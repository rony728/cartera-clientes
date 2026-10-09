require('dotenv').config();

const express = require('express');
const { sendMail } = require('./mail');
const { checkDatabase, closeDatabase } = require('./database');

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '3005', 10);
const apiKey = process.env.API_KEY;

if (!apiKey || apiKey.trim() === '') {
  console.error('No se puede iniciar la API: falta configurar API_KEY en .env.');
  process.exit(1);
}

function requireApiKey(req, res, next) {
  if (req.get('X-API-Key') !== apiKey) {
    return res.status(401).json({ ok: false, mensaje: 'No autorizado' });
  }
  return next();
}

app.use('/api/cartera/celular', requireApiKey);
app.use(express.json({ limit: '16kb' }));

app.get('/api/v1/health', requireApiKey, async (req, res) => {
  try {
    await checkDatabase();
    return res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error(`PostgreSQL no disponible: ${error.name || 'Error'}`);
    return res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

function validateValue(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }

  // Evita el delimitador del asunto y caracteres de control (incluidos CR/LF).
  return !/[|\u0000-\u001F\u007F]/u.test(value);
}

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
    await sendMail({ subject });
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

app.listen(port, host, () => {
  console.log(`API escuchando en http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`Cerrando API (${signal}).`);
  await closeDatabase();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(1));
});
