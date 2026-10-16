const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseReporte, fecha, readReportes } = require('../src/visitas/reportes');
const { createApp } = require('../src/app');
const { baseAppOptions } = require('./test-app-options');
const row = { ID: 1, Terminal: '0001', Fecha: '2026-10-01T00:00:00Z', Tecnico: 'RTDOMINGUEZ', TipoVisita: 'Soporte' };
const parse = (rows) => parseReporte(Buffer.from(JSON.stringify(rows)));

test('visitas exige ID SharePoint, texto y fechas con zona; conserva múltiples visitas de una terminal', () => {
  assert.equal(parse([row, { ...row, ID: 2 }]).records.length, 2);
  for (const invalid of [{ ID: null }, { ID: true }, { ID: 0 }, { ID: Number.MAX_SAFE_INTEGER + 1 }, { Terminal: 1 }, { Fecha: '2026-02-30T00:00:00Z' }, { Fecha: '2026-10-01' }, { Fecha: '2026-10-01T00:00:00' }]) {
    assert.throws(() => parse([{ ...row, ...invalid }]));
  }
  assert.throws(() => parse([row, row]), /ID_DUPLICADO/);
  assert.equal(fecha('2026-10-01T00:00:00-06:00'), '2026-10-01T06:00:00.000Z');
  for (const constant of ['NaN','Infinity','-Infinity','1e999']) {
    assert.throws(() => parseReporte(Buffer.from(JSON.stringify([row]).replace('"ID":1', `"Extra":${constant},"ID":1`))));
  }
  assert.throws(() => parseReporte(Buffer.from('{broken')));
  assert.throws(() => parseReporte(Buffer.from('{}')));
});

test('lector fija el bundle, comprueba hash/metadatos, tamaño y corrupción sin escribir originales', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visitas-test-'));
  try {
    for (const source of ['historico','mensual']) {
      const bundle = path.join(root, source, 'versiones', 'v1');
      await fs.mkdir(bundle, { recursive: true });
      const buffer = Buffer.from(JSON.stringify([row]));
      await fs.writeFile(path.join(bundle, 'original.json'), buffer);
      await fs.symlink('original.json', path.join(bundle, 'data.json'));
      await fs.writeFile(path.join(bundle, 'metadata.json'), JSON.stringify({ sha256: crypto.createHash('sha256').update(buffer).digest('hex'), records: 1, received_at: row.Fecha, processed_at: '2026-10-16T13:13:25.425387+00:00' }));
      await fs.symlink('versiones/v1', path.join(root, source, 'ultimo'));
    }
    const reports = await readReportes({ root });
    assert.equal(reports.mensual.records[0].terminal, '0001');
    await assert.rejects(readReportes({ root, maxBytes: 1 }), /ARCHIVO_DEMASIADO_GRANDE/);
    await fs.writeFile(path.join(root, 'mensual/ultimo/original.json'), '[]');
    await assert.rejects(readReportes({ root }), /HASH_INVALIDO/);
    await fs.writeFile(path.join(root, 'mensual/ultimo/original.json'), 'corrupto');
    await assert.rejects(readReportes({ root }), /JSON_INVALIDO/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

async function request(app, url, method = 'GET') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally { await new Promise((resolve) => server.close(resolve)); }
}
test('endpoints exigen sesión, estado exige ADMIN y no hay importación HTTP', async () => {
  const pool = { query: async () => { throw new Error('No consultar DB'); } };
  const anonymous = createApp({ apiKey: 'test', databasePool: pool, sessionMiddleware(req, _res, next) { req.session = {}; next(); } });
  for (const url of ['/api/v1/visitas/estado','/api/v1/visitas/estadisticas/mensual','/api/v1/visitas/terminales/0001/ultima']) {
    assert.equal((await request(anonymous, url)).status, 401);
  }
  const reader = createApp({ apiKey: 'test', databasePool: pool, visitasEnabled: true, ...baseAppOptions('TECNICO') });
  assert.equal((await request(reader, '/api/v1/visitas/estado')).status, 403);
  assert.equal((await request(reader, '/api/v1/visitas/importar', 'POST')).status, 404);
  const disabled = createApp({ apiKey: 'test', databasePool: pool, ...baseAppOptions() });
  assert.equal((await request(disabled, '/api/v1/visitas/estadisticas/mensual')).status, 503);
});
test('errores HTTP no exponen rutas, JSON ni secretos', async () => {
  const app = createApp({ apiKey: 'test', visitasEnabled: true, databasePool: { query: async () => { throw new Error('/ruta/privada secreto'); } }, ...baseAppOptions() });
  const result = await request(app, '/api/v1/visitas/estado');
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /privada|secreto/);
});
