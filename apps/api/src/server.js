require('dotenv').config();

const { closeDatabase } = require('./database');
const { createApp } = require('./app');

function startServer() {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Falta configurar API_KEY en .env.');
  }

  const host = process.env.HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.PORT || '3005', 10);
  const app = createApp({ apiKey });
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
