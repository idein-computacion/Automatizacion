const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const readline = require('readline');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets'
];

async function run() {
  const content = fs.readFileSync('credentials.json', 'utf-8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  const redirectUri = (key.redirect_uris && key.redirect_uris.length > 0) ? key.redirect_uris[0] : 'http://localhost';
  const oAuth2Client = new OAuth2Client(
    key.client_id,
    key.client_secret,
    redirectUri
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    // login_hint: 'diplomaturadanza@gmail.com'
  });

  console.log('\n======================================================');
  console.log('🔗 AUTORIZACIÓN MANUAL REQUERIDA');
  console.log('Por favor visita el siguiente enlace en tu navegador:');
  console.log(authUrl);
  console.log('\nIMPORTANTE: Después de autorizar, el navegador intentará ir a una página que dice "No se puede acceder a este sitio" o "localhost rechazó la conexión". ESTO ES NORMAL.');
  console.log('Solo debes mirar la barra de direcciones de tu navegador, buscar la parte que dice "code=..." y copiar ese código (hasta el símbolo "&").');
  console.log('======================================================\n');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Una vez autorizado, pega aquí el código de la URL: ', async (code) => {
    rl.close();
    try {
      // Decode URI component in case the user copied url-encoded characters
      code = decodeURIComponent(code);
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      fs.writeFileSync('../token.json', JSON.stringify(tokens));
      console.log('¡Éxito! token.json creado correctamente.');
    } catch (error) {
      console.error('Error al obtener los tokens:', error);
    }
  });
}

run();
