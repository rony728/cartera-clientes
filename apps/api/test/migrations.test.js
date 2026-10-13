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
