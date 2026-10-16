const assert = require('node:assert/strict');
const test = require('node:test');
const { importVisitas } = require('../../src/visitas/service');
const { parseReporte, ReportError } = require('../../src/visitas/reportes');
const queries = require('../../src/visitas/queries');
const { searchTerminales } = require('../../src/terminales/queries');
const { parseSearchParams } = require('../../src/terminales/validation');
const { createApp } = require('../../src/app');
const { baseAppOptions } = require('../test-app-options');
const { createVerifiedTestPool, cleanTestData, verifySchema } = require('./test-database');
let pool, config;
const BASE = { ID: 1, Terminal: '00001', Fecha: '2026-10-01T06:00:00Z', Tecnico: 'RTDOMINGUEZ', TipoVisita: 'Soporte' };
const make = (rows, recibido = '2026-10-16T12:00:00Z') => ({
  ...parseReporte(Buffer.from(JSON.stringify(rows))), recibido, procesado: recibido
});
const run = (historico, mensual, extra = {}) => importVisitas({ pool, readFn: async () => ({ historico, mensual }), ...extra });
const fixedPool = (instant) => ({ query: (q) => {
  const sql = `TIMESTAMPTZ '${instant}'`;
  return pool.query(typeof q === 'string' ? q.replaceAll('CURRENT_TIMESTAMP', sql)
    : { ...q, text: q.text.replaceAll('CURRENT_TIMESTAMP', sql) });
} });
async function terminals() {
  await pool.query(`INSERT INTO public.terminales(terminal,datos_excel,activa)
    VALUES ('00001','{}',true),('00002','{}',true),('00003','{}',false)`);
}
test.before(async () => {
  const verified = await createVerifiedTestPool(); pool = verified.pool; config = verified.config;
  await verifySchema(pool);
});
test.beforeEach(async () => cleanTestData(pool, config.expectedName));
test.after(async () => { if (pool) { await cleanTestData(pool, config.expectedName); await pool.end(); } });

test('histórico y mensual consolidan ID, conservan JSONB, ceros y visitas de terminales desconocidas/inactivas', async () => {
  await terminals();
  const history = make([BASE, { ...BASE, ID: 2, Terminal: '00003' }, { ...BASE, ID: 3, Terminal: '00999' }]);
  const monthly = make([{ ...BASE, Fecha: '2026-10-12T06:00:00Z', Extra: { prueba: true } }]);
  assert.equal((await run(history, monthly)).estado, 'COMPLETADA');
  const result = await pool.query('SELECT * FROM public.visitas_tecnicas ORDER BY id');
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].fuente, 'mensual');
  assert.equal(result.rows[0].terminal, '00001');
  assert.deepEqual(result.rows[0].datos.Extra, { prueba: true });
  assert.equal(result.rows[1].terminal, '00003');
  assert.equal(result.rows[2].terminal, '00999');
  const state = await queries.estado(pool);
  assert.equal(state.reportes.length, 2);
  assert.equal(state.reportes[0].cantidad, 3);
  assert.ok(state.reportes.every((r) => r.importado instanceof Date));
  assert.equal(state.ultimo_intento.resultado, 'COMPLETADA');
});

test('actualizaciones, prioridad Modified/recepción/empate y ausencia no eliminan otros períodos', async () => {
  const older = { ...BASE, Modified: '2026-10-01T00:00:00Z' };
  await run(make([older, { ...BASE, ID: 2 }]), make([older]));
  const newer = { ...BASE, Modified: '2026-10-02T00:00:00Z', TipoVisita: 'Actualizada' };
  await run(make([newer], '2026-10-17T00:00:00Z'), make([], '2026-10-17T00:00:00Z'));
  const rows = (await pool.query('SELECT * FROM public.visitas_tecnicas ORDER BY id')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fuente, 'historico');
  assert.equal(rows[0].tipo_visita, 'Actualizada');
  await assert.rejects(run(make([BASE]), make([])), /REPORTE_ANTIGUO/);
  assert.equal((await pool.query('SELECT tipo_visita FROM public.visitas_tecnicas WHERE id=1')).rows[0].tipo_visita, 'Actualizada');
});

test('hashes repetidos no reprocesan visitas ni actualizan marca de importación exitosa', async () => {
  const report = make([BASE]);
  await run(report, make([]));
  const before = (await pool.query('SELECT importacion_id FROM public.visitas_fuentes')).rows;
  const state = (await pool.query('SELECT importado FROM public.visitas_reportes ORDER BY fuente')).rows;
  assert.equal((await run(report, make([]))).estado, 'SIN_CAMBIOS');
  assert.deepEqual((await pool.query('SELECT importacion_id FROM public.visitas_fuentes')).rows, before);
  assert.deepEqual((await pool.query('SELECT importado FROM public.visitas_reportes ORDER BY fuente')).rows, state);
});

