const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadTestDatabaseConfig,
  verifyTestDatabase
} = require('./integration/test-database');

test('la configuración de integración no usa variables de producción como fallback', () => {
  assert.throws(
    () => loadTestDatabaseConfig({
      DATABASE_URL: 'postgresql://example/otra',
      DB_NAME: 'otra'
    }),
    /TEST_DATABASE_URL y TEST_DATABASE_NAME/u
  );
});

test('rechaza expresamente nombres de bases protegidas', () => {
  for (const name of ['cartera_clientes', 'postgres', 'template0', 'template1']) {
    assert.throws(
      () => loadTestDatabaseConfig({
        TEST_DATABASE_URL: `postgresql://test:test@127.0.0.1:5432/${name}`,
        TEST_DATABASE_NAME: name
      }),
      /prohibida/u
    );
  }
});

test('exige coincidencia entre URL, confirmación y current_database()', async () => {
  assert.throws(
    () => loadTestDatabaseConfig({
      TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/base_a',
      TEST_DATABASE_NAME: 'base_b'
    }),
    /coincidir exactamente/u
  );
  await assert.rejects(
    () => verifyTestDatabase({
      async query() { return { rows: [{ database_name: 'base_incorrecta', user_name: 'test' }] }; }
    }, 'cartera_clientes_pruebas'),
    /Identidad de base de pruebas rechazada/u
  );
});
