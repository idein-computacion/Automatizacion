const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { authorize } = require('./authService');
const { getUnreadEmails, downloadAttachments, addLabelToEmail, markAsRead, markAsUnread, sendReplyEmail } = require('./gmailService');
const { processImageWithGemini } = require('./visionService');
const { appendToSheet } = require('./sheetsService');
const { getNextBatchInfo, generateBatchExcel, ACCOUNT_CONFIG } = require('./excelService');
const { saveToFirebase } = require('./firebaseService');
const { getOrCreateFolder, uploadOrUpdateFile } = require('./driveService');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Función auxiliar para obtener el primer apellido en mayúsculas
function getFirstSurname(nameStr) {
  if (!nameStr || nameStr.startsWith('Falta') || nameStr === 'Revisar') return 'DESCONOCIDO';
  if (nameStr.includes(',')) {
    const surname = nameStr.split(',')[0].trim();
    return surname.toUpperCase();
  }
  const parts = nameStr.trim().split(/\s+/);
  return parts[0].toUpperCase();
}

// Función de espera para evitar límites de API (Rate limits)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isRunning = false;
let shouldStop = false;
const extractionEmitter = new EventEmitter();

const sessionOperationsSet = new Set();
let sessionRecordCounter = 0;

/**
 * Valida si un registro extraído es completo y utilizeable.
 * Retorna null si es válido, o un string con el motivo si es inválido.
 */
function validateRecord(data) {
  if (!data) return 'Sin datos extraídos';

  const nombre = data.nombre || '';
  const monto = String(data.monto || '');
  const op = data.nroOperacion || '';

  const nombreInvalido =
    !nombre ||
    nombre.startsWith('Falta') ||
    nombre.includes('DESCONOCIDO') ||
    nombre.includes('NO_SE_PUDO') ||
    nombre.trim() === '';

  const montoInvalido =
    !monto ||
    monto === '0' ||
    monto === '0.00' ||
    monto.startsWith('Falta') ||
    monto.trim() === '';

  const opInvalida =
    !op ||
    op.startsWith('Falta') ||
    op.includes('NO_SE_PUDO') ||
    op.trim() === '';

  // Si los tres campos clave son inválidos => completamente inútil
  if (nombreInvalido && montoInvalido && opInvalida) {
    return 'Sin datos válidos (nombre, monto y operación ausentes)';
  }

  // Si al menos nombre y monto son inválidos
  if (nombreInvalido && montoInvalido) {
    return 'Nombre y monto no identificados';
  }

  return null; // válido
}

/**
 * Inicia la extracción de comprobantes de la cuenta de correo especificada.
 * @param {number} targetLimit - Cantidad máxima de comprobantes a procesar en este lote
 * @param {object} authClient  - Cliente OAuth2 autenticado
 * @param {string} activeEmail - Cuenta de correo activa (determina carpeta destino y metadata del Excel)
 */