test('misma carga recibida después actualiza procedencia sin reprocesar contenido y puede resolver empate', async () => {
  const historical = make([{ ...BASE, TipoVisita: 'Histórica' }]);
  const monthly = make([{ ...BASE, TipoVisita: 'Mensual' }]);
  await run(historical, monthly);
  const before = (await pool.query("SELECT importacion_id FROM public.visitas_fuentes WHERE fuente='historico'")).rows[0];
  assert.equal((await pool.query('SELECT tipo_visita FROM public.visitas_tecnicas')).rows[0].tipo_visita, 'Mensual');
  const receivedAgain = { ...historical, recibido: '2026-10-17T00:00:00Z' };
  await run(receivedAgain, monthly);
  assert.equal((await pool.query('SELECT tipo_visita FROM public.visitas_tecnicas')).rows[0].tipo_visita, 'Histórica');
  assert.deepEqual((await pool.query("SELECT importacion_id FROM public.visitas_fuentes WHERE fuente='historico'")).rows[0], before);
});

test('validación corrupta mantiene visitas válidas y registra error seguro', async () => {
  await run(make([BASE]), make([]));
  await assert.rejects(importVisitas({ pool, readFn: async () => { throw new ReportError('JSON_INVALIDO'); } }), /JSON_INVALIDO/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.visitas_tecnicas')).rows[0].n, 1);
  const state = await queries.estado(pool);
  assert.equal(state.ultimo_intento.resultado, 'ERROR');
  assert.equal(state.ultimo_intento.detalle, 'JSON_INVALIDO');
  assert.ok(state.reportes[0].importado);
});

test('fallo transaccional después del histórico revierte ambos reportes y conserva estados', async () => {
  await run(make([BASE]), make([]));
  // Trigger de fallo exclusivamente dentro de la base aislada verificada.
  await pool.query(`CREATE FUNCTION public.fail_test_visita() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.fuente='mensual' THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_visita BEFORE INSERT ON public.visitas_fuentes FOR EACH ROW EXECUTE FUNCTION public.fail_test_visita()`);
  try {
    await assert.rejects(run(make([{ ...BASE, ID: 2 }], '2026-10-17T00:00:00Z'), make([{ ...BASE, ID: 3 }], '2026-10-17T00:00:00Z')), /IMPORTACION_FALLIDA/);
    assert.deepEqual((await pool.query('SELECT id FROM public.visitas_tecnicas ORDER BY id')).rows.map((r) => r.id), ['1']);
    assert.equal((await queries.estado(pool)).ultimo_intento.resultado, 'ERROR');
    assert.equal((await pool.query('SELECT cantidad FROM public.visitas_reportes WHERE fuente=\'mensual\'')).rows[0].cantidad, 0);
  } finally { await pool.query('DROP TRIGGER fail_visita ON public.visitas_fuentes; DROP FUNCTION public.fail_test_visita()'); }
});

test('bloqueo de importación es independiente del snapshot y evita ejecuciones concurrentes', async () => {
  const lock = await pool.connect();
  try {
    await lock.query('BEGIN');
    await lock.query("SELECT pg_advisory_xact_lock(hashtext('cartera-clientes:visitas'))");
    await assert.rejects(run(make([BASE]), make([])), /IMPORTACION_EN_CURSO/);
    const snapshotLock = await pool.query("SELECT pg_try_advisory_xact_lock(hashtext('cartera-clientes:importacion')) AS ok");
    assert.equal(snapshotLock.rows[0].ok, true);
  } finally { await lock.query('ROLLBACK'); lock.release(); }
});

test('última visita y estadísticas usan Honduras: incluyen futuro del mes, excluyen siguiente mes y cuentan visitas', async () => {
  await terminals();
  const records = [
    BASE, { ...BASE, ID: 2, Fecha: '2026-10-31T23:59:59-06:00' },
    { ...BASE, ID: 3, Fecha: '2026-11-01T00:00:00-06:00' },
    { ...BASE, ID: 4, Fecha: '2026-10-01T05:59:59Z', Tecnico: 'ERMEJIA' },
    { ...BASE, ID: 5, Fecha: '2026-10-01T06:00:00Z', Tecnico: 'ERMEJIA' },
    { ...BASE, ID: 6, Terminal: '00999', Tecnico: 'ERMEJIA' },
    { ...BASE, ID: 7, Terminal: '00003', Tecnico: 'ERMEJIA' }
  ];
  await run(make(records), make([]));
  const fixed = fixedPool('2026-10-16T12:00:00Z');
  const last = await queries.ultima(fixed, '00001', false);
  assert.equal(last.ultima_visita.toISOString(), '2026-11-01T05:59:59.000Z');
  assert.equal((await queries.ultima(fixed, '00002', false)).ultima_visita, null);
  assert.equal(await queries.ultima(fixed, '00003', false), null);
  assert.equal((await queries.ultima(fixed, '00003', true)).ultima_visita, null);
  assert.equal(await queries.ultima(fixed, '00999', true), null);
  const stats = await queries.estadisticas(fixed);
  assert.deepEqual(stats.datos, [{ tecnico: 'ERMEJIA', visitas: 3 }, { tecnico: 'RTDOMINGUEZ', visitas: 2 }]);
  assert.equal(stats.desde.toISOString(), '2026-10-01T06:00:00.000Z');
  assert.equal(stats.hasta.toISOString(), '2026-11-01T06:00:00.000Z');
  const september = await queries.estadisticas(fixedPool('2026-10-01T05:59:59Z'));
  assert.deepEqual(september.datos, [{ tecnico: 'ERMEJIA', visitas: 1 }, { tecnico: 'RTDOMINGUEZ', visitas: 0 }]);
});

test('listado integra MAX en una consulta sin cambiar paginación ni orden; endpoints solo exponen datos necesarios', async () => {
  await terminals();
  await run(make([BASE, { ...BASE, ID: 2 }]), make([]));
  const filters = parseSearchParams({ pagina: '1', limite: '1', estado: 'activas' });
  const list = await searchTerminales(fixedPool('2026-10-16T12:00:00Z'), filters, true);
  assert.equal(list.total, 2); assert.equal(list.datos.length, 1);
  assert.equal(list.datos[0].terminal, '00001'); assert.ok(list.datos[0].ultima_visita);
  const second = await searchTerminales(pool, { ...filters, pagina: 2 }, true);
  assert.equal(second.datos[0].terminal, '00002'); assert.equal(second.datos[0].ultima_visita, null);
  const app = createApp({ apiKey: 'test', databasePool: fixedPool('2026-10-16T12:00:00Z'), visitasEnabled: true, ...baseAppOptions('TECNICO') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const prefix = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/api/v1/visitas/estadisticas/mensual', '/api/v1/visitas/terminales/00001/ultima', '/api/v1/terminales?limite=1']) {
      const response = await fetch(prefix + route);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.doesNotMatch(body, /datos_excel.*Comentarios|ItemInternalId|\/home\/rony|sha256/);
    }
    assert.equal((await fetch(prefix + '/api/v1/visitas/terminales/00003/ultima')).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('mes de Honduras maneja cambio de año y febrero bisiesto sin zona del host', async () => {
  for (const [instant, from, to] of [
    ['2027-01-01T05:59:59Z','2026-12-01T06:00:00.000Z','2027-01-01T06:00:00.000Z'],
    ['2027-01-01T06:00:00Z','2027-01-01T06:00:00.000Z','2027-02-01T06:00:00.000Z'],
    ['2028-02-29T12:00:00Z','2028-02-01T06:00:00.000Z','2028-03-01T06:00:00.000Z']
  ]) {
    const stats = await queries.estadisticas(fixedPool(instant));
    assert.equal(stats.desde.toISOString(), from);
    assert.equal(stats.hasta.toISOString(), to);
    assert.equal(stats.datos.reduce((sum, row) => sum + row.visitas, 0), 0);
  }
});

test('una fila ausente retenida no recibe la fecha nueva de un reporte idéntico', async () => {
  const a = { ...BASE, TipoVisita: 'Histórica' };
  await run(make([a]), make([]));
  const empty = make([], '2026-10-17T00:00:00Z');
  await run(empty, make([{ ...BASE, TipoVisita: 'Mensual' }], '2026-10-18T00:00:00Z'));
  await run({ ...empty, recibido: '2026-10-19T00:00:00Z' }, make([{ ...BASE, TipoVisita: 'Mensual' }], '2026-10-18T00:00:00Z'));
  assert.equal((await pool.query('SELECT tipo_visita FROM public.visitas_tecnicas')).rows[0].tipo_visita, 'Mensual');
});
