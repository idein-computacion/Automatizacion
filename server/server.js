const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { google } = require('googleapis');
const fs = require('fs');
const os = require('os');
const { startExtraction, stopExtraction, getStatus, extractionEmitter } = require('./extractorService');
const { getApiKeysStatus, processImageWithGemini } = require('./visionService');
const { loadSavedCredentialsIfExist, generateAuthUrl, handleAuthCode, saveCredentials, listConnectedAccounts, authorize } = require('./authService');
const { getNextBatchInfo, getBaseDir, ACCOUNT_CONFIG } = require('./excelService');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── Constantes ───────────────────────────────────────────────────────────────

const BASE_COMPROBANTES_DIR = path.join(__dirname, '../comprobantes_guardados');

// Mapeo de diploma (nombre de gestión) a subcarpeta / cuenta de correo
const DIPLOMA_TO_EMAIL = {
  'DANZA': 'diplomaturadanza@gmail.com',
  'GUARANI': 'solopagosguarani@gmail.com',
  'LICENCIATURA': 'pagosfolklore@gmail.com',
  'DUELO': null // sin cuenta asociada aún
};

function getDiplomaDir(diploma) {
  if (!diploma) return BASE_COMPROBANTES_DIR;
  // Primero intentar con ACCOUNT_CONFIG por email
  for (const [email, config] of Object.entries(ACCOUNT_CONFIG)) {
    if (config.subDir === diploma.toUpperCase()) {
      return path.join(BASE_COMPROBANTES_DIR, config.subDir);
    }
  }
  // Fallback: carpeta con el mismo nombre del diploma
  return path.join(BASE_COMPROBANTES_DIR, diploma.toUpperCase());
}

// ─── OAuth callback ───────────────────────────────────────────────────────────

