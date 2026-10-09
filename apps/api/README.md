# API de cartera de clientes

API Express para consultar terminales en PostgreSQL y enviar actualizaciones a Power Automate mediante Microsoft Graph. La autenticación de Microsoft usa OAuth 2.0 Device Code Flow; no usa contraseña de Hotmail, SMTP ni client secret.

## Configuración

Requisitos: Node.js 20 o superior y, en Android, Termux con `node` y `npm` instalados.

```sh
npm install
cp .env.example .env
```

Edita `.env` y configura `MAIL_TO` con el destinatario, `API_KEY` con una clave temporal segura y las variables `DB_*` con las credenciales del usuario de PostgreSQL de la API. El `MS_CLIENT_ID` del ejemplo corresponde a la aplicación de Microsoft Entra indicada para esta prueba. No subas `.env` ni el caché de MSAL a Git.

La aplicación debe tener el permiso delegado de Microsoft Graph `Mail.Send` y estar configurada para permitir flujos de clientes públicos. La autoridad `common` permite cuentas organizacionales y cuentas personales de Microsoft.

## Ejecutar

```sh
npm run test:mail
```

Para ejecutar las pruebas automatizadas aisladas, sin PostgreSQL ni envío de correo real:

```sh
npm test
```

La primera vez aparecerá un mensaje de Microsoft con una URL y un código. Abre la URL desde cualquier dispositivo, inicia sesión con la cuenta que enviará el correo y confirma el consentimiento solicitado. Después, MSAL guardará el caché de sesión en:

```text
~/.config/cartera-clientes-api/msal-cache.json
```

En Termux corresponde normalmente a `/data/data/com.termux/files/home/.config/cartera-clientes-api/msal-cache.json`. El archivo se crea con permisos privados y queda fuera del proyecto. Para moverlo a una ubicación específica, define `MS_TOKEN_CACHE_PATH` en `.env`.

El asunto predeterminado es `ACTUALIZAR_CARTERA|00000000|99999999`, y puede cambiarse mediante `MAIL_SUBJECT`. El cuerpo puede cambiarse mediante `MAIL_BODY`.

El módulo usa `/me/sendMail`, por lo que el correo sale de la cuenta que completa el Device Code Flow. Si el token deja de ser válido o se elimina el caché, se solicitará iniciar sesión otra vez.

## API local

Inicia la API, escuchando inicialmente solo en `127.0.0.1:3005`:

```sh
npm run start:api
```

Prueba el endpoint desde otra terminal:

```sh
curl -i -X POST http://127.0.0.1:3005/api/cartera/celular \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: CAMBIAR_POR_UNA_CLAVE_SEGURA' \
  -d '{"terminal":"00000000","celular":"99999999"}'
```

Si falta `X-API-Key` o no coincide con `API_KEY`, la API responde HTTP 401. Si Microsoft Graph acepta el mensaje, responde HTTP 202 y Power Automate recibe el asunto `ACTUALIZAR_CARTERA|00000000|99999999`.

Esta autenticación con `X-API-Key` es temporal para pruebas del backend. No incrustes esta clave en la futura PWA; la PWA deberá usar un mecanismo de autenticación apropiado.

## Salud de PostgreSQL

La API usa un pool compartido de PostgreSQL y el endpoint protegido ejecuta únicamente `SELECT 1`:

```sh
curl -i http://127.0.0.1:3005/api/v1/health \
  -H 'X-API-Key: CAMBIAR_POR_UNA_CLAVE_SEGURA'
```

Con PostgreSQL disponible responde HTTP 200 con `{"status":"ok","database":"connected"}`. Si no está disponible responde HTTP 503 con `{"status":"error","database":"unavailable"}` sin revelar detalles de conexión.

No se ejecutan migraciones desde la API ni se modifican tablas en esta etapa. Tampoco se implementan frontend, túnel, autenticación de usuarios ni otros campos del Excel.

## Consulta de terminales

Todos los endpoints de consulta requieren `X-API-Key` y escuchan inicialmente solo en `127.0.0.1`.

### Buscar terminales

```text
GET /api/v1/terminales
```

Parámetros opcionales:

- `q`: término de búsqueda.
- `campo`: `todos` (predeterminado), `terminal`, `NombreComercial`, `CodigoComercio`, `Inventario` o `SeriePOS`.
- `pagina`: página positiva, predeterminada `1`.
- `limite`: entre `1` y `100`, predeterminado `20`.
- `estado`: `activas` (predeterminado), `inactivas` o `todas`.

Ejemplo:

```sh
curl -G http://127.0.0.1:3005/api/v1/terminales \
  -H 'X-API-Key: CAMBIAR_POR_UNA_CLAVE_SEGURA' \
  --data-urlencode 'q=2004' \
  --data-urlencode 'campo=terminal' \
  --data-urlencode 'pagina=1' \
  --data-urlencode 'limite=20' \
  --data-urlencode 'estado=activas'
```

Respuesta exitosa:

```json
{
  "datos": [
    {
      "terminal": "00000000",
      "activa": true,
      "version": 1,
      "datos_excel": {
        "NombreComercial": "COMERCIO EJEMPLO",
        "CodigoComercio": "12345"
      }
    }
  ],
  "paginacion": {
    "pagina": 1,
    "limite": 20,
    "total": 1,
    "total_paginas": 1
  }
}
```

### Consultar una terminal

```text
GET /api/v1/terminales/:terminal
```

Ejemplo:

