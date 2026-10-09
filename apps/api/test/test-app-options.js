function testSessionMiddleware(req, _res, next) {
  req.session = {
    user: { id: '1' },
    csrfToken: 'test-csrf-token',
    destroy(callback) { callback(); },
    regenerate(callback) { callback(); },
    save(callback) { callback(); }
  };
  next();
}

function authorizationFor(role = 'ADMIN') {
  return {
    requireAuth(req, _res, next) {
      req.user = { id: '1', nombre: 'Prueba', usuario: 'prueba', rol: role, activo: true };
      next();
    },
    requireAdmin(req, res, next) {
      if (req.user?.rol !== 'ADMIN') {
        return res.status(403).json({ ok: false, mensaje: 'Acceso denegado' });
      }
      return next();
    }
  };
}

function baseAppOptions(role = 'ADMIN') {
  return { sessionMiddleware: testSessionMiddleware, authorization: authorizationFor(role) };
}

module.exports = { authorizationFor, baseAppOptions, testSessionMiddleware };
