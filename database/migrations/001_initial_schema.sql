-- Cartera de Clientes | migracion 001
-- ESQUEMA INICIAL - revisar y aprobar antes de ejecutar.
-- PostgreSQL 17+. Ejecutar con usuario propietario de cartera_clientes.
-- Las columnas de negocio son dinamicas y se almacenan en JSONB.
-- Terminal es el identificador permanente: nunca se elimina por ausencia en un snapshot.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.usuarios (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL,
    usuario text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    rol text NOT NULL CHECK (rol IN ('ADMIN', 'USUARIO')),
    activo boolean NOT NULL DEFAULT true,
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    ultimo_acceso timestamptz,
    CHECK (btrim(nombre) <> ''),
    CHECK (btrim(usuario) <> ''),
    CHECK (btrim(password_hash) <> '')
);

CREATE TABLE public.terminales (
    terminal text PRIMARY KEY,
    datos_excel jsonb NOT NULL DEFAULT '{}'::jsonb,
    activa boolean NOT NULL DEFAULT true,
    version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    fecha_ultima_sincronizacion timestamptz,
    CHECK (btrim(terminal) <> ''),
    CHECK (jsonb_typeof(datos_excel) = 'object')
);

CREATE TABLE public.sincronizaciones (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id bigint REFERENCES public.usuarios(id) ON DELETE RESTRICT,
    fecha_inicio timestamptz NOT NULL DEFAULT now(),
    fecha_fin timestamptz,
    archivo_hash text,
    total_registros integer NOT NULL DEFAULT 0 CHECK (total_registros >= 0),
    insertados integer NOT NULL DEFAULT 0 CHECK (insertados >= 0),
    actualizados integer NOT NULL DEFAULT 0 CHECK (actualizados >= 0),
    sin_cambios integer NOT NULL DEFAULT 0 CHECK (sin_cambios >= 0),
    inactivados integer NOT NULL DEFAULT 0 CHECK (inactivados >= 0),
    reactivados integer NOT NULL DEFAULT 0 CHECK (reactivados >= 0),
    conflictos integer NOT NULL DEFAULT 0 CHECK (conflictos >= 0),
    estado text NOT NULL DEFAULT 'EN_PROCESO'
        CHECK (estado IN ('EN_PROCESO', 'COMPLETADA', 'RECHAZADA', 'ERROR')),
    detalle_error text,
    CHECK (archivo_hash IS NULL OR archivo_hash ~ '^[0-9a-f]{64}$'),
    CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

-- Cada fila representa una revision de un solo campo. operacion_id agrupa
-- todos los campos guardados atomica y conjuntamente desde la PWA.
CREATE TABLE public.cola_sincronizacion (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operacion_id uuid NOT NULL,
    terminal text NOT NULL REFERENCES public.terminales(terminal) ON DELETE RESTRICT,
    campo text NOT NULL,
    revision bigint NOT NULL CHECK (revision >= 1),
    -- jsonb permite representar texto, null y estructuras del origen.
    -- Los indicadores *_presente separan ausencia de clave de JSON null.
    valor_anterior jsonb,
    valor_anterior_presente boolean NOT NULL DEFAULT true,
    valor_nuevo jsonb,
    valor_nuevo_presente boolean NOT NULL DEFAULT true,
    estado text NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'CONFIRMADO', 'ERROR',
                          'CONFLICTO', 'SUPERADA', 'INCIERTO')),
    usuario_id bigint REFERENCES public.usuarios(id) ON DELETE RESTRICT,
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_envio timestamptz,
    fecha_confirmacion timestamptz,
    intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
    proximo_intento timestamptz,
    ultimo_error text,
    CONSTRAINT uq_cola_campo_revision UNIQUE (terminal, campo, revision),
    CHECK (btrim(campo) <> '')
);

