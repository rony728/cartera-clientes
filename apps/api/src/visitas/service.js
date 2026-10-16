const { FUENTES, ReportError, readReportes } = require('./reportes');

async function importVisitas({ pool, config, readFn = readReportes }) {
  const attempt = await pool.query(`INSERT INTO public.importaciones_visitas(resultado)
    VALUES ('PROCESANDO') RETURNING id`);
  const id = attempt.rows[0].id;
  let client;
  try {
    // Leer y validar ambos antes de modificar registros de visitas.
    const reports = await readFn(config);
    const metadata = Object.fromEntries(FUENTES.map((source) => [source, {
      hash: reports[source].hash, cantidad: reports[source].records.length,
      recibido: reports[source].recibido, procesado: reports[source].procesado
    }]));
    client = await pool.connect();
    await client.query('BEGIN');
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('cartera-clientes:visitas')) AS acquired");
    if (!lock.rows[0].acquired) throw new ReportError('IMPORTACION_EN_CURSO');
    const current = await client.query('SELECT * FROM public.visitas_reportes');
    let changed = false;
    for (const source of FUENTES) {
      const report = reports[source];
      const previous = current.rows.find((row) => row.fuente === source);
      if (previous && new Date(previous.recibido) > new Date(report.recibido)) {
        throw new ReportError('REPORTE_ANTIGUO');
      }
      if (!previous || previous.hash !== report.hash) {
        changed = true;
        // Un solo INSERT por fuente; filas ausentes se conservan.
        const payload = report.records.map((row) => ({ ...row, fuente: source, recibido: report.recibido }));
        await client.query({ text: `INSERT INTO public.visitas_fuentes
          (fuente,id,terminal,fecha,tecnico,tipo_visita,modificado,recibido,datos,importacion_id)
          SELECT fuente,id,terminal,fecha,tecnico,tipo,modificado,recibido,datos,$2
          FROM jsonb_to_recordset($1::jsonb) AS r(fuente text,id bigint,terminal text,
            fecha timestamptz,tecnico text,tipo text,modificado timestamptz,recibido timestamptz,datos jsonb)
          ON CONFLICT (fuente,id) DO UPDATE SET terminal=EXCLUDED.terminal, fecha=EXCLUDED.fecha,
            tecnico=EXCLUDED.tecnico,tipo_visita=EXCLUDED.tipo_visita,modificado=EXCLUDED.modificado,
            recibido=EXCLUDED.recibido,datos=EXCLUDED.datos,importacion_id=EXCLUDED.importacion_id
          WHERE (COALESCE(EXCLUDED.modificado,'-infinity'::timestamptz),EXCLUDED.recibido)
             >= (COALESCE(visitas_fuentes.modificado,'-infinity'::timestamptz),visitas_fuentes.recibido)`,
        values: [JSON.stringify(payload), id] });
      }
      if (previous && previous.hash === report.hash
          && +new Date(previous.recibido) !== +new Date(report.recibido)) {
        // Misma carga, nueva recepción: actualizar solo la procedencia para desempates.
        await client.query({ text: 'UPDATE public.visitas_fuentes SET recibido=$2 WHERE fuente=$1 AND id=ANY($3::bigint[])',
          values: [source, report.recibido, report.records.map((row) => row.id)] });
      }
      // También registrar recepción nueva de contenido idéntico, sin reprocesar filas.
      if (!previous || previous.hash !== report.hash || +new Date(previous.recibido) !== +new Date(report.recibido)) {
        await client.query({ text: `INSERT INTO public.visitas_reportes
          (fuente,hash,cantidad,recibido,procesado,importacion_id)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(fuente) DO UPDATE SET
          hash=EXCLUDED.hash,cantidad=EXCLUDED.cantidad,recibido=EXCLUDED.recibido,
          procesado=EXCLUDED.procesado,importado=now(),importacion_id=EXCLUDED.importacion_id`,
        values: [source, report.hash, report.records.length, report.recibido, report.procesado, id] });
      }
    }
    const estado = changed ? 'COMPLETADA' : 'SIN_CAMBIOS';
    await client.query({ text: `UPDATE public.importaciones_visitas SET fin=now(),resultado=$2,reportes=$3::jsonb WHERE id=$1`,
      values: [id, estado, JSON.stringify(metadata)] });
    await client.query('COMMIT');
    return { id, estado, reportes: metadata };
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    const code = error instanceof ReportError ? error.code : 'IMPORTACION_FALLIDA';
    await pool.query({ text: `UPDATE public.importaciones_visitas SET fin=now(),resultado='ERROR',detalle=$2 WHERE id=$1`, values: [id, code] });
    throw new ReportError(code);
  } finally { if (client) client.release(); }
}
module.exports = { importVisitas };
