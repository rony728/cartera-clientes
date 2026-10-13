async function getTerminal(pool, terminal) {
  const result = await pool.query({
    text: 'SELECT terminal, activa FROM public.terminales WHERE terminal = $1',
    values: [terminal]
  });
  return result.rows[0] || null;
}

async function getPhoto(pool, terminal) {
  const result = await pool.query({
    text: `SELECT contenido, mime_type, tamano_bytes, ancho, alto,
                  fecha_creacion, fecha_actualizacion
           FROM public.fotografias_comercios
           WHERE terminal = $1`,
    values: [terminal]
  });
  return result.rows[0] || null;
}

async function createPhoto(pool, input) {
  const result = await pool.query({
    text: `INSERT INTO public.fotografias_comercios
             (terminal, contenido, mime_type, tamano_bytes, ancho, alto, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (terminal) DO NOTHING
           RETURNING terminal, mime_type, tamano_bytes, ancho, alto, fecha_creacion, fecha_actualizacion`,
    values: [input.terminal, input.content, input.mimeType, input.size, input.width, input.height, input.userId]
  });
  return result.rows[0] || null;
}

async function replacePhoto(pool, input) {
  const result = await pool.query({
    text: `INSERT INTO public.fotografias_comercios
             (terminal, contenido, mime_type, tamano_bytes, ancho, alto, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (terminal) DO UPDATE SET
             contenido = EXCLUDED.contenido,
             mime_type = EXCLUDED.mime_type,
             tamano_bytes = EXCLUDED.tamano_bytes,
             ancho = EXCLUDED.ancho,
             alto = EXCLUDED.alto,
             fecha_actualizacion = now(),
             usuario_id = EXCLUDED.usuario_id
           RETURNING terminal, mime_type, tamano_bytes, ancho, alto, fecha_creacion, fecha_actualizacion`,
    values: [input.terminal, input.content, input.mimeType, input.size, input.width, input.height, input.userId]
  });
  return result.rows[0];
}

module.exports = { createPhoto, getPhoto, getTerminal, replacePhoto };
