const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');

async function run() {
  const code = '4/0AXEQxIAIE0tgckvcYZ7hgCdA0mijUfWselmz0noL0ZwU8V-yfXrlLRuMy_HateYt51FOFg';
  const content = fs.readFileSync('credentials.json', 'utf-8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  const redirectUri = (key.redirect_uris && key.redirect_uris.length > 0) ? key.redirect_uris[0] : 'http://localhost';
  const oAuth2Client = new OAuth2Client(
    key.client_id,
    key.client_secret,
    redirectUri
  );

  try {
    const { tokens } = await oAuth2Client.getToken(decodeURIComponent(code));
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync('../token.json', JSON.stringify(tokens));
    console.log('¡Éxito! token.json creado correctamente con el nuevo código.');
  } catch (error) {
    console.error('Error al obtener los tokens:', error);
  }
}

run();
