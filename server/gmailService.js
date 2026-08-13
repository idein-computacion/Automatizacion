const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function getUnreadEmails(auth, limit = 10) {
  const gmail = google.gmail({ version: 'v1', auth });
  
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:inbox is:unread -label:Procesados -label:Revisar',
    maxResults: limit,
  });

  const messages = res.data.messages;
  if (!messages || messages.length === 0) {
    return [];
  }

  const emailDetails = [];

  for (const msg of messages) {
    const msgData = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full'
    });

    const labelIds = msgData.data.labelIds || [];
    // Verificar estrictamente que el mensaje sea NO LEÍDO
    if (!labelIds.includes('UNREAD')) {
      console.log(`Omitiendo correo ID ${msg.id} porque no tiene la etiqueta UNREAD (ya está leído).`);
      continue;
    }

    const payload = msgData.data.payload;
    const body = getBody(payload);
    let attachments = getAttachmentsMetadata(payload);

    // Extraer Asunto
    let subject = '';
    const headers = payload.headers || [];
    const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
    if (subjectHeader) {
      subject = subjectHeader.value;
    }

    // Si este mensaje de la conversación no tiene adjuntos, buscar en todo el hilo (Thread)
    if (attachments.length === 0 && msgData.data.threadId) {
      try {
        const threadData = await gmail.users.threads.get({
          userId: 'me',
          id: msgData.data.threadId,
          format: 'full'
        });

        if (threadData.data.messages) {
          for (const threadMsg of threadData.data.messages) {
            if (threadMsg.payload) {
              const threadAtts = getAttachmentsMetadata(threadMsg.payload);
              if (threadAtts.length > 0) {
                attachments.push(...threadAtts);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error buscando adjuntos en el hilo:', err);
      }
    }

    emailDetails.push({
      id: msg.id,
      threadId: msgData.data.threadId,
      subject,
      body,
      attachments
    });
  }

  return emailDetails;
}

function getBody(payload) {
  let body = '';
  if (payload.parts) {
    for (const part of payload.parts) {
      if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && part.body && part.body.data) {
        let text = Buffer.from(part.body.data, 'base64').toString('utf8');
        if (part.mimeType === 'text/html') {
          // Strip basic HTML tags just to get the text context
          text = text.replace(/<[^>]*>?/gm, ' ');
        }
        body += text + '\n';
      } else if (part.parts) {
        body += getBody(part);
      }
    }
  } else if (payload.body && payload.body.data) {
    let text = Buffer.from(payload.body.data, 'base64').toString('utf8');
    if (payload.mimeType === 'text/html') {
      text = text.replace(/<[^>]*>?/gm, ' ');
    }
    body = text;
  }
  return body.trim();
}

function getAttachmentsMetadata(payload) {
  const attachments = [];

  function scanParts(partList) {
    if (!partList) return;
    for (const part of partList) {
      // Ignore text/plain and text/html as attachments
      if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
        if (part.parts) scanParts(part.parts);
        continue;
      }

      const isImageOrPdf = part.mimeType && (part.mimeType.startsWith('image/') || part.mimeType === 'application/pdf');
      const hasAttachmentId = part.body && part.body.attachmentId;
      const hasDirectData = part.body && part.body.data;

      if ((part.filename || isImageOrPdf) && (hasAttachmentId || hasDirectData)) {
        let ext = 'bin';
        if (part.mimeType === 'application/pdf') ext = 'pdf';
        else if (part.mimeType && part.mimeType.startsWith('image/')) ext = part.mimeType.split('/')[1] || 'jpg';

        const filename = part.filename || `comprobante_${Date.now()}.${ext}`;

        attachments.push({
          filename,
          mimeType: part.mimeType || 'image/jpeg',
          attachmentId: part.body ? part.body.attachmentId : null,
          data: part.body ? part.body.data : null
        });
      }

      if (part.parts) {
        scanParts(part.parts);
      }
    }
  }

  if (payload.parts) {
    scanParts(payload.parts);
  } else if (payload.body && (payload.body.attachmentId || payload.body.data)) {
    if (payload.mimeType !== 'text/plain' && payload.mimeType !== 'text/html') {
      let ext = 'bin';
      if (payload.mimeType === 'application/pdf') ext = 'pdf';
      else if (payload.mimeType && payload.mimeType.startsWith('image/')) ext = payload.mimeType.split('/')[1] || 'jpg';

      attachments.push({
        filename: payload.filename || `comprobante_${Date.now()}.${ext}`,
        mimeType: payload.mimeType || 'image/jpeg',
        attachmentId: payload.body.attachmentId || null,
        data: payload.body.data || null
      });
    }
  }

  return attachments;
}

