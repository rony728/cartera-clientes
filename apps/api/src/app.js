const express = require('express');
const { sendMail } = require('./mail');
const { checkDatabase, pool: defaultPool } = require('./database');
const { createApiKeyMiddleware } = require('./middleware/api-key');
const { createTerminalesRouter } = require('./terminales/routes');

function createApp({
  apiKey,
  databasePool = defaultPool,
  checkDatabaseFn = checkDatabase,
  sendMailFn = sendMail
} = {}) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Falta configurar API_KEY en .env.');
  }

  const app = express();
  const requireApiKey = createApiKeyMiddleware(apiKey);

  app.use('/api/cartera/celular', requireApiKey);
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
  app.use('/api/v1/terminales', requireApiKey, createTerminalesRouter({ pool: databasePool }));

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
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ ok: false, error: 'El cuerpo debe ser JSON válido.' });
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