```sh
curl -i http://127.0.0.1:3005/api/v1/terminales/00000000 \
  -H 'X-API-Key: CAMBIAR_POR_UNA_CLAVE_SEGURA'
```

La consulta individual respeta el identificador como texto, incluidos ceros a la izquierda, y devuelve también terminales inactivas. Si no existe, responde HTTP 404.

Las consultas usan SQL parametrizado, una lista cerrada de campos JSONB y paginación en PostgreSQL. No se descargan todos los registros a Node.js ni se permiten consultas SQL arbitrarias.

## Importación manual Excel → PostgreSQL

El motor lee el snapshot producido por el servicio externo, valida todo el contenido y aplica la sincronización en una única transacción PostgreSQL:

```text
Excel → correo → servicio externo → snapshot.json → importación manual → PostgreSQL
```

La descarga del archivo no inicia una importación. La ruta solo se configura en el servidor y nunca se acepta desde una solicitud HTTP.

### Configuración

```env
SNAPSHOT_IMPORT_ENABLED=false
SNAPSHOT_PATH=/ruta/privada/cartera-snapshot/snapshot.json
SNAPSHOT_RECORDS_PATH=
SNAPSHOT_MAX_BYTES=10485760
```

- `SNAPSHOT_IMPORT_ENABLED` debe permanecer en `false` hasta implementar y validar autorización administrativa real.
- `SNAPSHOT_PATH` tiene como valor recomendado en Ubuntu `/ruta/privada/cartera-snapshot/snapshot.json`.
- Si el nivel raíz del JSON es un arreglo, `SNAPSHOT_RECORDS_PATH` queda vacío. Si está anidado, configura una ruta por puntos, por ejemplo `value` o `data.items`.
- `SNAPSHOT_MAX_BYTES` limita el tamaño leído; el valor predeterminado es 10 MiB.

El parser exige que cada registro sea un objeto con `Terminal` de tipo texto, no vacío y único. Rechaza identificadores numéricos porque no puede reconstruir ceros a la izquierda perdidos. `Terminal` se almacena como identificador y las demás propiedades dinámicas se guardan en `datos_excel`. `ItemInternalId` y `@odata.etag` se ignoran para evitar cambios de negocio falsos.

El archivo se lee sin modificarlo. Se comprueban tamaño, legibilidad y estabilidad entre las lecturas de metadatos, y se calcula SHA-256 antes de modificar PostgreSQL.

### Endpoints administrativos

Todos requieren `X-API-Key`. Esta protección es temporal y no sustituye autenticación ni rol `ADMIN`.

```text
POST /api/v1/sincronizaciones
GET  /api/v1/sincronizaciones?pagina=1&limite=20
GET  /api/v1/sincronizaciones/:id
```

Con la importación deshabilitada, `POST` responde HTTP 403:

```json
{
  "ok": false,
  "codigo": "IMPORT_DISABLED",
  "mensaje": "La importación manual está deshabilitada en este servidor."
}
```

Cuando la validación en Ubuntu y la autorización administrativa estén listas, una ejecución se solicita sin proporcionar una ruta:

```sh
curl -i -X POST http://127.0.0.1:3005/api/v1/sincronizaciones \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: CAMBIAR_POR_UNA_CLAVE_SEGURA' \
  -d '{}'
```

Una importación completada devuelve sus contadores:

```json
{
  "ok": true,
  "sincronizacion": {
    "id": 42,
    "estado": "COMPLETADA",
    "total_registros": 1000,
    "insertados": 10,
    "actualizados": 20,
    "sin_cambios": 965,
    "inactivados": 3,
    "reactivados": 2,
    "conflictos": 0
  }
}
```

### Ausencias, historial y conflictos

Las terminales ausentes se inactivan y nunca se eliminan. Si las ausencias superan el 10% de las terminales activas, la transacción se rechaza antes de realizar cambios. Después de revisar la integridad del snapshot, el administrador puede repetir la solicitud con:

```json
{
  "confirmar_inactivacion_masiva": true
}
```

La confirmación solo omite la barrera porcentual; no omite la validación del archivo.

Cada propiedad modificada se registra en `historial_cambios`, conservando la diferencia entre ausencia y `null`. Los cambios de estado usan el campo administrativo `__estado_terminal__` con origen `SISTEMA`; los cambios del snapshot usan origen `EXCEL`.

El motor revisa la última revisión no resuelta de `cola_sincronizacion` por terminal y campo. Solo confirma valores enviados cuando el snapshot es posterior a `fecha_envio`. Los valores incompatibles generan un conflicto abierto asociado a la sincronización, sin decidir automáticamente si gana Excel o la PWA y sin duplicar el conflicto de una misma revisión.

La operación utiliza un bloqueo asesor transaccional para impedir importaciones simultáneas. Los cambios de terminales, historial, cola y conflictos se confirman juntos. Ante un error se ejecuta `ROLLBACK`, mientras el intento queda registrado como `ERROR` o `RECHAZADA` sin cambios parciales.

### Pruebas y limitaciones

```sh
npm test
npm audit --omit=dev
```

Las pruebas usan fixtures sintéticas y dependencias PostgreSQL simuladas; no modifican producción ni envían correos. Antes de habilitar `SNAPSHOT_IMPORT_ENABLED` en Ubuntu se debe validar `SNAPSHOT_RECORDS_PATH` con el archivo real, ejecutar las pruebas de integración contra una base aislada y completar autenticación administrativa. La resolución manual de conflictos todavía no está implementada.
