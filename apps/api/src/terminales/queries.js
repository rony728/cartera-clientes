const { MONTH_END } = require('../visitas/queries');
const { FILTER_FIELDS, PWA_INTERNAL_FIELD_SET, SEARCH_FIELDS } = require('./fields');

function escapeLike(value) {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function getStateCondition(estado) {
  if (estado === 'activas') return 't.activa = true';
  if (estado === 'inactivas') return 't.activa = false';
  return 'TRUE';
}

function buildSearchQuery(filters, visitasEnabled = false) {
  const offset = (filters.pagina - 1) * filters.limite;
  const conditions = [getStateCondition(filters.estado)];
  const values = [];

  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.q !== null) {
    const pattern = addValue(escapeLike(filters.q));
    if (filters.campo === 'todos') {
      conditions.push(`(t.terminal ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        OR t.ubicacion_interna ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        OR t.referencia_interna ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM jsonb_each_text(t.datos_excel) AS property
          WHERE property.value ILIKE '%' || ${pattern} || '%' ESCAPE '\\'
        ))`);
    } else if (filters.campo === 'terminal') {
      conditions.push(`t.terminal ILIKE '%' || ${pattern} || '%' ESCAPE '\\'`);
    } else if (PWA_INTERNAL_FIELD_SET.has(filters.campo)) {
      const column = filters.campo === 'ubicacion_interna'
        ? 't.ubicacion_interna'
        : 't.referencia_interna';
      conditions.push(`${column} ILIKE '%' || ${pattern} || '%' ESCAPE '\\'`);
    } else {
      const key = addValue(filters.campo);
      conditions.push(`(t.datos_excel ->> ${key}) ILIKE '%' || ${pattern} || '%' ESCAPE '\\'`);
    }
  }

  for (const [field, value] of Object.entries(filters.filtros || {})) {
    if (!FILTER_FIELDS.includes(field)) continue;
    const key = addValue(field);
    const filterValue = addValue(value);
    conditions.push(`(t.datos_excel ->> ${key}) = ${filterValue}`);
  }

  const sortExpression = filters.orden === 'Terminal'
    ? 't.terminal'
    : `(t.datos_excel ->> ${addValue(filters.orden)})`;

  const offsetParam = addValue(offset);
  const limitParam = addValue(filters.limite);
  const direction = filters.direccion === 'desc' ? 'DESC' : 'ASC';

  const text = `
    SELECT
      t.terminal,
      t.datos_excel,
      t.ubicacion_interna,
      t.referencia_interna,
      t.activa,
      t.version,
      t.fecha_creacion,
      t.fecha_actualizacion,
      t.fecha_ultima_sincronizacion,
      ${visitasEnabled ? 'uv.ultima_visita,' : ''}
      COUNT(*) OVER() AS total_count
    FROM public.terminales AS t
    ${visitasEnabled ? `LEFT JOIN (
      SELECT terminal, MAX(fecha) AS ultima_visita FROM public.visitas_tecnicas
      WHERE fecha < ${MONTH_END} GROUP BY terminal
    ) uv ON uv.terminal=t.terminal AND t.activa` : ''}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${sortExpression} ${direction} NULLS LAST, t.terminal ASC
    OFFSET ${offsetParam}
    LIMIT ${limitParam}
  `;

  return { text, values };
}

function mapTerminal(row) {
  return {
    ...(Object.hasOwn(row, 'ultima_visita') ? { ultima_visita: row.ultima_visita } : {}),
    terminal: row.terminal,
    activa: row.activa,
    version: row.version,
    fecha_creacion: row.fecha_creacion,
    fecha_actualizacion: row.fecha_actualizacion,
    fecha_ultima_sincronizacion: row.fecha_ultima_sincronizacion,
    ubicacion_interna: row.ubicacion_interna,
    referencia_interna: row.referencia_interna,
    datos_excel: row.datos_excel
  };
}

async function searchTerminales(pool, filters, visitasEnabled = false) {
  const result = await pool.query(buildSearchQuery(filters, visitasEnabled));
  const total = result.rows.length === 0 ? 0 : Number(result.rows[0].total_count);
  return { datos: result.rows.map(mapTerminal), total };
}

async function findTerminal(pool, terminal) {
  const result = await pool.query({
    text: `
      SELECT
        t.terminal,
        t.datos_excel,
        t.ubicacion_interna,
        t.referencia_interna,
        t.activa,
        t.version,
        t.fecha_creacion,
        t.fecha_actualizacion,
        t.fecha_ultima_sincronizacion
      FROM public.terminales AS t
      WHERE t.terminal = $1
    `,
    values: [terminal]
  });
  return result.rows.length === 0 ? null : mapTerminal(result.rows[0]);
}

module.exports = { buildSearchQuery, findTerminal, searchTerminales };
