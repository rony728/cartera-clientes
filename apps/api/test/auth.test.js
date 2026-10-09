const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const session = require('express-session');

const { createApp } = require('../src/app');
const { createCorsMiddleware } = require('../src/auth/cors');
const authRepository = require('../src/auth/repository');
const { hashPassword } = require('../src/auth/password');
const { createSessionMiddleware } = require('../src/auth/session');
const { baseAppOptions } = require('./test-app-options');

let validHash;
test.before(async () => { validHash = await hashPassword('Contraseña-Segura-123!'); });

function request(app, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const req = http.request({ host: '127.0.0.1', port: address.port, method, path, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => server.close(() => resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
          headers: res.headers
        })));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

function cookieFrom(response) {
  return response.headers['set-cookie']?.[0]?.split(';')[0];
}

function fakeUsers(overrides = {}) {
  const user = {
    id: '1', nombre: 'Admin', usuario: 'admin', password_hash: validHash,
    rol: 'ADMIN', activo: true
  };
  const attempts = new Map();
  return {
    user,
    attempts,
    async findUserByUsername(_pool, usuario) { return usuario === user.usuario ? user : null; },
    async findUserById(_pool, id) { return String(id) === String(user.id) ? user : null; },
    async getLoginAttempt(_pool, key) { return attempts.get(key) || null; },
    async registerLoginFailure(_pool, key, limits) {
      const current = attempts.get(key) || { attempts: 0 };
      current.attempts += 1;
      if (current.attempts >= limits.maxAttempts) current.blocked_until = new Date(Date.now() + 60_000);
      attempts.set(key, current);
      return current;
    },
    async clearLoginFailures(_pool, key) { attempts.delete(key); },
    async updateLastAccess() {},
    async listUsers() { return [user].map(({ password_hash, ...safe }) => safe); },
    ...overrides
  };
}

function authApp({ users = fakeUsers(), cookie = {}, corsMiddleware, loginLimits } = {}) {
  const sessionMiddleware = session({
    secret: 'test-session-secret-with-at-least-32-characters',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60_000, ...cookie }
  });
  return createApp({
    apiKey: 'integration-key',
    databasePool: { async query() { return { rows: [] }; } },
    checkDatabaseFn: async () => {},
    sendMailFn: async () => {},
    sessionMiddleware,
    users,
    corsMiddleware,
    loginLimits: loginLimits || { maxAttempts: 3, windowSeconds: 900, blockSeconds: 900 }
  });
}

async function csrfSession(app, headers = {}) {
  const response = await request(app, { path: '/api/v1/auth/csrf', headers });
  return { cookie: cookieFrom(response), token: response.body.csrf_token, response };
}

test('login correcto crea cookie HttpOnly, regenera sesión y permite /auth/me', async () => {
  const app = authApp();
  const initial = await csrfSession(app);
  const login = await request(app, {
    method: 'POST', path: '/api/v1/auth/login',
    headers: { Cookie: initial.cookie, 'X-CSRF-Token': initial.token, 'Content-Type': 'application/json' },
    body: { usuario: 'admin', password: 'Contraseña-Segura-123!' }
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers['set-cookie'][0].includes('HttpOnly'), true);
  assert.notEqual(cookieFrom(login), initial.cookie);
  assert.equal('password_hash' in login.body.usuario, false);
  const me = await request(app, { path: '/api/v1/auth/me', headers: { Cookie: cookieFrom(login) } });
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.body).sort(), ['autenticado', 'id', 'nombre', 'rol', 'usuario']);
});

