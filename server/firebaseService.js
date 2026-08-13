const { ACCOUNT_CONFIG } = require('./excelService');

const FIREBASE_DB_URL = 'https://idein-cobranzas-default-rtdb.firebaseio.com';

/**
 * Guarda un registro de pago en Firebase Realtime Database
 * @param {string} email - Email activo (para determinar la diplomatura)
 * @param {object} recordData - Datos extraídos del comprobante
 * @param {string} savedFilename - Nombre del archivo guardado
 */
async function saveToFirebase(email, recordData, savedFilename) {
  try {
    const emailKey = email ? email.toLowerCase().trim() : null;
    const config = ACCOUNT_CONFIG[emailKey];
    if (!config || !config.subDir) {
      console.log(`No se encontró configuración de Firebase para la cuenta: ${email}`);
      return;
    }
    
    const activeDiploma = config.subDir;
    
    // Rutas
    const dailyUrl = `${FIREBASE_DB_URL}/diplomaturas/${activeDiploma}/daily_records.json`;
    const consolidatedUrl = `${FIREBASE_DB_URL}/diplomaturas/${activeDiploma}/consolidated_records.json`;

    // 1. Descargar registros actuales
    const [dailyRes, consolidatedRes] = await Promise.all([
      fetch(dailyUrl).catch(() => null),
      fetch(consolidatedUrl).catch(() => null)
    ]);

    const rawDaily = dailyRes && dailyRes.ok ? await dailyRes.json() || [] : [];
    const rawConsolidated = consolidatedRes && consolidatedRes.ok ? await consolidatedRes.json() || [] : [];

    // Convertir de objeto a array si Firebase lo devuelve como objeto (por keys numéricos/string)
    const dailyArray = Array.isArray(rawDaily) ? rawDaily : Object.values(rawDaily).filter(Boolean);
    const consolidatedArray = Array.isArray(rawConsolidated) ? rawConsolidated : Object.values(rawConsolidated).filter(Boolean);

    // 2. Preparar el nuevo registro
    const newRecordId = dailyArray.length + 1;
    
    const recOp = recordData.nroOperacion ? String(recordData.nroOperacion).trim() : '';
    const cleanFecha = recordData.fecha || '';
    const studentKey = (recordData.dni && String(recordData.dni).trim()) || (recordData.nombre && String(recordData.nombre).trim().toUpperCase()) || '';
    const recComp = studentKey ? `${studentKey}-${cleanFecha}-${recordData.monto}` : '';

    const newRecord = {
      id: newRecordId,
      apellidoNombre: recordData.nombre || "",
      dni: recordData.dni ? String(recordData.dni).replace(/\./g, "") : "",
      banco: recordData.banco || "MP",
      operacion: recOp,
      fecha: cleanFecha,
      monto: Number(recordData.monto) || 0,
      titular: recordData.titular || "",
      archivoRenombrado: savedFilename || "",
      fileDataUrl: "",
      timestamp: new Date().toISOString()
    };

    // 3. Lógica para consolidado
    const consolidatedByOp = new Map();
    const consolidatedByCompKey = new Map();

    consolidatedArray.forEach((c, index) => {
      if (c.operacion) consolidatedByOp.set(String(c.operacion).trim(), index);
      const sKey = (c.dni && String(c.dni).trim()) || (c.apellidoNombre && String(c.apellidoNombre).trim().toUpperCase()) || '';
      const cCompKey = sKey ? `${sKey}-${c.fecha}-${c.monto}` : '';
      if (cCompKey) consolidatedByCompKey.set(cCompKey, index);
    });

    let existingIndex = -1;
    if (recOp && consolidatedByOp.has(recOp)) {
      existingIndex = consolidatedByOp.get(recOp);
    } else if (recComp && consolidatedByCompKey.has(recComp)) {
      const idx = consolidatedByCompKey.get(recComp);
      const existingRecord = consolidatedArray[idx];
      if (!recOp || !existingRecord.operacion || String(existingRecord.operacion).trim() === recOp) {
        existingIndex = idx;
      }
    }

    if (existingIndex !== -1) {
      // Actualizar existente
      consolidatedArray[existingIndex] = { ...consolidatedArray[existingIndex], ...newRecord };
      newRecord.consolidatedId = consolidatedArray[existingIndex].consolidatedId;
    } else {
      // Crear nuevo en consolidado
      const nextConsolidatedId = consolidatedArray.length + 1;
      newRecord.consolidatedId = nextConsolidatedId;
      const newConsolidatedRecord = { ...newRecord, consolidatedId: nextConsolidatedId };
      consolidatedArray.push(newConsolidatedRecord);
    }

    // 4. Actualizar daily_records (remapear y asignar consolidatedId a todos)
    dailyArray.push(newRecord);
    const updatedDaily = dailyArray.map((rec, idx) => ({
      ...rec,
      id: idx + 1,
      consolidatedId: rec.consolidatedId || rec.id || (Date.now() + idx)
    }));

    // 5. Guardar en Firebase
    await Promise.all([
      fetch(dailyUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDaily)
      }),
      fetch(consolidatedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consolidatedArray)
      })
    ]);

    console.log(`Registro de pago (${newRecord.apellidoNombre}) guardado exitosamente en Firebase (Diplomatura: ${activeDiploma})`);
  } catch (err) {
    console.error(`Error al guardar en Firebase para ${email}:`, err);
  }
}

module.exports = { saveToFirebase };
