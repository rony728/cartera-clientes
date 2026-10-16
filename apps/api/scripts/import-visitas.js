// Importador independiente, nunca se ejecuta al arrancar la API.
require('dotenv').config();
const { pool, closeDatabase } = require('../src/database');
const { importVisitas } = require('../src/visitas/service');
async function main() {
  // Doble habilitación explícita antes de tocar cualquier base de datos.
  if (process.env.VISITAS_IMPORT_ENABLED !== 'true') throw new Error('IMPORTACION_DESHABILITADA');
  const result = await importVisitas({ pool, config: {
    ...(process.env.VISITAS_ROOT ? { root: process.env.VISITAS_ROOT } : {})
  } });
  console.log(JSON.stringify({ id: result.id, estado: result.estado }));
}
main().catch(() => {
  console.error('Importación de visitas no completada. Revisar estado administrativo.');
  process.exitCode = 1;
}).finally(closeDatabase);
