-- Cartera de Clientes | migración 004
-- Fotografías internas optimizadas por terminal. No participa en sincronización con Excel.
-- Revisar y ejecutar posteriormente en Ubuntu; esta migración no se ejecuta automáticamente.

BEGIN;

CREATE TABLE public.fotografias_comercios (
    terminal text PRIMARY KEY REFERENCES public.terminales(terminal) ON DELETE RESTRICT,
    contenido bytea NOT NULL,
    mime_type text NOT NULL CHECK (mime_type = 'image/webp'),
    tamano_bytes integer NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 2097152),
    ancho integer NOT NULL CHECK (ancho > 0 AND ancho <= 1600),
    alto integer NOT NULL CHECK (alto > 0 AND alto <= 1600),
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    usuario_id bigint REFERENCES public.usuarios(id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.fotografias_comercios IS
    'Fotografía interna optimizada de cada terminal; excluida de Excel, snapshots y protocolo V2.';
COMMENT ON COLUMN public.fotografias_comercios.contenido IS
    'Imagen WebP optimizada. BYTEA mantiene persistencia y backup atómicos sin rutas locales.';

COMMIT;
