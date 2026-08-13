const { processImageWithGemini } = require('./visionService');

async function testGemini() {
  try {
    const downloadedFiles = [
      {
        path: 'C:\\Automatizacion\\server\\temp\\mercadopago_comprobante_171306347533.png',
        mimeType: 'image/png',
        filename: 'mercadopago_comprobante_171306347533.png'
      }
    ];
    console.log('Running processImageWithGemini...');
    const result = await processImageWithGemini(downloadedFiles, null, 'pago matrícula', '');
    console.log('Result:', result);
  } catch (err) {
    console.error('Error:', err);
  }
}
testGemini();
