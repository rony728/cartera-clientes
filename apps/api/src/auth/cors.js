const cors = require('cors');

function parseAllowedOrigins(value = '') {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function createCorsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return cors({
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-API-Key'],
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      const error = new Error('Origen no permitido por CORS.');
      error.code = 'CORS_DENIED';
      return callback(error);
    }
  });
}

module.exports = { createCorsMiddleware, parseAllowedOrigins };
