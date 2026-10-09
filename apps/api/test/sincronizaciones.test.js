const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/app');
const { buildPlan, diffFields } = require('../src/sincronizaciones/domain');
const repository = require('../src/sincronizaciones/repository');
const { ImportError, importSnapshot, reconcilePendingQueue } = require('../src/sincronizaciones/service');
const { SnapshotError, parseSnapshot, readSnapshot } = require('../src/sincronizaciones/snapshot');
const { baseAppOptions } = require('./test-app-options');

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function record(terminal, extras = {}) {
  return { Terminal: terminal, NombreComercial: `Comercio ${terminal}`, ...extras };
}

function normalized(terminal, datos = {}, activa = true) {
  return { terminal, datos_excel: datos, activa, version: '1' };
}

function request(app, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const req = http.request({ host: '127.0.0.1', port: address.port, method, path, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => server.close(() => resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null
        })));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

function serviceHarness({ existing = [], lock = true, failApply = false, queue = [] } = {}) {
  const commands = [];
  const events = { attempts: [], finishes: [], history: [], confirmations: [], conflicts: [] };
  const client = {
    async query(query) {
      const text = typeof query === 'string' ? query : query.text;
      commands.push(text.trim());
      if (text.includes('pg_try_advisory')) return { rows: [{ acquired: lock }] };
      return { rows: [] };
    },
    release() { events.released = true; }
  };
  const pool = { async connect() { return client; } };
  const repositoryApi = {
    async createAttempt(_pool, data) { events.attempts.push(data); return 41; },
    async finishAttempt(_queryable, id, estado, counters, detail) {
      events.finishes.push({ id, estado, counters: { ...counters }, detail });
    },
    async getExistingTerminals() { return existing; },
    async applyActions(_client, actions) {
      if (failApply) throw new Error('simulated failure');
      events.actions = actions;
    },
    async insertHistory(_client, id, entries) { events.history.push({ id, entries }); },
    async getLatestUnresolvedQueue() { return queue; },
    async confirmQueueEntry(_client, id) { events.confirmations.push(id); },
    async createConflict(_client, syncId, entry, value, present) {
      events.conflicts.push({ syncId, entry, value, present });
      return true;
    }
  };
  return { pool, client, repositoryApi, commands, events };
}

function snapshot(records, modifiedAt = new Date('2026-01-02T00:00:00Z')) {
  return { hash: 'a'.repeat(64), records, modifiedAt };
}

test('acepta un arreglo raíz y un arreglo en ruta configurable', () => {
  assert.equal(parseSnapshot(jsonBuffer([record('001')])).records[0].terminal, '001');
  assert.equal(parseSnapshot(jsonBuffer({ value: [record('002')] }), { recordsPath: 'value' }).records[0].terminal, '002');
});

test('planifica una importación inicial atómica con historial', () => {
  const plan = buildPlan([], [normalized('001', { NombreComercial: 'A' })]);
  assert.equal(plan.counters.insertados, 1);
  assert.equal(plan.actions[0].type, 'insert');
  assert.equal(plan.history.some((entry) => entry.campo === 'NombreComercial'), true);
});

test('una segunda importación idéntica no duplica cambios', () => {
  const plan = buildPlan([normalized('001', { NombreComercial: 'A' })], [normalized('001', { NombreComercial: 'A' })]);
  assert.equal(plan.counters.sin_cambios, 1);
  assert.equal(plan.history.length, 0);
});

test('detecta modificación de uno y varios campos', () => {
  assert.equal(diffFields({ a: 1 }, { a: 2 }).length, 1);
  assert.equal(diffFields({ a: 1, b: 2 }, { a: 2, b: 3 }).length, 2);
});

test('planifica una terminal nueva en sincronizaciones posteriores', () => {
  const plan = buildPlan([normalized('001')], [normalized('001'), normalized('002')]);
  assert.equal(plan.counters.insertados, 1);
});

test('inactiva una terminal desaparecida sin eliminarla', () => {
  const plan = buildPlan([normalized('001'), normalized('002')], [normalized('001')]);
  assert.equal(plan.actions.some((action) => action.type === 'deactivate' && action.record.terminal === '002'), true);
});

