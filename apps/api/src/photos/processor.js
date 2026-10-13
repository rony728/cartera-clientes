const sharp = require('sharp');
const { MAX_DIMENSION, MAX_STORED_BYTES } = require('./constants');

class PhotoValidationError extends Error {
  constructor(message, statusCode = 400, code = 'FOTO_INVALIDA') {
    super(message);
    this.name = 'PhotoValidationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function optimizePhoto(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new PhotoValidationError('La fotografía está vacía.');
  }

  let metadata;
  try {
    metadata = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
  } catch (_) {
    throw new PhotoValidationError('El archivo no contiene una imagen válida.');
  }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new PhotoValidationError('El formato real de la fotografía no está permitido.', 415, 'FORMATO_NO_PERMITIDO');
  }
  const detectedMime = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;

  for (const quality of [82, 72, 62]) {
    let output;
    try {
      output = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
    } catch (_) {
      throw new PhotoValidationError('No se pudo procesar la fotografía.');
    }
    if (output.data.length <= MAX_STORED_BYTES) {
      return {
        content: output.data,
        detectedMime,
        mimeType: 'image/webp',
        size: output.data.length,
        width: output.info.width,
        height: output.info.height
      };
    }
  }
  throw new PhotoValidationError('La fotografía optimizada supera el límite de 2 MiB.', 413, 'FOTO_DEMASIADO_GRANDE');
}

module.exports = { PhotoValidationError, optimizePhoto };
