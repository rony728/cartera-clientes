-- Cartera de Clientes | migración 002
-- Sesiones persistentes e intentos de autenticación.
-- Revisar y ejecutar posteriormente en Ubuntu; esta migración no se ejecuta automáticamente.

BEGIN;

CREATE UNIQUE INDEX ux_usuarios_usuario_lower
    ON public.usuarios (lower(usuario));

CREATE TABLE public.user_sessions (
    sid varchar NOT NULL PRIMARY KEY,
    sess json NOT NULL,
    expire timestamp(6) NOT NULL
);

CREATE INDEX ix_user_sessions_expire
    ON public.user_sessions (expire);

CREATE TABLE public.auth_login_attempts (
    key_hash char(64) PRIMARY KEY,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    window_start timestamptz NOT NULL DEFAULT now(),
    blocked_until timestamptz
);

CREATE INDEX ix_auth_login_attempts_blocked
    ON public.auth_login_attempts (blocked_until)
    WHERE blocked_until IS NOT NULL;

COMMIT;