test('contraseña incorrecta, usuario inexistente e inactivo usan mensaje genérico', async () => {
  for (const variant of ['wrong', 'missing', 'inactive']) {
    const users = fakeUsers();
    if (variant === 'inactive') users.user.activo = false;
    if (variant === 'missing') users.findUserByUsername = async () => null;
    const app = authApp({ users });
    const initial = await csrfSession(app);
    const response = await request(app, {
      method: 'POST', path: '/api/v1/auth/login',
      headers: { Cookie: initial.cookie, 'X-CSRF-Token': initial.token, 'Content-Type': 'application/json' },
      body: { usuario: variant === 'missing' ? 'nadie' : 'admin', password: variant === 'wrong' ? 'Incorrecta-123!' : 'Contraseña-Segura-123!' }
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.mensaje, 'Credenciales inválidas.');
  }
});

test('limita intentos de autenticación', async () => {
  const app = authApp({ loginLimits: { maxAttempts: 1, windowSeconds: 900, blockSeconds: 900 } });
  let state = await csrfSession(app);
  await request(app, {
    method: 'POST', path: '/api/v1/auth/login',
    headers: { Cookie: state.cookie, 'X-CSRF-Token': state.token, 'Content-Type': 'application/json' },
    body: { usuario: 'admin', password: 'Incorrecta-123!' }
  });
  state = await csrfSession(app);
  const blocked = await request(app, {
    method: 'POST', path: '/api/v1/auth/login',
    headers: { Cookie: state.cookie, 'X-CSRF-Token': state.token, 'Content-Type': 'application/json' },
    body: { usuario: 'admin', password: 'Contraseña-Segura-123!' }
  });
  assert.equal(blocked.status, 429);
});

test('cookie Secure funciona detrás de proxy HTTPS', async () => {
  const app = authApp({ cookie: { secure: true, sameSite: 'none' } });
  const csrf = await csrfSession(app, { 'X-Forwarded-Proto': 'https' });
  assert.match(csrf.response.headers['set-cookie'][0], /Secure/);
  assert.match(csrf.response.headers['set-cookie'][0], /SameSite=None/);
});

test('logout requiere CSRF, destruye sesión y /auth/me rechaza sesión ausente', async () => {
  const app = authApp();
  const initial = await csrfSession(app);
  const login = await request(app, {
    method: 'POST', path: '/api/v1/auth/login',
    headers: { Cookie: initial.cookie, 'X-CSRF-Token': initial.token, 'Content-Type': 'application/json' },
    body: { usuario: 'admin', password: 'Contraseña-Segura-123!' }
  });
  const cookie = cookieFrom(login);
  const noCsrf = await request(app, { method: 'POST', path: '/api/v1/auth/logout', headers: { Cookie: cookie } });
  assert.equal(noCsrf.status, 403);
  const logout = await request(app, {
    method: 'POST', path: '/api/v1/auth/logout', headers: { Cookie: cookie, 'X-CSRF-Token': login.body.csrf_token }
  });
  assert.equal(logout.status, 200);
  assert.equal((await request(app, { path: '/api/v1/auth/me', headers: { Cookie: cookie } })).status, 401);
});

test('una sesión expirada no autentica al usuario', async () => {
  const app = authApp({ cookie: { maxAge: 30 } });
  const initial = await csrfSession(app);
  const login = await request(app, {
    method: 'POST', path: '/api/v1/auth/login',
    headers: { Cookie: initial.cookie, 'X-CSRF-Token': initial.token, 'Content-Type': 'application/json' },
    body: { usuario: 'admin', password: 'Contraseña-Segura-123!' }
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const response = await request(app, { path: '/api/v1/auth/me', headers: { Cookie: cookieFrom(login) } });
  assert.equal(response.status, 401);
});

test('CORS permite solo orígenes configurados y nunca usa wildcard', async () => {
  const app = authApp({ corsMiddleware: createCorsMiddleware(['https://pwa.example.com']) });
  const allowed = await request(app, { path: '/api/v1/auth/csrf', headers: { Origin: 'https://pwa.example.com' } });
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://pwa.example.com');
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  const denied = await request(app, { path: '/api/v1/auth/csrf', headers: { Origin: 'https://evil.example' } });
  assert.equal(denied.status, 403);
});

test('las sesiones de producción usan almacenamiento PostgreSQL', () => {
  const middleware = createSessionMiddleware({
    pool: { query() {} },
    secret: 'production-session-secret-at-least-32-characters'
  });
  assert.notEqual(middleware.sessionStore.constructor.name, 'MemoryStore');
});

test('USUARIO consulta activas pero no inactivas ni sincronizaciones', async () => {
  const pool = { async query(query) {
    if (typeof query === 'object' && query.text.includes('FROM public.terminales')) return { rows: [] };
    return { rows: [] };
  } };
  const app = createApp({
    apiKey: 'key', databasePool: pool, checkDatabaseFn: async () => {}, sendMailFn: async () => {},
    ...baseAppOptions('USUARIO')
  });
  assert.equal((await request(app, { path: '/api/v1/terminales' })).status, 200);
  assert.equal((await request(app, { path: '/api/v1/terminales?estado=inactivas' })).status, 403);
  assert.equal((await request(app, { path: '/api/v1/sincronizaciones' })).status, 403);
  assert.equal((await request(app, {
    method: 'POST', path: '/api/v1/sincronizaciones',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' }, body: {}
  })).status, 403);
});

test('USUARIO no puede consultar el detalle de una terminal inactiva', async () => {
  const pool = {
    async query() {
      return { rows: [{
        terminal: '001', datos_excel: {}, activa: false, version: '1',
        fecha_creacion: null, fecha_actualizacion: null, fecha_ultima_sincronizacion: null
      }] };
    }
  };
  const app = createApp({
    apiKey: 'key', databasePool: pool, checkDatabaseFn: async () => {}, sendMailFn: async () => {},
    ...baseAppOptions('USUARIO')
  });
  assert.equal((await request(app, { path: '/api/v1/terminales/001' })).status, 403);
});

test('ADMIN accede a inactivas y operaciones administrativas', async () => {
  const pool = { async query() { return { rows: [] }; } };
  const synchronizationRepository = {
    async listSynchronizations() { return { datos: [], total: 0 }; },
    async getSynchronization() { return null; }
  };
  const users = fakeUsers();
  const app = createApp({
    apiKey: 'key', databasePool: pool, checkDatabaseFn: async () => {}, sendMailFn: async () => {},
    synchronizationRepository, users, ...baseAppOptions('ADMIN')
  });
  assert.equal((await request(app, { path: '/api/v1/terminales?estado=inactivas' })).status, 200);
  assert.equal((await request(app, { path: '/api/v1/sincronizaciones' })).status, 200);
  assert.equal((await request(app, { path: '/api/v1/usuarios' })).status, 200);
});

test('crear usuario valida contraseña y nunca devuelve hash', async () => {
  const users = fakeUsers({
    async createUser(_pool, data) {
      return { id: '2', nombre: data.nombre, usuario: data.usuario, rol: data.rol, activo: true };
    }
  });
  const app = createApp({
    apiKey: 'key', databasePool: {}, users, checkDatabaseFn: async () => {}, sendMailFn: async () => {}, ...baseAppOptions()
  });
  const weak = await request(app, {
    method: 'POST', path: '/api/v1/usuarios', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' },
    body: { nombre: 'Nuevo', usuario: 'nuevo', password: 'debil', rol: 'USUARIO' }
  });
  assert.equal(weak.status, 400);
  const created = await request(app, {
    method: 'POST', path: '/api/v1/usuarios', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' },
    body: { nombre: 'Nuevo', usuario: 'nuevo', password: 'Segura-Nueva-123!', rol: 'USUARIO' }
  });
  assert.equal(created.status, 201);
  assert.equal('password_hash' in created.body, false);
});

test('usuario duplicado devuelve 409 y restablecer contraseña invalida sesiones', async () => {
  let reset = false;
  const duplicate = Object.assign(new Error('duplicate'), { code: '23505' });
  const users = fakeUsers({
    async createUser() { throw duplicate; },
    async resetUserPassword() { reset = true; return true; }
  });
  const app = createApp({
    apiKey: 'key', databasePool: {}, users, checkDatabaseFn: async () => {}, sendMailFn: async () => {}, ...baseAppOptions()
  });
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' };
  const created = await request(app, {
    method: 'POST', path: '/api/v1/usuarios', headers,
    body: { nombre: 'Nuevo', usuario: 'nuevo', password: 'Segura-Nueva-123!', rol: 'USUARIO' }
  });
  assert.equal(created.status, 409);
  const password = await request(app, {
    method: 'POST', path: '/api/v1/usuarios/2/password', headers,
    body: { password: 'Otra-Segura-456!' }
  });
  assert.equal(password.status, 200);
  assert.equal(reset, true);
});

test('protege desactivación propia y último ADMIN activo', async () => {
  const conflict = Object.assign(new Error('No puedes desactivar tu propia cuenta.'), { code: 'SELF_DEACTIVATION' });
  const users = fakeUsers({ async setUserActive() { throw conflict; } });
  const app = createApp({
    apiKey: 'key', databasePool: {}, users, checkDatabaseFn: async () => {}, sendMailFn: async () => {}, ...baseAppOptions()
  });
  const response = await request(app, {
    method: 'PATCH', path: '/api/v1/usuarios/1/estado',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf-token' }, body: { activo: false }
  });
  assert.equal(response.status, 409);
});

test('el repositorio invalida sesiones al restablecer contraseña', async () => {
  const queries = [];
  const client = {
    async query(query) {
      const text = typeof query === 'string' ? query : query.text;
      queries.push(text);
      if (text.includes('UPDATE public.usuarios')) return { rows: [{ id: '2' }] };
      return { rows: [] };
    },
    release() {}
  };
  await authRepository.resetUserPassword({ async connect() { return client; } }, 2, 'hash');
  assert.equal(queries.some((query) => query.includes('DELETE FROM public.user_sessions')), true);
  assert.equal(queries.includes('COMMIT'), true);
});

test('el repositorio impide desactivar el último ADMIN activo', async () => {
  const commands = [];
  const client = {
    async query(query) {
      const text = typeof query === 'string' ? query : query.text;
      commands.push(text.trim());
      if (text.includes('FROM public.usuarios WHERE id')) {
        return { rows: [{ id: '2', rol: 'ADMIN', activo: true }] };
      }
      if (text.includes("rol = 'ADMIN'")) return { rows: [{ id: '2' }] };
      return { rows: [] };
    },
    release() {}
  };
  await assert.rejects(
    () => authRepository.setUserActive({ async connect() { return client; } }, 2, false, 1),
    (error) => error.code === 'LAST_ADMIN'
  );
  assert.equal(commands.includes('ROLLBACK'), true);
});

test('desactivar un usuario invalida sus sesiones persistentes', async () => {
  const commands = [];
  const client = {
    async query(query) {
      const text = typeof query === 'string' ? query : query.text;
      commands.push(text.trim());
      if (text.includes('FROM public.usuarios WHERE id')) {
        return { rows: [{ id: '2', nombre: 'U', usuario: 'u', rol: 'USUARIO', activo: true }] };
      }
      if (text.includes('UPDATE public.usuarios SET activo')) {
        return { rows: [{ id: '2', nombre: 'U', usuario: 'u', rol: 'USUARIO', activo: false }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  await authRepository.setUserActive({ async connect() { return client; } }, 2, false, 1);
  assert.equal(commands.some((command) => command.includes('DELETE FROM public.user_sessions')), true);
  assert.equal(commands.includes('COMMIT'), true);
});
