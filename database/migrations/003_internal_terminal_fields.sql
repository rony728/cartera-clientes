BEGIN;

ALTER TABLE public.terminales
    ADD COLUMN ubicacion_interna text,
    ADD COLUMN referencia_interna text;

COMMENT ON COLUMN public.terminales.ubicacion_interna IS
    'Ubicación operativa interna de la terminal; no se sincroniza con Excel.';
COMMENT ON COLUMN public.terminales.referencia_interna IS
    'Referencia operativa interna de la terminal; no se sincroniza con Excel.';

COMMIT;
