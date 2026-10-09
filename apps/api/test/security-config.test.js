const assert = require('node:assert/strict');
const test = require('node:test');

const { parseAllowedOrigins } = require('../src/auth/cors');
const { createSessionMiddleware } = require('../src/auth/session');
const { loadServerConfig } = require('../src/config');

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '3005',
    API_KEY: 'clave-sintetica-segura-para-pruebas',
    SESSION_SECRET: 'secreto-sintetico-de-pruebas-con-mas-de-32-caracteres',
    SESSION_COOKIE_NAME: 'cartera.sid',
    SESSION_MAX_AGE_MS: '28800000',
    COOKIE_SECURE: 'true',
    COOKIE_SAME_SITE: 'lax',
    TRUST_PROXY: '1',
    CORS_ORIGINS: 'https://cartera.rtdev.uk',
    LOGIN_MAX_ATTEMPTS: '5',
    LOGIN_WINDOW_SECONDS: '900',
    LOGIN_BLOCK_SECONDS: '900',
    SNAPSHOT_IMPORT_ENABLED: 'false',
    SNAPSHOT_MAX_BYTES: '10485760',
    ...overrides
  };
}

test('acepta la configuración HTTPS prevista sin activar importaciones', () => {
  const config = loadServerConfig(productionEnv());
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3005);
  assert.equal(config.cookie.secure, true);
  assert.equal(config.cookie.sameSite, 'lax');
  assert.equal(config.trustProxy, 1);
  assert.deepEqual(config.corsOrigins, ['https://cartera.rtdev.uk']);
  assert.equal(config.importEnabled, false);
});

test('permite activar explícitamente la importación manual en producción', () => {
  const config = loadServerConfig(productionEnv({ SNAPSHOT_IMPORT_ENABLED: 'true' }));
  assert.equal(config.importEnabled, true);
  assert.equal(config.cookie.secure, true);
  assert.deepEqual(config.corsOrigins, ['https://cartera.rtdev.uk']);
});

test('rechaza producción sin cookie segura, loopback, proxy exacto u origen HTTPS', () => {
  const invalid = [
    [{ COOKIE_SECURE: 'false' }, /COOKIE_SECURE/u],
    [{ HOST: '0.0.0.0' }, /HOST/u],
    [{ TRUST_PROXY: '2' }, /TRUST_PROXY/u],
    [{ CORS_ORIGINS: '' }, /CORS_ORIGINS/u],
    [{ CORS_ORIGINS: 'http://cartera.rtdev.uk' }, /HTTPS/u]
  ];
  for (const [override, expected] of invalid) {
    assert.throws(() => loadServerConfig(productionEnv(override)), expected);
  }
});

test('rechaza secretos inseguros, booleanos ambiguos y nombres de cookie inválidos', () => {
  const invalid = [
    [{ SESSION_SECRET: 'corto' }, /SESSION_SECRET/u],
    [{ SESSION_SECRET: 'CAMBIAR_POR_UN_SECRETO_ALEATORIO_DE_AL_MENOS_32_CARACTERES' }, /SESSION_SECRET/u],
    [{ API_KEY: 'CAMBIAR_POR_UNA_CLAVE_SEGURA' }, /API_KEY/u],
    [{ COOKIE_SECURE: 'yes' }, /COOKIE_SECURE/u],
    [{ SNAPSHOT_IMPORT_ENABLED: 'yes' }, /SNAPSHOT_IMPORT_ENABLED/u],
    [{ SESSION_COOKIE_NAME: 'cookie inválida' }, /SESSION_COOKIE_NAME/u]
  ];
  for (const [override, expected] of invalid) {
    assert.throws(() => loadServerConfig(productionEnv(override)), expected);
  }
});

test('SameSite admite lax, strict y none seguro, pero rechaza none sin Secure', () => {
  assert.equal(loadServerConfig(productionEnv({ COOKIE_SAME_SITE: 'strict' })).cookie.sameSite, 'strict');
  assert.equal(loadServerConfig(productionEnv({ COOKIE_SAME_SITE: 'none' })).cookie.sameSite, 'none');
  assert.throws(
    () => loadServerConfig(productionEnv({ COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'false' })),
    /requiere COOKIE_SECURE=true/u
  );
  assert.throws(() => createSessionMiddleware({
    pool: { query() {} },
    secret: 'secreto-sintetico-de-pruebas-con-mas-de-32-caracteres',
    secure: false,
    sameSite: 'none'
  }), /requiere COOKIE_SECURE=true/u);
});

test('CORS rechaza comodines, rutas, credenciales y duplicados inseguros', () => {
  assert.throws(() => parseAllowedOrigins('*'), /comodines/u);
  assert.throws(() => parseAllowedOrigins('https://cartera.rtdev.uk/ruta'), /exactos/u);
  assert.throws(() => parseAllowedOrigins('https://user:pass@cartera.rtdev.uk'), /exactos/u);
  assert.deepEqual(
    parseAllowedOrigins('https://cartera.rtdev.uk, https://cartera.rtdev.uk'),
    ['https://cartera.rtdev.uk']
  );
});

test('los errores de configuración no incluyen los valores secretos', () => {
  const secret = 'valor-super-secreto-que-no-debe-aparecer-en-el-error';
  assert.throws(
    () => loadServerConfig(productionEnv({ API_KEY: secret, SESSION_SECRET: 'corto' })),
    (error) => !error.message.includes(secret)
  );
});
