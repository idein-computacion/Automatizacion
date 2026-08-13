const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const BASE_DIR = path.join(__dirname, '../comprobantes_guardados');

// Mapeo de cuenta de correo a subcarpeta y metadata del proyecto
const ACCOUNT_CONFIG = {
  'diplomaturadanza@gmail.com': {
    subDir: 'DANZA',
    projectName: 'Esp y Dipl Sup en Danzas folkloricas Regionales',
    budgetUnit: 'Unidad presupuestaria 147',
    driveRootFolderId: process.env.DRIVE_ROOT_FOLDER_ID_DANZA || null
  },
  'solopagosguarani@gmail.com': {
    subDir: 'GUARANI',
    projectName: 'Diplomatura Superior en Lengua y Cultura Guaraní',
    budgetUnit: 'Unidad presupuestaria 135',
    driveRootFolderId: process.env.DRIVE_ROOT_FOLDER_ID_GUARANI || null
  },
  'pagosfolklore@gmail.com': {
    subDir: 'LICENCIATURA',
    projectName: 'CCC Licenciatura en Folklore con mención en cultura regional',
    budgetUnit: 'Unidad presupuestaria 166',
    driveRootFolderId: process.env.DRIVE_ROOT_FOLDER_ID_LICENCIATURA || null
  }
};

/**
 * Returns the base directory for the given email account.
 * Falls back to BASE_DIR if no matching account found.
 */
function getBaseDir(email) {
  const config = email ? ACCOUNT_CONFIG[email.toLowerCase().trim()] : null;
  if (config) {
    return path.join(BASE_DIR, config.subDir);
  }
  return BASE_DIR;
}

/**
 * Scans the account-specific subdirectory to find existing `PLANILLA N XX-YYYY` folders
 * and determines the batch info, resuming if the last batch has less than 15 records.
 * @param {string} email - The active Gmail account
 */
async function getNextBatchInfo(email) {
  const accountBaseDir = getBaseDir(email);

  if (!fs.existsSync(accountBaseDir)) {
    fs.mkdirSync(accountBaseDir, { recursive: true });
  }

  const entries = fs.readdirSync(accountBaseDir, { withFileTypes: true });
  let maxNum = 0;
  const folderMap = new Map();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const match = entry.name.match(/PLANILLA\s+N[°º]?\s*(\d+)-/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
        folderMap.set(num, entry.name);
      }
    }
  }

  let targetNum = maxNum + 1;
  let existingRecords = [];
  let foundIncomplete = false;

  // Buscar la PRIMERA carpeta incompleta (desde la 1 hasta maxNum)
  for (let i = 1; i <= maxNum; i++) {
    const folderName = folderMap.get(i);
    if (folderName) {
      const folderPath = path.join(accountBaseDir, folderName);
      const files = fs.readdirSync(folderPath);
      // Contar imágenes o PDFs
      const imageCount = files.filter(f => f.match(/\.(jpg|jpeg|png|pdf)$/i)).length;
      
      // Si hay menos de 15 comprobantes, revisamos el Excel para confirmar
      if (imageCount < 15) {
        const excelFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
        let records = [];
        if (excelFiles.length > 0) {
          const currentExcelPath = path.join(folderPath, excelFiles[0]);
          try {
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.readFile(currentExcelPath);
            const ws = wb.getWorksheet(1) || wb.worksheets[0];
            
            for (let r = 5; r <= 19; r++) { // Filas 5 a 19 (15 registros)
              const row = ws.getRow(r);
              if (row.getCell(2).value) {
                records.push([
                  row.getCell(2).value,
                  row.getCell(3).value,
                  row.getCell(4).value,
                  row.getCell(5).value,
                  row.getCell(6).value,
                  row.getCell(7).value,
                  row.getCell(8).value
                ]);
              }
            }
          } catch (err) {
            console.error(`Error reading existing excel ${currentExcelPath}:`, err);
          }
        }
        
        if (records.length < 15) {
          targetNum = i;
          existingRecords = records;
          foundIncomplete = true;
          break; // Encontramos la primera incompleta, nos detenemos aquí
        }
      }
    }
  }

  // Si todas están completas o no había ninguna
  if (!foundIncomplete) {
    targetNum = maxNum === 0 ? 1 : maxNum + 1;
    existingRecords = [];
  }

  const folderName = `PLANILLA N ${targetNum}-2026`;
  const excelFileName = `PLANILLA N ${targetNum}-2026.xlsx`;
  const c2Value = `${targetNum} - 2026.`;
  const targetDir = path.join(accountBaseDir, folderName);

  return {
    num: targetNum,
    folderName,
    excelFileName,
    c2Value,
    targetDir,
    accountBaseDir,
    existingRecords
  };
}

/**
 * Finds the latest existing Excel file within the account-specific subdirectory
 * to use as a formatting template.
 * @param {string} email - The active Gmail account
 */
