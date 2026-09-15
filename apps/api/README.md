# Prueba de correo con Microsoft Graph

Módulo mínimo para enviar un correo desde una cuenta personal Hotmail/Outlook.com usando Microsoft Graph, OAuth 2.0 y Device Code Flow. Incluye una API HTTP local mínima. No usa contraseña, SMTP ni client secret.

## Configuración

Requisitos: Node.js 20 o superior y, en Android, Termux con `node` y `npm` instalados.

```sh
npm install
cp .env.example .env
```

Edita `.env` y configura `MAIL_TO` con el destinatario y `API_KEY` con una clave temporal segura. El `MS_CLIENT_ID` del ejemplo corresponde a la aplicación de Microsoft Entra indicada para esta prueba. No subas `.env` ni el caché de MSAL a Git.

La aplicación debe tener el permiso delegado de Microsoft Graph `Mail.Send` y estar configurada para permitir flujos de clientes públicos. La autoridad `common` permite cuentas organizacionales y cuentas personales de Microsoft.

## Ejecutar

```sh
npm run test:mail
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

No se implementan todavía base de datos, frontend, túnel, autenticación de usuarios ni otros campos del Excel.
