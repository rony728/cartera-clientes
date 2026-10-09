require('dotenv').config();

const { cleanTestData, createVerifiedTestPool } = require('../test/integration/test-database');

async function main() {
  const { pool, config, identity } = await createVerifiedTestPool();
  try {
    await cleanTestData(pool, config.expectedName);
    console.log(`Datos de prueba eliminados de forma transaccional en ${identity.databaseName}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`No se pudo limpiar la base de pruebas: ${error.message}`);
  process.exitCode = 1;
});
