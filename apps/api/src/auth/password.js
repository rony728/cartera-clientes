const argon2 = require('argon2');

const ARGON_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
});

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return false;
  }
  return /[a-záéíóúñ]/u.test(password)
    && /[A-ZÁÉÍÓÚÑ]/u.test(password)
    && /\d/u.test(password)
    && /[^\p{L}\p{N}]/u.test(password);
}

async function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTIONS);
}

async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch (_) {
    return false;
  }
}

module.exports = { hashPassword, validatePassword, verifyPassword };
