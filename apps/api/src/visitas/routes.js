const express = require('express');
const queries = require('./queries');
const { validateTerminalParam, ValidationError } = require('../terminales/validation');
function createVisitasRouter({ pool, enabled, requireAdmin }) {
  const router = express.Router();
  router.use((_req, res, next) => enabled ? next() : res.status(503).json({ ok: false, codigo: 'VISITAS_DESHABILITADAS' }));
  router.get('/estado', requireAdmin, async (_req, res, next) => {
    try { res.json(await queries.estado(pool)); } catch (error) { next(error); }
  });
  router.get('/estadisticas/mensual', async (_req, res, next) => {
    try { res.json(await queries.estadisticas(pool)); } catch (error) { next(error); }
  });
  router.get('/terminales/:terminal/ultima', async (req, res, next) => {
    try {
      const result = await queries.ultima(pool, validateTerminalParam(req.params.terminal), req.user.rol === 'ADMIN');
      if (!result) return res.status(404).json({ ok: false, mensaje: 'Terminal no encontrada.' });
      return res.json(result);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ ok: false, mensaje: 'Terminal inválida.' });
      return next(error);
    }
  });
  return router;
}
module.exports = { createVisitasRouter };
