async function findUserByUsername(pool, usuario) {
  const result = await pool.query({
    text: `
      SELECT id, nombre, usuario, password_hash, rol, activo, fecha_creacion, ultimo_acceso
      FROM public.usuarios
      WHERE lower(usuario) = lower($1)
    `,
    values: [usuario]
  });
  return result.rows[0] || null;
}

async function findUserById(pool, id) {
  const result = await pool.query({
    text: `
      SELECT id, nombre, usuario, rol, activo, fecha_creacion, ultimo_acceso
      FROM public.usuarios
      WHERE id = $1
    `,
    values: [id]
  });
  return result.rows[0] || null;
}

async function updateLastAccess(pool, id) {
  await pool.query({ text: 'UPDATE public.usuarios SET ultimo_acceso = now() WHERE id = $1', values: [id] });
}

async function getLoginAttempt(pool, keyHash) {
  const result = await pool.query({
    text: 'SELECT attempts, blocked_until FROM public.auth_login_attempts WHERE key_hash = $1',
    values: [keyHash]
  });
  return result.rows[0] || null;
}

async function registerLoginFailure(pool, keyHash, { maxAttempts, windowSeconds, blockSeconds }) {
  const result = await pool.query({
    text: `
      INSERT INTO public.auth_login_attempts (key_hash, attempts, window_start, blocked_until)
      VALUES ($1, 1, now(), NULL)
      ON CONFLICT (key_hash) DO UPDATE
      SET attempts = CASE
            WHEN auth_login_attempts.window_start < now() - make_interval(secs => $3)
              THEN 1
            ELSE auth_login_attempts.attempts + 1
          END,
          window_start = CASE
            WHEN auth_login_attempts.window_start < now() - make_interval(secs => $3)
              THEN now()
            ELSE auth_login_attempts.window_start
          END,
          blocked_until = CASE
            WHEN (CASE
              WHEN auth_login_attempts.window_start < now() - make_interval(secs => $3)
                THEN 1
              ELSE auth_login_attempts.attempts + 1
            END) >= $2
              THEN now() + make_interval(secs => $4)
            ELSE NULL
          END
      RETURNING attempts, blocked_until
    `,
    values: [keyHash, maxAttempts, windowSeconds, blockSeconds]
  });
  return result.rows[0];
}

async function clearLoginFailures(pool, keyHash) {
  await pool.query({ text: 'DELETE FROM public.auth_login_attempts WHERE key_hash = $1', values: [keyHash] });
}

async function listUsers(pool) {
  const result = await pool.query(`
    SELECT id, nombre, usuario, rol, activo, fecha_creacion, ultimo_acceso
    FROM public.usuarios
    ORDER BY usuario ASC
  `);
  return result.rows;
}

async function createUser(pool, { nombre, usuario, passwordHash, rol }) {
  const result = await pool.query({
    text: `
      INSERT INTO public.usuarios (nombre, usuario, password_hash, rol)
      VALUES ($1, $2, $3, $4)
      RETURNING id, nombre, usuario, rol, activo, fecha_creacion, ultimo_acceso
    `,
    values: [nombre, usuario, passwordHash, rol]
  });
  return result.rows[0];
}

async function lockActiveAdmins(client) {
  const result = await client.query(`
    SELECT id FROM public.usuarios
    WHERE rol = 'ADMIN' AND activo = true
    FOR UPDATE
  `);
  return result.rows;
}

async function updateUser(pool, id, { nombre, rol }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query({
      text: 'SELECT id, rol, activo FROM public.usuarios WHERE id = $1 FOR UPDATE',
      values: [id]
    });
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return null;
    }
    if (current.rol === 'ADMIN' && current.activo && rol !== 'ADMIN') {
      const admins = await lockActiveAdmins(client);
      if (admins.length <= 1) {
        const error = new Error('No se puede retirar el último administrador activo.');
        error.code = 'LAST_ADMIN';
        throw error;
      }
    }
    const result = await client.query({
      text: `
        UPDATE public.usuarios SET nombre = $2, rol = $3
        WHERE id = $1
        RETURNING id, nombre, usuario, rol, activo, fecha_creacion, ultimo_acceso
      `,
      values: [id, nombre, rol]
    });
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function invalidateUserSessions(queryable, userId) {
  await queryable.query({
    text: `DELETE FROM public.user_sessions WHERE sess->'user'->>'id' = $1`,
    values: [String(userId)]
  });
}

async function setUserActive(pool, id, active, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query({
      text: 'SELECT id, nombre, usuario, rol, activo, fecha_creacion, ultimo_acceso FROM public.usuarios WHERE id = $1 FOR UPDATE',
      values: [id]
    });
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return null;
    }
    if (!active && String(id) === String(actorId)) {
      const error = new Error('No puedes desactivar tu propia cuenta.');
      error.code = 'SELF_DEACTIVATION';
      throw error;
    }
    if (!active && current.rol === 'ADMIN' && current.activo) {
      const admins = await lockActiveAdmins(client);
      if (admins.length <= 1) {
        const error = new Error('No se puede desactivar el último administrador activo.');
        error.code = 'LAST_ADMIN';
        throw error;
      }
    }
    const result = await client.query({
      text: `
        UPDATE public.usuarios SET activo = $2
        WHERE id = $1
        RETURNING id, nombre, usuario, rol, activo, fecha_creacion, ultimo_acceso
      `,
      values: [id, active]
    });
    if (!active) await invalidateUserSessions(client, id);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resetUserPassword(pool, id, passwordHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query({
      text: `
        UPDATE public.usuarios SET password_hash = $2
        WHERE id = $1
        RETURNING id
      `,
      values: [id, passwordHash]
    });
    if (result.rows.length > 0) await invalidateUserSessions(client, id);
    await client.query('COMMIT');
    return result.rows.length > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createFirstAdmin(pool, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('cartera-clientes:first-admin'))");
    const existing = await client.query("SELECT id FROM public.usuarios WHERE rol = 'ADMIN' LIMIT 1");
    if (existing.rows.length > 0) {
      const error = new Error('Ya existe un administrador inicializado.');
      error.code = 'ADMIN_EXISTS';
      throw error;
    }
    const result = await client.query({
      text: `
        INSERT INTO public.usuarios (nombre, usuario, password_hash, rol)
        VALUES ($1, $2, $3, 'ADMIN')
        RETURNING id, nombre, usuario, rol, activo
      `,
      values: [user.nombre, user.usuario, user.passwordHash]
    });
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  clearLoginFailures,
  createFirstAdmin,
  createUser,
  findUserById,
  findUserByUsername,
  getLoginAttempt,
  invalidateUserSessions,
  listUsers,
  registerLoginFailure,
  resetUserPassword,
  setUserActive,
  updateLastAccess,
  updateUser
};
