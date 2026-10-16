const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config();

const { createVerifiedTestPool, verifySchema } = require('../test/integration/test-database');

const MIGRATIONS = ['001_initial_schema.sql', '002_auth_sessions.sql', '003_internal_terminal_fields.sql', '004_terminal_photos.sql', '005_visitas_tecnicas.sql'];

async function main() {
  const { pool, identity } = await createVerifiedTestPool();
  try {
    console.log(`Base de pruebas verificada: ${identity.databaseName}`);
    for (const migration of MIGRATIONS) {
      const migrationPath = path.resolve(__dirname, '../../../database/migrations', migration);
      const sql = await fs.readFile(migrationPath, 'utf8');
      await pool.query(sql);
      console.log(`Migración instalada: ${migration}`);
    }
    await verifySchema(pool);
    console.log('Esquema de pruebas listo. No se creó ni eliminó ninguna base de datos.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`No se pudo preparar la base de pruebas: ${error.message}`);
  process.exitCode = 1;
});
