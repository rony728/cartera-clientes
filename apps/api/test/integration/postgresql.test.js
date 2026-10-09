const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../../src/app');
const authRepository = require('../../src/auth/repository');
const { hashPassword } = require('../../src/auth/password');
const { createSessionMiddleware } = require('../../src/auth/session');
const repository = require('../../src/sincronizaciones/repository');
const terminalRepository = require('../../src/terminales/repository');
const { ImportError, importSnapshot } = require('../../src/sincronizaciones/service');
const { SnapshotError, parseSnapshot } = require('../../src/sincronizaciones/snapshot');
const {
  cleanTestData,
  createVerifiedTestPool,
  verifySchema
} = require('./test-database');

let pool;
let databaseConfig;

function syntheticSnapshot(rawRecords, modifiedAt = new Date()) {
  const buffer = Buffer.from(JSON.stringify(rawRecords));
  const parsed = parseSnapshot(buffer);
  return { ...parsed, modifiedAt };
}

function importer(snapshot, options = {}) {
  return importSnapshot({
    pool,
    snapshotConfig: {},
    readSnapshotFn: async () => snapshot,
    ...options
  });
}

function request(app, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, method, path, headers
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => server.close(() => resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
          headers: res.headers
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

function cookieFrom(response) {
  return response.headers['set-cookie']?.[0]?.split(';')[0];
}

async function login(app, usuario, password) {
  const csrf = await request(app, { path: '/api/v1/auth/csrf' });
  const response = await request(app, {
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: {
      Cookie: cookieFrom(csrf),
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.body.csrf_token
    },
    body: { usuario, password }
  });
  return { response, cookie: cookieFrom(response), csrfToken: response.body.csrf_token };
}

async function insertQueue({ terminal, campo, revision, value, state, sentAt = null }) {
  return pool.query({
    text: `INSERT INTO public.cola_sincronizacion
      (operacion_id, terminal, campo, revision, valor_anterior,
       valor_nuevo, valor_nuevo_presente, estado, fecha_envio)
      VALUES ($1, $2, $3, $4, 'null'::jsonb, $5::jsonb, true, $6, $7)
      RETURNING id`,
    values: [crypto.randomUUID(), terminal, campo, revision, JSON.stringify(value), state, sentAt]
  });
}

test.before(async () => {
  const verified = await createVerifiedTestPool();
  pool = verified.pool;
  databaseConfig = verified.config;
  await verifySchema(pool);
});

test.beforeEach(async () => cleanTestData(pool, databaseConfig.expectedName));
test.after(async () => {
  if (pool) {
    await cleanTestData(pool, databaseConfig.expectedName);
    await pool.end();
  }
});

test('importación inicial persiste texto, ceros, JSONB, historial y contadores', async () => {
  const result = await importer(syntheticSnapshot([
    { Terminal: '00001234', CodigoComercio: '00077', NombreComercial: 'Sintético A', Extra: { nivel: 2 } },
    { Terminal: '00005678', Inventario: 'INV-01', Celular: null }
  ]));

  assert.deepEqual(
    { total: result.total_registros, inserted: result.insertados, unchanged: result.sin_cambios },
    { total: 2, inserted: 2, unchanged: 0 }
  );
  const terminals = await pool.query('SELECT * FROM public.terminales ORDER BY terminal');
  assert.equal(terminals.rows[0].terminal, '00001234');
  assert.equal(terminals.rows[0].datos_excel.CodigoComercio, '00077');
  assert.deepEqual(terminals.rows[0].datos_excel.Extra, { nivel: 2 });
  assert.equal(terminals.rows[1].datos_excel.Celular, null);
  assert.ok(terminals.rows.every((row) => row.fecha_ultima_sincronizacion instanceof Date));
  const history = await pool.query('SELECT count(*)::int AS total FROM public.historial_cambios');
  assert.equal(history.rows[0].total, 7);
  const synchronization = await pool.query('SELECT * FROM public.sincronizaciones');
  assert.equal(synchronization.rows[0].estado, 'COMPLETADA');
  assert.ok(synchronization.rows[0].fecha_fin instanceof Date);
});

test('sincronizaciones posteriores no duplican y registran cambios dinámicos e inactivación/reactivación', async () => {
  const initial = await importer(syntheticSnapshot([
    { Terminal: '001', Inventario: 'A', SeriePOS: 'S1', Nullable: null, ItemInternalId: 't1' },
    { Terminal: '002', Inventario: 'B', SeriePOS: 'S2' }
  ]));
  const identical = await importer(syntheticSnapshot([
    { Terminal: '001', Inventario: 'A', SeriePOS: 'S1', Nullable: null, '@odata.etag': 'nuevo' },
    { Terminal: '002', Inventario: 'B', SeriePOS: 'S2' }
  ]));
  assert.equal(identical.sin_cambios, 2);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM public.terminales')).rows[0].total, 2);
  assert.equal((await pool.query({
    text: 'SELECT count(*)::int AS total FROM public.historial_cambios WHERE sincronizacion_id = $1',
    values: [identical.id]
  })).rows[0].total, 0);

  const changed = await importer(syntheticSnapshot([
    { Terminal: '001', Inventario: 'A2', SeriePOS: 'S1-N', ColumnaNueva: 'valor' },
    { Terminal: '003', Inventario: 'C' }
  ]), { confirmMassDeactivation: true });
  assert.deepEqual(
    { inserted: changed.insertados, updated: changed.actualizados, inactive: changed.inactivados },
    { inserted: 1, updated: 1, inactive: 1 }
  );
  const absentVsNull = await pool.query(`
    SELECT valor_anterior_presente, valor_nuevo_presente
    FROM public.historial_cambios WHERE terminal = '001' AND campo = 'Nullable'
    ORDER BY id DESC LIMIT 1
  `);
  assert.deepEqual(absentVsNull.rows[0], {
    valor_anterior_presente: true,
    valor_nuevo_presente: false
  });
  const changedFields = await pool.query({
    text: `SELECT campo FROM public.historial_cambios
      WHERE sincronizacion_id = $1 AND terminal = '001'
      ORDER BY campo`,
    values: [changed.id]
  });
  assert.deepEqual(changedFields.rows.map((row) => row.campo), [
    'ColumnaNueva', 'Inventario', 'Nullable', 'SeriePOS'
  ]);
  assert.equal((await pool.query("SELECT activa FROM public.terminales WHERE terminal = '002'")).rows[0].activa, false);

  const reactivated = await importer(syntheticSnapshot([
    { Terminal: '001', Inventario: 'A2', SeriePOS: 'S1-N', ColumnaNueva: 'valor' },
    { Terminal: '002', Inventario: 'B', SeriePOS: 'S2' },
    { Terminal: '003', Inventario: 'C' }
  ]));
  assert.equal(reactivated.reactivados, 1);
  assert.equal((await pool.query("SELECT activa FROM public.terminales WHERE terminal = '002'")).rows[0].activa, true);
  assert.equal((await pool.query({
    text: `SELECT count(*)::int AS total FROM public.historial_cambios
      WHERE sincronizacion_id = $1 AND terminal = '001'`,
    values: [reactivated.id]
  })).rows[0].total, 0);
  assert.equal((await pool.query({
    text: `SELECT count(*)::int AS total FROM public.historial_cambios
      WHERE sincronizacion_id = $1 AND terminal = '002' AND campo = '__estado_terminal__'`,
    values: [reactivated.id]
  })).rows[0].total, 1);
  assert.equal((await pool.query({
    text: `SELECT count(*)::int AS total FROM public.historial_cambios
      WHERE terminal = '001' AND campo IN ('Inventario', 'SeriePOS', 'ColumnaNueva', 'Nullable')
        AND sincronizacion_id IN ($1, $2)`,
    values: [initial.id, changed.id]
  })).rows[0].total, 7);
});

test('cola real confirma, conserva pendientes/antiguas/superadas y evita conflictos duplicados', async () => {
  const oldDate = new Date('2026-01-01T00:00:00Z');
  const newDate = new Date('2026-01-03T00:00:00Z');
  await importer(syntheticSnapshot([{ Terminal: 'Q1', A: 'base', B: 'base', C: 'base', D: 'base' }], oldDate));
  await insertQueue({ terminal: 'Q1', campo: 'A', revision: 1, value: 'local-a', state: 'PENDIENTE' });
  await insertQueue({ terminal: 'Q1', campo: 'B', revision: 1, value: 'confirmado', state: 'ENVIADO', sentAt: oldDate });
  const conflict = await insertQueue({ terminal: 'Q1', campo: 'C', revision: 1, value: 'local-c', state: 'ENVIADO', sentAt: oldDate });
  await insertQueue({ terminal: 'Q1', campo: 'D', revision: 1, value: 'ignorado', state: 'SUPERADA', sentAt: oldDate });
  await insertQueue({ terminal: 'Q1', campo: 'E', revision: 1, value: 'igual', state: 'ENVIADO', sentAt: newDate });

  await importer(syntheticSnapshot([
    { Terminal: 'Q1', A: 'local-a', B: 'confirmado', C: 'excel-c', D: 'excel-d', E: 'igual' }
  ], new Date('2026-01-02T00:00:00Z')));
  const states = await pool.query('SELECT campo, estado FROM public.cola_sincronizacion ORDER BY campo');
  assert.deepEqual(Object.fromEntries(states.rows.map((row) => [row.campo, row.estado])), {
    A: 'PENDIENTE', B: 'CONFIRMADO', C: 'CONFLICTO', D: 'SUPERADA', E: 'ENVIADO'
  });
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM public.conflictos_sincronizacion')).rows[0].total, 1);
  await importer(syntheticSnapshot([
    { Terminal: 'Q1', A: 'local-a', B: 'confirmado', C: 'excel-c', D: 'excel-d', E: 'igual' }
  ], new Date('2026-01-04T00:00:00Z')));
  assert.equal((await pool.query({
    text: 'SELECT count(*)::int AS total FROM public.conflictos_sincronizacion WHERE cola_id = $1',
    values: [conflict.rows[0].id]
  })).rows[0].total, 1);
});

test('un error revierte terminales e historial pero conserva el intento fallido', async () => {
  const failingRepository = {
    ...repository,
    async applyActions(client, actions) {
      await repository.applyActions(client, actions);
      throw new Error('fallo sintético después de escribir');
    }
  };
  await assert.rejects(
    () => importer(syntheticSnapshot([{ Terminal: 'R1', Campo: 'valor' }]), {
      repositoryApi: failingRepository
    }),
    (error) => error instanceof ImportError && error.code === 'IMPORT_FAILED'
  );
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM public.terminales')).rows[0].total, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM public.historial_cambios')).rows[0].total, 0);
  assert.equal((await pool.query("SELECT estado FROM public.sincronizaciones")).rows[0].estado, 'ERROR');
});

