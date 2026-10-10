const express = require('express');
const { buildPowerAutomateV2Mail } = require('../mail');
const { findTerminal, searchTerminales } = require('./queries');
const repository = require('./repository');
const { INTERNAL_FIELDS, POWER_AUTOMATE_FIELD_SET } = require('./fields');
const { ValidationError, parseSearchParams, validateTerminalParam } = require('./validation');

function handleError(res, error) {
  if (error instanceof ValidationError) {
    return res.status(error.statusCode).json({ ok: false, mensaje: error.message });
  }

  console.error(`Error consultando terminales: ${error.name || 'Error'}`);
  return res.status(500).json({ ok: false, mensaje: 'No se pudo consultar la cartera.' });
}

function parsePage(query) {
  const pagina = Number(query.pagina || 1);
  const limite = Number(query.limite || 20);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || !Number.isSafeInteger(limite) || limite < 1 || limite > 100) {
    throw new ValidationError('La paginación no es válida.');
  }
  return { pagina, limite };
}

function validateChanges(body) {
  if (!body || (!Number.isSafeInteger(body.version) && !/^\d+$/u.test(String(body.version)))) {
    throw new ValidationError('La versión es obligatoria.');
  }
  if (!body.cambios || typeof body.cambios !== 'object' || Array.isArray(body.cambios)) {
    throw new ValidationError('Los cambios no son válidos.');
  }
  const entries = Object.entries(body.cambios);
  if (entries.length < 1 || entries.length > POWER_AUTOMATE_FIELD_SET.size) {
    throw new ValidationError('La cantidad de cambios no es válida.');
  }
  for (const [field, value] of entries) {
    if (!field || field.length > 120 || INTERNAL_FIELDS.has(field) || /[\u0000-\u001F\u007F]/u.test(field)) {
      throw new ValidationError(`El campo ${field || '(vacío)'} no se puede editar.`);
    }
    if (!POWER_AUTOMATE_FIELD_SET.has(field)) {
      throw new ValidationError(`El campo ${field} todavía no admite propagación a Excel.`);
    }
    if (value !== null && typeof value !== 'string') {
      throw new ValidationError(`El valor de ${field} no es válido.`);
    }
    if (typeof value === 'string' && value.length > 5000) {
      throw new ValidationError(`El valor de ${field} es demasiado largo.`);
    }
  }
  return { version: body.version, changes: Object.fromEntries(entries) };
}

