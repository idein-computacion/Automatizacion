const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive'
];

function getFilePath(filename) {
  const rootPath = path.join(__dirname, '..', filename);
  if (fsSync.existsSync(rootPath)) return rootPath;
  const serverPath = path.join(__dirname, filename);
  if (fsSync.existsSync(serverPath)) return serverPath;
  return path.join(process.cwd(), filename);
}

async function getOAuth2Client() {
  const credPath = getFilePath('credentials.json');
  if (!fsSync.existsSync(credPath)) {
    throw new Error(`Archivo credentials.json no encontrado en ${credPath}`);
  }
  const content = await fs.readFile(credPath, 'utf8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  const redirectUri = (key.redirect_uris && key.redirect_uris.length > 0) ? key.redirect_uris[0] : 'http://localhost';
  return new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    redirectUri
  );
}

async function loadSavedCredentialsIfExist(email) {
  if (!email) return null;
  try {
    const tokenPath = getFilePath(`token_${email}.json`);
    if (!fsSync.existsSync(tokenPath)) return null;

    const tokenContent = await fs.readFile(tokenPath, 'utf8');
    const tokenData = JSON.parse(tokenContent);
    const oAuth2Client = await getOAuth2Client();

    if (tokenData.type === 'authorized_user') {
      const client = google.auth.fromJSON(tokenData);
      await client.getAccessToken();
      return client;
    } else {
      oAuth2Client.setCredentials(tokenData);
      await oAuth2Client.getAccessToken();
      return oAuth2Client;
    }
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client, email) {
  if (!email) return;
  const tokenPath = path.join(__dirname, '..', `token_${email}.json`);
  const credPath = getFilePath('credentials.json');
  const content = await fs.readFile(credPath, 'utf8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  let payload;
  if (client.credentials && client.credentials.refresh_token) {
    payload = JSON.stringify(client.credentials, null, 2);
  } else {
    payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials ? client.credentials.refresh_token : null,
      access_token: client.credentials ? client.credentials.access_token : null,
    }, null, 2);
  }
  await fs.writeFile(tokenPath, payload);
}

async function generateAuthUrl() {
  const oAuth2Client = await getOAuth2Client();
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function handleAuthCode(code) {
  const oAuth2Client = await getOAuth2Client();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  return oAuth2Client;
}

async function authorize(email) {
  let client = await loadSavedCredentialsIfExist(email);
  if (client) {
    return client;
  }
  const authUrl = await generateAuthUrl();
  console.log('\n========================================================================');
  console.log('🤖 PARA CONECTAR TU CUENTA DE GMAIL, ABRE EL SIGUIENTE ENLACE EN TU NAVEGADOR:');
  console.log(authUrl);
  console.log('========================================================================\n');
  
  const error = new Error('NOT_AUTHORIZED');
  error.authUrl = authUrl;
  throw error;
}

async function listConnectedAccounts() {
  const rootPath = path.join(__dirname, '..');
  const files = await fs.readdir(rootPath);
  const accounts = files
    .filter(f => f.startsWith('token_') && f.endsWith('.json'))
    .map(f => f.replace('token_', '').replace('.json', ''));
  return accounts;
}

module.exports = {
  authorize,
  loadSavedCredentialsIfExist,
  getOAuth2Client,
  generateAuthUrl,
  handleAuthCode,
  saveCredentials,
  listConnectedAccounts
};
