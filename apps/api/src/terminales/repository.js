const crypto = require('node:crypto');
const { FILTER_FIELDS, INTERNAL_FIELDS } = require('./fields');

async function getFieldNames(pool, activeOnly) {
  const result = await pool.query({
    text: `SELECT DISTINCT field
      FROM public.terminales
      CROSS JOIN LATERAL jsonb_object_keys(datos_excel) AS field
      WHERE ($1::boolean = false OR activa = true)
        AND NOT (field = ANY($2::text[]))
      ORDER BY field LIMIT 500`,
    values: [activeOnly, [...INTERNAL_FIELDS]]
  });
  return result.rows.map((row) => row.field);
}

async function getFilterOptions(pool, activeOnly) {
  const result = await pool.query({
    text: `SELECT field, value FROM unnest($1::text[]) AS fields(field)
      CROSS JOIN LATERAL (
        SELECT DISTINCT datos_excel ->> field AS value FROM public.terminales
        WHERE ($2::boolean = false OR activa = true)
          AND NULLIF(btrim(datos_excel ->> field), '') IS NOT NULL
        ORDER BY value LIMIT 250
      ) values_by_field`,
    values: [FILTER_FIELDS, activeOnly]
  });
  return Object.fromEntries(FILTER_FIELDS.map((field) => [
    field,
    result.rows.filter((row) => row.field === field).map((row) => row.value)
  ]));
}

async function getDashboard(pool, activeOnly) {
  const counts = await pool.query({
    text: `SELECT
      count(*) FILTER (WHERE activa)::int AS activas,
      count(*) FILTER (WHERE NOT activa)::int AS inactivas,
      count(DISTINCT NULLIF(datos_excel->>'TecnicoAsignado', '')) FILTER (WHERE activa)::int AS tecnicos,
      count(DISTINCT NULLIF(datos_excel->>'Zona', '')) FILTER (WHERE activa)::int AS zonas,
      count(DISTINCT NULLIF(datos_excel->>'Ciudad', '')) FILTER (WHERE activa)::int AS ciudades,
      count(DISTINCT NULLIF(datos_excel->>'CategoriaComercio', '')) FILTER (WHERE activa)::int AS categorias
      FROM public.terminales`
  });
  const distributions = {};
  for (const field of [...FILTER_FIELDS, 'Modelo']) {
    const result = await pool.query({
      text: `SELECT datos_excel ->> $1 AS valor, count(*)::int AS total
        FROM public.terminales
        WHERE ($2::boolean = false OR activa = true)
          AND activa = true AND NULLIF(btrim(datos_excel ->> $1), '') IS NOT NULL
        GROUP BY datos_excel ->> $1 ORDER BY total DESC, valor ASC LIMIT 12`,
      values: [field, activeOnly]
    });
    distributions[field] = result.rows;
  }
  return {
    indicadores: {
      ...counts.rows[0],
      inactivas: activeOnly ? null : counts.rows[0].inactivas
    },
    distribuciones: distributions
  };
}

async function getHistory(pool, terminal, { pagina, limite }) {
  const offset = (pagina - 1) * limite;
  const result = await pool.query({
    text: `SELECT h.id, h.campo, h.valor_anterior, h.valor_anterior_presente,
      h.valor_nuevo, h.valor_nuevo_presente, h.origen, h.fecha,
      u.nombre AS responsable, c.estado AS estado_excel, count(*) OVER() AS total_count
      FROM public.historial_cambios h
      LEFT JOIN public.usuarios u ON u.id = h.usuario_id
      LEFT JOIN public.cola_sincronizacion c ON c.id = h.cola_id
      WHERE h.terminal = $1 ORDER BY h.fecha DESC, h.id DESC OFFSET $2 LIMIT $3`,
    values: [terminal, offset, limite]
  });
  return {
    datos: result.rows.map(({ total_count, ...row }) => row),
    total: result.rows.length ? Number(result.rows[0].total_count) : 0
  };
}

async function updateTerminal(pool, { terminal, version, changes, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query({
      text: `SELECT terminal, datos_excel, activa, version FROM public.terminales
        WHERE terminal = $1 FOR UPDATE`,
      values: [terminal]
    });
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { kind: 'not_found' };
    }
    if (!current.activa) {
      await client.query('ROLLBACK');
      return { kind: 'inactive', current };
    }
    if (String(current.version) !== String(version)) {
      await client.query('ROLLBACK');
      return { kind: 'conflict', current };
    }

    const effective = Object.entries(changes).filter(([field, value]) => (
      !Object.prototype.hasOwnProperty.call(current.datos_excel, field)
      || JSON.stringify(current.datos_excel[field]) !== JSON.stringify(value)
    ));
    if (effective.length === 0) {
      await client.query('COMMIT');
      return { kind: 'unchanged', terminal: current };
    }
    const operationId = crypto.randomUUID();
    const nextData = { ...current.datos_excel };
    const queue = [];
    for (const [field, value] of effective) {
      const oldPresent = Object.prototype.hasOwnProperty.call(current.datos_excel, field);
      const oldValue = oldPresent ? current.datos_excel[field] : null;
      nextData[field] = value;
      await client.query({
        text: `UPDATE public.cola_sincronizacion SET estado = 'SUPERADA'
          WHERE terminal = $1 AND campo = $2
            AND estado = ANY($3::text[])`,
        values: [terminal, field, ['PENDIENTE', 'ENVIADO', 'ERROR', 'CONFLICTO', 'INCIERTO']]
      });
      const queued = await client.query({
        text: `INSERT INTO public.cola_sincronizacion
          (operacion_id, terminal, campo, revision, valor_anterior, valor_anterior_presente,
           valor_nuevo, valor_nuevo_presente, estado, usuario_id)
          VALUES ($1, $2, $3,
            COALESCE((SELECT max(revision) + 1 FROM public.cola_sincronizacion WHERE terminal = $2 AND campo = $3), 1),
            $4::jsonb, $5, $6::jsonb, true, 'PENDIENTE', $7) RETURNING id, campo, estado`,
        values: [operationId, terminal, field, JSON.stringify(oldValue), oldPresent, JSON.stringify(value), userId]
      });
      const queueRow = queued.rows[0];
      queue.push(queueRow);
      await client.query({
        text: `INSERT INTO public.historial_cambios
          (terminal, campo, valor_anterior, valor_anterior_presente, valor_nuevo,
           valor_nuevo_presente, origen, usuario_id, cola_id)
          VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, true, 'PWA', $6, $7)`,
        values: [terminal, field, JSON.stringify(oldValue), oldPresent, JSON.stringify(value), userId, queueRow.id]
      });
    }
    const updated = await client.query({
      text: `UPDATE public.terminales SET datos_excel = $2::jsonb, version = version + 1,
        fecha_actualizacion = now() WHERE terminal = $1
        RETURNING terminal, datos_excel, activa, version, fecha_creacion,
          fecha_actualizacion, fecha_ultima_sincronizacion`,
      values: [terminal, JSON.stringify(nextData)]
    });
    await client.query('COMMIT');
    return { kind: 'updated', terminal: updated.rows[0], queue };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markQueue(pool, id, state, error = null) {
  await pool.query({
    text: `UPDATE public.cola_sincronizacion SET estado = $2,
      fecha_envio = CASE WHEN $2 = 'ENVIADO' THEN now() ELSE fecha_envio END,
      intentos = intentos + 1, ultimo_error = $3 WHERE id = $1`,
    values: [id, state, error]
  });
}

module.exports = { getDashboard, getFieldNames, getFilterOptions, getHistory, markQueue, updateTerminal };
