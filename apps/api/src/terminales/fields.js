const SEARCH_FIELDS = Object.freeze([
  'Terminal', 'NombreComercial', 'CodigoComercio', 'Inventario', 'SeriePOS',
  'SerieSimcard', 'Celular', 'Ciudad', 'Zona', 'TecnicoAsignado', 'Correo',
  'CategoriaComercio', 'Modelo', 'Comunicacion', 'RedSimcard', 'Atendio',
  'Direccion', 'Ubicacion', 'PLATAFORMA', 'IP', 'Mascara', 'Gateway', 'DNS', 'DNS2',
  'ubicacion_interna', 'referencia_interna'
]);
const FILTER_FIELDS = Object.freeze([
  'TecnicoAsignado', 'Zona', 'Ciudad', 'CategoriaComercio', 'Modelo', 'Comunicacion', 'RedSimcard'
]);
const SORT_FIELDS = Object.freeze([
  'NombreComercial', 'Terminal', 'CodigoComercio', 'Ciudad', 'TecnicoAsignado'
]);
const POWER_AUTOMATE_FIELDS = Object.freeze([
  'CodigoComercio', 'NombreComercial', 'Zona', 'Direccion', 'Ciudad',
  'Inventario', 'SeriePOS', 'Modelo', 'Comunicacion', 'RedSimcard',
  'SerieSimcard', 'Atendio', 'Celular', 'Ubicacion', 'TecnicoAsignado',
  'IP', 'Mascara', 'Gateway', 'DNS', 'DNS2', 'PLATAFORMA', 'Correo',
  'CategoriaComercio'
]);
const POWER_AUTOMATE_FIELD_SET = new Set(POWER_AUTOMATE_FIELDS);
const PWA_INTERNAL_FIELDS = Object.freeze(['ubicacion_interna', 'referencia_interna']);
const PWA_INTERNAL_FIELD_SET = new Set(PWA_INTERNAL_FIELDS);
const INTERNAL_FIELDS = new Set([
  'Terminal', 'ItemInternalId', '@odata.etag', 'version', 'activa',
  'fecha_creacion', 'fecha_actualizacion', 'fecha_ultima_sincronizacion',
  ...PWA_INTERNAL_FIELDS
]);

module.exports = {
  FILTER_FIELDS,
  INTERNAL_FIELDS,
  POWER_AUTOMATE_FIELDS,
  POWER_AUTOMATE_FIELD_SET,
  PWA_INTERNAL_FIELDS,
  PWA_INTERNAL_FIELD_SET,
  SEARCH_FIELDS,
  SORT_FIELDS
};
