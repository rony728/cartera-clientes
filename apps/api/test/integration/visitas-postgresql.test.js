const assert = require('node:assert/strict');
const test = require('node:test');
const { importVisitas, refreshCanonical } = require('../../src/visitas/service');
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
  assert.deepEqual((await pool.query("SELECT datos FROM public.visitas_fuentes WHERE fuente='mensual' AND id=1")).rows[0].datos.Extra, { prueba: true });
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

test('retención indefinida, categorías por meses calendario y filtros/orden previos a paginación', async () => {
  await pool.query(`INSERT INTO public.terminales(terminal,datos_excel,activa)
    SELECT lpad(n::text,5,'0'),jsonb_build_object('NombreComercial',n::text),true FROM generate_series(1,7) n`);
  const dates = ['2026-10-12T06:00:00Z','2026-08-31T23:59:59-06:00','2026-07-31T23:59:59-06:00',
    '2020-01-01T00:00:00Z', '2026-10-31T23:59:59.999999-06:00', '2026-11-01T00:00:00-06:00'];
  await run(make(dates.map((Fecha, index) => ({ ...BASE, ID: index + 1, Terminal: String(index + 1).padStart(5,'0'), Fecha }))), make([]));
  // Los dos reportes pierden todas las visitas; ninguna debe borrarse.
  await run(make([], '2026-10-17T00:00:00Z'), make([], '2026-10-17T00:00:00Z'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.visitas_tecnicas')).rows[0].n, 6);
  const db = fixedPool('2026-10-16T12:00:00Z');
  const list = (q) => searchTerminales(db, parseSearchParams(q), true);
  const all = await list({ orden: 'Terminal' });
  assert.equal(all.total, 7);
  assert.equal(new Set(all.datos.map((x) => x.terminal)).size, 7);
  assert.equal(all.datos[5].ultima_visita, null); // visita existe pero es del próximo mes
  assert.equal(all.datos[5].tiene_visitas_registradas, true);
  assert.equal(all.datos[6].ultima_visita, null);
  assert.equal(all.datos[6].tiene_visitas_registradas, false);
  assert.deepEqual((await list({ visitas:'sin' })).datos.map((r) => r.terminal), ['00007']);
  const two = await list({ visita_antiguedad_meses:'2', orden:'ultima_visita', direccion:'desc', limite:'1' });
  assert.equal(two.total, 3); assert.equal(two.datos[0].terminal, '00002');
  const page2 = await list({ visita_antiguedad_meses:'2', orden:'ultima_visita', direccion:'desc', limite:'1', pagina:'2' });
  assert.equal(page2.total, 3); assert.equal(page2.datos[0].terminal, '00003');
  const three = await list({ visita_antiguedad_meses:'3', orden:'ultima_visita', direccion:'desc' });
  assert.deepEqual(three.datos.map((r) => r.terminal), ['00003','00004']);
  const recentRange = await list({ visita_desde:'2026-10-01T00:00:00-06:00', visita_hasta:'2026-11-01T00:00:00-06:00', orden:'ultima_visita', direccion:'desc', limite:'1' });
  assert.equal(recentRange.total, 2); assert.equal(recentRange.datos[0].terminal, '00005');
  assert.equal((await queries.ultima(db, '00007', false)).tiene_visitas_registradas, false);
  assert.equal((await queries.ultima(db, '00006', false)).tiene_visitas_registradas, true);
  // En diciembre, enero todavía tiene antigüedad por año calendario correcto.
  const january = await searchTerminales(fixedPool('2027-01-01T12:00:00Z'), parseSearchParams({ visita_antiguedad_meses:'2' }), true);
  assert.equal(january.total, 6);
});

test('versiones con microsegundos se resuelven sin duplicar ID ni retroceder Modified', async () => {
  const old = { ...BASE, Fecha:'2026-08-01T00:00:00Z', Modified:'2026-10-01T00:00:00.123456Z' };
  const fresh = { ...BASE, Fecha:'2026-10-01T00:00:00Z', Modified:'2026-10-01T00:00:00.123457Z' };
  await run(make([fresh]), make([old]));
  assert.equal((await pool.query('SELECT fuente FROM public.visitas_tecnicas')).rows[0].fuente, 'historico');
  // Un contenido obsoleto no reemplaza la versión guardada en esa fuente.
  await run(make([old], '2026-10-17T00:00:00Z'), make([fresh], '2026-10-18T00:00:00Z'));
  await run(make([old], '2026-10-19T00:00:00Z'), make([fresh], '2026-10-18T00:00:00Z'));
  const result = (await pool.query('SELECT fuente FROM public.visitas_tecnicas')).rows;
  assert.equal(result.length, 1); assert.equal(result[0].fuente, 'mensual');
});

test('archivo/importación fallida no afecta listado, salud ni últimas visitas ya importadas', async () => {
  await terminals();
  await run(make([BASE]), make([]));
  await assert.rejects(importVisitas({ pool, readFn: async () => { throw new ReportError('REPORTE_NO_DISPONIBLE'); } }));
  const app = createApp({ apiKey:'test', databasePool:pool, checkDatabaseFn:async () => pool.query('SELECT 1'), visitasEnabled:true, ...baseAppOptions() });
  const server = app.listen(0,'127.0.0.1'); await new Promise((resolve) => server.once('listening',resolve));
  try {
    for (const url of ['/api/v1/terminales','/api/v1/visitas/terminales/00001/ultima','/api/v1/health']) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { headers: { 'X-API-Key':'test' } });
      assert.equal(res.status,200);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('roles mínimos pueden consultar/importar pero no leer JSON privado ni borrar/alterar tablas', async () => {
  await terminals();
  const client = await pool.connect();
  try {
    await client.query('CREATE ROLE visita_reader_test; CREATE ROLE visita_importer_test');
    const fs = require('node:fs/promises'); const path = require('node:path');
    const grants = (await fs.readFile(path.resolve(__dirname,'../../../../deploy/visitas/grants.sql.example'),'utf8'))
      .replaceAll(':"api_role"','visita_reader_test').replaceAll(':"import_role"','visita_importer_test');
    await client.query(grants);
    await client.query('GRANT SELECT ON public.terminales TO visita_reader_test'); // permiso previo de cartera
    await client.query('SET ROLE visita_importer_test');
    const restrictedPool = { query: (...a) => client.query(...a), connect: async () => ({ query:(...a) => client.query(...a), release() {} }) };
    assert.equal((await importVisitas({ pool:restrictedPool, readFn:async () => ({ historico:make([BASE]),mensual:make([]) }) })).estado, 'COMPLETADA');
    await assert.rejects(client.query('DELETE FROM public.visitas_fuentes'), /permission denied/);
    await client.query('RESET ROLE; SET ROLE visita_reader_test');
    await queries.estadisticas(client);
    await queries.ultima(client,'00001',false);
    await queries.estado(client);
    await searchTerminales(client,parseSearchParams({}),true);
    await assert.rejects(client.query('SELECT * FROM public.visitas_tecnicas'), /permission denied/);
    await assert.rejects(client.query('SELECT * FROM public.visitas_fuentes'), /permission denied/);
    await assert.rejects(client.query('DELETE FROM public.visitas_reportes'), /permission denied/);
    await assert.rejects(client.query('ALTER TABLE public.visitas_fuentes ADD COLUMN forbidden text'), /must be owner/);
  } finally {
    await client.query('RESET ROLE; DROP OWNED BY visita_reader_test, visita_importer_test; DROP ROLE visita_reader_test, visita_importer_test');
    client.release();
  }
});

test('rendimiento y cardinalidad con 100 mil filas fuente: agregado único, búsqueda y páginas sin duplicados', async (t) => {
  await pool.query(`INSERT INTO public.terminales(terminal,datos_excel,activa)
    SELECT lpad(n::text,5,'0'),jsonb_build_object('NombreComercial','Comercio '||n,'Comunicacion',CASE WHEN n%2=0 THEN 'GPRS' ELSE ' Gprs ' END),true FROM generate_series(1,1000) n`);
  const attempt = await pool.query("INSERT INTO public.importaciones_visitas(resultado) VALUES('COMPLETADA') RETURNING id");
  await pool.query({ text: `INSERT INTO public.visitas_fuentes
    (fuente,id,terminal,fecha,tecnico,tipo_visita,modificado,recibido,datos,importacion_id)
    SELECT fuente,n,lpad((1+n%1000)::text,5,'0'),CURRENT_TIMESTAMP-(n%4000)*interval '1 day',
    'RTDOMINGUEZ','Soporte',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
    jsonb_build_object('ID',n,'Comentarios',repeat('sintetico ',100)),$1
    FROM generate_series(1,50000) n CROSS JOIN unnest(ARRAY['historico','mensual']) fuente`, values:[attempt.rows[0].id] });
  await refreshCanonical(pool, Array.from({ length:50000 }, (_,i) => String(i+1)));
  await pool.query('ANALYZE public.visitas_fuentes; ANALYZE public.visitas_actuales; ANALYZE public.terminales');
  const { buildSearchQuery } = require('../../src/terminales/queries');
  const timings = {};
  for (const [name, params] of [['listado',{}], ['busqueda',{ q:'00001', campo:'terminal' }], ['antiguedad',{ visita_antiguedad_meses:'2', orden:'ultima_visita' }], ['variantes_orden',{Comunicacion:'GPRS',filtros_variantes:JSON.stringify({Comunicacion:['GPRS',' Gprs ']}),orden:'ultima_visita',direccion:'desc'}], ['variantes_2meses',{Comunicacion:'GPRS',filtros_variantes:JSON.stringify({Comunicacion:['GPRS',' Gprs ']}),visita_antiguedad_meses:'2',orden:'ultima_visita',pagina:'3'}], ['variantes_rango',{Comunicacion:'GPRS',filtros_variantes:JSON.stringify({Comunicacion:['GPRS',' Gprs ']}),visita_desde:'2026-01-01T00:00:00-06:00',visita_hasta:'2026-11-01T00:00:00-06:00',orden:'ultima_visita'}]]) {
    for (const enabled of (name === 'antiguedad'||name.startsWith('variantes') ? [true] : [false,true])) {
      const query = buildSearchQuery(parseSearchParams(params),enabled);
      const explain = await pool.query({ text:'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query.text, values:query.values });
      const plan = explain.rows[0]['QUERY PLAN'][0];
      timings[name+(enabled ? '_visitas_ms' : '_base_ms')] = plan['Execution Time'];
      assert.ok(plan['Execution Time']<2000, 'Consulta sintética excedió 2 s: '+name);
      const nodes = [];
      const walk = (node) => { nodes.push(node); (node.Plans || []).forEach(walk); };
      walk(plan.Plan);
      assert.ok(nodes.every(node => node['Sort Space Type'] !== 'Disk' && !(node['Disk Usage'] > 0)), 'No debe derramar a disco con este volumen');
      assert.ok(nodes.filter((node) => /Aggregate/u.test(node['Node Type'])).every((node) => node['Actual Loops'] <= 1));
    }
  }
  const first = await searchTerminales(pool, parseSearchParams({ orden:'Terminal', limite:'100' }), true);
  const second = await searchTerminales(pool, parseSearchParams({ orden:'Terminal', limite:'100', pagina:'2' }), true);
  assert.equal(first.total, 1000); assert.equal(second.total, 1000);
  assert.equal(new Set([...first.datos,...second.datos].map((row) => row.terminal)).size, 200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.visitas_tecnicas')).rows[0].n,50000);
  t.diagnostic('EXPLAIN ANALYZE (100000 filas fuente / 50000 IDs / 1000 terminales): '+JSON.stringify(timings));
});

test('corregir Terminal/Fecha de un ID actualiza MAX sin dejar duplicados ni máximos obsoletos', async () => {
  await terminals();
  await run(make([BASE,{ ...BASE,ID:2,Fecha:'2026-09-01T06:00:00Z' }]),make([]));
  await run(make([{ ...BASE,Terminal:'00002',Fecha:'2026-08-01T06:00:00Z',Modified:'2026-10-17T06:00:00Z' }], '2026-10-17T12:00:00Z'),make([]));
  const db = fixedPool('2026-10-18T06:00:00Z');
  assert.equal((await queries.ultima(db,'00001',false)).ultima_visita.toISOString(),'2026-09-01T06:00:00.000Z');
  assert.equal((await queries.ultima(db,'00002',false)).ultima_visita.toISOString(),'2026-08-01T06:00:00.000Z');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.visitas_tecnicas')).rows[0].n,2);
});

test('fallo al mantener la proyección canónica revierte también fuentes y estado de reportes', async () => {
  await run(make([BASE]),make([]));
  await pool.query(`CREATE FUNCTION public.fail_projection_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fallo simulado'; END $$;
    CREATE TRIGGER fail_projection BEFORE INSERT OR UPDATE ON public.visitas_actuales FOR EACH ROW EXECUTE FUNCTION public.fail_projection_test()`);
  try {
    await assert.rejects(run(make([{ ...BASE, ID:2 }], '2026-10-17T00:00:00Z'),make([])),/IMPORTACION_FALLIDA/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.visitas_actuales')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.visitas_fuentes')).rows[0].n,1);
    assert.equal((await pool.query("SELECT cantidad FROM public.visitas_reportes WHERE fuente='historico'")).rows[0].cantidad,1);
  } finally { await pool.query('DROP TRIGGER fail_projection ON public.visitas_actuales; DROP FUNCTION public.fail_projection_test()'); }
});

test('variantes SQL combinadas con visitas mantienen totales, orden, páginas y búsquedas anteriores', async () => {
  const names=['Alfa','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Literal'];
  const communications=['GPRS',' Gprs ','GPRS','WIFI','GPRS',' Gprs ','GPRS',"'); DROP TABLE terminales; --"];
  for(let index=0;index<names.length;index++){
    await pool.query('INSERT INTO public.terminales(terminal,datos_excel,activa) VALUES($1,$2,true)',[
      String(index+1).padStart(5,'0'),JSON.stringify({NombreComercial:names[index],Comunicacion:communications[index],Zona:index===2?'Sur':index===1?' Norte ':'Norte'})
    ]);
  }
  const dates={1:'2026-08-31T23:59:59-06:00',2:'2026-07-31T23:59:59-06:00',3:'2026-10-31T23:59:59-06:00',4:'2026-07-01T00:00:00-06:00',6:'2026-11-01T00:00:00-06:00',7:'2026-09-01T00:00:00-06:00',8:'2026-08-01T00:00:00-06:00'};
  await run(make(Object.entries(dates).map(([id,Fecha])=>({...BASE,ID:Number(id),Terminal:id.padStart(5,'0'),Fecha}))),make([]));
  const db=fixedPool('2026-10-17T12:00:00Z');
  const variants={Comunicacion:['GPRS',' Gprs '],Zona:['Norte',' Norte ']};
  const query={Comunicacion:'GPRS',Zona:'Norte',filtros_variantes:JSON.stringify(variants)};
  const list=parameters=>searchTerminales(db,parseSearchParams(parameters),true);
  const first=await list({...query,visita_antiguedad_meses:'2',orden:'ultima_visita',direccion:'desc',limite:'1'});
  const second=await list({...query,visita_antiguedad_meses:'2',orden:'ultima_visita',direccion:'desc',limite:'1',pagina:'2'});
  assert.equal(first.total,2);assert.equal(second.total,2);
  assert.deepEqual([...first.datos,...second.datos].map(row=>row.terminal),['00001','00002']);
  assert.deepEqual((await list({...query,visita_antiguedad_meses:'3',orden:'ultima_visita'})).datos.map(row=>row.terminal),['00002']);
  assert.deepEqual((await list({...query,visita_desde:'2026-07-01T00:00:00-06:00',visita_hasta:'2026-09-01T00:00:00-06:00',orden:'ultima_visita'})).datos.map(row=>row.terminal),['00002','00001']);
  assert.equal((await list({...query,visitas:'con'})).total,4);
  assert.deepEqual((await list({...query,visitas:'sin'})).datos.map(row=>row.terminal),['00005']);
  const all=await list({...query,orden:'ultima_visita',direccion:'desc'});
  assert.deepEqual(all.datos.map(row=>row.terminal),['00007','00001','00002','00005','00006']);
  assert.equal(all.datos[3].ultima_visita,null);assert.equal(all.datos[3].tiene_visitas_registradas,false);
  assert.equal(all.datos[4].ultima_visita,null);assert.equal(all.datos[4].tiene_visitas_registradas,true);
  const oldParams=parseSearchParams({Comunicacion:'GPRS',Zona:'Norte',q:'Al',campo:'NombreComercial',orden:'Terminal'});
  for(const enabled of [false,true]){
    const old=await searchTerminales(db,oldParams,enabled);
    assert.equal(old.total,1);assert.equal(old.datos[0].terminal,'00001');
  }
  const literal=await list({Comunicacion:communications[7],filtros_variantes:JSON.stringify({Comunicacion:[communications[7]]})});
  assert.equal(literal.total,1);assert.equal(literal.datos[0].terminal,'00008');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.terminales')).rows[0].n,8);
  const app=createApp({apiKey:'test',databasePool:db,visitasEnabled:true,...baseAppOptions('TECNICO')});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const options=await (await fetch(base+'/api/v1/terminales/filtros/opciones')).json();
    assert.equal(options.capacidades.filtros_variantes,true);
    const response=await fetch(base+'/api/v1/terminales?'+new URLSearchParams({...query,visita_antiguedad_meses:'2',orden:'ultima_visita',direccion:'desc',limite:'1',pagina:'2'}));
    assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.filtros_variantes_aplicadas,true);assert.equal(body.paginacion.total,2);assert.equal(body.datos[0].terminal,'00002');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('filtros 2/3 meses y MAX en enero respetan medianoche de Honduras y futuro dentro del mes', async()=>{
  await pool.query(`INSERT INTO public.terminales(terminal,datos_excel,activa)
    SELECT lpad(n::text,5,'0'),'{}',true FROM generate_series(1,5) n`);
  const dates=['2026-11-30T23:59:59-06:00','2026-10-31T23:59:59-06:00','2026-12-01T00:00:00-06:00','2027-01-31T23:59:59-06:00','2027-02-01T00:00:00-06:00'];
  await run(make(dates.map((Fecha,i)=>({...BASE,ID:i+1,Terminal:String(i+1).padStart(5,'0'),Fecha}))),make([]));
  const list=(instant,q)=>searchTerminales(fixedPool(instant),parseSearchParams({orden:'Terminal',...q}),true);
  const january='2027-01-01T06:00:00Z';
  assert.deepEqual((await list(january,{visita_antiguedad_meses:'2'})).datos.map(row=>row.terminal),['00001','00002']);
  assert.deepEqual((await list(january,{visita_antiguedad_meses:'3'})).datos.map(row=>row.terminal),['00002']);
  assert.deepEqual((await list('2027-01-01T05:59:59Z',{visita_antiguedad_meses:'2'})).datos.map(row=>row.terminal),['00002']);
  const all=await list(january,{});
  assert.equal(all.datos[3].ultima_visita.toISOString(),'2027-02-01T05:59:59.000Z');
  assert.equal(all.datos[4].ultima_visita,null);assert.equal(all.datos[4].tiene_visitas_registradas,true);
});
