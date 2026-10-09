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
  const maxSnapshotBytes = Number.parseInt(process.env.SNAPSHOT_MAX_BYTES || '10485760', 10);
  if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1) {
    throw new Error('SNAPSHOT_MAX_BYTES debe ser un entero positivo.');
  }
  const app = createApp({
    apiKey,
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