test('dos sincronizaciones concurrentes se excluyen y el bloqueo se libera al terminar', async () => {
  let announceFirstLock;
  let releaseFirst;
  const firstHasLock = new Promise((resolve) => { announceFirstLock = resolve; });
  const continueFirst = new Promise((resolve) => { releaseFirst = resolve; });
  let firstCall = true;
  const pausedRepository = {
    ...repository,
    async getExistingTerminals(client) {
      if (firstCall) {
        firstCall = false;
        announceFirstLock();
        await continueFirst;
      }
      return repository.getExistingTerminals(client);
    }
  };
  const firstImport = importer(syntheticSnapshot([{ Terminal: 'L1', Campo: 'primero' }]), {
    repositoryApi: pausedRepository
  });
  await firstHasLock;
  await assert.rejects(
    () => importer(syntheticSnapshot([{ Terminal: 'L2', Campo: 'segundo' }])),
    (error) => error.code === 'IMPORT_IN_PROGRESS' && error.statusCode === 409
  );
  releaseFirst();
  assert.equal((await firstImport).estado, 'COMPLETADA');
  const states = await pool.query('SELECT estado FROM public.sincronizaciones ORDER BY id');
  assert.deepEqual(states.rows.map((row) => row.estado).sort(), ['COMPLETADA', 'RECHAZADA']);

  const afterRelease = await importer(syntheticSnapshot([
    { Terminal: 'L1', Campo: 'primero' },
    { Terminal: 'L2', Campo: 'segundo' }
  ]));
  assert.equal(afterRelease.estado, 'COMPLETADA');
});

