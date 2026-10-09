# Autenticación y sesiones

## Estrategia

La API usa `express-session` con `connect-pg-simple`. El navegador recibe únicamente una cookie opaca `HttpOnly`; el contenido de la sesión se guarda en `public.user_sessions`. Las contraseñas usan Argon2id. Los intentos fallidos se limitan mediante `public.auth_login_attempts`, por lo que el bloqueo sobrevive reinicios de PM2.

La sesión solo conserva el ID del usuario y el token CSRF. En cada solicitud protegida, la API consulta `public.usuarios` para comprobar estado y rol actuales.

## Migración requerida

La migración [002_auth_sessions.sql](../database/migrations/002_auth_sessions.sql) crea:

- índice único case-insensitive para `usuarios.usuario`;
- tabla persistente `user_sessions`;
- tabla persistente `auth_login_attempts`;
- índices de expiración y bloqueo.

No se ejecuta automáticamente. Después de revisar y respaldar la base, debe aplicarse en Ubuntu con el usuario propietario autorizado, no con las credenciales incluidas en comandos o Git:

```sh
cd /ruta/al/repositorio
psql -d cartera_clientes -f database/migrations/002_auth_sessions.sql
```

## Variables de entorno

```env
SESSION_SECRET=VALOR_ALEATORIO_DE_AL_MENOS_32_CARACTERES
SESSION_COOKIE_NAME=cartera.sid
SESSION_MAX_AGE_MS=28800000
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=1
CORS_ORIGINS=https://pwa.example.com
LOGIN_MAX_ATTEMPTS=5
LOGIN_WINDOW_SECONDS=900
LOGIN_BLOCK_SECONDS=900
```

Genera `SESSION_SECRET` directamente en Ubuntu y guárdalo solo en `.env`. En producción la API se niega a arrancar con `COOKIE_SECURE=false`. `COOKIE_SAME_SITE=none` se permite únicamente junto con cookies seguras; úsalo cuando PWA y API sean sitios diferentes y confirma la política definitiva de dominios. `CORS_ORIGINS` acepta una lista exacta separada por comas y nunca debe contener `*` cuando se usan credenciales.

Cloudflare termina HTTPS y reenvía a `127.0.0.1:3005`; `TRUST_PROXY=1` permite que Express reconozca el protocolo original y emita cookies seguras correctamente.

## Primer administrador

Después de aplicar la migración y configurar `.env`, ejecuta desde una consola interactiva del servidor:

```sh
cd /ruta/al/repositorio/apps/api
npm ci
npm run admin:init
```

El comando solicita usuario, nombre y contraseña sin recibir la contraseña como argumento ni mostrarla. Requiere 12-128 caracteres, mayúscula, minúscula, número y símbolo. Usa un bloqueo asesor y se niega a crear otro administrador inicial si ya existe uno.

No existe endpoint público para inicialización y no hay credenciales predeterminadas.

## CSRF, CORS y cookies

El cliente obtiene un token en `GET /api/v1/auth/csrf`. Debe conservar la cookie y enviar `X-CSRF-Token` en login, logout, administración de usuarios e importación. Después de login debe sustituirlo por el token nuevo retornado, porque la sesión se regenera para evitar fijación.

Las solicitudes sin sesión reciben HTTP 401. Las sesiones sin rol suficiente reciben HTTP 403. Los errores de login no distinguen usuario inexistente, inactivo o contraseña incorrecta.

## Orden de despliegue en Ubuntu

1. Respaldar PostgreSQL y revisar `002_auth_sessions.sql`.
2. Aplicar la migración 002; no volver a ejecutar la 001.
3. Ejecutar `npm ci` en `apps/api`.
4. Configurar las variables de sesión, cookies y CORS en `.env`.
5. Mantener `SNAPSHOT_IMPORT_ENABLED=false`.
6. Crear el primer administrador con `npm run admin:init`.
7. Ejecutar `npm test` y verificar login/CORS con los dominios reales.
8. Reiniciar la aplicación mediante el procedimiento operativo aprobado para PM2.
9. Habilitar importaciones solo después de validar autorización ADMIN y el snapshot real.

No se implementan todavía interfaz de login, edición desde PWA ni resolución manual de conflictos.
