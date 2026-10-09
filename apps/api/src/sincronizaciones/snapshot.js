const crypto = require('node:crypto');
const fs = require('node:fs/promises');

const TECHNICAL_FIELDS = new Set(['ItemInternalId', '@odata.etag']);

class SnapshotError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'SnapshotError';
    this.code = code;
    this.statusCode = options.statusCode || 400;
    this.hash = options.hash || null;
    this.totalRecords = options.totalRecords || 0;
  }
}

function getRecordsAtPath(parsed, recordsPath) {
  if (Array.isArray(parsed)) return parsed;
  if (!recordsPath) {
    throw new SnapshotError(
      'SNAPSHOT_FORMAT',
      'El snapshot no es un arreglo y SNAPSHOT_RECORDS_PATH no está configurado.'
    );
  }

  const records = recordsPath.split('.').reduce((value, part) => (
    value && typeof value === 'object' ? value[part] : undefined
  ), parsed);
  if (!Array.isArray(records)) {
    throw new SnapshotError('SNAPSHOT_FORMAT', 'La ruta configurada no contiene un arreglo de registros.');
  }
  return records;
}

function normalizeRecords(records, hash) {
  if (records.length === 0) {
    throw new SnapshotError('SNAPSHOT_EMPTY', 'El snapshot está vacío.', { hash });
  }

  const seen = new Set();
  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new SnapshotError('INVALID_RECORD', `El registro ${index + 1} no es un objeto.`, {
        hash,
        totalRecords: records.length
      });
    }

    if (!Object.prototype.hasOwnProperty.call(record, 'Terminal')) {
      throw new SnapshotError('MISSING_TERMINAL', `El registro ${index + 1} no contiene Terminal.`, {
        hash,
        totalRecords: records.length
      });
    }
    if (typeof record.Terminal !== 'string') {
      throw new SnapshotError(
        'NUMERIC_TERMINAL',
        `Terminal debe ser texto en el registro ${index + 1}; no se puede recuperar un cero perdido.`,
        { hash, totalRecords: records.length }
      );
    }
    if (record.Terminal.trim() === '') {
      throw new SnapshotError('EMPTY_TERMINAL', `Terminal está vacío en el registro ${index + 1}.`, {
        hash,
        totalRecords: records.length
      });
    }
    if (seen.has(record.Terminal)) {
      throw new SnapshotError('DUPLICATE_TERMINAL', `Terminal duplicada: ${record.Terminal}.`, {
        hash,
        totalRecords: records.length
      });
    }
    seen.add(record.Terminal);

    const datosExcel = {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'Terminal' && !TECHNICAL_FIELDS.has(key)) {
        datosExcel[key] = value;
      }
    }
    return { terminal: record.Terminal, datos_excel: datosExcel };
  });
}

function parseSnapshot(buffer, { recordsPath = '', maxBytes = 10 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer debe ser Buffer.');
  if (buffer.length > maxBytes) {
    throw new SnapshotError('SNAPSHOT_TOO_LARGE', 'El snapshot supera el tamaño máximo permitido.', {
      statusCode: 413
    });
  }

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch (_) {
    throw new SnapshotError('INVALID_JSON', 'El snapshot contiene JSON inválido o truncado.', { hash });
  }

  try {
    const rawRecords = getRecordsAtPath(parsed, recordsPath);
    return { hash, records: normalizeRecords(rawRecords, hash) };
  } catch (error) {
    if (error instanceof SnapshotError && !error.hash) error.hash = hash;
    throw error;
  }
}

async function readSnapshot({ filePath, recordsPath = '', maxBytes = 10 * 1024 * 1024 }) {
  let before;
  try {
    before = await fs.stat(filePath);
  } catch (_) {
    throw new SnapshotError('SNAPSHOT_UNREADABLE', 'El snapshot no existe o no se puede leer.');
  }
  if (!before.isFile()) {
    throw new SnapshotError('SNAPSHOT_UNREADABLE', 'La ruta del snapshot no corresponde a un archivo.');
  }
  if (before.size > maxBytes) {
    throw new SnapshotError('SNAPSHOT_TOO_LARGE', 'El snapshot supera el tamaño máximo permitido.', {
      statusCode: 413
    });
  }

  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (_) {
    throw new SnapshotError('SNAPSHOT_UNREADABLE', 'El snapshot no existe o no se puede leer.');
  }
  let after;
  try {
    after = await fs.stat(filePath);
  } catch (_) {
    throw new SnapshotError(
      'SNAPSHOT_CHANGED',
      'El snapshot cambió durante la lectura; inténtalo nuevamente.',
      { statusCode: 409 }
    );
  }
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new SnapshotError(
      'SNAPSHOT_CHANGED',
      'El snapshot cambió durante la lectura; inténtalo nuevamente.',
      { statusCode: 409 }
    );
  }

  const result = parseSnapshot(buffer, { recordsPath, maxBytes });
  return { ...result, modifiedAt: after.mtime };
}

module.exports = { SnapshotError, parseSnapshot, readSnapshot };
