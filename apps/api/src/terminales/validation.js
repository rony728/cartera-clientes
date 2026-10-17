const { fecha } = require('../visitas/reportes');
const { FILTER_FIELDS, INTERNAL_FIELDS, SEARCH_FIELDS, SORT_FIELDS } = require('./fields');

const CAMPOS_PERMITIDOS = Object.freeze(['todos', 'terminal', ...SEARCH_FIELDS.filter((field) => field !== 'Terminal')]);

const ESTADOS_PERMITIDOS = Object.freeze(['activas', 'inactivas', 'todas']);

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

function getSingleQueryValue(value, name) {
  if (Array.isArray(value) || (value !== undefined && typeof value !== 'string')) {
    throw new ValidationError(`El parámetro ${name} no es válido.`);
  }
  return value;
}

function parsePositiveInteger(value, name, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  const singleValue = getSingleQueryValue(value, name);
  if (singleValue === undefined || singleValue === '') {
    return defaultValue;
  }
  if (!/^\d+$/u.test(singleValue)) {
    throw new ValidationError(`El parámetro ${name} debe ser un entero positivo.`);
  }

  const parsed = Number(singleValue);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ValidationError(`El parámetro ${name} está fuera de rango.`);
  }
  return parsed;
}

function parseSearchParams(query) {
  const rawQuery = getSingleQueryValue(query.q, 'q');
  const rawCampo = getSingleQueryValue(query.campo, 'campo');
  const rawEstado = getSingleQueryValue(query.estado, 'estado');
  const rawOrden = getSingleQueryValue(query.orden, 'orden');
  const rawDireccion = getSingleQueryValue(query.direccion, 'direccion');

  if (rawQuery !== undefined && rawQuery.length > 200) {
    throw new ValidationError('El parámetro q es demasiado largo.');
  }

  const campo = rawCampo || 'todos';
  if (!CAMPOS_PERMITIDOS.includes(campo)
      && (campo.length > 120 || INTERNAL_FIELDS.has(campo) || !/^[\p{L}\p{N} _@.-]+$/u.test(campo))) {
    throw new ValidationError('El parámetro campo no es válido.');
  }

  const estado = rawEstado || 'activas';
  if (!ESTADOS_PERMITIDOS.includes(estado)) {
    throw new ValidationError('El parámetro estado no es válido.');
  }

  const orden = rawOrden || 'NombreComercial';
  if (!SORT_FIELDS.includes(orden) && orden !== 'ultima_visita') throw new ValidationError('El parámetro orden no es válido.');
  const direccion = rawDireccion || 'asc';
  if (!['asc', 'desc'].includes(direccion)) throw new ValidationError('El parámetro direccion no es válido.');

  const filtros = {};
  for (const field of FILTER_FIELDS) {
    const value = getSingleQueryValue(query[field], field);
    if (value !== undefined && value.trim() !== '') {
      if (value.length > 200) throw new ValidationError(`El filtro ${field} es demasiado largo.`);
      filtros[field] = value;
    }
  }

  // Unión de categorías equivalentes en SQL, antes de la paginación.
  const variantes = {};
  const rawVariantes = getSingleQueryValue(query.filtros_variantes, 'filtros_variantes');
  if (rawVariantes !== undefined) {
    let parsed;
    try {
      if (rawVariantes.length > 32000) throw new Error();
      parsed = JSON.parse(rawVariantes);
    } catch (_) { throw new ValidationError('Las variantes de filtros no son válidas.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ValidationError('Las variantes de filtros no son válidas.');
    for (const [field, values] of Object.entries(parsed)) {
      if (!FILTER_FIELDS.includes(field) || !filtros[field] || !Array.isArray(values)
          || values.length === 0 || values.length > 250
          || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 200)) {
        throw new ValidationError('Las variantes de filtros no son válidas.');
      }
      variantes[field] = [...new Set(values)];
    }
  }

  const visitas = {};
  const presencia = getSingleQueryValue(query.visitas, 'visitas');
  if (presencia !== undefined) {
    if (!['con', 'sin'].includes(presencia)) throw new ValidationError('El filtro visitas no es válido.');
    visitas.presencia = presencia;
  }
  for (const key of ['visita_desde', 'visita_hasta']) {
    const value = getSingleQueryValue(query[key], key);
    if (value !== undefined) {
      try { visitas[key] = fecha(value); } catch (_) { throw new ValidationError(`El filtro ${key} requiere fecha ISO con zona.`); }
    }
  }
  const padded = (value) => value.replace(/\.(\d+)Z$/u, (_, fraction) => `.${fraction.padEnd(6, '0')}Z`);
  if (visitas.visita_desde && visitas.visita_hasta && padded(visitas.visita_desde) >= padded(visitas.visita_hasta)) {
    throw new ValidationError('El rango de visitas no es válido.');
  }
  const meses = getSingleQueryValue(query.visita_antiguedad_meses, 'visita_antiguedad_meses');
  if (meses !== undefined) {
    if (!['2', '3'].includes(meses)) throw new ValidationError('La antigüedad debe ser 2 o 3 meses calendario.');
    visitas.meses = Number(meses);
  }

  return {
    q: rawQuery === undefined || rawQuery.trim() === '' ? null : rawQuery.trim(),
    campo,
    pagina: parsePositiveInteger(query.pagina, 'pagina', 1),
    limite: parsePositiveInteger(query.limite, 'limite', 20, 100),
    estado,
    orden,
    direccion,
    filtros,
    ...(Object.keys(variantes).length ? { variantes } : {}),
    ...(Object.keys(visitas).length ? { visitas } : {})
  };
}

function validateTerminalParam(terminal) {
  if (typeof terminal !== 'string' || terminal.length === 0 || /[\u0000-\u001F\u007F]/u.test(terminal)) {
    throw new ValidationError('El parámetro terminal no es válido.');
  }
  return terminal;
}

module.exports = {
  CAMPOS_PERMITIDOS,
  ESTADOS_PERMITIDOS,
  ValidationError,
  parseSearchParams,
  validateTerminalParam
};
