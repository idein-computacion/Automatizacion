const { authorize } = require('./authService');
const { google } = require('googleapis');

const records = [
  { name: 'OLMEDO, MARISA SILVINA', dni: '27299195', op: '171645624542' },
  { name: 'NAZARUK, SARA NORMA OTILIA', dni: '30213934', op: '0111' },
  { name: 'MARQUEZ BITANCURT, GUILLE', dni: '41615623', op: '171632194556' },
  { name: 'FRAYMUTH, VERONICA GISEL', dni: '34451027', op: '915116563' },
  { name: 'FRAYMUTH, VERONICA GISEL', dni: '34451027', op: '914843256' },
  { name: 'FRAYMUTH, VERONICA GISEL', dni: '34451027', op: '914560787' },
  { name: 'BARROS, MARLENE ITATI', dni: '39640284', op: '171619019958' },
  { name: 'AGUILERA, ANTONIA GENOVEV', dni: '36063750', op: '170722296319' },
  { name: 'GOMEZ BOVEDA, CRISTINA SOL', dni: '38189695', op: '170709481523' },
  { name: 'VAZQUEZ, SILVINA RAQUEL', dni: '34395051', op: '170707668051' },
  { name: 'BAEZ, IVAN ALFREDO', dni: '34017096', op: '171602337530' },
  { name: 'BAEZ, IVAN ALFREDO', dni: '34017096', op: '170705671367' },
  { name: 'BAEZ, IVAN ALFREDO', dni: '34017096', op: '171601805110' },
  { name: 'BAEZ, IVAN ALFREDO', dni: '34017096', op: '170704954763' },
  { name: 'BAEZ, IVAN ALFREDO', dni: '34017096', op: '170705034133' }
];

async function main() {
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  const foundMap = new Map();

  for (const rec of records) {
    console.log(`\nBuscando registro: ${rec.name} | DNI: ${rec.dni} | Op: ${rec.op}`);
    
    // Buscar primero por N° de operación
    let res = await gmail.users.messages.list({ userId: 'me', q: rec.op });
    let msgs = res.data.messages || [];
    
    // Si no se encuentra por op, buscar por DNI
    if (msgs.length === 0) {
      res = await gmail.users.messages.list({ userId: 'me', q: rec.dni });
      msgs = res.data.messages || [];
    }

    // Si tampoco, buscar por apellido (primer palabra del nombre)
    if (msgs.length === 0) {
      const surname = rec.name.split(',')[0].trim();
      res = await gmail.users.messages.list({ userId: 'me', q: surname });
      msgs = res.data.messages || [];
    }

    console.log(`-> Encontrados ${msgs.length} mensajes en Gmail`);
    for (const m of msgs) {
      const msg = await gmail.users.messages.get({ 
        userId: 'me', 
        id: m.id, 
        format: 'metadata', 
        metadataHeaders: ['From', 'Subject', 'Date', 'Message-ID'] 
      });
      const headers = msg.data.payload.headers || [];
      const from = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value;
      const subj = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value;
      const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value;
      const messageHeaderId = (headers.find(h => h.name.toLowerCase() === 'message-id') || {}).value;

      if (!foundMap.has(m.id)) {
        foundMap.set(m.id, {
          id: m.id,
          threadId: msg.data.threadId,
          from,
          subj,
          date,
          messageHeaderId,
          recs: [rec]
        });
      } else {
        foundMap.get(m.id).recs.push(rec);
      }
    }
  }

  console.log('\n======================================================');
  console.log(`TOTAL DE MENSAJES UNICOS A PROCESAR: ${foundMap.size}`);
  console.log('======================================================');
  for (const [id, info] of foundMap.entries()) {
    console.log(`Message ID: ${id}`);
    console.log(`Thread ID:  ${info.threadId}`);
    console.log(`From:       ${info.from}`);
    console.log(`Subject:    ${info.subj}`);
    console.log(`Date:       ${info.date}`);
    console.log(`Ops/Recs:   ${info.recs.map(r => `${r.name} (${r.op})`).join(' | ')}`);
    console.log('------------------------------------------------------');
  }
}

main().catch(console.error);
