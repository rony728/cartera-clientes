const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { optimizePhoto } = require('../src/photos/processor');
const { baseAppOptions, testSessionMiddleware } = require('./test-app-options');

const processed = { content: Buffer.from('webp-controlado'), detectedMime: 'image/jpeg', mimeType: 'image/webp', size: 15, width: 800, height: 600 };

function repository(overrides = {}) {
  return {
    async getTerminal() { return { terminal: '000123', activa: true }; },
    async getPhoto() { return null; },
    async createPhoto(_pool, input) { return metadata(input); },
    async replacePhoto(_pool, input) { return metadata(input); },
    ...overrides
  };
}

function metadata(input) {
  return {
    terminal: input.terminal, mime_type: input.mimeType, tamano_bytes: input.size,
    ancho: input.width, alto: input.height,
    fecha_creacion: '2026-10-12T00:00:00.000Z', fecha_actualizacion: '2026-10-12T00:00:00.000Z'
  };
}

function appWith(repositoryApi = repository(), options = {}) {
  return createApp({
    apiKey: 'test-key', databasePool: { query: async () => ({ rows: [] }) },
    checkDatabaseFn: async () => {}, sendMailFn: async () => {},
    photoRepository: repositoryApi,
    optimizePhotoFn: options.optimizePhotoFn || (async () => processed),
    ...baseAppOptions(options.role || 'ADMIN')
  });
}

function request(app, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const client = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => server.close(() => {
          const buffer = Buffer.concat(chunks);
          const type = String(response.headers['content-type'] || '');
          resolve({ status: response.statusCode, headers: response.headers, buffer,
            body: type.includes('json') && buffer.length ? JSON.parse(buffer.toString()) : null });
        }));
      });
      client.on('error', reject);
      if (body) client.write(body);
      client.end();
    });
  });
}

const uploadHeaders = { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': 'test-csrf-token' };

test('GET devuelve la fotografía binaria protegida sin exponer rutas', async () => {
  const content = Buffer.from('imagen-webp');
  const app = appWith(repository({ async getPhoto() { return {
    contenido: content, mime_type: 'image/webp', tamano_bytes: content.length,
    ancho: 100, alto: 80, fecha_actualizacion: '2026-10-12T00:00:00.000Z'
  }; } }));
  const response = await request(app, { path: '/api/v1/terminales/000123/fotografia' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'image/webp');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(response.buffer, content);
});

test('POST crea y PUT reemplaza una fotografía usando contenido optimizado', async () => {
  const operations = [];
  const repo = repository({
    async createPhoto(_pool, input) { operations.push(['create', input]); return metadata(input); },
    async replacePhoto(_pool, input) { operations.push(['replace', input]); return metadata(input); }
  });
  const app = appWith(repo);
  const created = await request(app, { method: 'POST', path: '/api/v1/terminales/000123/fotografia', headers: uploadHeaders, body: Buffer.from('jpeg') });
  const replaced = await request(app, { method: 'PUT', path: '/api/v1/terminales/000123/fotografia', headers: uploadHeaders, body: Buffer.from('jpeg-2') });
  assert.equal(created.status, 201);
  assert.equal(replaced.status, 200);
  assert.deepEqual(operations.map(([operation]) => operation), ['create', 'replace']);
  assert.equal(operations[0][1].mimeType, 'image/webp');
  assert.equal(operations[0][1].userId, '1');
});

test('POST no reemplaza silenciosamente una fotografía existente', async () => {
  const app = appWith(repository({ async createPhoto() { return null; } }));
  const response = await request(app, { method: 'POST', path: '/api/v1/terminales/000123/fotografia', headers: uploadHeaders, body: Buffer.from('jpeg') });
  assert.equal(response.status, 409);
  assert.equal(response.body.codigo, 'FOTO_EXISTENTE');
});

test('rechaza escritura en terminal inactiva y discrepancia entre MIME y contenido', async () => {
  const inactive = await request(appWith(repository({ async getTerminal() { return { terminal: '000123', activa: false }; } })), {
    method: 'PUT', path: '/api/v1/terminales/000123/fotografia', headers: uploadHeaders, body: Buffer.from('jpeg')
  });
  assert.equal(inactive.status, 409);
  assert.equal(inactive.body.codigo, 'TERMINAL_INACTIVA');
  const mismatch = await request(appWith(undefined, { optimizePhotoFn: async () => ({ ...processed, detectedMime: 'image/png' }) }), {
    method: 'POST', path: '/api/v1/terminales/000123/fotografia', headers: uploadHeaders, body: Buffer.from('png')
  });
  assert.equal(mismatch.status, 415);
  assert.equal(mismatch.body.codigo, 'MIME_NO_COINCIDE');
});

test('rechaza terminal inexistente, MIME inválido y ausencia de sesión', async () => {
  const missing = await request(appWith(repository({ async getTerminal() { return null; } })), {
    method: 'POST', path: '/api/v1/terminales/999/fotografia', headers: uploadHeaders, body: Buffer.from('jpeg')
  });
  assert.equal(missing.status, 404);
  const invalidMime = await request(appWith(), {
    method: 'POST', path: '/api/v1/terminales/000123/fotografia',
    headers: { ...uploadHeaders, 'Content-Type': 'application/pdf' }, body: Buffer.from('pdf')
  });
  assert.equal(invalidMime.status, 415);
  const app = createApp({
    apiKey: 'test-key', databasePool: {}, checkDatabaseFn: async () => {}, sendMailFn: async () => {},
    photoRepository: repository(), sessionMiddleware: testSessionMiddleware,
    authorization: { requireAuth(_req, res) { return res.status(401).json({ ok: false }); },
      requireAdmin(_req, res) { return res.status(403).json({ ok: false }); } }
  });
  const unauthorized = await request(app, { path: '/api/v1/terminales/000123/fotografia' });
  assert.equal(unauthorized.status, 401);
});

test('rechaza el cuerpo que supera 8 MiB antes de procesarlo', async () => {
  let processedBody = false;
  const app = appWith(undefined, { optimizePhotoFn: async () => { processedBody = true; return processed; } });
  const response = await request(app, { method: 'POST', path: '/api/v1/terminales/000123/fotografia',
    headers: uploadHeaders, body: Buffer.alloc(8 * 1024 * 1024 + 1) });
  assert.equal(response.status, 413);
  assert.equal(processedBody, false);
});

test('el procesador valida contenido real y normaliza JPEG a WebP limitado', async () => {
  const source = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#a71930' } }).jpeg().toBuffer();
  const result = await optimizePhoto(source);
  assert.equal(result.mimeType, 'image/webp');
  assert.equal(result.detectedMime, 'image/jpeg');
  assert.ok(result.width <= 1600);
  assert.ok(result.height <= 1600);
  assert.ok(result.size <= 2 * 1024 * 1024);
  await assert.rejects(() => optimizePhoto(Buffer.from('no-es-imagen')), /imagen válida/u);
});
