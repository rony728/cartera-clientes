const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('la migración 003 agrega campos internos nulos fuera de datos_excel', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../../../database/migrations/003_internal_terminal_fields.sql'),
    'utf8'
  );
  assert.match(migration, /ALTER TABLE public\.terminales/u);
  assert.match(migration, /ADD COLUMN ubicacion_interna text/u);
  assert.match(migration, /ADD COLUMN referencia_interna text/u);
  assert.doesNotMatch(migration, /NOT NULL/u);
  assert.doesNotMatch(migration, /datos_excel\s*=/u);
});

test('la migración 004 guarda una fotografía WebP separada por terminal con límites', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../../../database/migrations/004_terminal_photos.sql'),
    'utf8'
  );
  assert.match(migration, /CREATE TABLE public\.fotografias_comercios/u);
  assert.match(migration, /terminal text PRIMARY KEY REFERENCES public\.terminales/u);
  assert.match(migration, /contenido bytea NOT NULL/u);
  assert.match(migration, /mime_type text NOT NULL CHECK \(mime_type = 'image\/webp'\)/u);
  assert.match(migration, /tamano_bytes <= 2097152/u);
  assert.doesNotMatch(migration, /datos_excel/u);
});
