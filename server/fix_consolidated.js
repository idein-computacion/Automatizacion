const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://idein-cobranzas-default-rtdb.firebaseio.com'
});
const db = admin.database();

async function fixRecords() {
  const diploma = 'DANZA';
  const dailyRef = db.ref(`diplomaturas/${diploma}/daily_records`);
  const consolidatedRef = db.ref(`diplomaturas/${diploma}/consolidated_records`);
  
  const dailySnap = await dailyRef.once('value');
  const consSnap = await consolidatedRef.once('value');
  
  let daily = dailySnap.val() || [];
  let cons = consSnap.val() || [];
  
  const consByOp = new Map();
  const consByCompKey = new Map();
  
  cons.forEach((c, idx) => {
    if (!c) return;
    if (c.operacion) {
      consByOp.set(String(c.operacion).trim(), idx);
    }
    const studentKey = (c.dni && String(c.dni).trim()) || (c.apellidoNombre && String(c.apellidoNombre).trim().toUpperCase()) || '';
    const compKey = studentKey ? `${studentKey}-${c.fecha}-${c.monto}` : '';
    if (compKey) consByCompKey.set(compKey, idx);
  });
  
  let changed = false;
  
  daily.forEach((rec, idx) => {
    if (!rec) return;
    const cleanOp = rec.operacion ? String(rec.operacion).trim() : '';
    const cleanFecha = rec.fecha;
    const studentKey = (rec.dni && String(rec.dni).trim()) || (rec.apellidoNombre && String(rec.apellidoNombre).trim().toUpperCase()) || '';
    const compKey = studentKey ? `${studentKey}-${cleanFecha}-${rec.monto}` : '';
    
    let existingIndex = -1;
    if (cleanOp && consByOp.has(cleanOp)) {
      existingIndex = consByOp.get(cleanOp);
    } else if (compKey && consByCompKey.has(compKey)) {
      const matchIdx = consByCompKey.get(compKey);
      const matchRec = cons[matchIdx];
      if (!cleanOp || !matchRec.operacion || String(matchRec.operacion).trim() === cleanOp) {
        existingIndex = matchIdx;
      }
    }
    
    if (existingIndex === -1) {
      console.log('Missing in consolidated:', rec.apellidoNombre, rec.operacion, rec.fecha, rec.monto);
      const nextId = cons.length > 0 ? Math.max(...cons.map(c => c ? (c.consolidatedId || c.id || 0) : 0)) + 1 : 1;
      const newCons = {
        ...rec,
        id: nextId,
        consolidatedId: nextId
      };
      cons.push(newCons);
      changed = true;
      
      const newIdx = cons.length - 1;
      if (cleanOp) consByOp.set(cleanOp, newIdx);
      if (compKey) consByCompKey.set(compKey, newIdx);
      
      rec.consolidatedId = nextId;
    } else {
      rec.consolidatedId = cons[existingIndex].consolidatedId;
    }
  });
  
  if (changed) {
    console.log('Updating firebase with fixed consolidated records...');
    await consolidatedRef.set(cons);
    await dailyRef.set(daily);
    console.log('Done!');
  } else {
    console.log('No missing records found.');
  }
  process.exit(0);
}
fixRecords().catch(console.error);
