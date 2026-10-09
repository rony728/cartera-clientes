const os = require('node:os');
const path = require('node:path');
const { parseAllowedOrigins } = require('./auth/cors');

function parsePositiveInteger(value, name, defaultValue, minimum = 1) {
  const parsed = Number.parseInt(value ?? String(defaultValue), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || String(parsed) !== String(value ?? defaultValue)) {
    throw new Error(`${name} debe ser un entero válido.`);
  }
  return parsed;
}

function parseBoolean(value, name, defaultValue = false) {
  const normalized = value === undefined ? String(defaultValue) : value;
  if (normalized !== 'true' && normalized !== 'false') {
    throw new Error(`${name} debe ser true o false.`);
  }
  return normalized === 'true';
}

function isPlaceholder(value) {
  return /CAMBIAR|REEMPLAZAR|EJEMPLO/u.test(value);
}

function loadServerConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }
  const production = nodeEnv === 'production';
  const host = env.HOST || '127.0.0.1';
  const port = parsePositiveInteger(env.PORT, 'PORT', 3005);
  const apiKey = env.API_KEY;
  const sessionSecret = env.SESSION_SECRET;
  const cookieName = env.SESSION_COOKIE_NAME || 'cartera.sid';
  const sessionMaxAgeMs = parsePositiveInteger(
    env.SESSION_MAX_AGE_MS,
    'SESSION_MAX_AGE_MS',
    604_800_000,
    60_000
  );
  const cookieSecure = parseBoolean(env.COOKIE_SECURE, 'COOKIE_SECURE', false);
  const cookieSameSite = (env.COOKIE_SAME_SITE || 'lax').toLowerCase();
  const trustProxy = parsePositiveInteger(env.TRUST_PROXY, 'TRUST_PROXY', production ? 1 : 0, 0);
  const loginLimits = {
    maxAttempts: parsePositiveInteger(env.LOGIN_MAX_ATTEMPTS, 'LOGIN_MAX_ATTEMPTS', 5),
    windowSeconds: parsePositiveInteger(env.LOGIN_WINDOW_SECONDS, 'LOGIN_WINDOW_SECONDS', 900),
    blockSeconds: parsePositiveInteger(env.LOGIN_BLOCK_SECONDS, 'LOGIN_BLOCK_SECONDS', 900)
  };
  const maxSnapshotBytes = parsePositiveInteger(
    env.SNAPSHOT_MAX_BYTES,
    'SNAPSHOT_MAX_BYTES',
    10_485_760
  );
  const importEnabled = parseBoolean(
    env.SNAPSHOT_IMPORT_ENABLED,
    'SNAPSHOT_IMPORT_ENABLED',
    false
  );

  if (typeof apiKey !== 'string' || apiKey.trim() === '' || isPlaceholder(apiKey)) {
    throw new Error('API_KEY debe configurarse con un valor propio.');
  }
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32 || isPlaceholder(sessionSecret)) {
    throw new Error('SESSION_SECRET debe configurarse con al menos 32 caracteres aleatorios.');
  }
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(cookieName)) {
    throw new Error('SESSION_COOKIE_NAME no es válido.');
  }
  if (!['lax', 'strict', 'none'].includes(cookieSameSite)) {
    throw new Error('COOKIE_SAME_SITE debe ser lax, strict o none.');
  }
  if (cookieSameSite === 'none' && !cookieSecure) {
    throw new Error('COOKIE_SAME_SITE=none requiere COOKIE_SECURE=true.');
  }
  const corsOrigins = parseAllowedOrigins(env.CORS_ORIGINS || '', { requireHttps: production });

  if (production) {
    if (host !== '127.0.0.1') {
      throw new Error('HOST debe ser 127.0.0.1 en producción detrás del túnel local.');
    }
    if (!cookieSecure) {
      throw new Error('COOKIE_SECURE debe ser true en producción.');
    }
    if (trustProxy !== 1) {
      throw new Error('TRUST_PROXY debe ser 1 en producción detrás de Cloudflare Tunnel.');
    }
    if (corsOrigins.length === 0) {
      throw new Error('CORS_ORIGINS debe contener al menos un origen HTTPS en producción.');
    }
    if (importEnabled) {
      throw new Error('SNAPSHOT_IMPORT_ENABLED debe permanecer false en esta etapa.');
    }
  }

  return {
    apiKey,
    cookie: {
      name: cookieName,
      maxAgeMs: sessionMaxAgeMs,
      secure: cookieSecure,
      sameSite: cookieSameSite
    },
    corsOrigins,
    host,
    importEnabled,
    loginLimits,
    nodeEnv,
    port,
    sessionSecret,
    snapshotConfig: {
      filePath: env.SNAPSHOT_PATH || path.join(os.homedir(), 'cartera-snapshot', 'snapshot.json'),
      recordsPath: env.SNAPSHOT_RECORDS_PATH || '',
      maxBytes: maxSnapshotBytes
    },
    trustProxy
  };
}

module.exports = { loadServerConfig, parseBoolean, parsePositiveInteger };
