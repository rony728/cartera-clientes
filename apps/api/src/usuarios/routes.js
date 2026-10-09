const express = require('express');
const { hashPassword, validatePassword } = require('../auth/password');

const ROLES = new Set(['ADMIN', 'USUARIO']);

function parseId(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validIdentity(nombre, usuario) {
  return typeof nombre === 'string' && nombre.trim().length >= 1 && nombre.trim().length <= 120
    && typeof usuario === 'string' && /^[A-Za-z0-9._-]{3,64}$/u.test(usuario);
}

function sendUserError(res, error) {
  if (error.code === '23505') {
    return res.status(409).json({ ok: false, mensaje: 'El usuario ya existe.' });
  }
  if (error.code === 'LAST_ADMIN' || error.code === 'SELF_DEACTIVATION') {
    return res.status(409).json({ ok: false, mensaje: error.message });
  }
  console.error(`Error administrando usuarios: ${error.name || 'Error'}`);
  return res.status(500).json({ ok: false, mensaje: 'No se pudo completar la operación.' });
}

function createUsersRouter({ pool, users, csrfProtection }) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      return res.status(200).json({ datos: await users.listUsers(pool) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', csrfProtection, async (req, res) => {
    const { nombre, usuario, password, rol } = req.body || {};
    if (!validIdentity(nombre, usuario) || !ROLES.has(rol) || !validatePassword(password)) {
      return res.status(400).json({ ok: false, mensaje: 'Datos de usuario inválidos.' });
    }
    try {
      const created = await users.createUser(pool, {
        nombre: nombre.trim(),
        usuario: usuario.toLowerCase(),
        passwordHash: await hashPassword(password),
        rol
      });
      return res.status(201).json(created);
    } catch (error) {
      return sendUserError(res, error);
    }
  });

  router.patch('/:id', csrfProtection, async (req, res) => {
    const id = parseId(req.params.id);
    const { nombre, rol } = req.body || {};
    if (!id || typeof nombre !== 'string' || nombre.trim().length < 1
        || nombre.trim().length > 120 || !ROLES.has(rol)) {
      return res.status(400).json({ ok: false, mensaje: 'Datos de usuario inválidos.' });
    }
    try {
      const updated = await users.updateUser(pool, id, { nombre: nombre.trim(), rol });
      if (!updated) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
      return res.status(200).json(updated);
    } catch (error) {
      return sendUserError(res, error);
    }
  });

  router.patch('/:id/estado', csrfProtection, async (req, res) => {
    const id = parseId(req.params.id);
    const { activo } = req.body || {};
    if (!id || typeof activo !== 'boolean') {
      return res.status(400).json({ ok: false, mensaje: 'Estado de usuario inválido.' });
    }
    try {
      const updated = await users.setUserActive(pool, id, activo, req.user.id);
      if (!updated) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
      return res.status(200).json(updated);
    } catch (error) {
      return sendUserError(res, error);
    }
  });

  router.post('/:id/password', csrfProtection, async (req, res) => {
    const id = parseId(req.params.id);
    const { password } = req.body || {};
    if (!id || !validatePassword(password)) {
      return res.status(400).json({ ok: false, mensaje: 'Contraseña inválida.' });
    }
    try {
      const updated = await users.resetUserPassword(pool, id, await hashPassword(password));
      if (!updated) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
      return res.status(200).json({ ok: true, mensaje: 'Contraseña restablecida.' });
    } catch (error) {
      return sendUserError(res, error);
    }
  });

  return router;
}

module.exports = { createUsersRouter };