function createTerminalesRouter({ pool, csrfProtection, sendMailFn, repositoryApi = repository }) {
  const router = express.Router();

  router.get('/filtros/opciones', async (req, res) => {
    try {
      const activeOnly = req.user.rol !== 'ADMIN';
      const [options, fields] = await Promise.all([
        repositoryApi.getFilterOptions(pool, activeOnly),
        repositoryApi.getFieldNames(pool, activeOnly)
      ]);
      return res.status(200).json({
        datos: options,
        campos: fields
      });
    } catch (error) { return handleError(res, error); }
  });

  router.get('/dashboard/resumen', async (req, res) => {
    try {
      return res.status(200).json(await repositoryApi.getDashboard(pool, req.user.rol !== 'ADMIN'));
    } catch (error) { return handleError(res, error); }
  });

  router.get('/', async (req, res) => {
    try {
      const filters = parseSearchParams(req.query);
      if (req.user.rol !== 'ADMIN' && filters.estado !== 'activas') {
        return res.status(403).json({ ok: false, mensaje: 'Acceso denegado' });
      }
      const result = await searchTerminales(pool, filters);
      return res.status(200).json({
        datos: result.datos,
        paginacion: {
          pagina: filters.pagina,
          limite: filters.limite,
          total: result.total,
          total_paginas: result.total === 0 ? 0 : Math.ceil(result.total / filters.limite)
        }
      });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/:terminal', async (req, res) => {
    try {
      const terminal = validateTerminalParam(req.params.terminal);
      const result = await findTerminal(pool, terminal);
      if (result === null) {
        return res.status(404).json({ ok: false, mensaje: 'Terminal no encontrada.' });
      }
      if (!result.activa && req.user.rol !== 'ADMIN') {
        return res.status(403).json({ ok: false, mensaje: 'Acceso denegado' });
      }
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/:terminal/historial', async (req, res) => {
    try {
      const terminal = validateTerminalParam(req.params.terminal);
      const found = await findTerminal(pool, terminal);
      if (!found) return res.status(404).json({ ok: false, mensaje: 'Terminal no encontrada.' });
      if (!found.activa && req.user.rol !== 'ADMIN') return res.status(403).json({ ok: false, mensaje: 'Acceso denegado' });
      const pagination = parsePage(req.query);
      const result = await repositoryApi.getHistory(pool, terminal, pagination);
      return res.status(200).json({
        datos: result.datos,
        paginacion: { ...pagination, total: result.total, total_paginas: Math.ceil(result.total / pagination.limite) }
      });
    } catch (error) { return handleError(res, error); }
  });

  router.patch('/:terminal', csrfProtection, async (req, res) => {
    try {
      const terminal = validateTerminalParam(req.params.terminal);
      const { version, changes } = validateChanges(req.body);
      const result = await repositoryApi.updateTerminal(pool, {
        terminal, version, changes, userId: req.user.id
      });
      if (result.kind === 'not_found') return res.status(404).json({ ok: false, mensaje: 'Terminal no encontrada.' });
      if (result.kind === 'inactive') return res.status(409).json({ ok: false, codigo: 'TERMINAL_INACTIVA', mensaje: 'Una terminal inactiva no se puede editar.' });
      if (result.kind === 'conflict') return res.status(409).json({
        ok: false, codigo: 'VERSION_CONFLICT', mensaje: 'La terminal fue modificada por otra persona.', terminal: result.current
      });
      if (result.kind === 'unchanged') return res.status(200).json({
        ok: true,
        terminal: result.terminal,
        propagacion: [],
        envio_excel: { estado: 'SIN_CAMBIOS', campos: [] }
      });

      const operationId = result.queue[0].operacion_id;
      const effectiveChanges = Object.fromEntries(
        result.queue.map((entry) => [entry.campo, entry.valor_nuevo])
      );
      try {
        const prepared = await repositoryApi.markQueueOperation(pool, operationId, 'INCIERTO');
        if (prepared !== result.queue.length) throw new Error('QUEUE_PREPARATION_FAILED');
      } catch (_) {
        console.error('No se pudo preparar el registro de envío a Microsoft Graph.');
        return res.status(200).json(buildUpdateResponse(result, 'PENDIENTE'));
      }

      try {
        await sendMailFn(buildPowerAutomateV2Mail(terminal, effectiveChanges));
      } catch (_) {
        let failureState = 'ERROR';
        try {
          const marked = await repositoryApi.markQueueOperation(
            pool, operationId, 'ERROR', 'MAIL_DELIVERY_FAILED'
          );
          if (marked !== result.queue.length) failureState = 'INCIERTO';
        } catch (_) {
          failureState = 'INCIERTO';
        }
        return res.status(200).json(buildUpdateResponse(result, failureState));
      }

      let externalState = 'ENVIADO';
      try {
        const marked = await repositoryApi.markQueueOperation(pool, operationId, 'ENVIADO');
        if (marked !== result.queue.length) throw new Error('QUEUE_FINALIZATION_FAILED');
      } catch (_) {
        externalState = 'INCIERTO';
        console.error('Microsoft Graph aceptó el correo, pero no se pudo registrar el estado de la operación.');
      }
      return res.status(200).json(buildUpdateResponse(result, externalState));
    } catch (error) { return handleError(res, error); }
  });

  return router;
}

function buildUpdateResponse(result, state) {
  const fields = result.queue.map((entry) => entry.campo);
  return {
    ok: true,
    terminal: result.terminal,
    propagacion: fields.map((campo) => ({ campo, estado: state })),
    envio_excel: { estado: state, campos: fields }
  };
}

module.exports = { createTerminalesRouter, validateChanges };
