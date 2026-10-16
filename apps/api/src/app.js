const express = require('express');
const { createVisitasRouter } = require('./visitas/routes');
const authRepository = require('./auth/repository');
const { createAuthRouter } = require('./auth/routes');
const { createAuthorization } = require('./auth/authorization');
const { csrfProtection } = require('./auth/csrf');
const { sendMail } = require('./mail');
const { checkDatabase, pool: defaultPool } = require('./database');
const { createApiKeyMiddleware } = require('./middleware/api-key');
const { createPhotosRouter } = require('./photos/routes');
const { createSynchronizationsRouter } = require('./sincronizaciones/routes');
const { createTerminalesRouter } = require('./terminales/routes');
const { createUsersRouter } = require('./usuarios/routes');

function createApp({
  apiKey,
  databasePool = defaultPool,
  checkDatabaseFn = checkDatabase,
  sendMailFn = sendMail,
  importEnabled = false,
  visitasEnabled = false,
  snapshotConfig = {},
  importService,
  synchronizationRepository,
  terminalRepository,
  photoRepository,
  optimizePhotoFn,
  sessionMiddleware,
  corsMiddleware = (_req, _res, next) => next(),
  users = authRepository,
  authorization,
  cookieName = 'cartera.sid',
  loginLimits = { maxAttempts: 5, windowSeconds: 900, blockSeconds: 900 },
  trustProxy = false
} = {}) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Falta configurar API_KEY en .env.');
  }
  if (typeof sessionMiddleware !== 'function') {
    throw new Error('Falta configurar el middleware de sesiones persistentes.');
  }

  const app = express();
  const requireApiKey = createApiKeyMiddleware(apiKey);
  const access = authorization || createAuthorization({ pool: databasePool, users });

  app.set('trust proxy', trustProxy);
  app.use(corsMiddleware);
  app.use(sessionMiddleware);
  app.use('/api/cartera/celular', requireApiKey);
  app.use('/api/v1/terminales', createPhotosRouter({
    pool: databasePool,
    requireAuth: access.requireAuth,
    csrfProtection,
    ...(photoRepository ? { repositoryApi: photoRepository } : {}),
    ...(optimizePhotoFn ? { optimizePhotoFn } : {})
  }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/v1/health', requireApiKey, async (req, res) => {
    try {
      await checkDatabaseFn();
      return res.status(200).json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error(`PostgreSQL no disponible: ${error.name || 'Error'}`);
      return res.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });
  app.use('/api/v1/auth', createAuthRouter({
    pool: databasePool,
    users,
    requireAuth: access.requireAuth,
    loginLimits,
    cookieName
  }));
  app.use('/api/v1/terminales', access.requireAuth, createTerminalesRouter({
    pool: databasePool,
    csrfProtection,
    sendMailFn,
    visitasEnabled,
    ...(terminalRepository ? { repositoryApi: terminalRepository } : {})
  }));
  app.use('/api/v1/visitas', access.requireAuth, createVisitasRouter({
    pool: databasePool, enabled: visitasEnabled, requireAdmin: access.requireAdmin
  }));
  app.use('/api/v1/sincronizaciones', access.requireAuth, access.requireAdmin, createSynchronizationsRouter({
    pool: databasePool,
    importEnabled,
    snapshotConfig,
    csrfProtection,
    ...(importService ? { importService } : {}),
    ...(synchronizationRepository ? { repositoryApi: synchronizationRepository } : {})
  }));
  app.use('/api/v1/usuarios', access.requireAuth, access.requireAdmin, createUsersRouter({
    pool: databasePool,
    users,
    csrfProtection
  }));

  app.post('/api/cartera/celular', async (req, res) => {
    const { terminal, celular } = req.body || {};

    if (!validateValue(terminal) || !validateValue(celular)) {
      return res.status(400).json({
        ok: false,
        error: 'terminal y celular deben ser textos no vacíos y no contener caracteres no permitidos.'
      });
    }

    const cleanTerminal = terminal.trim();
    const cleanCelular = celular.trim();
    const subject = `ACTUALIZAR_CARTERA|${cleanTerminal}|${cleanCelular}`;

    try {
      await sendMailFn({ subject });
      return res.status(202).json({
        ok: true,
        terminal: cleanTerminal,
        mensaje: 'Actualización enviada a Power Automate'
      });
    } catch (error) {
      console.error(`No se pudo enviar actualización de cartera: ${error.name || 'Error'}`);
      return res.status(500).json({
        ok: false,
        error: 'No se pudo enviar la actualización.'
      });
    }
  });

  app.use((error, req, res, next) => {
    if (error.code === 'CORS_DENIED') {
      return res.status(403).json({ ok: false, error: 'Origen no permitido.' });
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ ok: false, error: 'El cuerpo debe ser JSON válido.' });
    }
    if (error.type === 'entity.too.large'
        && String(req.originalUrl || '').split('?', 1)[0].endsWith('/fotografia')) {
      return res.status(413).json({ ok: false, codigo: 'FOTO_DEMASIADO_GRANDE', mensaje: 'La fotografía supera el límite de 8 MiB.' });
    }
    return next(error);
  });

  app.use((error, req, res, next) => {
    console.error(`Error HTTP no controlado: ${error.name || 'Error'}`);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
  });

  return app;
}

function validateValue(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }
  return !/[|\u0000-\u001F\u007F]/u.test(value);
}

module.exports = { createApp };
