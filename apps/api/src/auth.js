const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PublicClientApplication } = require('@azure/msal-node');

const SCOPES = ['Mail.Send'];

function getCachePath() {
  return process.env.MS_TOKEN_CACHE_PATH || path.join(
    os.homedir(),
    '.config',
    'cartera-clientes-api',
    'msal-cache.json'
  );
}

function ensureCacheDirectory(cachePath) {
  const directory = path.dirname(cachePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch (_) {
    // Algunos sistemas de archivos no soportan chmod; MSAL seguirá funcionando.
  }
}

function createMsalClient() {
  const clientId = process.env.MS_CLIENT_ID;
  if (!clientId) {
    throw new Error('Falta MS_CLIENT_ID en el archivo .env.');
  }

  const cachePath = getCachePath();
  ensureCacheDirectory(cachePath);
  const cachePlugin = {
    beforeCacheAccess: async (context) => {
      if (fs.existsSync(cachePath)) {
        context.tokenCache.deserialize(fs.readFileSync(cachePath, 'utf8'));
      }
    },
    afterCacheAccess: async (context) => {
      if (context.cacheHasChanged) {
        fs.writeFileSync(cachePath, context.tokenCache.serialize(), {
          encoding: 'utf8',
          mode: 0o600
        });
        try {
          fs.chmodSync(cachePath, 0o600);
        } catch (_) {
          // Algunos sistemas de archivos no soportan chmod.
        }
      }
    }
  };

  return new PublicClientApplication({
    auth: {
      clientId,
      authority: 'https://login.microsoftonline.com/common'
    },
    cache: { cachePlugin }
  });
}

async function getAccessToken() {
  const client = createMsalClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  const account = accounts[0];

  if (account) {
    try {
      const silent = await client.acquireTokenSilent({ account, scopes: SCOPES });
      return silent.accessToken;
    } catch (error) {
      console.log('La sesión guardada requiere autenticación nuevamente.');
    }
  }

  const result = await client.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      console.log(response.message);
    }
  });

  return result.accessToken;
}

module.exports = { getAccessToken, getCachePath };
