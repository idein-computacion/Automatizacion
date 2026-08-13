const { google } = require('googleapis');
const fs = require('fs');

/**
 * Busca si una carpeta existe dentro de otra. Si no existe, la crea.
 * @param {object} auth - Cliente OAuth2 autenticado
 * @param {string} folderName - Nombre de la carpeta a buscar/crear
 * @param {string} parentId - ID de la carpeta padre en Google Drive
 * @returns {Promise<string>} - ID de la carpeta
 */
async function getOrCreateFolder(auth, folderName, parentId) {
  if (!parentId) {
    throw new Error('parentId es requerido para crear/buscar carpetas en Drive.');
  }

  const drive = google.drive({ version: 'v3', auth });

  try {
    // Buscar carpeta por nombre y parentId
    const query = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${parentId}' in parents and trashed=false`;
    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (res.data.files && res.data.files.length > 0) {
      // Retornar la primera coincidencia
      return res.data.files[0].id;
    }

    // Si no existe, crearla
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    };

    const createRes = await drive.files.create({
      resource: fileMetadata,
      fields: 'id',
      supportsAllDrives: true,
    });

    return createRes.data.id;
  } catch (err) {
    console.error(`Error al buscar/crear carpeta '${folderName}' en Drive:`, err);
    throw err;
  }
}

/**
 * Sube o actualiza un archivo en Google Drive.
 * @param {object} auth - Cliente OAuth2 autenticado
 * @param {string} filePath - Ruta local del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @param {string} parentId - ID de la carpeta destino en Google Drive
 * @param {string} fileName - Nombre del archivo destino
 */
async function uploadOrUpdateFile(auth, filePath, mimeType, parentId, fileName) {
  if (!parentId) {
    throw new Error('parentId es requerido para subir archivos a Drive.');
  }

  const drive = google.drive({ version: 'v3', auth });

  try {
    // Buscar si el archivo ya existe
    const query = `name='${fileName}' and '${parentId}' in parents and trashed=false`;
    const searchRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const media = {
      mimeType: mimeType,
      body: fs.createReadStream(filePath),
    };

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      // Actualizar archivo existente
      const fileId = searchRes.data.files[0].id;
      await drive.files.update({
        fileId: fileId,
        media: media,
        supportsAllDrives: true,
      });
      console.log(`Archivo actualizado en Drive: ${fileName} (ID: ${fileId})`);
      return fileId;
    } else {
      // Crear nuevo archivo
      const fileMetadata = {
        name: fileName,
        parents: [parentId],
      };
      const createRes = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id',
        supportsAllDrives: true,
      });
      console.log(`Archivo subido a Drive: ${fileName} (ID: ${createRes.data.id})`);
      return createRes.data.id;
    }
  } catch (err) {
    console.error(`Error al subir/actualizar archivo '${fileName}' en Drive:`, err);
    throw err;
  }
}

module.exports = {
  getOrCreateFolder,
  uploadOrUpdateFile
};
