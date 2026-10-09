# Despliegue HTTPS y seguridad de producción

## Infraestructura existente

La API pública utiliza `https://api-cartera.rtdev.uk`. Cloudflare termina HTTPS y el túnel existente reenvía hacia `http://127.0.0.1:3005`. El nombre del proceso PM2 se configura en el servidor.

Este procedimiento no crea túneles, no modifica DNS o credenciales de Cloudflare, no abre el puerto 3005, no ejecuta migraciones y no cambia PostgreSQL. La API debe seguir enlazada exclusivamente a `127.0.0.1`.

El origen previsto para la futura PWA es `https://cartera.rtdev.uk`. Aún debe confirmarse antes del despliegue del frontend. CORS compara orígenes exactos, permite credenciales y no reemplaza la autenticación ni los roles.

## Archivo `.env` completo para Ubuntu

Conserva este archivo únicamente en `/ruta/al/repositorio/apps/api/.env`, con permisos privados. Sustituye todos los valores `REEMPLAZAR_*`; no los confirmes en Git.

```dotenv
NODE_ENV=production

MS_CLIENT_ID=c562e3d4-bc99-40f7-9bca-e413a1a3d90b

HOST=127.0.0.1
PORT=3005
API_KEY=REEMPLAZAR_CLAVE_API_ALEATORIA

SESSION_SECRET=REEMPLAZAR_SECRETO_ALEATORIO_DE_32_O_MAS_CARACTERES
SESSION_COOKIE_NAME=cartera.sid
SESSION_MAX_AGE_MS=28800000
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=1
CORS_ORIGINS=https://cartera.rtdev.uk
LOGIN_MAX_ATTEMPTS=5
LOGIN_WINDOW_SECONDS=900
LOGIN_BLOCK_SECONDS=900

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=cartera_clientes
DB_USER=cartera_clientes_api
DB_PASSWORD=REEMPLAZAR_PASSWORD_POSTGRESQL_API

TEST_DATABASE_URL=postgresql://cartera_test:REEMPLAZAR_PASSWORD_POSTGRESQL_PRUEBAS@127.0.0.1:5432/cartera_clientes_pruebas
TEST_DATABASE_NAME=cartera_clientes_pruebas

SNAPSHOT_IMPORT_ENABLED=false
SNAPSHOT_PATH=/ruta/privada/cartera-snapshot/snapshot.json
SNAPSHOT_RECORDS_PATH=
SNAPSHOT_MAX_BYTES=10485760
SNAPSHOT_VALIDATE_PATH=/ruta/privada/cartera-snapshot/snapshot.json

MAIL_TO=REEMPLAZAR_DESTINATARIO_AUTORIZADO
MAIL_SUBJECT=ACTUALIZAR_CARTERA|00000000|99999999
MAIL_BODY=Solicitud de actualización de cartera.
MS_TOKEN_CACHE_PATH=/ruta/privada/cartera-clientes-api/msal-cache.json
```

La cookie no establece `Domain`, por lo que queda limitada a `api-cartera.rtdev.uk`. Es `HttpOnly`, `Secure`, `SameSite=Lax`, expira según `SESSION_MAX_AGE_MS` y solo contiene el identificador opaco de sesión. `SameSite=Strict` está permitido. `SameSite=None` solo es válido con `COOKIE_SECURE=true` y no es necesario para los dos subdominios previstos bajo `rtdev.uk`.

## Confianza en el proxy

`TRUST_PROXY=1` representa el único salto Cloudflare Tunnel → Express. La aplicación se niega a arrancar en producción si el host no es `127.0.0.1`, si el número de saltos no es exactamente uno o si la cookie no es segura. Esta combinación es importante: el puerto local no debe publicarse ni reenviarse por otro proxy. `express-session` no confía directamente en encabezados reenviados; usa `req.secure`, calculado por Express.

## CORS, sesiones y CSRF

El frontend debe enviar solicitudes con credenciales (`credentials: 'include'`). Primero obtiene `GET /api/v1/auth/csrf`; luego envía `X-CSRF-Token` en login, logout, administración de usuarios e importaciones. Después del login debe usar el nuevo token retornado, porque el identificador de sesión se regenera para impedir fijación.

