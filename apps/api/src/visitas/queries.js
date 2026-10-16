// PostgreSQL calcula los límites en la zona del negocio, independientemente del servidor.
const MONTH_START = `(date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Tegucigalpa') AT TIME ZONE 'America/Tegucigalpa')`;
const MONTH_END = `((date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Tegucigalpa') + interval '1 month') AT TIME ZONE 'America/Tegucigalpa')`;
const LAST_VISIT = `(SELECT MAX(v.fecha) FROM public.visitas_tecnicas v
  WHERE v.terminal=t.terminal AND t.activa AND v.fecha < ${MONTH_END})`;
async function ultima(pool, terminal, admin) {
  const result = await pool.query({ text: `SELECT t.terminal, ${LAST_VISIT} AS ultima_visita,
    EXISTS (SELECT 1 FROM public.visitas_tecnicas v WHERE v.terminal=t.terminal) AS tiene_visitas_registradas
    FROM public.terminales t WHERE t.terminal=$1 AND (t.activa OR $2::boolean)`, values: [terminal, admin] });
  return result.rows[0] || null;
}
async function estadisticas(pool) {
  const result = await pool.query(`SELECT ${MONTH_START} AS desde, ${MONTH_END} AS hasta,
    jsonb_agg(counts ORDER BY counts.tecnico) AS datos
    FROM (
      SELECT tech.tecnico, count(v.id)::int AS visitas
      FROM unnest(ARRAY['RTDOMINGUEZ','ERMEJIA']) AS tech(tecnico)
      LEFT JOIN public.visitas_tecnicas v ON v.tecnico=tech.tecnico
        AND v.fecha >= ${MONTH_START} AND v.fecha < ${MONTH_END}
      GROUP BY tech.tecnico
    ) counts`);
  return { zona_horaria: 'America/Tegucigalpa', ...result.rows[0] };
}
async function estado(pool) {
  const reports = await pool.query(`SELECT fuente,hash,cantidad,recibido,procesado,importado FROM public.visitas_reportes ORDER BY fuente`);
  const attempt = await pool.query(`SELECT inicio,fin,resultado,detalle FROM public.importaciones_visitas ORDER BY id DESC LIMIT 1`);
  return { reportes: ['historico','mensual'].map((fuente) => reports.rows.find((row) => row.fuente === fuente)
    || { fuente, importado: null }), ultimo_intento: attempt.rows[0] || null };
}
module.exports = { MONTH_START, MONTH_END, LAST_VISIT, ultima, estadisticas, estado };