test('reactiva una terminal que reaparece', () => {
  const plan = buildPlan([normalized('001', {}, false)], [normalized('001')]);
  assert.equal(plan.counters.reactivados, 1);
  assert.equal(plan.actions[0].reactivated, true);
});

test('permite ausencias de hasta 10% y exige confirmación por encima', () => {
  const ten = Array.from({ length: 10 }, (_, i) => normalized(String(i)));
  assert.equal(buildPlan(ten, ten.slice(0, 9)).requiresMassDeactivationConfirmation, false);
  const eleven = Array.from({ length: 11 }, (_, i) => normalized(String(i)));
  assert.equal(buildPlan(eleven, eleven.slice(0, 9)).requiresMassDeactivationConfirmation, true);
});

test('rechaza ausencia masiva sin confirmación y la acepta con confirmación', async () => {
  const existing = Array.from({ length: 11 }, (_, i) => normalized(String(i)));
  const incoming = existing.slice(0, 9).map(({ terminal, datos_excel }) => ({ terminal, datos_excel }));
  const rejected = serviceHarness({ existing });
  await assert.rejects(() => importSnapshot({
    pool: rejected.pool,
    snapshotConfig: {},
    readSnapshotFn: async () => snapshot(incoming),
    repositoryApi: rejected.repositoryApi
  }), (error) => error.code === 'MASS_DEACTIVATION_CONFIRMATION_REQUIRED');
  assert.equal(rejected.events.finishes.at(-1).estado, 'RECHAZADA');

  const accepted = serviceHarness({ existing });
  const result = await importSnapshot({
    pool: accepted.pool,
    snapshotConfig: {},
    confirmMassDeactivation: true,
    readSnapshotFn: async () => snapshot(incoming),
    repositoryApi: accepted.repositoryApi
  });
  assert.equal(result.estado, 'COMPLETADA');
});

test('rechaza snapshot vacío, corrupto, duplicado, sin Terminal o con Terminal numérica', () => {
  assert.throws(() => parseSnapshot(jsonBuffer([])), (error) => error.code === 'SNAPSHOT_EMPTY');
  assert.throws(() => parseSnapshot(Buffer.from('{')), (error) => error.code === 'INVALID_JSON');
  assert.throws(() => parseSnapshot(jsonBuffer([record('1'), record('1')])), (error) => error.code === 'DUPLICATE_TERMINAL');
  assert.throws(() => parseSnapshot(jsonBuffer([{ Nombre: 'A' }])), (error) => error.code === 'MISSING_TERMINAL');
  assert.throws(() => parseSnapshot(jsonBuffer([{ Terminal: 123 }])) , (error) => error.code === 'NUMERIC_TERMINAL');
});

test('conserva ceros a la izquierda y columnas nuevas', () => {
  const parsed = parseSnapshot(jsonBuffer([record('000123', { NuevaColumna: { activo: true } })]));
  assert.equal(parsed.records[0].terminal, '000123');
  assert.deepEqual(parsed.records[0].datos_excel.NuevaColumna, { activo: true });
});

test('distingue propiedades ausentes frente a null', () => {
  const changes = diffFields({ campo: null }, {});
  assert.equal(changes[0].valor_anterior_presente, true);
  assert.equal(changes[0].valor_nuevo_presente, false);
});

test('ignora valores técnicos para evitar falsos cambios', () => {
  const first = parseSnapshot(jsonBuffer([record('1', { ItemInternalId: 'A', '@odata.etag': '1' })]));
  const second = parseSnapshot(jsonBuffer([record('1', { ItemInternalId: 'B', '@odata.etag': '2' })]));
  assert.deepEqual(first.records[0], second.records[0]);
  const plan = buildPlan([
    normalized('1', { NombreComercial: 'Comercio 1', ItemInternalId: 'viejo', '@odata.etag': 'viejo' })
  ], first.records);
  assert.equal(plan.counters.sin_cambios, 1);
  assert.equal(plan.history.length, 0);
});