Los preflight admiten solamente `GET`, `POST`, `PATCH` y `OPTIONS`, y los encabezados `Content-Type`, `X-CSRF-Token` y `X-API-Key`. Las solicitudes internas sin `Origin` siguen permitidas. Los orígenes desconocidos reciben HTTP 403.

Toda futura operación de edición de terminales deberá incorporarse detrás de sesión, autorización por rol y `X-CSRF-Token`; esta etapa no crea ese endpoint.

No se deben almacenar contraseñas, API keys, tokens CSRF ni identificadores de sesión en `localStorage` o IndexedDB. El token CSRF puede mantenerse únicamente en memoria durante la sesión de la PWA.

## Validación y despliegue con PM2

Ejecuta el bloque completo desde una sesión del usuario propietario del despliegue. Se detiene si el árbol tiene cambios locales. No ejecuta migraciones ni toca Cloudflare:

```sh
set -eu
cd /ruta/al/repositorio
test -z "$(git status --porcelain)" || { echo 'El repositorio tiene cambios locales; despliegue cancelado.' >&2; exit 1; }
git rev-parse HEAD > /ruta/privada/cartera-clientes.rollback
git fetch origin
git pull --ff-only origin main
cd /ruta/al/repositorio/apps/api
chmod 600 .env
npm ci
npm run config:check
npm test
npm audit --omit=dev
pm2 restart NOMBRE_PROCESO_PM2 --update-env
pm2 status NOMBRE_PROCESO_PM2
pm2 logs NOMBRE_PROCESO_PM2 --lines 50 --nostream
API_KEY_CHECK="$(node -e 'require("dotenv").config(); process.stdout.write(process.env.API_KEY || "")')"
curl --fail --silent --show-error https://api-cartera.rtdev.uk/api/v1/health -H "X-API-Key: ${API_KEY_CHECK}"
unset API_KEY_CHECK
```

Después, desde un navegador autorizado, valida que login emita una cookie con `Secure`, `HttpOnly` y `SameSite=Lax`, que `/auth/me` conserve la sesión y que logout la invalide. Verifica también que un `Origin` desconocido no reciba encabezados CORS.

## Rollback

Usa este bloque únicamente si el despliegue falla y el árbol continúa limpio. Restaura temporalmente el commit guardado sin borrar archivos ni reescribir historial remoto:

```sh
set -eu
cd /ruta/al/repositorio
test -z "$(git status --porcelain)" || { echo 'El repositorio tiene cambios locales; rollback cancelado.' >&2; exit 1; }
ROLLBACK_COMMIT="$(cat /ruta/privada/cartera-clientes.rollback)"
git fetch origin
git switch --detach "$ROLLBACK_COMMIT"
cd /ruta/al/repositorio/apps/api
npm ci
npm run config:check
npm test
pm2 restart NOMBRE_PROCESO_PM2 --update-env
pm2 status NOMBRE_PROCESO_PM2
pm2 logs NOMBRE_PROCESO_PM2 --lines 50 --nostream
```

Para volver posteriormente a la versión vigente:

```sh
set -eu
cd /ruta/al/repositorio
test -z "$(git status --porcelain)" || { echo 'El repositorio tiene cambios locales; operación cancelada.' >&2; exit 1; }
git switch main
git pull --ff-only origin main
```

## Riesgos y verificaciones pendientes

- Confirmar que `https://cartera.rtdev.uk` sea el origen definitivo antes de desplegar la PWA.
- Comprobar desde el navegador la cadena Cloudflare → túnel → Express y los atributos reales de la cookie.
- Mantener el puerto 3005 cerrado externamente; `TRUST_PROXY=1` deja de ser apropiado si se agrega otro salto.
- Mantener `SNAPSHOT_IMPORT_ENABLED=false` hasta una autorización posterior.
- Proteger `.env`, el caché MSAL y el archivo de rollback mediante permisos del sistema.