app.get('/', async (req, res, next) => {
  if (req.query.code) {
    try {
      const client = await handleAuthCode(req.query.code);
      const gmail = google.gmail({ version: 'v1', auth: client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const email = profile.data.emailAddress;

      await saveCredentials(client, email);

      return res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>Autenticación Exitosa - Extractor Gmail</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; height: 100vh; align-items: center; justify-content: center; margin: 0; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2.5rem; text-align: center; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
            h2 { color: #10b981; margin-top: 0; }
            .email { background: #0f172a; padding: 0.75rem 1rem; border-radius: 0.5rem; font-weight: bold; color: #38bdf8; margin: 1rem 0; border: 1px solid #334155; }
            .btn { display: inline-block; background: #6366f1; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; margin-top: 1rem; }
            .btn:hover { background: #4f46e5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>¡Cuenta Conectada Exitosamente!</h2>
            <p>Se ha autenticado correctamente la cuenta:</p>
            <div class="email">📧 ${email}</div>
            <p style="color: #94a3b8; font-size: 0.875rem;">El sistema de extracción con Gemini IA está listo para procesar comprobantes de esta casilla.</p>
            <a href="/" class="btn">Ir al Extractor</a>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      return res.status(500).send(`<h3>Error al procesar la autorización de Google: ${err.message}</h3>`);
    }
  }
  next();
});

// ─── Static files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '../')));

// ─── SSE Stream ───────────────────────────────────────────────────────────────

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (eventName, data) => {
    if (eventName === 'message') {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } else {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onRowExtracted   = (data) => send('row_extracted', data);
  const onBatchCompleted = (data) => send('batch_completed', data);
  const onEmailStart     = (data) => send('email_start', data);
  const onEmailSkip      = (data) => send('email_skip', data);
  const onSyncProgress   = (data) => send('sync_progress', data);
  const onSyncStart      = (data) => send('sync_start', data);
  const onSyncDone       = (data) => send('sync_done', data);

  extractionEmitter.on('row_extracted',   onRowExtracted);
  extractionEmitter.on('batch_completed', onBatchCompleted);
  extractionEmitter.on('email_start',     onEmailStart);
  extractionEmitter.on('email_skip',      onEmailSkip);
  extractionEmitter.on('sync_progress',   onSyncProgress);
  extractionEmitter.on('sync_start',      onSyncStart);
  extractionEmitter.on('sync_done',       onSyncDone);

  req.on('close', () => {
    extractionEmitter.off('row_extracted',   onRowExtracted);
    extractionEmitter.off('batch_completed', onBatchCompleted);
    extractionEmitter.off('email_start',     onEmailStart);
    extractionEmitter.off('email_skip',      onEmailSkip);
    extractionEmitter.off('sync_progress',   onSyncProgress);
    extractionEmitter.off('sync_start',      onSyncStart);
    extractionEmitter.off('sync_done',       onSyncDone);
  });
});

// ─── Cuentas / Auth ───────────────────────────────────────────────────────────

app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await listConnectedAccounts();
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth-url', async (req, res) => {
  try {
    const url = await generateAuthUrl();
    res.json({ authUrl: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/account', async (req, res) => {
  try {
    const emailToLoad = req.query.email;
    const auth = await loadSavedCredentialsIfExist(emailToLoad);
    if (!auth) {
      const authUrl = await generateAuthUrl();
      return res.json({ connected: false, authUrl });
    }
    const gmail = google.gmail({ version: 'v1', auth });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    res.json({
      connected: true,
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal
    });
  } catch (err) {
    const authUrl = await generateAuthUrl().catch(() => null);
    res.json({ connected: false, error: err.message, authUrl });
  }
});

// ─── Extracción (legado — inicia por /api/start con email) ───────────────────

app.get('/api/start', async (req, res) => {
  const status = getStatus();
  if (status.isRunning) {
    return res.json({ status: 'already running' });
  }

  try {
    const emailToLoad = req.query.email;
    if (!emailToLoad) {
      throw new Error('Debe especificar una cuenta de correo para iniciar la extracción.');
    }
    const authClient = await authorize(emailToLoad);
    startExtraction(15, authClient, emailToLoad).catch(console.error);
    res.json({ status: 'started' });
  } catch (err) {
    if (err.message === 'NOT_AUTHORIZED' && err.authUrl) {
      return res.json({ status: 'not_authorized', authUrl: err.authUrl });
    }
    return res.status(500).json({ error: err.message, authUrl: err.authUrl });
  }
});

app.get('/api/stop', (req, res) => {
  const result = stopExtraction();
  res.json(result);
});

app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

// ─── Sync Gmail por diploma ───────────────────────────────────────────────────

/**
 * POST /api/sync-gmail?diploma=DANZA
 * Inicia la extracción de Gmail para la gestión/diploma indicada.
 * Resuelve la cuenta de correo asociada según DIPLOMA_TO_EMAIL.
 */
app.post('/api/sync-gmail', async (req, res) => {
  const diploma = (req.query.diploma || '').toUpperCase();

  const status = getStatus();
  if (status.isRunning) {
    return res.json({ success: false, error: 'Ya hay una sincronización en curso.' });
  }

  // Resolver cuenta de correo para este diploma
  const email = DIPLOMA_TO_EMAIL[diploma] || null;

  if (!email) {
    return res.json({
      success: false,
      error: `No hay cuenta de correo configurada para la gestión "${diploma}". Verifica la configuración en el servidor.`
    });
  }

  try {
    const authClient = await authorize(email);
    startExtraction(15, authClient, email).catch(console.error);
    res.json({ success: true, message: `Sincronización iniciada para ${diploma} (${email})`, email });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Diplomas disponibles ─────────────────────────────────────────────────────

/**
 * GET /api/diplomas
 * Retorna la lista de diplomas/gestiones detectadas en comprobantes_guardados.
 */
app.get('/api/diplomas', (req, res) => {
  try {
    if (!fs.existsSync(BASE_COMPROBANTES_DIR)) {
      return res.json([]);
    }
    const entries = fs.readdirSync(BASE_COMPROBANTES_DIR, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name.toUpperCase());
    res.json(dirs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Archivos locales ─────────────────────────────────────────────────────────

/**
 * GET /api/local-files?diploma=DANZA
 * Lista todos los archivos de imagen/PDF en la carpeta más reciente del diploma.
 */
app.get('/api/local-files', (req, res) => {
  try {
    const diploma = (req.query.diploma || '').toUpperCase();
    const diplomaDir = getDiplomaDir(diploma);

    if (!fs.existsSync(diplomaDir)) {
      return res.json([]);
    }

    // Buscar la carpeta de planilla más reciente
    const entries = fs.readdirSync(diplomaDir, { withFileTypes: true });
    let latestNum = -1;
    let latestFolder = null;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/PLANILLA\s+N[°º]?\s*(\d+)-/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > latestNum) {
            latestNum = num;
            latestFolder = path.join(diplomaDir, entry.name);
          }
        }
      }
    }

    const scanDir = latestFolder || diplomaDir;
    const files = fs.readdirSync(scanDir)
      .filter(name => {
        const lower = name.toLowerCase();
        return lower.endsWith('.png') || lower.endsWith('.jpg') ||
               lower.endsWith('.jpeg') || lower.endsWith('.pdf');
      })
      .map(name => {
        const filePath = path.join(scanDir, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          size: stat.size,
          modified: stat.mtime,
          folderName: latestFolder ? path.basename(latestFolder) : diploma
        };
      });

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/local-files/download?name=1-GARCIA.jpg&diploma=DANZA
 * Devuelve el archivo binario para su uso en el OCR del frontend.
 */
app.get('/api/local-files/download', (req, res) => {
  try {
    const diploma = (req.query.diploma || '').toUpperCase();
    const fileName = req.query.name;

    if (!fileName) return res.status(400).json({ error: 'Falta parámetro name' });

    const diplomaDir = getDiplomaDir(diploma);

    // Buscar el archivo en la carpeta de planilla más reciente
    const entries = fs.existsSync(diplomaDir)
      ? fs.readdirSync(diplomaDir, { withFileTypes: true })
      : [];

    let latestNum = -1;
    let latestFolder = null;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/PLANILLA\s+N[°º]?\s*(\d+)-/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > latestNum) {
            latestNum = num;
            latestFolder = path.join(diplomaDir, entry.name);
          }
        }
      }
    }

    const scanDir = latestFolder || diplomaDir;
    const filePath = path.join(scanDir, path.basename(fileName));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Archivo no encontrado: ${fileName}` });
    }

    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/local-files/delete?diploma=DANZA
 * Elimina un archivo de la carpeta del diploma.
 */
app.post('/api/local-files/delete', (req, res) => {
  try {
    const diploma = (req.query.diploma || '').toUpperCase();
    const { fileName } = req.body;

    if (!fileName) return res.status(400).json({ error: 'Falta fileName en el body' });

    const diplomaDir = getDiplomaDir(diploma);
    const entries = fs.existsSync(diplomaDir)
      ? fs.readdirSync(diplomaDir, { withFileTypes: true })
      : [];

    let latestNum = -1;
    let latestFolder = null;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/PLANILLA\s+N[°º]?\s*(\d+)-/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > latestNum) { latestNum = num; latestFolder = path.join(diplomaDir, entry.name); }
        }
      }
    }

    const scanDir = latestFolder || diplomaDir;
    const filePath = path.join(scanDir, path.basename(fileName));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Archivo no encontrado: ${fileName}` });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: `Archivo ${fileName} eliminado.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/local-files/rename?diploma=DANZA
 * Renombra o guarda un archivo en la carpeta del diploma.
 */
app.post('/api/local-files/rename', (req, res) => {
  try {
    const diploma = (req.query.diploma || '').toUpperCase();
    const { originalName, newFileName, fileDataUrl } = req.body;

    if (!newFileName) return res.status(400).json({ error: 'Falta newFileName en el body' });

    const diplomaDir = getDiplomaDir(diploma);
    if (!fs.existsSync(diplomaDir)) {
      fs.mkdirSync(diplomaDir, { recursive: true });
    }

    const entries = fs.readdirSync(diplomaDir, { withFileTypes: true });
    let latestNum = -1;
    let latestFolder = null;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/PLANILLA\s+N[°º]?\s*(\d+)-/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > latestNum) { latestNum = num; latestFolder = path.join(diplomaDir, entry.name); }
        }
      }
    }

    // Si no hay planilla existente, usar getNextBatchInfo para crearla
    let targetDir = latestFolder;
    if (!targetDir) {
      // Resolver email del diploma para obtener batchInfo
      const email = DIPLOMA_TO_EMAIL[diploma] || null;
      if (email) {
        const batchInfo = getNextBatchInfo(email);
        targetDir = batchInfo.targetDir;
      } else {
        targetDir = diplomaDir;
      }
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    }

    const newFilePath = path.join(targetDir, path.basename(newFileName));

    // Si viene fileDataUrl, guardar desde base64
    if (fileDataUrl) {
      const base64Data = fileDataUrl.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(newFilePath, buffer);

      // Si el originalName es diferente al newFileName, eliminar el original
      if (originalName && originalName !== newFileName) {
        const origPath = path.join(targetDir, path.basename(originalName));
        if (fs.existsSync(origPath)) {
          fs.unlinkSync(origPath);
        }
      }

      return res.json({ success: true, newFileName, targetDir });
    }

    // Si no hay fileDataUrl, simplemente renombrar el archivo original
    if (!originalName) return res.status(400).json({ error: 'Falta originalName o fileDataUrl' });

    const origPath = path.join(targetDir, path.basename(originalName));
    if (!fs.existsSync(origPath)) {
      return res.status(404).json({ error: `Archivo original no encontrado: ${originalName}` });
    }

    fs.renameSync(origPath, newFilePath);
    res.json({ success: true, newFileName, targetDir });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Procesar imagen con Gemini (OCR) ─────────────────────────────────────────

app.get('/api/keys-status', async (req, res) => {
  try {
    const data = await getApiKeysStatus();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/process-image', async (req, res) => {
  try {
    const { base64, mimeType } = req.body;
    if (!base64) {
      return res.status(400).json({ error: 'Falta base64 de la imagen' });
    }

    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const ext = (mimeType || 'image/jpeg').includes('png') ? '.png' : '.jpg';
    const tempPath = path.join(os.tmpdir(), `upload_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);

    fs.writeFileSync(tempPath, buffer);

    try {
      const extracted = await processImageWithGemini(tempPath, mimeType || 'image/jpeg');
      return res.json(extracted);
    } finally {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    }
  } catch (err) {
    console.error('Error procesando imagen enviada:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
