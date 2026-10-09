const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cartera_clientes',
  user: process.env.DB_USER || 'cartera_clientes_api',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: false
});

pool.on('error', () => {
  console.error('Error inesperado en el pool de PostgreSQL.');
});

async function checkDatabase() {
  await pool.query('SELECT 1');
}

async function closeDatabase() {
  await pool.end();
}

module.exports = { checkDatabase, closeDatabase, pool };
