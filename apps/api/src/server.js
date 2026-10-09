require('dotenv').config();

const { closeDatabase, pool } = require('./database');
const { createApp } = require('./app');
const { createCorsMiddleware, parseAllowedOrigins } = require('./auth/cors');
const { createSessionMiddleware } = require('./auth/session');

function startServer() {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Falta configurar API_KEY en .env.');
  }

  const host = process.env.HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.PORT || '3005', 10);
  const cookieName = process.env.SESSION_COOKIE_NAME || 'cartera.sid';
  const sessionMaxAgeMs = Number.parseInt(process.env.SESSION_MAX_AGE_MS || '28800000', 10);
  const cookieSecure = process.env.COOKIE_SECURE === 'true';
  const cookieSameSite = process.env.COOKIE_SAME_SITE || 'lax';
  const trustProxy = Number.parseInt(process.env.TRUST_PROXY || '1', 10);
  const loginMaxAttempts = Number.parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
  const loginWindowSeconds = Number.parseInt(process.env.LOGIN_WINDOW_SECONDS || '900', 10);
  const loginBlockSeconds = Number.parseInt(process.env.LOGIN_BLOCK_SECONDS || '900', 10);
  const positiveValues = [port, sessionMaxAgeMs, loginMaxAttempts, loginWindowSeconds, loginBlockSeconds];
  if (positiveValues.some((value) => !Number.isSafeInteger(value) || value < 1)
      || !Number.isSafeInteger(trustProxy) || trustProxy < 0) {
    throw new Error('La configuración numérica del servidor no es válida.');
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('CAMBIAR_POR')) {
    throw new Error('SESSION_SECRET debe configurarse con un valor aleatorio propio.');
  }
  if (process.env.NODE_ENV === 'production' && !cookieSecure) {
    throw new Error('COOKIE_SECURE debe ser true en producción.');
  }
  const sessionMiddleware = createSessionMiddleware({
    pool,
    secret: process.env.SESSION_SECRET,
    name: cookieName,
    maxAgeMs: sessionMaxAgeMs,
    secure: cookieSecure,
    sameSite: cookieSameSite
  });
  const corsMiddleware = createCorsMiddleware(parseAllowedOrigins(process.env.CORS_ORIGINS || ''));
  const maxSnapshotBytes = Number.parseInt(process.env.SNAPSHOT_MAX_BYTES || '10485760', 10);
  if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1) {
    throw new Error('SNAPSHOT_MAX_BYTES debe ser un entero positivo.');
  }
  const app = createApp({
    apiKey,
    sessionMiddleware,
    corsMiddleware,
    cookieName,
    trustProxy,
    loginLimits: {
      maxAttempts: loginMaxAttempts,
      windowSeconds: loginWindowSeconds,
      blockSeconds: loginBlockSeconds
    },
    importEnabled: process.env.SNAPSHOT_IMPORT_ENABLED === 'true',
    snapshotConfig: {
      filePath: process.env.SNAPSHOT_PATH || '/ruta/privada/cartera-snapshot/snapshot.json',
      recordsPath: process.env.SNAPSHOT_RECORDS_PATH || '',
      maxBytes: maxSnapshotBytes
    }
  });
  const server = app.listen(port, host, () => {
    console.log(`API escuchando en http://${host}:${port}`);
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
