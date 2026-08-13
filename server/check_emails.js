const { authorize } = require('./authService');
const { google } = require('googleapis');

async function testEmails() {
  try {
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });
    console.log('Fetching unread emails...');
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox is:unread -label:Procesados -label:Revisar',
      maxResults: 10,
    });
    const messages = res.data.messages;
    console.log('Unread messages count:', messages ? messages.length : 0);
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        console.log('Message ID:', msg.id);
        const msgData = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata' // Only metadata to be fast
        });
        const subject = msgData.data.payload.headers.find(h => h.name === 'Subject')?.value;
        console.log('Subject:', subject);
      }
    }
  } catch (err) {
    console.error(err);
  }
}
testEmails();
