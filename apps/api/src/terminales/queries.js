const JSON_FIELD_SQL = Object.freeze({
  NombreComercial: "t.datos_excel->>'NombreComercial'",
  CodigoComercio: "t.datos_excel->>'CodigoComercio'",
  Inventario: "t.datos_excel->>'Inventario'",
  SeriePOS: "t.datos_excel->>'SeriePOS'"
});

const SEARCH_FIELD_SQL = Object.freeze({
  terminal: 't.terminal',
  ...JSON_FIELD_SQL
});

function escapeLike(value) {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function getSearchExpressions(campo) {
  if (campo === 'todos') {
    return Object.values(SEARCH_FIELD_SQL);
  }
  return [SEARCH_FIELD_SQL[campo]];
}

function getStateCondition(estado) {
  if (estado === 'activas') return 't.activa = true';
  if (estado === 'inactivas') return 't.activa = false';
  return 'TRUE';
}

function buildSearchQuery(filters) {
  const offset = (filters.pagina - 1) * filters.limite;
  const conditions = [getStateCondition(filters.estado)];
  const values = [];

  if (filters.q !== null) {
    values.push(filters.q, escapeLike(filters.q));
    const expressions = getSearchExpressions(filters.campo);
    conditions.push(`(${expressions.map((expression) => `${expression} ILIKE '%' || $2 || '%' ESCAPE '\\'`).join(' OR ')})`);
  }

  const offsetIndex = values.length + 1;
  const limitIndex = values.length + 2;
  values.push(offset, filters.limite);

  const orderBy = filters.q === null
    ? 't.terminal ASC'
    : "CASE WHEN t.terminal = $1 THEN 0 WHEN t.terminal ILIKE $2 || '%' ESCAPE '\\' THEN 1 ELSE 2 END, t.terminal ASC";

  const text = `
    SELECT
      t.terminal,
      t.datos_excel,
      t.activa,
      t.version,
      t.fecha_creacion,
      t.fecha_actualizacion,
      t.fecha_ultima_sincronizacion,
      COUNT(*) OVER() AS total_count
    FROM public.terminales AS t
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    OFFSET $${offsetIndex}
    LIMIT $${limitIndex}
  `;

  return { text, values };
}

function mapTerminal(row) {
  return {
    terminal: row.terminal,
    activa: row.activa,
    version: row.version,
    fecha_creacion: row.fecha_creacion,
    fecha_actualizacion: row.fecha_actualizacion,
    fecha_ultima_sincronizacion: row.fecha_ultima_sincronizacion,
    datos_excel: row.datos_excel
  };
}

async function searchTerminales(pool, filters) {
  const result = await pool.query(buildSearchQuery(filters));
  const total = result.rows.length === 0 ? 0 : Number(result.rows[0].total_count);
  return { datos: result.rows.map(mapTerminal), total };
}

async function findTerminal(pool, terminal) {
  const result = await pool.query({
    text: `
      SELECT
        t.terminal,
        t.datos_excel,
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
