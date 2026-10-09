require('dotenv').config();

const { createVerifiedTestPool, verifySchema } = require('../test/integration/test-database');

async function main() {
  const { pool, identity } = await createVerifiedTestPool();
  try {
    await verifySchema(pool);
    console.log(`Conexión y esquema de pruebas verificados: ${identity.databaseName}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Base de pruebas no disponible: ${error.message}`);
  process.exitCode = 1;
});