test('el umbral permite menos de 10% y 10%, pero exige confirmación por encima', async () => {
  const twenty = Array.from({ length: 20 }, (_, index) => ({ Terminal: `T${index}`, Valor: index }));
  await importer(syntheticSnapshot(twenty));
  const belowTen = await importer(syntheticSnapshot(twenty.slice(0, 19)));
  assert.equal(belowTen.inactivados, 1);
  await importer(syntheticSnapshot(twenty));
  const exactlyTen = await importer(syntheticSnapshot(twenty.slice(0, 18)));
  assert.equal(exactlyTen.inactivados, 2);
  await importer(syntheticSnapshot(twenty));

  await assert.rejects(
    () => importer(syntheticSnapshot(twenty.slice(0, 17))),
    (error) => error.code === 'MASS_DEACTIVATION_CONFIRMATION_REQUIRED'
  );
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM public.terminales WHERE activa')).rows[0].total, 20);
  const confirmed = await importer(syntheticSnapshot(twenty.slice(0, 17)), {
    confirmMassDeactivation: true
  });
  assert.equal(confirmed.inactivados, 3);
});

test('snapshots vacíos, corruptos o incompletos no inactivan datos', async () => {
  await importer(syntheticSnapshot([{ Terminal: 'SAFE', Campo: 'valor' }]));
  for (const buffer of [Buffer.from('[]'), Buffer.from('{'), Buffer.from('[{"Campo":"x"}]')]) {
    let snapshotError;
    try {
      parseSnapshot(buffer);
    } catch (error) {
      snapshotError = error;
    }
    assert.ok(snapshotError instanceof SnapshotError);
    await assert.rejects(
      () => importSnapshot({
        pool,
        snapshotConfig: {},
        readSnapshotFn: async () => { throw snapshotError; }
      }),
      (error) => ['SNAPSHOT_EMPTY', 'INVALID_JSON', 'MISSING_TERMINAL'].includes(error.code)
    );
    assert.equal((await pool.query("SELECT activa FROM public.terminales WHERE terminal = 'SAFE'")).rows[0].activa, true);
  }
});

