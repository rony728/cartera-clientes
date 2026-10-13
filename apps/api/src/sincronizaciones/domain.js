const { isDeepStrictEqual } = require('node:util');

const STATUS_FIELD = '__estado_terminal__';
const TECHNICAL_FIELDS = new Set([
  'ItemInternalId', '@odata.etag', 'ubicacion_interna', 'referencia_interna'
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function withoutTechnicalFields(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !TECHNICAL_FIELDS.has(key))
  );
}

function diffFields(previous, current) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const changes = [];
  for (const field of keys) {
    const previousPresent = hasOwn(previous, field);
    const currentPresent = hasOwn(current, field);
    const previousValue = previousPresent ? previous[field] : null;
    const currentValue = currentPresent ? current[field] : null;
    if (previousPresent !== currentPresent || !isDeepStrictEqual(previousValue, currentValue)) {
      changes.push({
        campo: field,
        valor_anterior: previousValue,
        valor_anterior_presente: previousPresent,
        valor_nuevo: currentValue,
        valor_nuevo_presente: currentPresent
      });
    }
  }
  return changes;
}

function initialHistory(record) {
  return Object.entries(record.datos_excel).map(([field, value]) => ({
    terminal: record.terminal,
    campo: field,
    valor_anterior: null,
    valor_anterior_presente: false,
    valor_nuevo: value,
    valor_nuevo_presente: true,
    origen: 'EXCEL'
  }));
}

function statusHistory(terminal, previous, current, previousPresent = true) {
  return {
    terminal,
    campo: STATUS_FIELD,
    valor_anterior: previous,
    valor_anterior_presente: previousPresent,
    valor_nuevo: current,
    valor_nuevo_presente: true,
    origen: 'SISTEMA'
  };
}

function buildPlan(existingRows, snapshotRecords) {
  const existingByTerminal = new Map(existingRows.map((row) => [row.terminal, row]));
  const snapshotByTerminal = new Map(snapshotRecords.map((row) => [row.terminal, row]));
  const actions = [];
  const history = [];
  const counters = {
    total_registros: snapshotRecords.length,
    insertados: 0,
    actualizados: 0,
    sin_cambios: 0,
    inactivados: 0,
    reactivados: 0,
    conflictos: 0
  };

  for (const record of snapshotRecords) {
    const previous = existingByTerminal.get(record.terminal);
    if (!previous) {
      actions.push({ type: 'insert', record });
      counters.insertados += 1;
      history.push(...initialHistory(record));
      history.push(statusHistory(record.terminal, null, true, false));
      continue;
    }

    const changes = diffFields(withoutTechnicalFields(previous.datos_excel), record.datos_excel);
    const reactivated = previous.activa === false;
    if (changes.length > 0 || reactivated) {
      actions.push({ type: 'update', record, changes, reactivated });
      if (changes.length > 0) counters.actualizados += 1;
      if (reactivated) {
        counters.reactivados += 1;
        history.push(statusHistory(record.terminal, false, true));
      }
      history.push(...changes.map((change) => ({
        terminal: record.terminal,
        ...change,
        origen: 'EXCEL'
      })));
    } else {
      actions.push({ type: 'unchanged', record });
      counters.sin_cambios += 1;
    }
  }

  const activeRows = existingRows.filter((row) => row.activa === true);
  const missing = activeRows.filter((row) => !snapshotByTerminal.has(row.terminal));
  for (const row of missing) {
    actions.push({ type: 'deactivate', record: row });
    counters.inactivados += 1;
    history.push(statusHistory(row.terminal, true, false));
  }

  const missingRatio = activeRows.length === 0 ? 0 : missing.length / activeRows.length;
  return {
    actions,
    history,
    counters,
    missingRatio,
    requiresMassDeactivationConfirmation: missingRatio > 0.10
  };
}

function queueValueMatchesSnapshot(queueEntry, datosExcel) {
  const present = hasOwn(datosExcel, queueEntry.campo);
  const value = present ? datosExcel[queueEntry.campo] : null;
  return queueEntry.valor_nuevo_presente === present
    && isDeepStrictEqual(queueEntry.valor_nuevo, value);
}

module.exports = {
  STATUS_FIELD,
  buildPlan,
  diffFields,
  queueValueMatchesSnapshot
};
