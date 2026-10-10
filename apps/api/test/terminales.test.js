const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/app');
const { buildPowerAutomateV2Mail } = require('../src/mail');
const { buildSearchQuery, findTerminal } = require('../src/terminales/queries');
const { validateChanges } = require('../src/terminales/routes');
const { parseSearchParams, ValidationError } = require('../src/terminales/validation');
const { baseAppOptions, testSessionMiddleware } = require('./test-app-options');

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
      sendMailFn: options.sendMailFn || (async () => {}),
      ...baseAppOptions(options.role || 'ADMIN')
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
  assert.deepEqual(pool.calls[0].values, ['123', 'NombreComercial', 1, 1]);
});

test('busca por cada propiedad JSONB permitida', async () => {
  for (const campo of ['NombreComercial', 'CodigoComercio', 'Inventario', 'SeriePOS']) {
    const filters = parseSearchParams({ q: 'valor', campo, estado: 'todas' });
    const query = buildSearchQuery(filters);
    assert.match(query.text, /datos_excel ->> \$2/u);
    assert.equal(query.values[1], campo);
  }
});

test('permite buscar una columna dinámica segura y rechaza campos internos', () => {
  const query = buildSearchQuery(parseSearchParams({ q: 'valor', campo: 'Nueva Columna 2026' }));
  assert.equal(query.values[1], 'Nueva Columna 2026');
  assert.throws(() => parseSearchParams({ campo: '@odata.etag' }), ValidationError);
});

test('búsqueda general usa los valores de todos los campos dinámicos sin buscar nombres de claves', () => {
  const query = buildSearchQuery(parseSearchParams({ q: 'valor', campo: 'todos' }));
  assert.match(query.text, /jsonb_each_text/u);
  assert.match(query.text, /property\.value ILIKE/u);
  assert.doesNotMatch(query.text, /datos_excel::text ILIKE/u);
  assert.match(query.text, /t\.terminal ILIKE/u);
});

test('combina filtros y orden antes de paginar usando parámetros SQL', () => {
  const query = buildSearchQuery(parseSearchParams({
    q: 'norte', campo: 'Ciudad', TecnicoAsignado: 'Ana', Zona: 'Norte',
    orden: 'TecnicoAsignado', direccion: 'desc', pagina: '2', limite: '20'
  }));
  assert.match(query.text, /ORDER BY .* DESC NULLS LAST/su);
  assert.deepEqual(query.values, ['norte', 'Ciudad', 'TecnicoAsignado', 'Ana', 'Zona', 'Norte', 'TecnicoAsignado', 20, 20]);
  assert.doesNotMatch(query.text, /Ana|Norte/u);
});

