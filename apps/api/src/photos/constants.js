const ALLOWED_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1600;

module.exports = { ALLOWED_MIME_TYPES, MAX_DIMENSION, MAX_STORED_BYTES, MAX_UPLOAD_BYTES };
