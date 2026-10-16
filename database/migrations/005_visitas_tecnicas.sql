BEGIN;

CREATE TABLE public.importaciones_visitas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inicio timestamptz NOT NULL DEFAULT now(),
  fin timestamptz,
  resultado text NOT NULL CHECK (resultado IN ('PROCESANDO','COMPLETADA','SIN_CAMBIOS','ERROR')),
  detalle text,
  reportes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.visitas_reportes (
  fuente text PRIMARY KEY CHECK (fuente IN ('historico','mensual')),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  cantidad integer NOT NULL CHECK (cantidad >= 0),
  recibido timestamptz NOT NULL,
  procesado timestamptz NOT NULL,
  importado timestamptz NOT NULL DEFAULT now(),
  importacion_id bigint NOT NULL REFERENCES public.importaciones_visitas(id)
);
-- Sin FK a terminales: conservar visitas fuera de cartera y terminales inactivas.
CREATE TABLE public.visitas_fuentes (
  fuente text NOT NULL CHECK (fuente IN ('historico','mensual')),
  id bigint NOT NULL CHECK (id > 0),
  terminal text NOT NULL CHECK (btrim(terminal) <> ''),
  fecha timestamptz NOT NULL,
  tecnico text NOT NULL,
  tipo_visita text NOT NULL,
  modificado timestamptz,
  recibido timestamptz NOT NULL,
  datos jsonb NOT NULL CHECK (jsonb_typeof(datos) = 'object'),
  importacion_id bigint NOT NULL REFERENCES public.importaciones_visitas(id),
  PRIMARY KEY (fuente, id)
);
CREATE INDEX ix_visitas_resolucion ON public.visitas_fuentes
  (id, modificado DESC NULLS LAST, recibido DESC, fuente DESC);
CREATE INDEX ix_visitas_terminal_fecha ON public.visitas_fuentes (terminal, fecha DESC);
CREATE INDEX ix_visitas_tecnico_fecha ON public.visitas_fuentes (tecnico, fecha);
CREATE INDEX ix_visitas_fecha ON public.visitas_fuentes (fecha);
CREATE INDEX ix_importaciones_visitas_inicio ON public.importaciones_visitas (inicio DESC);

-- Una sola visita lógica por ID. Mayor Modified, luego recepción; empate: mensual.
CREATE VIEW public.visitas_tecnicas AS
  SELECT DISTINCT ON (id) id, terminal, fecha, tecnico, tipo_visita, datos,
    fuente, modificado, recibido, importacion_id
  FROM public.visitas_fuentes
  ORDER BY id, modificado DESC NULLS LAST, recibido DESC, fuente DESC;

COMMIT;
