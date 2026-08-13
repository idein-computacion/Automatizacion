const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

function getApiKeys() {
  const keys = [];
  
  const apisFilePath = path.join(__dirname, '../apis.txt');
  if (fs.existsSync(apisFilePath)) {
    const fileContent = fs.readFileSync(apisFilePath, 'utf8');
    const fileKeys = fileContent
      .split(/[,;\s]+/)
      .map(k => k.trim())
      .filter(k => k.startsWith('AIzaSy'));
    keys.push(...fileKeys);
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIzaSy')) {
    if (!keys.includes(process.env.GEMINI_API_KEY)) {
      keys.push(process.env.GEMINI_API_KEY);
    }
  }

  return keys;
}

let keyIndex = 0;
const keyQuotaExhaustedMap = {};

function markKeyQuotaExhausted(key) {
  keyQuotaExhaustedMap[key] = Date.now();
}

function isKeyExhausted(key) {
  const lastErrorTime = keyQuotaExhaustedMap[key];
  if (!lastErrorTime) return false;
  // Reducir descanso a 20 segundos para rotación ágil
  if (Date.now() - lastErrorTime < 20 * 1000) {
    return true;
  }
  delete keyQuotaExhaustedMap[key];
  return false;
}

async function processImageWithGemini(filesInput = null, mimeTypeInput = null, subject = '', body = '') {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error('No se encontraron claves API válidas en apis.txt ni en las variables de entorno.');
  }

  // Normalizar entrada de archivos (puede ser un array o una ruta individual)
  let filesList = [];
  if (Array.isArray(filesInput)) {
    filesList = filesInput;
  } else if (typeof filesInput === 'string' && filesInput) {
    filesList = [{ path: filesInput, mimeType: mimeTypeInput }];
  }

  const prompt = `Analiza de manera experta este comprobante de pago bancario y extrae con máxima precisión los datos estructurados para conciliación de caja.

ASUNTO DEL CORREO: "${subject}"
CUERPO DEL CORREO: "${body}"

Reglas de extracción críticas:
1. Identifica el banco emisor: Debe ser 'MP' si es de Mercado Pago, 'MACRO' si es de Banco Macro, 'BNA' si es de Banco Nación, 'PERSONAL_PAY' si es de Personal Pay, 'MODO' si es de MODO, 'ASTRO_PAY' si es de Astro Pay, o 'OTROS' si es otro medio.
2. ALUMNO (apellidoNombre y dni): BUSCA PRIMERO EN EL ASUNTO Y CUERPO DEL CORREO. Si el texto del correo menciona un nombre y/o DNI (ej: "Florencia Sosa DNI 34895802" o "pago de Florencia Sosa"), extrae ESE nombre y DNI para los campos 'apellidoNombre' y 'dni'. Si el correo NO menciona a ningún alumno, entonces extrae el nombre y DNI que figuren en el comprobante. Formatea el nombre siempre como: APELLIDO, NOMBRE (en mayúsculas).
3. TITULAR DE LA CUENTA (titular): Extrae ÚNICAMENTE el nombre de la persona que figura como ordenante o titular de la cuenta de origen EN EL COMPROBANTE de pago.
4. Si figura un CUIT/CUIL del remitente, extrae exclusivamente los 8 dígitos intermedios correspondientes al DNI. Si el banco es MACRO y no figura el DNI, CUIT o CUIL del remitente/ordenante, NO extraigas el CUIT/DNI del destinatario; deja el campo "dni" totalmente vacío ("").
5. Obtén el número de operación, transacción, comprobante o ID de transferencia de manera exacta. IMPORTANTE para Banco Macro: El número de operación se encuentra en la cabecera superior al lado de la fecha y hora.
6. Obtén la fecha de la operación y conviértela estrictamente al formato simple: DD-MM-AAAA.
7. Obtén el importe o importe neto transferido como número flotante o entero.`;

  const contents = [prompt];

  if (filesList && filesList.length > 0) {
    for (const f of filesList) {
      if (f.path && fs.existsSync(f.path)) {
        const fileBuffer = fs.readFileSync(f.path);
        let mime = f.mimeType || 'image/jpeg';
        if (mime.includes('*') || !mime.includes('/')) {
          mime = (f.path && f.path.endsWith('.png')) ? 'image/png' : 'image/jpeg';
        }
        contents.push({
          inlineData: {
            data: fileBuffer.toString('base64'),
            mimeType: mime
          }
        });
      }
    }
  }

  // Modelos compatibles a intentar
  const modelNames = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError = null;

  // Filtrar claves no agotadas
  let availableKeys = keys.filter(k => !isKeyExhausted(k));
  if (availableKeys.length === 0) {
    Object.keys(keyQuotaExhaustedMap).forEach(k => delete keyQuotaExhaustedMap[k]);
    availableKeys = keys;
  }

  // Rotar claves API en caso de toparnos con cuota 429
  for (let kAttempt = 0; kAttempt < availableKeys.length; kAttempt++) {
    const currentKey = availableKeys[keyIndex % availableKeys.length];
    keyIndex++;

    const genAI = new GoogleGenerativeAI(currentKey);

    for (const modelName of modelNames) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                apellidoNombre: { type: 'STRING' },
                dni: { type: 'STRING' },
                banco: { type: 'STRING', enum: ['MP', 'MACRO', 'BNA', 'PERSONAL_PAY', 'MODO', 'ASTRO_PAY', 'OTROS'] },
                operacion: { type: 'STRING' },
                fecha: { type: 'STRING' },
                monto: { type: 'NUMBER' },
                titular: { type: 'STRING' }
              },
              required: ['banco', 'operacion', 'fecha', 'monto']
            }
          }
        });

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout de Gemini IA superado (30s)')), 30000)
        );
        const result = await Promise.race([
          model.generateContent(contents),
          timeoutPromise
        ]);
        const response = await result.response;
        let text = response.text();
        
        // Limpiar posibles bloques de markdown en la respuesta
        if (text.startsWith('```json')) {
          text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        } else if (text.startsWith('```')) {
          text = text.replace(/```/g, '').trim();
        }

        const data = JSON.parse(text);
        return {
          nombre: data.apellidoNombre || '',
          apellidoNombre: data.apellidoNombre || '',
          primerApellido: data.apellidoNombre ? data.apellidoNombre.split(',')[0].trim() : '',
          dni: data.dni || '',
          banco: data.banco || 'OTROS',
          monto: data.monto !== undefined && data.monto !== null ? String(data.monto) : '0',
          nroOperacion: data.operacion || '',
          operacion: data.operacion || '',
          fecha: data.fecha || '',
          titular: data.titular || ''
        };
      } catch (error) {
        const errMsg = error.message || String(error);
        if (errMsg.includes('429') || errMsg.includes('Quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
          console.warn(`Límite 429 en clave API (${currentKey.substring(0, 8)}...): rotando a la siguiente clave.`);
          markKeyQuotaExhausted(currentKey);
          break; // Pasar inmediatamente a la siguiente clave API
        } else {
          console.error(`Error en modelo ${modelName} con clave (${currentKey.substring(0, 8)}...):`, errMsg.split('\n')[0]);
          lastError = error;
        }
      }
    }
  }

  if (lastError) {
    throw new Error(`Error en Gemini IA: ${lastError.message || lastError}`);
  }

  // Si todas las claves fallaron por 429, limpiar el mapa para reintentos inmediatos
  Object.keys(keyQuotaExhaustedMap).forEach(k => delete keyQuotaExhaustedMap[k]);
  throw new Error('Todas las claves API de Gemini alcanzaron el límite de cuota (429). Por favor reintenta en unos instantes.');
}

function getApiKeysStatus() {
  const keys = getApiKeys();
  const results = keys.map((key, index) => ({
    keyIndex: index + 1,
    active: !isKeyExhausted(key),
    keyHint: key.substring(0, 8)
  }));

  const activeCount = results.filter(r => r.active).length;
  const totalCount = keys.length;
  const percentageActive = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;

  return {
    activeCount,
    totalCount,
    percentageActive,
    keys: results
  };
}

module.exports = {
  processImageWithGemini,
  getApiKeysStatus
};