CREATE TABLE public.historial_cambios (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    terminal text NOT NULL REFERENCES public.terminales(terminal) ON DELETE RESTRICT,
    campo text NOT NULL,
    valor_anterior jsonb,
    valor_anterior_presente boolean NOT NULL DEFAULT true,
    valor_nuevo jsonb,
    valor_nuevo_presente boolean NOT NULL DEFAULT true,
    origen text NOT NULL CHECK (origen IN ('EXCEL', 'PWA', 'SISTEMA')),
    usuario_id bigint REFERENCES public.usuarios(id) ON DELETE RESTRICT,
    sincronizacion_id bigint REFERENCES public.sincronizaciones(id) ON DELETE RESTRICT,
    cola_id bigint REFERENCES public.cola_sincronizacion(id) ON DELETE RESTRICT,
    fecha timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(campo) <> '')
);

CREATE TABLE public.conflictos_sincronizacion (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    terminal text NOT NULL REFERENCES public.terminales(terminal) ON DELETE RESTRICT,
    campo text NOT NULL,
    cola_id bigint NOT NULL REFERENCES public.cola_sincronizacion(id) ON DELETE RESTRICT,
    sincronizacion_id bigint NOT NULL REFERENCES public.sincronizaciones(id) ON DELETE RESTRICT,
    valor_excel jsonb,
    valor_excel_presente boolean NOT NULL DEFAULT true,
    valor_pwa jsonb,
    valor_pwa_presente boolean NOT NULL DEFAULT true,
    estado text NOT NULL DEFAULT 'ABIERTO'
        CHECK (estado IN ('ABIERTO', 'RESUELTO')),
    resolucion text,
    usuario_resolucion_id bigint REFERENCES public.usuarios(id) ON DELETE RESTRICT,
    fecha_deteccion timestamptz NOT NULL DEFAULT now(),
    fecha_resolucion timestamptz,
    CHECK (btrim(campo) <> ''),
    CHECK (fecha_resolucion IS NULL OR fecha_resolucion >= fecha_deteccion)
);

-- Solo un conflicto abierto por revision local. Conflictos resueltos
-- quedan registrados y no bloquean futuros conflictos.
CREATE UNIQUE INDEX ux_conflicto_abierto_cola
    ON public.conflictos_sincronizacion (cola_id)
    WHERE estado = 'ABIERTO';

-- Consultas normales de terminales activas
CREATE INDEX ix_terminales_activas
    ON public.terminales (terminal) WHERE activa = true;

-- Busquedas de subcadenas y sin distincion de mayusculas.
CREATE INDEX ix_terminales_nombre_trgm
    ON public.terminales USING gin ((datos_excel ->> 'NombreComercial') gin_trgm_ops);
CREATE INDEX ix_terminales_codigo_trgm
    ON public.terminales USING gin ((datos_excel ->> 'CodigoComercio') gin_trgm_ops);
CREATE INDEX ix_terminales_inventario_trgm
    ON public.terminales USING gin ((datos_excel ->> 'Inventario') gin_trgm_ops);
CREATE INDEX ix_terminales_serie_trgm
    ON public.terminales USING gin ((datos_excel ->> 'SeriePOS') gin_trgm_ops);

-- Consultas estructurales y nuevas columnas dinamicas del JSON
CREATE INDEX ix_terminales_datos_gin
    ON public.terminales USING gin (datos_excel);

CREATE INDEX ix_cola_estado_reintento
    ON public.cola_sincronizacion (estado, proximo_intento, fecha_creacion);
CREATE INDEX ix_cola_terminal_campo_fecha
    ON public.cola_sincronizacion (terminal, campo, fecha_creacion DESC);
CREATE INDEX ix_cola_operacion
    ON public.cola_sincronizacion (operacion_id);
CREATE INDEX ix_historial_terminal_fecha
    ON public.historial_cambios (terminal, fecha DESC, id DESC);
CREATE INDEX ix_historial_sincronizacion
    ON public.historial_cambios (sincronizacion_id)
    WHERE sincronizacion_id IS NOT NULL;
CREATE INDEX ix_sincronizaciones_fecha
    ON public.sincronizaciones (fecha_inicio DESC);
CREATE INDEX ix_sincronizaciones_hash_completado
    ON public.sincronizaciones (archivo_hash)
    WHERE estado = 'COMPLETADA';
CREATE INDEX ix_conflictos_abiertos
    ON public.conflictos_sincronizacion (terminal, fecha_deteccion DESC)
    WHERE estado = 'ABIERTO';

COMMIT;
