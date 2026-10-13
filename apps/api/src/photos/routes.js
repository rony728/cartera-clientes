const express = require('express');
const { validateTerminalParam, ValidationError } = require('../terminales/validation');
const { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } = require('./constants');
const { PhotoValidationError, optimizePhoto } = require('./processor');
const repository = require('./repository');

const rawPhoto = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

function createPhotosRouter({
  pool,
  requireAuth,
  csrfProtection,
  repositoryApi = repository,
  optimizePhotoFn = optimizePhoto
}) {
  const router = express.Router();

  router.get('/:terminal/fotografia', requireAuth, async (req, res) => {
    try {
      const terminal = validateTerminalParam(req.params.terminal);
      const accessError = await verifyTerminalAccess(repositoryApi, pool, terminal, req.user, false);
      if (accessError) return res.status(accessError.status).json(accessError.body);
      const photo = await repositoryApi.getPhoto(pool, terminal);
      if (!photo) return res.status(404).json({ ok: false, mensaje: 'Fotografía no encontrada.' });
      res.set({
        'Content-Type': photo.mime_type,
        'Content-Length': String(photo.tamano_bytes),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Last-Modified': new Date(photo.fecha_actualizacion).toUTCString()
      });
      return res.status(200).send(photo.contenido);
    } catch (error) {
      return handlePhotoError(res, error);
    }
  });

  const upload = async (req, res, replace) => {
    try {
      const terminal = validateTerminalParam(req.params.terminal);
      const accessError = await verifyTerminalAccess(repositoryApi, pool, terminal, req.user, true);
      if (accessError) return res.status(accessError.status).json(accessError.body);
      const requestMime = String(req.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
      if (!ALLOWED_MIME_TYPES.includes(requestMime)) {
        return res.status(415).json({ ok: false, codigo: 'FORMATO_NO_PERMITIDO', mensaje: 'Solo se permiten fotografías JPEG, PNG o WebP.' });
      }
      const processed = await optimizePhotoFn(req.body);
      if (processed.detectedMime && processed.detectedMime !== requestMime) {
        return res.status(415).json({ ok: false, codigo: 'MIME_NO_COINCIDE', mensaje: 'El contenido de la fotografía no coincide con el MIME declarado.' });
      }
      const input = { terminal, userId: req.user.id, ...processed };
      const saved = replace
        ? await repositoryApi.replacePhoto(pool, input)
        : await repositoryApi.createPhoto(pool, input);
      if (!saved) {
        return res.status(409).json({ ok: false, codigo: 'FOTO_EXISTENTE', mensaje: 'La terminal ya tiene una fotografía.' });
      }
      return res.status(replace ? 200 : 201).json({ ok: true, fotografia: publicMetadata(saved) });
    } catch (error) {
      return handlePhotoError(res, error);
    }
  };

  router.post('/:terminal/fotografia', requireAuth, csrfProtection, rawPhoto, (req, res) => upload(req, res, false));
  router.put('/:terminal/fotografia', requireAuth, csrfProtection, rawPhoto, (req, res) => upload(req, res, true));
  return router;
}

async function verifyTerminalAccess(repositoryApi, pool, terminal, user, write) {
  const found = await repositoryApi.getTerminal(pool, terminal);
  if (!found) return { status: 404, body: { ok: false, mensaje: 'Terminal no encontrada.' } };
  if (!found.activa && user.rol !== 'ADMIN') {
    return { status: 403, body: { ok: false, mensaje: 'Acceso denegado' } };
  }
  if (!found.activa && write) {
    return { status: 409, body: { ok: false, codigo: 'TERMINAL_INACTIVA', mensaje: 'Una terminal inactiva no se puede editar.' } };
  }
  return null;
}

function publicMetadata(photo) {
  return {
    mime_type: photo.mime_type,
    tamano_bytes: photo.tamano_bytes,
    ancho: photo.ancho,
    alto: photo.alto,
    fecha_creacion: photo.fecha_creacion,
    fecha_actualizacion: photo.fecha_actualizacion
  };
}

function handlePhotoError(res, error) {
  if (error instanceof PhotoValidationError || error instanceof ValidationError) {
    return res.status(error.statusCode || 400).json({ ok: false, codigo: error.code, mensaje: error.message });
  }
  console.error(`Error gestionando fotografía: ${error.name || 'Error'}`);
  return res.status(500).json({ ok: false, mensaje: 'No se pudo gestionar la fotografía.' });
}

module.exports = { createPhotosRouter };
