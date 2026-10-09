const crypto = require('node:crypto');
const express = require('express');
const { createCsrfToken, csrfProtection, ensureCsrfToken } = require('./csrf');
const { hashPassword, validatePassword, verifyPassword } = require('./password');

const DUMMY_PASSWORD_HASH = hashPassword('No-es-una-contraseña-real-123!');

function safeUser(user) {
  return {
    id: user.id,
    nombre: user.nombre,
    usuario: user.usuario,
    rol: user.rol,
    autenticado: true
  };
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (
    error ? reject(error) : resolve()
  )));
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => (
    error ? reject(error) : resolve()
  )));
}

function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy((error) => (
    error ? reject(error) : resolve()
  )));
}

function loginKey(usuario, ip) {
  return crypto.createHash('sha256').update(`${usuario.toLowerCase()}\0${ip}`).digest('hex');
}

function validLoginBody(body) {
  return body
    && typeof body.usuario === 'string'
    && body.usuario.trim().length >= 1
    && body.usuario.trim().length <= 64
    && typeof body.password === 'string'
    && body.password.length >= 1
    && body.password.length <= 128;
}

function createAuthRouter({ pool, users, requireAuth, loginLimits, cookieName }) {
  const router = express.Router();

  router.get('/csrf', (req, res) => {
    return res.status(200).json({ csrf_token: ensureCsrfToken(req) });
  });

  router.post('/login', csrfProtection, async (req, res, next) => {
    if (!validLoginBody(req.body)) {
      return res.status(400).json({ ok: false, mensaje: 'Solicitud de inicio de sesión inválida.' });
    }

    const usuario = req.body.usuario.trim().toLowerCase();
    const keyHash = loginKey(usuario, req.ip);
    try {
      const attempt = await users.getLoginAttempt(pool, keyHash);
      if (attempt?.blocked_until && new Date(attempt.blocked_until) > new Date()) {
        return res.status(429).json({ ok: false, mensaje: 'Demasiados intentos. Inténtalo más tarde.' });
      }

      const user = await users.findUserByUsername(pool, usuario);
      const validPassword = user
        ? await verifyPassword(user.password_hash, req.body.password)
        : await verifyPassword(await DUMMY_PASSWORD_HASH, req.body.password);

      if (!user || !user.activo || !validPassword) {
        await users.registerLoginFailure(pool, keyHash, loginLimits);
        return res.status(401).json({ ok: false, mensaje: 'Credenciales inválidas.' });
      }

      await users.clearLoginFailures(pool, keyHash);
      await users.updateLastAccess(pool, user.id);
      await regenerateSession(req);
      req.session.user = { id: String(user.id) };
      req.session.csrfToken = createCsrfToken();
      await saveSession(req);
      return res.status(200).json({
        ok: true,
        usuario: safeUser(user),
        csrf_token: req.session.csrfToken
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', requireAuth, csrfProtection, async (req, res, next) => {
    try {
      await destroySession(req);
      res.clearCookie(cookieName, { path: '/' });
      return res.status(200).json({ ok: true, mensaje: 'Sesión cerrada.' });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/password', requireAuth, csrfProtection, async (req, res, next) => {
    const currentPassword = req.body?.password_actual;
    const newPassword = req.body?.password_nueva;
    if (typeof currentPassword !== 'string' || !validatePassword(newPassword)) {
      return res.status(400).json({ ok: false, mensaje: 'Datos de contraseña inválidos.' });
    }
    try {
      const user = await users.findUserByUsername(pool, req.user.usuario);
      if (!user || !await verifyPassword(user.password_hash, currentPassword)) {
        return res.status(401).json({ ok: false, mensaje: 'La contraseña actual no es correcta.' });
      }
      await users.resetUserPassword(pool, req.user.id, await hashPassword(newPassword));
      await destroySession(req);
      res.clearCookie(cookieName, { path: '/' });
      return res.status(200).json({ ok: true, mensaje: 'Contraseña actualizada. Inicia sesión nuevamente.' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', requireAuth, (req, res) => {
    return res.status(200).json(safeUser(req.user));
  });

  return router;
}

module.exports = { createAuthRouter, safeUser };
