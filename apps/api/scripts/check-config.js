require('dotenv').config();

const { loadServerConfig } = require('../src/config');

try {
  const config = loadServerConfig();
  console.log(JSON.stringify({
    valid: true,
    node_env: config.nodeEnv,
    listen: `${config.host}:${config.port}`,
    cookie_secure: config.cookie.secure,
    cookie_same_site: config.cookie.sameSite,
    trust_proxy: config.trustProxy,
    cors_origins: config.corsOrigins,
    snapshot_import_enabled: config.importEnabled
  }, null, 2));
} catch (error) {
  console.error(`Configuración inválida: ${error.message}`);
  process.exitCode = 1;
}