test('PostgreSQL aplica claves foráneas y tipos JSONB reales', async () => {
  await assert.rejects(
    () => pool.query(`INSERT INTO public.cola_sincronizacion
      (operacion_id, terminal, campo, revision) VALUES ($1, 'NO_EXISTE', 'Campo', 1)`, [crypto.randomUUID()]),
    (error) => error.code === '23503'
  );
  await assert.rejects(
    () => pool.query("INSERT INTO public.terminales (terminal, datos_excel) VALUES ('BAD', '[]'::jsonb)"),
    (error) => error.code === '23514'
  );
});

test('consultas auxiliares y edición de terminales funcionan con PostgreSQL real sin duplicar historial', async () => {
  await importer(syntheticSnapshot([
    { Terminal: 'EDIT-001', NombreComercial: 'Comercio Norte', Ciudad: 'Tegucigalpa', Zona: 'Norte', Celular: '1111' }
  ]));
  const user = await pool.query({
    text: `INSERT INTO public.usuarios (nombre, usuario, password_hash, rol)
      VALUES ('Editor sintético', 'editor_test', 'hash-sintético', 'USUARIO') RETURNING id`
  });
  const options = await terminalRepository.getFilterOptions(pool, true);
  assert.deepEqual(options.Ciudad, ['Tegucigalpa']);
  const fields = await terminalRepository.getFieldNames(pool, true);
  assert.ok(fields.includes('NombreComercial'));
  assert.ok(fields.includes('Celular'));
  const dashboard = await terminalRepository.getDashboard(pool, true);
  assert.equal(dashboard.indicadores.activas, 1);
  assert.equal(dashboard.indicadores.inactivas, null);

  const updated = await terminalRepository.updateTerminal(pool, {
    terminal: 'EDIT-001', version: 1,
    changes: { Celular: '2222', CampoDinamico: 'valor' }, userId: user.rows[0].id
  });
  assert.equal(updated.kind, 'updated');
  assert.equal(updated.terminal.version, '2');
  assert.equal(updated.queue.length, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM public.historial_cambios WHERE terminal = 'EDIT-001' AND origen = 'PWA'")).rows[0].total, 2);

  const identical = await terminalRepository.updateTerminal(pool, {
    terminal: 'EDIT-001', version: 2,
    changes: { Celular: '2222', CampoDinamico: 'valor' }, userId: user.rows[0].id
  });
  assert.equal(identical.kind, 'unchanged');
  assert.equal((await pool.query("SELECT count(*)::int AS total FROM public.historial_cambios WHERE terminal = 'EDIT-001' AND origen = 'PWA'")).rows[0].total, 2);

  const conflict = await terminalRepository.updateTerminal(pool, {
    terminal: 'EDIT-001', version: 1, changes: { Ciudad: 'Otra' }, userId: user.rows[0].id
  });
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflict.current.datos_excel.Ciudad, 'Tegucigalpa');
});