test('registra contadores, historial y COMMIT en una importación satisfactoria', async () => {
  const harness = serviceHarness();
  const result = await importSnapshot({
    pool: harness.pool,
    snapshotConfig: {},
    readSnapshotFn: async () => snapshot([normalized('001', { a: 1 })]),
    repositoryApi: harness.repositoryApi
  });
  assert.equal(result.insertados, 1);
  assert.equal(harness.events.history[0].entries.length >= 1, true);
  assert.equal(harness.commands.includes('COMMIT'), true);
});

test('un fallo transaccional ejecuta ROLLBACK y registra ERROR', async () => {
  const harness = serviceHarness({ failApply: true });
  await assert.rejects(() => importSnapshot({
    pool: harness.pool,
    snapshotConfig: {},
    readSnapshotFn: async () => snapshot([normalized('001')]),
    repositoryApi: harness.repositoryApi
  }), (error) => error.code === 'IMPORT_FAILED');
  assert.equal(harness.commands.includes('ROLLBACK'), true);
  assert.equal(harness.events.finishes.at(-1).estado, 'ERROR');
  assert.equal(harness.events.finishes.at(-1).counters.insertados, 0);
  assert.equal(harness.events.released, true);
});

test('un fallo al adquirir conexión registra ERROR sin dejar EN_PROCESO', async () => {
  const events = [];
  const repositoryApi = {
    async createAttempt() { return 42; },
    async finishAttempt(_pool, id, estado, counters, detail) {
      events.push({ id, estado, counters, detail });
    }
  };
  await assert.rejects(() => importSnapshot({
    pool: { async connect() { throw new Error('unavailable'); } },
    snapshotConfig: {},
    readSnapshotFn: async () => snapshot([normalized('001')]),
    repositoryApi
  }), (error) => error.code === 'IMPORT_FAILED');
  assert.equal(events[0].estado, 'ERROR');
  assert.equal(events[0].detail, 'DATABASE_CONNECTION_FAILED');
});

test('rechaza una segunda importación cuando el bloqueo asesor está ocupado', async () => {
  const harness = serviceHarness({ lock: false });
  await assert.rejects(() => importSnapshot({
    pool: harness.pool,
    snapshotConfig: {},
    readSnapshotFn: async () => snapshot([normalized('001')]),
    repositoryApi: harness.repositoryApi
  }), (error) => error.code === 'IMPORT_IN_PROGRESS');
  assert.equal(harness.events.finishes.at(-1).estado, 'RECHAZADA');
});

test('una revisión PENDIENTE igual no se confirma antes de enviarse', async () => {
  const queue = [{ id: 1, terminal: '001', campo: 'a', valor_nuevo: 2, valor_nuevo_presente: true, estado: 'PENDIENTE', fecha_envio: null }];
  const harness = serviceHarness({ queue });
  await reconcilePendingQueue(harness.client, 41, [normalized('001', { a: 2 })], new Date(), harness.repositoryApi);
  assert.deepEqual(harness.events.confirmations, []);
});

test('confirma una revisión enviada solo con snapshot posterior', async () => {
  const queue = [{ id: 1, terminal: '001', campo: 'a', valor_nuevo: 2, valor_nuevo_presente: true, estado: 'ENVIADO', fecha_envio: '2026-01-01T00:00:00Z' }];
  const harness = serviceHarness({ queue });
  await reconcilePendingQueue(harness.client, 41, [normalized('001', { a: 2 })], new Date('2026-01-02'), harness.repositoryApi);
  assert.deepEqual(harness.events.confirmations, [1]);
  const old = serviceHarness({ queue });
  await reconcilePendingQueue(old.client, 41, [normalized('001', { a: 2 })], new Date('2025-12-31'), old.repositoryApi);
  assert.deepEqual(old.events.confirmations, []);
});

test('detecta conflicto incompatible y conserva presencia del valor Excel', async () => {
  const queue = [{ id: 1, terminal: '001', campo: 'a', valor_nuevo: 2, valor_nuevo_presente: true, estado: 'PENDIENTE', fecha_envio: null }];
  const harness = serviceHarness({ queue });
  const count = await reconcilePendingQueue(harness.client, 41, [normalized('001', {})], new Date(), harness.repositoryApi);
  assert.equal(count, 1);
  assert.equal(harness.events.conflicts[0].present, false);
});

