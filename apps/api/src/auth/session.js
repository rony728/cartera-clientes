const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');

function createSessionMiddleware({
  pool,
  secret,
  name = 'cartera.sid',
  maxAgeMs = 8 * 60 * 60 * 1000,
  secure = false,
  sameSite = 'lax'
}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  }
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('COOKIE_SAME_SITE debe ser lax, strict o none.');
  }
  if (sameSite === 'none' && !secure) {
    throw new Error('COOKIE_SAME_SITE=none requiere COOKIE_SECURE=true.');
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 60_000) {
    throw new Error('SESSION_MAX_AGE_MS no es válido.');
  }

  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    schemaName: 'public',
    tableName: 'user_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60
  });
  const middleware = session({
    name,
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: maxAgeMs,
      path: '/'
    }
  });
  middleware.sessionStore = store;
  return middleware;
}

module.exports = { createSessionMiddleware };
