const cors = require('cors');

function validateOrigin(origin, { requireHttps = false } = {}) {
  if (origin === '*' || origin.includes('*')) {
    throw new Error('CORS_ORIGINS no admite comodines.');
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    throw new Error('CORS_ORIGINS contiene un origen inválido.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.origin !== origin
      || parsed.username
      || parsed.password) {
    throw new Error('CORS_ORIGINS debe contener orígenes HTTP(S) exactos, sin rutas ni credenciales.');
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new Error('CORS_ORIGINS solo admite HTTPS en producción.');
  }
  return parsed.origin;
}

function parseAllowedOrigins(value = '', options = {}) {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  return [...new Set(origins.map((origin) => validateOrigin(origin, options)))];
}

function createCorsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins.map((origin) => validateOrigin(origin)));
  return cors({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-API-Key'],
    maxAge: 600,
    optionsSuccessStatus: 204,
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      const error = new Error('Origen no permitido por CORS.');
      error.code = 'CORS_DENIED';
      return callback(error);
    }
  });
}

module.exports = { createCorsMiddleware, parseAllowedOrigins, validateOrigin };
