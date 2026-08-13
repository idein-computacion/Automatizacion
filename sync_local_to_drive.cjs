const fs = require('fs');
const path = require('path');
// Cargar .env para que process.env.DRIVE_ROOT_FOLDER_ID_DANZA exista
require('./server/node_modules/dotenv').config({ path: path.join(__dirname, 'server', '.env') });

const { authorize } = require('./server/authService');
const { getOrCreateFolder, uploadOrUpdateFile } = require('./server/driveService');
const { ACCOUNT_CONFIG } = require('./server/excelService');

async function syncFolder(email, diplomaDir, folderName) {
  console.log(`\n--- Sincronizando ${diplomaDir} / ${folderName} ---`);
  const auth = await authorize(email);
  const localBatchPath = path.join(__dirname, 'comprobantes_guardados', diplomaDir, folderName);
  
  if (!fs.existsSync(localBatchPath)) {
    console.log(`No existe la carpeta local ${localBatchPath}`);
    return;
  }
  
  const config = ACCOUNT_CONFIG[email];
  if (!config) {
    console.log(`Error: No hay configuración para ${email} en ACCOUNT_CONFIG`);
    return;
  }
  
  const rootDriveId = config.driveRootFolderId;
  if (!rootDriveId) {
    console.log(`Error: No hay un DRIVE_ROOT_FOLDER_ID configurado para ${email}`);
    return;
  }
  
  console.log(`ID Raiz de Drive: ${rootDriveId}`);
  console.log(`Buscando/creando carpeta ${diplomaDir} en Drive...`);
  const driveDiplomaFolderId = await getOrCreateFolder(auth, diplomaDir, rootDriveId);
  
  console.log(`Buscando/creando carpeta ${folderName} en Drive...`);
  const driveBatchFolderId = await getOrCreateFolder(auth, folderName, driveDiplomaFolderId);
  
  const files = fs.readdirSync(localBatchPath);
  for (const file of files) {
    const filePath = path.join(localBatchPath, file);
    if (!fs.statSync(filePath).isFile()) continue;
    
    let mimeType = 'application/octet-stream';
    if (file.toLowerCase().endsWith('.png')) mimeType = 'image/png';
    else if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (file.toLowerCase().endsWith('.pdf')) mimeType = 'application/pdf';
    else if (file.toLowerCase().endsWith('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    
    console.log(`Subiendo ${file}...`);
    await uploadOrUpdateFile(auth, filePath, mimeType, driveBatchFolderId, file);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const foldersToSync = args.length > 0 ? args : ['PLANILLA N 74-2026', 'PLANILLA N 75-2026'];
  const diplomaDir = 'DANZA';
  const email = 'diplomaturadanza@gmail.com';
  
  for (const folder of foldersToSync) {
     await syncFolder(email, diplomaDir, folder);
  }
  console.log('\n¡Proceso finalizado!');
}

main().catch(console.error);
