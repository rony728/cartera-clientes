const fs = require('node:fs/promises');
require('dotenv').config();

const { parseSnapshot } = require('../src/sincronizaciones/snapshot');

const SAFE_ERRORS = Object.freeze({
  DUPLICATE_TERMINAL: 'Hay identificadores Terminal duplicados.',
  EMPTY_TERMINAL: 'Existe un identificador Terminal vacío.',
  INVALID_JSON: 'El archivo no contiene JSON válido.',
  INVALID_RECORD: 'Existe un registro que no es un objeto.',
  MISSING_TERMINAL: 'Existe un registro sin la propiedad Terminal.',
  NUMERIC_TERMINAL: 'Existe un identificador Terminal que no es texto.',
  SNAPSHOT_EMPTY: 'El arreglo de registros está vacío.',
  SNAPSHOT_FORMAT: 'La estructura no contiene el arreglo esperado.',
  SNAPSHOT_TOO_LARGE: 'El archivo supera el tamaño máximo permitido.'
});

async function main() {
  const filePath = process.env.SNAPSHOT_VALIDATE_PATH
    || '/ruta/privada/cartera-snapshot/snapshot.json';
  const maxBytes = Number.parseInt(process.env.SNAPSHOT_MAX_BYTES || '10485760', 10);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('SNAPSHOT_MAX_BYTES debe ser un entero positivo.');
  }
  const buffer = await fs.readFile(filePath);
  const raw = JSON.parse(buffer.toString('utf8'));
  const recordsPath = process.env.SNAPSHOT_RECORDS_PATH || '';
  const parsed = parseSnapshot(buffer, { recordsPath, maxBytes });
  const rawRecords = Array.isArray(raw)
    ? raw
    : recordsPath.split('.').filter(Boolean).reduce((value, part) => value?.[part], raw);
  const propertyCounts = rawRecords.map((record) => Object.keys(record).length);
  console.log(JSON.stringify({
    compatible: true,
    root_is_array: Array.isArray(raw),
    total_records: parsed.records.length,
    unique_terminals: new Set(parsed.records.map((record) => record.terminal)).size,
    terminal_values_are_text: parsed.records.every((record) => typeof record.terminal === 'string'),
    properties_per_record_min: Math.min(...propertyCounts),
    properties_per_record_max: Math.max(...propertyCounts)
  }, null, 2));
}

main().catch((error) => {
  const code = error.code || 'VALIDATION_FAILED';
  console.error(JSON.stringify({
    compatible: false,
    error_code: code,
    error: SAFE_ERRORS[code] || 'No se pudo validar la estructura del snapshot.'
  }, null, 2));
  process.exitCode = 1;
});
