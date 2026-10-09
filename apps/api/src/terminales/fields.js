const SEARCH_FIELDS = Object.freeze([
  'Terminal', 'NombreComercial', 'CodigoComercio', 'Inventario', 'SeriePOS',
  'SerieSimcard', 'Celular', 'Ciudad', 'Zona', 'TecnicoAsignado', 'Correo',
  'CategoriaComercio', 'Modelo', 'Comunicacion', 'RedSimcard', 'Atendio',
  'Direccion', 'Ubicacion', 'PLATAFORMA', 'IP', 'Mascara', 'Gateway', 'DNS', 'DNS2'
]);
const FILTER_FIELDS = Object.freeze([
  'TecnicoAsignado', 'Zona', 'Ciudad', 'CategoriaComercio', 'Modelo', 'Comunicacion', 'RedSimcard'
]);
const SORT_FIELDS = Object.freeze([
  'NombreComercial', 'Terminal', 'CodigoComercio', 'Ciudad', 'TecnicoAsignado'
]);
const INTERNAL_FIELDS = new Set([
  'Terminal', 'ItemInternalId', '@odata.etag', 'version', 'activa',
  'fecha_creacion', 'fecha_actualizacion', 'fecha_ultima_sincronizacion'
]);

module.exports = { FILTER_FIELDS, INTERNAL_FIELDS, SEARCH_FIELDS, SORT_FIELDS };
