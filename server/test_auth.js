const { loadSavedCredentialsIfExist } = require('./authService.js');

async function test() {
  console.log("Testing loadSavedCredentialsIfExist...");
  const client = await loadSavedCredentialsIfExist();
  if (client) {
    console.log("SUCCESS! Client loaded.", !!client.credentials);
  } else {
    console.log("FAILED! Client is null.");
  }
}

test().catch(console.error);