test('expone opciones y nombres de campos dinámicos sin listas de valores codificadas', async () => {
  const terminalRepository = {
    async getFilterOptions(_pool, activeOnly) { assert.equal(activeOnly, true); return { Ciudad: ['Tegucigalpa'] }; },
    async getFieldNames(_pool, activeOnly) { assert.equal(activeOnly, true); return ['Ciudad', 'CampoNuevo']; },
    async getDashboard() { return {}; }, async getHistory() { return { datos: [], total: 0 }; }
  };
  const app = createApp({ apiKey:'key', databasePool:fakePool(), checkDatabaseFn:async()=>{}, sendMailFn:async()=>{}, terminalRepository, ...baseAppOptions('USUARIO') });
  const response = await request(app, { path:'/api/v1/terminales/filtros/opciones' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { datos:{ Ciudad:['Tegucigalpa'] }, campos:['Ciudad','CampoNuevo'] });
});

test('edición exige versión, rechaza inactivas y expone conflictos sin sobrescribir', async () => {
  const base = { terminal: '001', activa: true, version: '3', datos_excel: { Celular: '1' } };
  for (const [kind, status, code] of [['inactive',409,'TERMINAL_INACTIVA'],['conflict',409,'VERSION_CONFLICT']]) {
    const terminalRepository = {
      async updateTerminal() { return { kind, current: base }; },
      async getFilterOptions() { return {}; }, async getDashboard() { return {}; }, async getHistory() { return { datos: [], total: 0 }; }
    };
    const app = createApp({
      apiKey: 'key', databasePool: fakePool(), checkDatabaseFn: async()=>{}, sendMailFn: async()=>{},
      terminalRepository, ...baseAppOptions()
    });
    const response = await request(app,{method:'PATCH',path:'/api/v1/terminales/001',headers:{'Content-Type':'application/json','X-CSRF-Token':'test-csrf-token'},body:{version:3,cambios:{Celular:'2'}}});
    assert.equal(response.status,status); assert.equal(response.body.codigo,code);
  }
});

test('edición múltiple envía un único correo V2 exacto y marca toda la operación', async () => {
  const sent=[];const marked=[];
  const terminalRepository={
    async updateTerminal(){return{kind:'updated',terminal:{terminal:'000001',activa:true,version:'2',datos_excel:{Celular:'0999',Ciudad:'San Pedro Sula'}},queue:[
      {id:1,operacion_id:'op-1',campo:'Celular',valor_nuevo:'0999'},
      {id:2,operacion_id:'op-1',campo:'Ciudad',valor_nuevo:'San Pedro Sula'}
    ]};},
    async markQueueOperation(_pool,id,state,error){marked.push([id,state,error??null]);return 2;}, async getFilterOptions(){return{};},async getDashboard(){return{};},async getHistory(){return{datos:[],total:0};}
  };
  const app=createApp({apiKey:'key',databasePool:fakePool(),checkDatabaseFn:async()=>{},sendMailFn:async data=>sent.push(data),terminalRepository,...baseAppOptions()});
  const response=await request(app,{method:'PATCH',path:'/api/v1/terminales/000001',headers:{'Content-Type':'application/json','X-CSRF-Token':'test-csrf-token'},body:{version:1,cambios:{Celular:'0999',Ciudad:'San Pedro Sula'}}});
  assert.equal(response.status,200);
  assert.deepEqual(sent,[{
    subject:'ACTUALIZAR_CARTERA_V2',
    body:'{"version":2,"terminal":"000001","cambios":{"Celular":"0999","Ciudad":"San Pedro Sula"}}',
    contentType:'Text'
  }]);
  assert.deepEqual(marked,[['op-1','INCIERTO',null],['op-1','ENVIADO',null]]);
  assert.deepEqual(response.body.envio_excel,{estado:'ENVIADO',campos:['Celular','Ciudad']});
  assert.deepEqual(response.body.propagacion,[{campo:'Celular',estado:'ENVIADO'},{campo:'Ciudad',estado:'ENVIADO'}]);
});

test('constructor V2 conserva texto, vacíos, null y escapa JSON sin alterar su estructura', () => {
  const message=buildPowerAutomateV2Mail('000284',{
    CodigoComercio:'000042',NombreComercial:'  Tienda "Norte"\n ',Celular:'',Correo:null
  });
  assert.equal(message.subject,'ACTUALIZAR_CARTERA_V2');
  assert.equal(message.contentType,'Text');
  assert.deepEqual(JSON.parse(message.body),{
    version:2,terminal:'000284',cambios:{CodigoComercio:'000042',NombreComercial:'  Tienda "Norte"\n ',Celular:'',Correo:null}
  });
});

test('validación V2 rechaza Terminal, internos, columnas desconocidas y valores no escalares de texto', () => {
  for(const cambios of [
    {Terminal:'otra'},{ItemInternalId:'1'},{CampoDinamico:'x'},
    {Ciudad:{nombre:'x'}},{Ciudad:['x']},{Ciudad:1},{Ciudad:true}
  ]) assert.throws(()=>validateChanges({version:1,cambios}),ValidationError);
  assert.deepEqual(validateChanges({version:1,cambios:{Celular:'',Correo:null}}).changes,{Celular:'',Correo:null});
});

test('un error de Microsoft Graph conserva el guardado local y marca todos los campos como ERROR', async () => {
  const marked=[];
  const terminalRepository={
    async updateTerminal(){return{kind:'updated',terminal:{terminal:'001',activa:true,version:'2',datos_excel:{Zona:'Norte',Ciudad:'Tela'}},queue:[
      {operacion_id:'op-error',campo:'Zona',valor_nuevo:'Norte'},
      {operacion_id:'op-error',campo:'Ciudad',valor_nuevo:'Tela'}
    ]};},
    async markQueueOperation(_pool,id,state,error){marked.push([id,state,error??null]);return 2;},async getFilterOptions(){return{};},async getDashboard(){return{};},async getHistory(){return{datos:[],total:0};}
  };
  const app=createApp({apiKey:'key',databasePool:fakePool(),checkDatabaseFn:async()=>{},sendMailFn:async()=>{throw new Error('fallo simulado');},terminalRepository,...baseAppOptions('USUARIO')});
  const response=await request(app,{method:'PATCH',path:'/api/v1/terminales/001',headers:{'Content-Type':'application/json','X-CSRF-Token':'test-csrf-token'},body:{version:1,cambios:{Zona:'Norte',Ciudad:'Tela'}}});
  assert.equal(response.status,200);
  assert.deepEqual(marked,[['op-error','INCIERTO',null],['op-error','ERROR','MAIL_DELIVERY_FAILED']]);
  assert.equal(response.body.envio_excel.estado,'ERROR');
});

test('una operación sin diferencias no envía correo ni crea un reintento duplicado', async () => {
  let sent=0;
  const terminalRepository={
    async updateTerminal(){return{kind:'unchanged',terminal:{terminal:'001',activa:true,version:'2',datos_excel:{Zona:'Norte'}}};},
    async getFilterOptions(){return{};},async getDashboard(){return{};},async getHistory(){return{datos:[],total:0};}
  };
  const app=createApp({apiKey:'key',databasePool:fakePool(),checkDatabaseFn:async()=>{},sendMailFn:async()=>{sent+=1;},terminalRepository,...baseAppOptions()});
  const response=await request(app,{method:'PATCH',path:'/api/v1/terminales/001',headers:{'Content-Type':'application/json','X-CSRF-Token':'test-csrf-token'},body:{version:2,cambios:{Zona:'Norte'}}});
  assert.equal(response.status,200);assert.equal(sent,0);
  assert.deepEqual(response.body.envio_excel,{estado:'SIN_CAMBIOS',campos:[]});
});

test('si Graph acepta pero falla el registro final, informa INCIERTO sin reenviar', async () => {
  let sent=0;let marks=0;
  const terminalRepository={
    async updateTerminal(){return{kind:'updated',terminal:{terminal:'001',activa:true,version:'2',datos_excel:{Zona:'Sur'}},queue:[{operacion_id:'op-uncertain',campo:'Zona',valor_nuevo:'Sur'}]};},
    async markQueueOperation(){marks+=1;if(marks===2)throw new Error('base no disponible');return 1;},
    async getFilterOptions(){return{};},async getDashboard(){return{};},async getHistory(){return{datos:[],total:0};}
  };
  const app=createApp({apiKey:'key',databasePool:fakePool(),checkDatabaseFn:async()=>{},sendMailFn:async()=>{sent+=1;},terminalRepository,...baseAppOptions()});
  const response=await request(app,{method:'PATCH',path:'/api/v1/terminales/001',headers:{'Content-Type':'application/json','X-CSRF-Token':'test-csrf-token'},body:{version:1,cambios:{Zona:'Sur'}}});
  assert.equal(response.status,200);assert.equal(sent,1);assert.equal(marks,2);
  assert.equal(response.body.envio_excel.estado,'INCIERTO');
});

test('no llama a Graph si no puede preparar todas las filas de cola', async () => {
  let sent=0;
  const terminalRepository={
    async updateTerminal(){return{kind:'updated',terminal:{terminal:'001',activa:true,version:'2',datos_excel:{Zona:'Sur'}},queue:[{operacion_id:'op-pending',campo:'Zona',valor_nuevo:'Sur'}]};},
    async markQueueOperation(){return 0;},async getFilterOptions(){return{};},async getDashboard(){return{};},async getHistory(){return{datos:[],total:0};}
  };
  const app=createApp({apiKey:'key',databasePool:fakePool(),checkDatabaseFn:async()=>{},sendMailFn:async()=>{sent+=1;},terminalRepository,...baseAppOptions()});
  const response=await request(app,{method:'PATCH',path:'/api/v1/terminales/001',headers:{'Content-Type':'application/json','X-CSRF-Token':'test-csrf-token'},body:{version:1,cambios:{Zona:'Sur'}}});
  assert.equal(response.status,200);assert.equal(sent,0);
  assert.equal(response.body.envio_excel.estado,'PENDIENTE');
});

test('edición exige CSRF y no persiste sin el token', async () => {
  let called=false;
  const terminalRepository={async updateTerminal(){called=true;},async getFilterOptions(){return{};},async getDashboard(){return{};},async getHistory(){return{datos:[],total:0};}};
  const app=createApp({apiKey:'key',databasePool:fakePool(),checkDatabaseFn:async()=>{},sendMailFn:async()=>{},terminalRepository,...baseAppOptions()});
  const response=await request(app,{method:'PATCH',path:'/api/v1/terminales/001',headers:{'Content-Type':'application/json'},body:{version:1,cambios:{Celular:'1'}}});
  assert.equal(response.status,403);assert.equal(called,false);
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

test('rechaza consultas de terminales sin sesión', async () => {
  const app = createApp({
    apiKey: 'test-api-key',
    databasePool: fakePool(),
    checkDatabaseFn: async () => {},
    sendMailFn: async () => {},
    sessionMiddleware: testSessionMiddleware,
    authorization: {
      requireAuth(_req, res) { return res.status(401).json({ ok: false }); },
      requireAdmin(_req, res) { return res.status(403).json({ ok: false }); }
    }
  });
  const missing = await request(app, { path: '/api/v1/terminales' });
  assert.equal(missing.status, 401);
});

test('permite la consulta con sesión válida', async () => {
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