async function startExtraction(targetLimit = 15, authClient, activeEmail) {
  if (isRunning) return { status: 'already running' };

  isRunning = true;
  shouldStop = false;
  sessionRecordCounter = 0;
  sessionOperationsSet.clear();

  // getNextBatchInfo ahora recibe el email para resolver la subcarpeta correcta
  const batchInfo = await getNextBatchInfo(activeEmail);
  if (!fs.existsSync(batchInfo.targetDir)) {
    fs.mkdirSync(batchInfo.targetDir, { recursive: true });
  }
  console.log(`Iniciando escaneo para lote: ${batchInfo.folderName} (Excel: ${batchInfo.excelFileName}) [Cuenta: ${activeEmail || 'sin especificar'}]...`);

  let driveBatchFolderId = null;
  try {
    const config = activeEmail ? ACCOUNT_CONFIG[activeEmail.toLowerCase().trim()] : null;
    const rootDriveId = config ? config.driveRootFolderId : null;
    if (rootDriveId) {
       console.log(`Resolviendo carpetas en Google Drive...`);
       const diplomaName = path.basename(batchInfo.accountBaseDir);
       const driveDiplomaFolderId = await getOrCreateFolder(authClient, diplomaName, rootDriveId);
       driveBatchFolderId = await getOrCreateFolder(authClient, batchInfo.folderName, driveDiplomaFolderId);
       console.log(`Carpeta destino en Google Drive resuelta (ID: ${driveBatchFolderId})`);
    } else {
       console.log(`No hay configuración de Drive para esta cuenta. Se omitirá subida a Drive.`);
    }
  } catch(err) {
    console.error('Error al resolver carpetas de Drive, se continuará localmente:', err);
  }

  // Emitir evento de inicio de sincronización
  extractionEmitter.emit('sync_start', {
    folderName: batchInfo.folderName,
    targetDir: batchInfo.targetDir,
    activeEmail,
    targetLimit
  });

  const existingRecords = batchInfo.existingRecords || [];
  const batchRecords = [...existingRecords];
  let validProcessedCount = existingRecords.length;
  let totalEmailsScanned = 0;

  sessionRecordCounter = existingRecords.length;
  existingRecords.forEach(rec => {
    if (rec[3]) {
      sessionOperationsSet.add(rec[3].toString().trim());
    }
  });

  try {
    const auth = authClient;

    while (validProcessedCount < targetLimit && !shouldStop) {
      // Buscar correos que NO tengan la etiqueta Procesados
      const emails = await getUnreadEmails(auth, 20);
      if (!emails || emails.length === 0) {
        console.log('No hay más correos pendientes de procesamiento en Gmail.');
        break;
      }

      for (const email of emails) {
        if (shouldStop || validProcessedCount >= targetLimit) break;

        const { id, subject, body, attachments } = email;
        totalEmailsScanned++;

        // Emitir evento: comenzando a procesar este correo
        extractionEmitter.emit('email_start', {
          emailId: id,
          subject: subject || '(Sin asunto)',
          index: totalEmailsScanned,
          hasAttachments: !!(attachments && attachments.length > 0)
        });

        let downloadedFiles = [];

        if (attachments && attachments.length > 0) {
          downloadedFiles = await downloadAttachments(auth, id, attachments);
        }

        if (!downloadedFiles || downloadedFiles.length === 0) {
          console.log(`Correo ID ${id} ("${subject}") sin adjuntos procesables. Marcando como Revisar y NO LEÍDO...`);

          // Emitir evento: correo omitido sin adjuntos
          extractionEmitter.emit('email_skip', {
            emailId: id,
            subject: subject || '(Sin asunto)',
            reason: 'Sin adjuntos de imagen o PDF',
            index: totalEmailsScanned
          });

          await addLabelToEmail(auth, id, 'Revisar');
          await markAsUnread(auth, id);
          continue;
        }

        let processedAnyFile = false;
        let sentReply = false;

        for (const file of downloadedFiles) {
          if (shouldStop || validProcessedCount >= targetLimit) break;

          let attachmentData = null;
          let processSuccess = false;

          while (!processSuccess && !shouldStop) {
            try {
              attachmentData = await processImageWithGemini([file], null, subject, body);
              processSuccess = true;
            } catch (e) {
              const errMsg = e.message || String(e);
              if (errMsg.includes('429') || errMsg.includes('cuota') || errMsg === 'RATE_LIMIT_EXCEEDED') {
                console.log('Todas las claves API alcanzaron el límite de cuota 429. Pausando 15 segundos para renovar cuota...');
                extractionEmitter.emit('email_skip', {
                  emailId: id,
                  subject: subject || '(Sin asunto)',
                  reason: 'Límite de API (429) — reintentando en 15s',
                  index: totalEmailsScanned
                });
                let waitedRate = 0;
                while (waitedRate < 15000 && !shouldStop) {
                  await sleep(1000);
                  waitedRate += 1000;
                }
              } else {
                console.error('Error al procesar el correo/adjunto:', errMsg);
                break;
              }
            }
          }

          if (!processSuccess || shouldStop) {
            console.log(`Omitiendo archivo ${file.filename} por error en análisis.`);
            extractionEmitter.emit('email_skip', {
              emailId: id,
              subject: subject || '(Sin asunto)',
              reason: `Error al analizar adjunto: ${file.filename}`,
              index: totalEmailsScanned
            });
            continue;
          }

          // ─── Validación estricta de registro ───────────────────────────────
          const invalidReason = validateRecord(attachmentData);
          if (invalidReason) {
            console.log(`Archivo ${file.filename} rechazado: ${invalidReason}`);
            extractionEmitter.emit('email_skip', {
              emailId: id,
              subject: subject || '(Sin asunto)',
              reason: `Datos insuficientes: ${invalidReason}`,
              index: totalEmailsScanned,
              filename: file.filename
            });
            continue;
          }

          // ─── Verificación de duplicados por N° de operación ─────────────
          const op = attachmentData.nroOperacion ? attachmentData.nroOperacion.trim() : '';
          if (op && op !== 'Falta nroOperacion' && sessionOperationsSet.has(op)) {
            console.log(`Comprobante duplicado omitido: N° Operación ${op}`);
            extractionEmitter.emit('email_skip', {
              emailId: id,
              subject: subject || '(Sin asunto)',
              reason: `Comprobante duplicado (Op. ${op})`,
              index: totalEmailsScanned
            });
            continue;
          }

          if (op && op !== 'Falta nroOperacion') {
            sessionOperationsSet.add(op);
          }

          sessionRecordCounter++;
          const surname = (
            attachmentData.primerApellido &&
            !attachmentData.primerApellido.startsWith('Falta') &&
            attachmentData.primerApellido !== 'Revisar'
          ) ? attachmentData.primerApellido.toUpperCase().trim() : getFirstSurname(attachmentData.nombre);

          let savedFilename = null;

          // Guardar comprobante en la subcarpeta correcta según la cuenta activa
          if (file.path && fs.existsSync(file.path)) {
            const stats = fs.statSync(file.path);
            if (stats.size >= 2500) {
              const ext = path.extname(file.path) || '.jpg';
              const newFilename = `${sessionRecordCounter}-${surname}${ext}`;
              const destPath = path.join(batchInfo.targetDir, newFilename);
              fs.copyFileSync(file.path, destPath);
              savedFilename = newFilename;
              console.log(`Comprobante guardado en ${batchInfo.folderName}: ${newFilename}`);
              
              if (driveBatchFolderId) {
                 try {
                    const mimeType = ext.toLowerCase().includes('pdf') ? 'application/pdf' : (ext.toLowerCase().includes('png') ? 'image/png' : 'image/jpeg');
                    await uploadOrUpdateFile(auth, destPath, mimeType, driveBatchFolderId, newFilename);
                 } catch(err) {
                    console.error('Error al subir imagen a Drive:', err);
                 }
              }
            }
          }

          if (attachmentData.nombre && !attachmentData.nombre.startsWith('Falta')) {
            attachmentData.nombre = attachmentData.nombre.toUpperCase().trim();
          }
          if (attachmentData.titular && !attachmentData.titular.startsWith('Falta')) {
            attachmentData.titular = attachmentData.titular.toUpperCase().trim();
          }
          if (attachmentData.fecha && !attachmentData.fecha.startsWith('Falta')) {
            attachmentData.fecha = attachmentData.fecha.replace(/[/.]/g, '-').trim();
          }
          if (attachmentData.monto && !attachmentData.monto.startsWith('Falta')) {
            const cleanMonto = attachmentData.monto.replace(/[^0-9]/g, '');
            if (cleanMonto) {
              attachmentData.monto = parseInt(cleanMonto, 10).toString();
            }
          }
          if (attachmentData.nroOperacion && !attachmentData.nroOperacion.startsWith('Falta')) {
            attachmentData.nroOperacion = attachmentData.nroOperacion.trim().toString();
          }

          const row = [
            attachmentData.nombre,
            attachmentData.dni,
            attachmentData.banco,
            attachmentData.nroOperacion,
            attachmentData.fecha,
            attachmentData.monto,
            attachmentData.titular
          ];

          if (SPREADSHEET_ID) {
            await appendToSheet(auth, SPREADSHEET_ID, 'A:G', row);
            console.log(`Fila ${sessionRecordCounter} (${surname}) agregada a Google Sheets.`);
          }

          batchRecords.push(row);
          try {
            const excelLocalPath = await generateBatchExcel(batchInfo.targetDir, batchInfo.excelFileName, batchInfo.c2Value, batchRecords, activeEmail);
            console.log(`Excel ${batchInfo.excelFileName} actualizado con ${batchRecords.length} registro(s).`);
            
            if (driveBatchFolderId && excelLocalPath) {
               await uploadOrUpdateFile(auth, excelLocalPath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', driveBatchFolderId, batchInfo.excelFileName);
            }
          } catch (excelErr) {
            console.error('Error al actualizar archivo Excel:', excelErr);
          }

          // Guardar en Firebase
          await saveToFirebase(activeEmail, attachmentData, savedFilename);

          // Emitir evento de fila extraída válida con información completa
          extractionEmitter.emit('row_extracted', {
            row,
            recordNumber: sessionRecordCounter,
            savedFilename,
            folderName: batchInfo.folderName,
            subject: subject || '(Sin asunto)',
            emailId: id,
            index: totalEmailsScanned,
            nombre: attachmentData.nombre,
            dni: attachmentData.dni || '',
            monto: attachmentData.monto,
            banco: attachmentData.banco,
            operacion: attachmentData.nroOperacion,
            fecha: attachmentData.fecha,
            titular: attachmentData.titular || ''
          });

          // Emitir progreso numérico
          extractionEmitter.emit('sync_progress', {
            current: validProcessedCount + 1,
            total: targetLimit,
            folderName: batchInfo.folderName
          });

          validProcessedCount++;
          processedAnyFile = true;
          console.log(`Progreso de lote: ${validProcessedCount}/${targetLimit}`);

          let waited = 0;
          while (waited < 2000) {
            if (shouldStop) break;
            await sleep(500);
            waited += 500;
          }
        } // fin for archivos

        if (processedAnyFile) {
          if (!sentReply) {
            const successMessage = 'Buenas tardes, el pago fue registrado correctamente. Saludos Cordiales';
            await sendReplyEmail(auth, id, successMessage);
            sentReply = true;
          }
          await markAsRead(auth, id);
          await addLabelToEmail(auth, id, 'Procesados');
        } else {
          console.log(`Correo ID ${id} ("${subject}") sin comprobante/datos válidos. Marcando como Revisar y NO LEÍDO (no se carga)...`);
          await addLabelToEmail(auth, id, 'Revisar');
          await markAsUnread(auth, id);
        }
      }
    }

    if (validProcessedCount >= targetLimit) {
      console.log(`Lote de ${targetLimit} comprobantes completado exitosamente.`);
      extractionEmitter.emit('batch_completed', {
        count: validProcessedCount,
        message: `¡Límite de ${targetLimit} comprobantes alcanzado! Por favor copie los registros a su archivo de Excel.`
      });
    }

    // Emitir evento de sincronización finalizada
    extractionEmitter.emit('sync_done', {
      validCount: validProcessedCount,
      totalScanned: totalEmailsScanned,
      folderName: batchInfo.folderName,
      stopped: shouldStop
    });

  } catch (error) {
    console.error('Error durante el proceso:', error);
    extractionEmitter.emit('sync_done', {
      validCount: validProcessedCount,
      totalScanned: totalEmailsScanned,
      folderName: batchInfo.folderName,
      error: error.message
    });
  } finally {
    isRunning = false;
  }
}

function stopExtraction() {
  if (isRunning) {
    shouldStop = true;
    return { status: 'stopping' };
  }
  return { status: 'not running' };
}

function getStatus() {
  return { isRunning, sessionRecordCounter };
}

module.exports = { startExtraction, stopExtraction, getStatus, extractionEmitter };
