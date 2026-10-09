const { buildPlan, queueValueMatchesSnapshot } = require('./domain');
const { SnapshotError, readSnapshot } = require('./snapshot');
const repository = require('./repository');

const EMPTY_COUNTERS = Object.freeze({
  total_registros: 0,
  insertados: 0,
  actualizados: 0,
  sin_cambios: 0,
  inactivados: 0,
  reactivados: 0,
  conflictos: 0
});

class ImportError extends Error {
  constructor(code, message, statusCode, synchronizationId = null) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.statusCode = statusCode;
    this.synchronizationId = synchronizationId;
  }
}

function safeFailureCode(error) {
  if (error instanceof SnapshotError || error instanceof ImportError) return error.code;
  return 'INTERNAL_ERROR';
}

async function recordRejectedSnapshot(pool, error, repositoryApi) {
  const counters = { ...EMPTY_COUNTERS, total_registros: error.totalRecords || 0 };
  const id = await repositoryApi.createAttempt(pool, {
    hash: error.hash,
    total: counters.total_registros,
    estado: 'RECHAZADA',
    detail: safeFailureCode(error)
  });
  throw new ImportError(error.code, error.message, error.statusCode, id);
}

async function reconcilePendingQueue(
  client,
  synchronizationId,
  snapshot,
  modifiedAt,
  repositoryApi = repository
) {
  const queueEntries = await repositoryApi.getLatestUnresolvedQueue(client);
  const snapshotByTerminal = new Map(snapshot.map((record) => [record.terminal, record.datos_excel]));
  let newConflicts = 0;

  for (const queueEntry of queueEntries) {
    const datosExcel = snapshotByTerminal.get(queueEntry.terminal);
    if (!datosExcel) continue;

    const sentAt = queueEntry.fecha_envio ? new Date(queueEntry.fecha_envio) : null;
    if (sentAt && modifiedAt < sentAt) continue;

    const matches = queueValueMatchesSnapshot(queueEntry, datosExcel);
    if (matches && sentAt && ['ENVIADO', 'INCIERTO'].includes(queueEntry.estado)) {
      await repositoryApi.confirmQueueEntry(client, queueEntry.id);
      continue;
    }
    if (matches) continue;

    const excelPresent = Object.prototype.hasOwnProperty.call(datosExcel, queueEntry.campo);
    const excelValue = excelPresent ? datosExcel[queueEntry.campo] : null;
    if (await repositoryApi.createConflict(
      client,
      synchronizationId,
      queueEntry,
      excelValue,
      excelPresent
    )) {
      newConflicts += 1;
    }
  }
  return newConflicts;
}

async function importSnapshot({
  pool,
  snapshotConfig,
  confirmMassDeactivation = false,
  readSnapshotFn = readSnapshot,
  repositoryApi = repository
}) {
  let snapshot;
  try {
    snapshot = await readSnapshotFn(snapshotConfig);
  } catch (error) {
    if (error instanceof SnapshotError) return recordRejectedSnapshot(pool, error, repositoryApi);
    throw error;
  }

  const synchronizationId = await repositoryApi.createAttempt(pool, {
    hash: snapshot.hash,
    total: snapshot.records.length
  });
  let client;
  try {
    client = await pool.connect();
  } catch (_) {
    const counters = { ...EMPTY_COUNTERS, total_registros: snapshot.records.length };
    await repositoryApi.finishAttempt(
      pool,
      synchronizationId,
      'ERROR',
      counters,
      'DATABASE_CONNECTION_FAILED'
    );
    throw new ImportError(
      'IMPORT_FAILED',
      'La importación no pudo iniciar y no realizó cambios.',
      500,
      synchronizationId
    );
  }
  let plan;
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtext('cartera-clientes:importacion')) AS acquired"
    );
    if (!lock.rows[0].acquired) {
      throw new ImportError(
        'IMPORT_IN_PROGRESS',
        'Ya existe una importación en curso.',
        409,
        synchronizationId
      );
    }

    const existing = await repositoryApi.getExistingTerminals(client);
    plan = buildPlan(existing, snapshot.records);
    if (plan.requiresMassDeactivationConfirmation && !confirmMassDeactivation) {
      throw new ImportError(
        'MASS_DEACTIVATION_CONFIRMATION_REQUIRED',
        'La ausencia supera el 10%; se requiere confirmación administrativa explícita.',
        409,
        synchronizationId
      );
    }

    await repositoryApi.applyActions(client, plan.actions);
    await repositoryApi.insertHistory(client, synchronizationId, plan.history);
    plan.counters.conflictos = await reconcilePendingQueue(
      client,
      synchronizationId,
      snapshot.records,
      snapshot.modifiedAt,
      repositoryApi
    );
    await repositoryApi.finishAttempt(client, synchronizationId, 'COMPLETADA', plan.counters);
    await client.query('COMMIT');
    return { id: synchronizationId, estado: 'COMPLETADA', ...plan.counters };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } finally {
      const counters = { ...EMPTY_COUNTERS, total_registros: snapshot.records.length };
      const estado = error instanceof ImportError ? 'RECHAZADA' : 'ERROR';
      await repositoryApi.finishAttempt(
        pool,
        synchronizationId,
        estado,
        counters,
        safeFailureCode(error)
      );
    }
    if (error instanceof ImportError) throw error;
    throw new ImportError(
      'IMPORT_FAILED',
      'La importación falló y fue revertida.',
      500,
      synchronizationId
    );
  } finally {
    client.release();
  }
}

module.exports = { ImportError, importSnapshot, reconcilePendingQueue };
