require('dotenv').config();

const { closeDatabase, pool } = require('./database');
const { createApp } = require('./app');
const { createCorsMiddleware } = require('./auth/cors');
const { createSessionMiddleware } = require('./auth/session');
const { loadServerConfig } = require('./config');

function startServer() {
  const config = loadServerConfig();
  const sessionMiddleware = createSessionMiddleware({
    pool,
    secret: config.sessionSecret,
    name: config.cookie.name,
    maxAgeMs: config.cookie.maxAgeMs,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite
  });
  const corsMiddleware = createCorsMiddleware(config.corsOrigins);
  const app = createApp({
    apiKey: config.apiKey,
    sessionMiddleware,
    corsMiddleware,
    cookieName: config.cookie.name,
    trustProxy: config.trustProxy,
    loginLimits: config.loginLimits,
    importEnabled: config.importEnabled,
    visitasEnabled: config.visitasEnabled,
    snapshotConfig: config.snapshotConfig
  });
  const server = app.listen(config.port, config.host, () => {
    console.log(`API escuchando en http://${config.host}:${config.port}`);
  });

  async function shutdown(signal) {
    console.log(`Cerrando API (${signal}).`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  }

  process.once('SIGINT', () => {
    shutdown('SIGINT').catch(() => process.exit(1));
  });
  process.once('SIGTERM', () => {
    shutdown('SIGTERM').catch(() => process.exit(1));
  });

  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(`No se puede iniciar la API: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { startServer };
