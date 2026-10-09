const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/app');
const { buildSearchQuery, findTerminal } = require('../src/terminales/queries');
const { parseSearchParams, ValidationError } = require('../src/terminales/validation');

const terminalRow = {
  terminal: '000123',
  datos_excel: {
    NombreComercial: 'Comercio Ejemplo',
    CodigoComercio: '12345',
    Inventario: 'POS-01',
    SeriePOS: 'SERIE-01'
  },
  activa: true,
  version: '1',
  fecha_creacion: '2026-01-01T00:00:00.000Z',
  fecha_actualizacion: '2026-01-02T00:00:00.000Z',
  fecha_ultima_sincronizacion: '2026-01-03T00:00:00.000Z',
  total_count: '2'
};

function fakePool(rows = [terminalRow]) {
  const calls = [];
  return {
    calls,
    async query(query) {
      calls.push(query);
      return { rows };
    }
  };
}

function request(app, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const request = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers
      }, (response) => {
        let responseBody = '';
        response.on('data', (chunk) => { responseBody += chunk; });
        response.on('end', () => {
          server.close(() => resolve({
            status: response.statusCode,
            body: responseBody ? JSON.parse(responseBody) : null
          }));
        });
      });
      request.on('error', reject);
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
  });
}

function appWithPool(pool = fakePool(), options = {}) {
  return {
    app: createApp({
      apiKey: 'test-api-key',
      databasePool: pool,
      checkDatabaseFn: options.checkDatabaseFn || (async () => {}),
      sendMailFn: options.sendMailFn || (async () => {})
    }),
    pool
  };
}

test('health informa conexión disponible sin exponer detalles', async () => {
  const { app } = appWithPool(undefined, { checkDatabaseFn: async () => {} });
  const response = await request(app, {
    path: '/api/v1/health',
    headers: { 'X-API-Key': 'test-api-key' }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok', database: 'connected' });
});

test('health informa PostgreSQL no disponible con HTTP 503', async () => {
  const { app } = appWithPool(undefined, {
    checkDatabaseFn: async () => { throw new Error('simulated database failure'); }
  });
  const response = await request(app, {
    path: '/api/v1/health',
    headers: { 'X-API-Key': 'test-api-key' }
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'error', database: 'unavailable' });
});

test('busca exacta por Terminal y conserva ceros a la izquierda', async () => {
  const { app, pool } = appWithPool();
  const response = await request(app, {
    path: '/api/v1/terminales?q=000123&campo=terminal',
    headers: { 'X-API-Key': 'test-api-key' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.datos[0].terminal, '000123');
  assert.equal(pool.calls[0].values[0], '000123');
});

test('busca parcialmente por Terminal con paginación', async () => {
  const { app, pool } = appWithPool();
  const response = await request(app, {
    path: '/api/v1/terminales?q=123&campo=terminal&pagina=2&limite=1',
    headers: { 'X-API-Key': 'test-api-key' }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.paginacion, { pagina: 2, limite: 1, total: 2, total_paginas: 2 });
  assert.deepEqual(pool.calls[0].values, ['123', '123', 1, 1]);
});

test('busca por cada propiedad JSONB permitida', async () => {
  for (const campo of ['NombreComercial', 'CodigoComercio', 'Inventario', 'SeriePOS']) {
    const filters = parseSearchParams({ q: 'valor', campo, estado: 'todas' });
    const query = buildSearchQuery(filters);
    assert.match(query.text, new RegExp(`datos_excel->>['"]${campo}['"]`));
  }
});

test('búsqueda general usa todos los campos permitidos', () => {
  const query = buildSearchQuery(parseSearchParams({ q: 'valor', campo: 'todos' }));
  for (const campo of ['NombreComercial', 'CodigoComercio', 'Inventario', 'SeriePOS']) {
    assert.match(query.text, new RegExp(`datos_excel->>['"]${campo}['"]`));
  }
});

test('filtra por estado y calcula total de páginas', async () => {
  const { app, pool } = appWithPool();
  const response = await request(app, {
    path: '/api/v1/terminales?estado=inactivas&limite=2',
    headers: { 'X-API-Key': 'test-api-key' }
  });
  assert.equal(response.status, 200);
  assert.match(pool.calls[0].text, /t\.activa = false/);
  assert.equal(response.body.paginacion.total_paginas, 1);
});

test('consulta una terminal específica mediante su clave exacta', async () => {
  const pool = fakePool([{ ...terminalRow, total_count: undefined }]);
  const found = await findTerminal(pool, '000123');
  assert.equal(found.terminal, '000123');
  assert.deepEqual(pool.calls[0].values, ['000123']);
});

test('devuelve 404 para una terminal inexistente', async () => {
  const { app } = appWithPool(fakePool([]));
  const response = await request(app, {
    path: '/api/v1/terminales/99999999',
    headers: { 'X-API-Key': 'test-api-key' }
  });
  assert.equal(response.status, 404);
});

test('rechaza parámetros inválidos y valores de campo no permitidos', () => {
  assert.throws(() => parseSearchParams({ limite: '101' }), ValidationError);
  assert.throws(() => parseSearchParams({ pagina: '0' }), ValidationError);
  assert.throws(() => parseSearchParams({ campo: 'terminal; DROP TABLE terminales' }), ValidationError);
  assert.throws(() => parseSearchParams({ estado: 'cualquiera' }), ValidationError);
});

test('los valores de búsqueda son parámetros, no SQL ejecutable', () => {
  const query = buildSearchQuery(parseSearchParams({ q: "' OR 1=1 --", campo: 'todos' }));
  assert.equal(query.values[0], "' OR 1=1 --");
  assert.doesNotMatch(query.text, /OR 1=1/);
});

test('rechaza solicitudes sin API key o con una clave incorrecta', async () => {
  const { app } = appWithPool();
  const missing = await request(app, { path: '/api/v1/terminales' });
  const incorrect = await request(app, {
    path: '/api/v1/terminales',
    headers: { 'X-API-Key': 'incorrecta' }
  });
  assert.equal(missing.status, 401);
  assert.equal(incorrect.status, 401);
});

test('permite la consulta protegida con la API key correcta', async () => {
  const { app } = appWithPool();
  const response = await request(app, {
    path: '/api/v1/terminales/000123',
    headers: { 'X-API-Key': 'test-api-key' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.terminal, '000123');
});

test('mantiene el endpoint existente de correo sin enviarlo durante la prueba', async () => {
  let sentSubject;
  const { app } = appWithPool(undefined, {
    sendMailFn: async ({ subject }) => { sentSubject = subject; }
  });
  const response = await request(app, {
    method: 'POST',
    path: '/api/cartera/celular',
    headers: { 'X-API-Key': 'test-api-key', 'Content-Type': 'application/json' },
    body: { terminal: '000123', celular: '99999999' }
  });
  assert.equal(response.status, 202);
  assert.equal(sentSubject, 'ACTUALIZAR_CARTERA|000123|99999999');
});