async function downloadAttachments(auth, messageId, attachments) {
  const gmail = google.gmail({ version: 'v1', auth });
  const downloadedFiles = [];

  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  for (const attachment of attachments) {
    try {
      let buffer = null;

      if (attachment.data) {
        const data = attachment.data.replace(/-/g, '+').replace(/_/g, '/');
        buffer = Buffer.from(data, 'base64');
      } else if (attachment.attachmentId) {
        const res = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: messageId,
          id: attachment.attachmentId,
        });
        const data = res.data.data.replace(/-/g, '+').replace(/_/g, '/');
        buffer = Buffer.from(data, 'base64');
      }

      if (buffer) {
        const filePath = path.join(tempDir, attachment.filename);
        fs.writeFileSync(filePath, buffer);
        
        downloadedFiles.push({
          path: filePath,
          mimeType: attachment.mimeType,
          filename: attachment.filename
        });
      }
    } catch (err) {
      console.error(`Error descargando adjunto ${attachment.filename}:`, err);
    }
  }

  return downloadedFiles;
}

async function markAsRead(auth, messageId) {
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD']
    }
  });
}

const labelCache = {};

async function getOrCreateLabel(auth, labelName) {
  if (labelCache[labelName]) return labelCache[labelName];

  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = res.data.labels || [];
  
  let targetLabel = labels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
  if (targetLabel) {
    labelCache[labelName] = targetLabel.id;
    return targetLabel.id;
  }

  const newLabel = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show'
    }
  });

  labelCache[labelName] = newLabel.data.id;
  return newLabel.data.id;
}

async function addLabelToEmail(auth, messageId, labelName) {
  try {
    let labelId = await getOrCreateLabel(auth, labelName);
    const gmail = google.gmail({ version: 'v1', auth });
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: [labelId]
        }
      });
    } catch (modifyErr) {
      const msg = modifyErr.message || String(modifyErr);
      if (msg.includes('labelId not found')) {
        delete labelCache[labelName];
        labelId = await getOrCreateLabel(auth, labelName);
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            addLabelIds: [labelId]
          }
        });
      } else {
        throw modifyErr;
      }
    }
  } catch (err) {
    console.error(`Error aplicando etiqueta '${labelName}' al mensaje ${messageId}:`, err.message || err);
  }
}

function createRawMessage(to, subject, bodyText, messageHeaderId) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject ? (subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`) : 'Re: Registro de pago'}`,
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

async function sendReplyEmail(auth, messageId, bodyText) {
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const headers = msg.data.payload.headers || [];
    const fromHeader = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value || '';
    const subjectHeader = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || '';
    const msgHeaderId = (headers.find(h => h.name.toLowerCase() === 'message-id') || {}).value || '';

    if (!fromHeader) {
      console.error(`No se encontró remitente (From) para el mensaje ${messageId}`);
      return;
    }

    const raw = createRawMessage(fromHeader, subjectHeader, bodyText, msgHeaderId);
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: raw,
        threadId: msg.data.threadId
      }
    });
    console.log(`Respuesta enviada correctamente a ${fromHeader}`);
  } catch (err) {
    console.error(`Error al enviar respuesta al mensaje ${messageId}:`, err.message || err);
  }
}

async function markAsUnread(auth, messageId) {
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: ['UNREAD']
    }
  });
}

module.exports = {
  getUnreadEmails,
  downloadAttachments,
  markAsRead,
  markAsUnread,
  addLabelToEmail,
  sendReplyEmail
};

