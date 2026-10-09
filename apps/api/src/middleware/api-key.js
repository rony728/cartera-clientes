function createApiKeyMiddleware(apiKey) {
  return (req, res, next) => {
    if (req.get('X-API-Key') !== apiKey) {
      return res.status(401).json({ ok: false, mensaje: 'No autorizado' });
    }
    return next();
  };
}

module.exports = { createApiKeyMiddleware };
