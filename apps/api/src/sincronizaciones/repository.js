const UNRESOLVED_QUEUE_STATES = ['PENDIENTE', 'ENVIADO', 'ERROR', 'CONFLICTO', 'INCIERTO'];

async function createAttempt(pool, { hash = null, total = 0, estado = 'EN_PROCESO', detail = null }) {
  const result = await pool.query({
    text: `
      INSERT INTO public.sincronizaciones
        (archivo_hash, total_registros, estado, detalle_error, fecha_fin)
      VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'EN_PROCESO' THEN NULL ELSE now() END)
      RETURNING id
    `,
    values: [hash, total, estado, detail]
  });
  return result.rows[0].id;
}

async function finishAttempt(queryable, id, estado, counters, detail = null) {
  await queryable.query({
    text: `
      UPDATE public.sincronizaciones
      SET fecha_fin = now(),
          total_registros = $2,
          insertados = $3,
          actualizados = $4,
          sin_cambios = $5,
          inactivados = $6,
          reactivados = $7,
          conflictos = $8,
          estado = $9,
          detalle_error = $10
      WHERE id = $1
    `,
    values: [
      id,
      counters.total_registros,
      counters.insertados,
      counters.actualizados,
      counters.sin_cambios,
      counters.inactivados,
      counters.reactivados,
      counters.conflictos,
      estado,
      detail
    ]
  });
}

async function getExistingTerminals(client) {
  const result = await client.query(`
    SELECT terminal, datos_excel, activa, version
    FROM public.terminales
    FOR UPDATE
  `);
  return result.rows;
}

async function applyActions(client, actions) {
  for (const action of actions) {
    if (action.type === 'insert') {
      await client.query({
        text: `
          INSERT INTO public.terminales
            (terminal, datos_excel, activa, fecha_ultima_sincronizacion)
          VALUES ($1, $2::jsonb, true, now())
        `,
        values: [action.record.terminal, JSON.stringify(action.record.datos_excel)]
      });
    } else if (action.type === 'update') {
      await client.query({
        text: `
          UPDATE public.terminales
          SET datos_excel = $2::jsonb,
              activa = true,
              version = version + 1,
              fecha_actualizacion = now(),
              fecha_ultima_sincronizacion = now()
          WHERE terminal = $1
        `,
        values: [action.record.terminal, JSON.stringify(action.record.datos_excel)]
      });
    } else if (action.type === 'unchanged') {
      await client.query({
        text: `
          UPDATE public.terminales
          SET fecha_ultima_sincronizacion = now()
          WHERE terminal = $1
        `,
        values: [action.record.terminal]
      });
    } else if (action.type === 'deactivate') {
      await client.query({
        text: `
          UPDATE public.terminales
          SET activa = false,
              version = version + 1,
              fecha_actualizacion = now(),
              fecha_ultima_sincronizacion = now()
          WHERE terminal = $1
        `,
        values: [action.record.terminal]
      });
    }
  }
}

async function insertHistory(client, synchronizationId, entries) {
  const chunkSize = 1000;
  for (let start = 0; start < entries.length; start += chunkSize) {
    const chunk = entries.slice(start, start + chunkSize).map((entry) => ({
      ...entry,
      sincronizacion_id: synchronizationId
    }));
    await client.query({
      text: `
        INSERT INTO public.historial_cambios
          (terminal, campo, valor_anterior, valor_anterior_presente,
           valor_nuevo, valor_nuevo_presente, origen, sincronizacion_id)
        SELECT terminal, campo, valor_anterior, valor_anterior_presente,
               valor_nuevo, valor_nuevo_presente, origen, sincronizacion_id
        FROM jsonb_to_recordset($1::jsonb) AS x(
          terminal text,
          campo text,
          valor_anterior jsonb,
          valor_anterior_presente boolean,
          valor_nuevo jsonb,
          valor_nuevo_presente boolean,
          origen text,
          sincronizacion_id bigint
        )
      `,
      values: [JSON.stringify(chunk)]
    });
  }
}

async function getLatestUnresolvedQueue(client) {
  const result = await client.query({
    text: `
      SELECT c.*
      FROM public.cola_sincronizacion AS c
      JOIN (
        SELECT terminal, campo, max(revision) AS revision
        FROM public.cola_sincronizacion
        WHERE estado = ANY($1::text[])
        GROUP BY terminal, campo
      ) AS latest
        ON latest.terminal = c.terminal
       AND latest.campo = c.campo
       AND latest.revision = c.revision
      FOR UPDATE OF c
    `,
    values: [UNRESOLVED_QUEUE_STATES]
  });
  return result.rows;
}

async function confirmQueueEntry(client, queueId) {
  await client.query({
    text: `
      UPDATE public.cola_sincronizacion
      SET estado = 'CONFIRMADO', fecha_confirmacion = now(), ultimo_error = NULL
      WHERE id = $1
    `,
    values: [queueId]
  });
}

async function createConflict(client, synchronizationId, queueEntry, excelValue, excelPresent) {
  const result = await client.query({
    text: `
      INSERT INTO public.conflictos_sincronizacion
        (terminal, campo, cola_id, sincronizacion_id,
         valor_excel, valor_excel_presente, valor_pwa, valor_pwa_presente)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
      ON CONFLICT (cola_id) WHERE estado = 'ABIERTO' DO NOTHING
      RETURNING id
    `,
    values: [
      queueEntry.terminal,
      queueEntry.campo,
      queueEntry.id,
      synchronizationId,
      JSON.stringify(excelValue),
      excelPresent,
      JSON.stringify(queueEntry.valor_nuevo),
      queueEntry.valor_nuevo_presente
    ]
  });
  if (result.rowCount > 0) {
    await client.query({
      text: `UPDATE public.cola_sincronizacion SET estado = 'CONFLICTO' WHERE id = $1`,
      values: [queueEntry.id]
    });
  }
  return result.rowCount > 0;
}

async function listSynchronizations(pool, { pagina, limite }) {
  const offset = (pagina - 1) * limite;
  const result = await pool.query({
    text: `
      SELECT s.*, COUNT(*) OVER() AS total_count
      FROM public.sincronizaciones AS s
      ORDER BY s.fecha_inicio DESC, s.id DESC
      OFFSET $1 LIMIT $2
    `,
    values: [offset, limite]
  });
  const total = result.rows.length === 0 ? 0 : Number(result.rows[0].total_count);
  return {
    datos: result.rows.map(({ total_count, ...row }) => row),
    total
  };
}

async function getSynchronization(pool, id) {
  const result = await pool.query({
    text: `SELECT * FROM public.sincronizaciones WHERE id = $1`,
    values: [id]
  });
  return result.rows[0] || null;
}

module.exports = {
  applyActions,
  confirmQueueEntry,
  createAttempt,
  createConflict,
  finishAttempt,
  getExistingTerminals,
  getLatestUnresolvedQueue,
  getSynchronization,
  insertHistory,
  listSynchronizations
};
