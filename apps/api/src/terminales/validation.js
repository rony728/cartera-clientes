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
  if (!SORT_FIELDS.includes(orden)) throw new ValidationError('El parámetro orden no es válido.');
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

  return {
    q: rawQuery === undefined || rawQuery.trim() === '' ? null : rawQuery.trim(),
    campo,
    pagina: parsePositiveInteger(query.pagina, 'pagina', 1),
    limite: parsePositiveInteger(query.limite, 'limite', 20, 100),
    estado,
    orden,
    direccion,
    filtros
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