function getTemplateExcelPath(email) {
  const accountBaseDir = getBaseDir(email);
  if (!fs.existsSync(accountBaseDir)) return null;

  const entries = fs.readdirSync(accountBaseDir, { withFileTypes: true });
  let latestNum = -1;
  let latestPath = null;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const match = entry.name.match(/PLANILLA\s+N[°º]?\s*(\d+)-/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const folderPath = path.join(accountBaseDir, entry.name);
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          if (file.startsWith('PLANILLA') && file.endsWith('.xlsx') && !file.startsWith('~$')) {
            if (num > latestNum) {
              latestNum = num;
              latestPath = path.join(folderPath, file);
            }
          }
        }
      }
    }
  }

  return latestPath;
}

/**
 * Creates or updates the batch Excel file.
 * @param {string} targetDir  - Directory where images & Excel are saved
 * @param {string} excelFileName - Name of Excel file (e.g. PLANILLA N 65-2026.xlsx)
 * @param {string} c2Value   - Cell C2 value (e.g. "65 - 2026.")
 * @param {Array}  records   - Array of row arrays to write starting at Row 5
 * @param {string} email     - Active Gmail account (used for project metadata)
 */
async function generateBatchExcel(targetDir, excelFileName, c2Value, records, email) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const excelPath = path.join(targetDir, excelFileName);
  const templatePath = getTemplateExcelPath(email);

  // Resolve account-specific project metadata
  const config = email ? ACCOUNT_CONFIG[email.toLowerCase().trim()] : null;
  const projectName = config ? config.projectName : 'Esp y Dipl Sup en Danzas folkloricas Regionales';
  const budgetUnit = config ? config.budgetUnit : 'Unidad presupuestaria 147';

  const wb = new ExcelJS.Workbook();
  if (templatePath && fs.existsSync(templatePath)) {
    await wb.xlsx.readFile(templatePath);
  } else {
    const ws = wb.addWorksheet('Hoja1');
    ws.getCell('B1').value = 'N° Y NOMBRE DEL PROYECTO';
    ws.getCell('C1').value = 'PLANILLA N.°';
    ws.getCell('D1').value = 'FECHA DE ENVÍO';
    ws.getCell('B2').value = projectName;
    ws.getCell('B3').value = budgetUnit;
    ws.getRow(4).values = ['N°', 'APELLIDO - NOMBRE', 'DNI', 'BANCO', 'OPERACIÓN N°', 'FECHA DE LA OPERACIÓN', 'MONTO', 'TITULAR DE LA CUENTA'];
  }

  const ws = wb.getWorksheet(1) || wb.worksheets[0];

  // Always set correct project metadata (even when using a template)
  ws.getCell('B2').value = projectName;
  ws.getCell('B3').value = budgetUnit;

  // Set planilla number and current date
  ws.getCell('C2').value = c2Value;
  ws.getCell('D2').value = new Date();

  // Clear previous sample data rows (Rows 5 to 22)
  for (let r = 5; r <= 22; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 8; c++) {
      row.getCell(c).value = null;
    }
    row.commit();
  }

  // Write new records starting at Row 5 (Cols A to H)
  records.forEach((rec, idx) => {
    const rowIdx = 5 + idx;
    const itemNum = idx + 1;
    const row = ws.getRow(rowIdx);

    let nombre = '', dni = '', banco = '', nroOp = '', fecha = '', monto = 0, titular = '';

    if (Array.isArray(rec)) {
      nombre  = rec[0] || '';
      dni     = rec[1] ? (parseInt(String(rec[1]).replace(/\D/g, ''), 10) || String(rec[1])) : '';
      banco   = rec[2] || '';
      nroOp   = rec[3] || '';
      fecha   = rec[4] || '';
      monto   = rec[5] ? (parseInt(String(rec[5]).replace(/\D/g, ''), 10) || 0) : 0;
      titular = rec[6] || '';
    } else {
      nombre  = rec.nombre || '';
      dni     = rec.dni ? (parseInt(String(rec.dni).replace(/\D/g, ''), 10) || String(rec.dni)) : '';
      banco   = rec.banco || '';
      nroOp   = rec.nroOperacion || '';
      fecha   = rec.fecha || '';
      monto   = rec.monto ? (parseInt(String(rec.monto).replace(/\D/g, ''), 10) || 0) : 0;
      titular = rec.titular || '';
    }

    row.getCell(1).value = itemNum;
    row.getCell(2).value = nombre;
    row.getCell(3).value = dni;
    row.getCell(4).value = banco;
    row.getCell(5).value = nroOp;
    row.getCell(6).value = fecha;
    row.getCell(7).value = monto;
    row.getCell(8).value = titular;

    row.commit();
  });

  // Total row right after records
  const totalRowIdx = 5 + records.length;
  const totalRow = ws.getRow(totalRowIdx);
  totalRow.getCell(1).value = 'TOTAL';
  totalRow.getCell(7).value = { formula: `SUM(G5:G${totalRowIdx - 1})` };
  totalRow.commit();

  await wb.xlsx.writeFile(excelPath);
  console.log(`Excel generado exitosamente en: ${excelPath}`);
  return excelPath;
}

module.exports = {
  getNextBatchInfo,
  getTemplateExcelPath,
  generateBatchExcel,
  getBaseDir,
  ACCOUNT_CONFIG
};
