async function fixRecords(diploma) {
  const dbUrl = 'https://idein-cobranzas-default-rtdb.firebaseio.com';
  
  const dailyRes = await fetch(`${dbUrl}/diplomaturas/${diploma}/daily_records.json`);
  const daily = await dailyRes.json() || [];
  
  const consRes = await fetch(`${dbUrl}/diplomaturas/${diploma}/consolidated_records.json`);
  let cons = await consRes.json() || [];
  
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
      console.log(`[${diploma}] Missing in consolidated:`, rec.apellidoNombre, rec.operacion, rec.fecha, rec.monto);
      const nextId = cons.length > 0 ? Math.max(...cons.filter(x => x).map(c => c.consolidatedId || c.id || 0)) + 1 : 1;
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
    console.log(`[${diploma}] Updating firebase with fixed consolidated records...`);
    const putRes = await fetch(`${dbUrl}/diplomaturas/${diploma}/consolidated_records.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cons)
    });
    console.log(`[${diploma}] Consolidated response:`, putRes.status);
    
    const putDaily = await fetch(`${dbUrl}/diplomaturas/${diploma}/daily_records.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(daily)
    });
    console.log(`[${diploma}] Daily response:`, putDaily.status);
    
    console.log(`[${diploma}] Done!`);
  } else {
    console.log(`[${diploma}] No missing records found.`);
  }
}

async function main() {
  const diplomas = ['FOLKLORE', 'LICENCIATURA', 'GUARANI', 'DANZA'];
  for (const diploma of diplomas) {
    try {
      console.log(`Checking ${diploma}...`);
      await fixRecords(diploma);
    } catch(e) {
      console.error(`Error with ${diploma}:`, e.message);
    }
  }
}

main().catch(console.error);
