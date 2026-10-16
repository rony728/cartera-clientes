const { Pool } = require('pg');

const FORBIDDEN_DATABASES = new Set(['cartera_clientes', 'postgres', 'template0', 'template1']);
const REQUIRED_TABLES = [
  'visitas_actuales',
  'visitas_fuentes',
  'visitas_reportes',
  'importaciones_visitas',
  'usuarios',
  'terminales',
  'sincronizaciones',
  'cola_sincronizacion',
  'historial_cambios',
  'conflictos_sincronizacion',
  'user_sessions',
  'auth_login_attempts',
  'fotografias_comercios'
];

function loadTestDatabaseConfig(env = process.env) {
  const connectionString = env.TEST_DATABASE_URL;
  const expectedName = env.TEST_DATABASE_NAME;
  if (!connectionString || !expectedName) {
    throw new Error(
      'Configura explícitamente TEST_DATABASE_URL y TEST_DATABASE_NAME para una base PostgreSQL aislada.'
    );
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch (_) {
    throw new Error('TEST_DATABASE_URL no es una URL PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL debe usar el protocolo postgres o postgresql.');
  }
  const urlName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!urlName || urlName !== expectedName) {
    throw new Error('TEST_DATABASE_NAME debe coincidir exactamente con la base indicada en TEST_DATABASE_URL.');
  }
  if (FORBIDDEN_DATABASES.has(expectedName.toLowerCase())) {
    throw new Error(`La base ${expectedName} está prohibida para pruebas de integración.`);
  }
  return { connectionString, expectedName };
}

async function verifyTestDatabase(pool, expectedName) {
  const result = await pool.query(
    'SELECT current_database() AS database_name, current_user AS user_name'
  );
  const actualName = result.rows[0]?.database_name;
  if (actualName !== expectedName || FORBIDDEN_DATABASES.has(String(actualName).toLowerCase())) {
    throw new Error(
      `Identidad de base de pruebas rechazada: se esperaba ${expectedName} y PostgreSQL informó ${actualName || 'desconocida'}.`
    );
  }
  return { databaseName: actualName, userName: result.rows[0].user_name };
}

async function createVerifiedTestPool(env = process.env) {
  const config = loadTestDatabaseConfig(env);
  const pool = new Pool({
    connectionString: config.connectionString,
    max: 6,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });
  try {
    const identity = await verifyTestDatabase(pool, config.expectedName);
    return { pool, config, identity };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}

async function verifySchema(pool) {
  const result = await pool.query({
    text: `SELECT name, to_regclass('public.' || name) AS relation
           FROM unnest($1::text[]) AS name`,
    values: [REQUIRED_TABLES]
  });
  const missing = result.rows.filter((row) => row.relation === null).map((row) => row.name);
  if (missing.length > 0) {
    throw new Error(
      `Falta instalar el esquema de pruebas (${missing.join(', ')}). Ejecuta npm run test:db:setup.`
    );
  }
}

async function cleanTestData(pool, expectedName) {
  await verifyTestDatabase(pool, expectedName);
  await verifySchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      TRUNCATE TABLE
        public.visitas_actuales,
        public.visitas_fuentes,
        public.visitas_reportes,
        public.importaciones_visitas,
        public.fotografias_comercios,
        public.conflictos_sincronizacion,
        public.historial_cambios,
        public.cola_sincronizacion,
        public.sincronizaciones,
        public.user_sessions,
        public.auth_login_attempts,
        public.terminales,
        public.usuarios
      RESTART IDENTITY CASCADE
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  FORBIDDEN_DATABASES,
  cleanTestData,
  createVerifiedTestPool,
  loadTestDatabaseConfig,
  verifySchema,
  verifyTestDatabase
};