test('la restricción de conflicto abierto evita duplicados', async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      return { rowCount: 0, rows: [] };
    }
  };
  const created = await repository.createConflict(client, 1, {
    id: 2, terminal: '001', campo: 'a', valor_nuevo: 3, valor_nuevo_presente: true
  }, 2, true);
  assert.equal(created, false);
  assert.match(calls[0].text, /ON CONFLICT \(cola_id\).*ABIERTO/s);
  assert.equal(calls.length, 1);
});

test('el endpoint de importación está protegido y deshabilitado por defecto', async () => {
  const app = createApp({
    apiKey: 'test-key',
    databasePool: { query: async () => ({ rows: [] }) },
    checkDatabaseFn: async () => {},
    sendMailFn: async () => {},
    ...baseAppOptions()
  });
  const disabled = await request(app, {
    method: 'POST',
    path: '/api/v1/sincronizaciones',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' },
    body: {}
  });
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.codigo, 'IMPORT_DISABLED');
});

test('expone historial paginado y detalle de sincronización protegidos', async () => {
  const synchronizationRepository = {
    async listSynchronizations() { return { datos: [{ id: '7', estado: 'COMPLETADA' }], total: 1 }; },
    async getSynchronization(_pool, id) { return id === 7 ? { id: '7', estado: 'COMPLETADA' } : null; }
  };
  const app = createApp({
    apiKey: 'test-key',
    databasePool: { query: async () => ({ rows: [] }) },
    checkDatabaseFn: async () => {},
    sendMailFn: async () => {},
    synchronizationRepository,
    ...baseAppOptions()
  });
  const list = await request(app, {
    path: '/api/v1/sincronizaciones?pagina=1&limite=20',
    headers: {}
  });
  assert.equal(list.status, 200);
  assert.equal(list.body.paginacion.total, 1);
  const detail = await request(app, {
    path: '/api/v1/sincronizaciones/7',
    headers: {}
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, '7');
});

test('el endpoint habilitado inicia solo la ruta configurada del servidor', async () => {
  let received;
  const app = createApp({
    apiKey: 'test-key',
    databasePool: { query: async () => ({ rows: [] }) },
    checkDatabaseFn: async () => {},
    sendMailFn: async () => {},
    importEnabled: true,
    snapshotConfig: { filePath: '/ruta-configurada/snapshot.json' },
    importService: async (options) => {
      received = options;
      return { id: 1, estado: 'COMPLETADA' };
    },
    ...baseAppOptions()
  });
  const response = await request(app, {
    method: 'POST',
    path: '/api/v1/sincronizaciones',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' },
    body: { confirmar_inactivacion_masiva: true, ruta: '/ruta-del-cliente' }
  });
  assert.equal(response.status, 200);
  assert.equal(received.snapshotConfig.filePath, '/ruta-configurada/snapshot.json');
  assert.equal(received.confirmMassDeactivation, true);
});

test('valida límite de tamaño y archivo inexistente', async () => {
  assert.throws(
    () => parseSnapshot(jsonBuffer([record('001')]), { maxBytes: 1 }),
    (error) => error.code === 'SNAPSHOT_TOO_LARGE'
  );
  await assert.rejects(
    () => readSnapshot({ filePath: 'Z:\\ruta-inexistente\\snapshot.json' }),
    (error) => error instanceof SnapshotError && error.code === 'SNAPSHOT_UNREADABLE'
  );
});

test('los endpoints de health, terminales y correo permanecen registrados', async () => {
  const pool = { async query() { return { rows: [] }; } };
  const app = createApp({
    apiKey: 'test-key', databasePool: pool, checkDatabaseFn: async () => {}, sendMailFn: async () => {}, ...baseAppOptions()
  });
  assert.equal((await request(app, { path: '/api/v1/health', headers: { 'X-API-Key': 'test-key' } })).status, 200);
  assert.equal((await request(app, { path: '/api/v1/terminales' })).status, 200);
  assert.equal((await request(app, {
    method: 'POST', path: '/api/cartera/celular', headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' }, body: { terminal: '001', celular: '999' }
  })).status, 202);
});
