const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const FUENTES = ['historico', 'mensual'];
class ReportError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fecha(value) {
  // Exigir ISO con zona explícita; rechazar fechas normalizadas como 30 de febrero.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new ReportError('FECHA_INVALIDA');
  }
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const max = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > max
      || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59
      || Number(value.slice(17, 19)) > 59 || !Number.isFinite(Date.parse(value))) {
    throw new ReportError('FECHA_INVALIDA');
  }
  return new Date(value).toISOString();
}
function parseReporte(buffer) {
  let rows;
  try { rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch (_) { throw new ReportError('JSON_INVALIDO'); }
  if (!Array.isArray(rows)) throw new ReportError('FORMATO_INVALIDO');
  const ids = new Set();
  const records = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new ReportError('REGISTRO_INVALIDO');
    const id = typeof row.ID === 'number' && Number.isSafeInteger(row.ID) ? String(row.ID) : row.ID;
    if (typeof id !== 'string' || !/^[1-9]\d*$/u.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new ReportError('ID_INVALIDO');
    }
    if (ids.has(id)) throw new ReportError('ID_DUPLICADO_EN_FUENTE');
    ids.add(id);
    for (const key of ['Terminal', 'Tecnico', 'TipoVisita']) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].includes('\0')) {
        throw new ReportError('CAMPO_INVALIDO');
      }
    }
    // JSON.parse acepta desbordamientos como 1e999, incompatibles con JSONB.
    const check = (v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new ReportError('JSON_INVALIDO');
      if (typeof v === 'string' && v.includes('\0')) throw new ReportError('JSON_INVALIDO');
      if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { check(k); check(x); });
    };
    check(row);
    return { id, terminal: row.Terminal, fecha: fecha(row.Fecha), tecnico: row.Tecnico,
      tipo: row.TipoVisita, modificado: row.Modified == null ? null : fecha(row.Modified), datos: row };
  });
  return { records, hash: crypto.createHash('sha256').update(buffer).digest('hex') };
}
async function readReportes({ root = path.join(os.homedir(), 'cartera-snapshot', 'visitas'), maxBytes = 30 * 1024 * 1024 } = {}) {
  const result = {};
  try {
    for (const source of FUENTES) {
      const category = await fs.realpath(path.join(root, source));
      const bundle = await fs.realpath(path.join(category, 'ultimo'));
      if (!bundle.startsWith(category + path.sep)) throw new ReportError('RUTA_INVALIDA');
      const dataPath = await fs.realpath(path.join(bundle, 'data.json'));
      if (!dataPath.startsWith(bundle + path.sep)) throw new ReportError('RUTA_INVALIDA');
      const stat = await fs.stat(dataPath);
      if (!stat.isFile() || stat.size > maxBytes) throw new ReportError('ARCHIVO_DEMASIADO_GRANDE');
      const metaPath = path.join(bundle, 'metadata.json');
      if ((await fs.stat(metaPath)).size > 64 * 1024) throw new ReportError('METADATOS_INVALIDOS');
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      const buffer = await fs.readFile(dataPath);
      if (buffer.length > maxBytes) throw new ReportError('ARCHIVO_DEMASIADO_GRANDE');
      const parsed = parseReporte(buffer);
      if (parsed.hash !== meta.sha256 || parsed.records.length !== meta.records) throw new ReportError('HASH_INVALIDO');
      result[source] = { ...parsed, recibido: fecha(meta.received_at), procesado: fecha(meta.processed_at) };
    }
    return result;
  } catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError('REPORTE_NO_DISPONIBLE');
  }
}
module.exports = { FUENTES, ReportError, fecha, parseReporte, readReportes };
