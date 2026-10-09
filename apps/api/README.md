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
