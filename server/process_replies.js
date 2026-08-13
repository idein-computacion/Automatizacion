const { authorize } = require('./authService');
const { markAsRead, addLabelToEmail } = require('./gmailService');
const { google } = require('googleapis');

const targetMsgIds = [
  '19fbfe38efa1d2a6',
  '19fbfabfba412a4e',
  '19fbf9d5e4a07954',
  '19fbf8c078aafab6',
  '19fbf8726559b8ed',
  '19fbf819c356ce4c',
  '19fbf6065a1d41b1',
  '19fbf53e75804145',
  '19fbf1cc1e4e3d58',
  '19fbf104878e79da',
  '19fbf062f11ac1fd',
  '19fbf0215d022236',
  '19fbeff31e69b3f1',
  '19fbefc48693053c',
  '19fbef82ae4c329b'
];

function createRawMessage(to, subject, bodyText, messageHeaderId) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject ? (subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`) : 'Re: Confirmación de pago'}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0'
  ];

  if (messageHeaderId) {
    headers.push(`In-Reply-To: ${messageHeaderId}`);
    headers.push(`References: ${messageHeaderId}`);
  }

  headers.push('');
  headers.push(bodyText);

  const emailStr = headers.join('\r\n');
  return Buffer.from(emailStr)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function processAll() {
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  const bodyMessage = "Buenas tardes, el pago fue registrado correctamente. Saludos Cordiales";

  console.log(`Iniciando envío de correos y marcado como Leído/Procesado para ${targetMsgIds.length} mensajes...\n`);

  let count = 0;

  for (const msgId of targetMsgIds) {
    count++;
    try {
      // 1. Obtener detalles del mensaje original
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'full'
      });

      const headers = msg.data.payload.headers || [];
      const fromHeader = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value || '';
      const subjectHeader = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || '';
      const msgHeaderId = (headers.find(h => h.name.toLowerCase() === 'message-id') || {}).value || '';

      console.log(`[${count}/${targetMsgIds.length}] Procesando mensaje ID: ${msgId}`);
      console.log(`   Remitente: ${fromHeader}`);
      console.log(`   Asunto:    ${subjectHeader}`);

      // 2. Enviar correo de respuesta
      const raw = createRawMessage(fromHeader, subjectHeader, bodyMessage, msgHeaderId);
      const sendRes = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: raw,
          threadId: msg.data.threadId
        }
      });
      console.log(`   ✅ Respuesta enviada. Sent Message ID: ${sendRes.data.id}`);

      // 3. Marcar como leído (quitar UNREAD)
      await markAsRead(auth, msgId);

      // 4. Aplicar etiqueta 'Procesados'
      await addLabelToEmail(auth, msgId, 'Procesados');

      console.log(`   ✅ Marcado como Leído y asignada etiqueta 'Procesados'\n`);

    } catch (err) {
      console.error(`   ❌ Error procesando el mensaje ${msgId}:`, err.message || err);
    }
  }

  console.log('Proceso completado exitosamente.');
}

processAll().catch(console.error);
