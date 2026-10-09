const crypto = require('node:crypto');

function createCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = createCsrfToken();
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  const expected = req.session?.csrfToken;
  const received = req.get('X-CSRF-Token');
  if (!expected || !received) {
    return res.status(403).json({ ok: false, mensaje: 'CSRF inválido' });
  }
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length
      || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(403).json({ ok: false, mensaje: 'CSRF inválido' });
  }
  return next();
}

module.exports = { createCsrfToken, csrfProtection, ensureCsrfToken };
