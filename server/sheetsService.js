const { google } = require('googleapis');

async function appendToSheet(auth, spreadsheetId, range, values) {
  const sheets = google.sheets({ version: 'v4', auth });
  
  const resource = {
    values: [values],
  };

  try {
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource,
    });
    return result;
  } catch (error) {
    console.error('Error al insertar fila en Google Sheets:', error);
    throw error;
  }
}

module.exports = {
  appendToSheet
};
