require('dotenv').config();
const { authorize } = require('./authService');
const { appendToSheet } = require('./sheetsService');
const { extractionEmitter } = require('./extractorService');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1-XH5Bnd1IqTHy0_pa-9szv86MxRZpoJEIad02IzCAIs';

const rowSilvia = [
  "DUARTE, SILVIA ALEJANDRA",
  "26595551",
  "Banco Macro",
  "70162501",
  "02/06/2026",
  "$ 30.000",
  "Silvia Alejandra Duarte"
];

const rowMarisa = [
  "OLMEDO, MARISA SILVINA",
  "27299195",
  "Mercado Pago",
  "164930338835",
  "25/06/2026",
  "$ 30.000",
  "Marisa Silvina Olmedo"
];

async function run() {
  try {
    const auth = await authorize();
    
    console.log('Agregando fila de Silvia Duarte...');
    await appendToSheet(auth, SPREADSHEET_ID, 'A:G', rowSilvia);
    extractionEmitter.emit('row_extracted', rowSilvia);
    console.log('Fila de Silvia Duarte agregada con éxito.');

    console.log('Agregando fila de Marisa Olmedo...');
    await appendToSheet(auth, SPREADSHEET_ID, 'A:G', rowMarisa);
    extractionEmitter.emit('row_extracted', rowMarisa);
    console.log('Fila de Marisa Olmedo agregada con éxito.');

    process.exit(0);
  } catch (error) {
    console.error('Error al insertar filas:', error);
    process.exit(1);
  }
}

run();