test('HTTP real persiste e invalida sesiones y aplica ADMIN, USUARIO, CSRF e importación deshabilitada', async () => {
  const password = 'Integracion-Segura-123!';
  const passwordHash = await hashPassword(password);
  const users = await pool.query({
    text: `INSERT INTO public.usuarios (nombre, usuario, password_hash, rol) VALUES
      ('Admin sintético', 'admin_test', $1, 'ADMIN'),
      ('Usuario sintético', 'user_test', $1, 'USUARIO') RETURNING id, usuario`,
    values: [passwordHash]
  });
  const sessionMiddleware = createSessionMiddleware({
    pool,
    secret: 'integration-only-session-secret-32-characters-minimum'
  });
  const app = createApp({
    apiKey: 'integration-only-api-key',
    databasePool: pool,
    checkDatabaseFn: async () => pool.query('SELECT 1'),
    sendMailFn: async () => { throw new Error('El correo no debe ejecutarse'); },
    sessionMiddleware,
    importEnabled: false
  });
  try {
    const admin = await login(app, 'admin_test', password);
    assert.equal(admin.response.status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM public.user_sessions')).rows[0].total, 1);
    assert.equal((await request(app, {
      path: '/api/v1/sincronizaciones', headers: { Cookie: admin.cookie }
    })).status, 200);
    const noCsrf = await request(app, {
      method: 'POST', path: '/api/v1/sincronizaciones', headers: { Cookie: admin.cookie }, body: {}
    });
    assert.equal(noCsrf.status, 403);
    const disabled = await request(app, {
      method: 'POST', path: '/api/v1/sincronizaciones',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrfToken },
      body: {}
    });
    assert.equal(disabled.status, 403);
    assert.equal(disabled.body.codigo, 'IMPORT_DISABLED');

    const normal = await login(app, 'user_test', password);
    assert.equal((await request(app, {
      path: '/api/v1/sincronizaciones', headers: { Cookie: normal.cookie }
    })).status, 403);
    const normalPost = await request(app, {
      method: 'POST', path: '/api/v1/sincronizaciones',
      headers: { Cookie: normal.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': normal.csrfToken },
      body: {}
    });
    assert.equal(normalPost.status, 403);

    const adminId = users.rows.find((row) => row.usuario === 'admin_test').id;
    await authRepository.invalidateUserSessions(pool, adminId);
    assert.equal((await request(app, {
      path: '/api/v1/auth/me', headers: { Cookie: admin.cookie }
    })).status, 401);
  } finally {
    if (typeof sessionMiddleware.sessionStore.close === 'function') {
      sessionMiddleware.sessionStore.close();
    }
  }
});
