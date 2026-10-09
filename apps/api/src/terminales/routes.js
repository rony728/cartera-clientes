const express = require('express');
const { findTerminal, searchTerminales } = require('./queries');
const { ValidationError, parseSearchParams, validateTerminalParam } = require('./validation');

function handleError(res, error) {
  if (error instanceof ValidationError) {
    return res.status(error.statusCode).json({ ok: false, mensaje: error.message });
  }

  console.error(`Error consultando terminales: ${error.name || 'Error'}`);
  return res.status(500).json({ ok: false, mensaje: 'No se pudo consultar la cartera.' });
}

function createTerminalesRouter({ pool }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const filters = parseSearchParams(req.query);
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
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}

module.exports = { createTerminalesRouter };
