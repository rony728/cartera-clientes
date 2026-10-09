function createAuthorization({ pool, users }) {
  async function requireAuth(req, res, next) {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ ok: false, mensaje: 'No autenticado' });
    try {
      const user = await users.findUserById(pool, userId);
      if (!user || !user.activo) {
        req.session.destroy(() => {});
        return res.status(401).json({ ok: false, mensaje: 'No autenticado' });
      }
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireAdmin(req, res, next) {
    if (!req.user || req.user.rol !== 'ADMIN') {
      return res.status(403).json({ ok: false, mensaje: 'Acceso denegado' });
    }
    return next();
  }

  return { requireAdmin, requireAuth };
}

module.exports = { createAuthorization };
