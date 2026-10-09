const express = require('express');
const repository = require('./repository');
const { ImportError, importSnapshot } = require('./service');

function parsePositiveInteger(value, name, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === '') return defaultValue;
  if (Array.isArray(value) || typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new ImportError('INVALID_PARAMETER', `${name} debe ser un entero positivo.`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ImportError('INVALID_PARAMETER', `${name} está fuera de rango.`, 400);
  }
  return parsed;
}

function sendError(res, error) {
  if (error instanceof ImportError) {
    return res.status(error.statusCode).json({
      ok: false,
      codigo: error.code,
      mensaje: error.message,
      sincronizacion_id: error.synchronizationId
    });
  }
  console.error(`Error administrando sincronizaciones: ${error.name || 'Error'}`);
  return res.status(500).json({ ok: false, mensaje: 'Error interno de sincronización.' });
}

function createSynchronizationsRouter({
  pool,
  importEnabled = false,
  snapshotConfig,
  importService = importSnapshot,
  repositoryApi = repository,
  csrfProtection
}) {
  const router = express.Router();

  router.post('/', csrfProtection, async (req, res) => {
    if (!importEnabled) {
      return res.status(403).json({
        ok: false,
        codigo: 'IMPORT_DISABLED',
        mensaje: 'La importación manual está deshabilitada en este servidor.'
      });
    }
    const confirmation = req.body?.confirmar_inactivacion_masiva;
    if (confirmation !== undefined && typeof confirmation !== 'boolean') {
      return res.status(400).json({
        ok: false,
        codigo: 'INVALID_CONFIRMATION',
        mensaje: 'confirmar_inactivacion_masiva debe ser booleano.'
      });
    }

    try {
      const result = await importService({
        pool,
        snapshotConfig,
        confirmMassDeactivation: confirmation === true
      });
      return res.status(200).json({ ok: true, sincronizacion: result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/', async (req, res) => {
    try {
      const pagina = parsePositiveInteger(req.query.pagina, 'pagina', 1);
      const limite = parsePositiveInteger(req.query.limite, 'limite', 20, 100);
      const result = await repositoryApi.listSynchronizations(pool, { pagina, limite });
      return res.status(200).json({
        datos: result.datos,
        paginacion: {
          pagina,
          limite,
          total: result.total,
          total_paginas: result.total === 0 ? 0 : Math.ceil(result.total / limite)
        }
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const id = parsePositiveInteger(req.params.id, 'id', null);
      const result = await repositoryApi.getSynchronization(pool, id);
      if (!result) {
        return res.status(404).json({ ok: false, mensaje: 'Sincronización no encontrada.' });
      }
      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = { createSynchronizationsRouter };
