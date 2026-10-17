import type { SearchState, Terminal } from './types';

export const VISIT_FILTER_KEYS = ['visitas', 'visita_antiguedad_meses', 'visita_desde', 'visita_hasta'] as const;
const zone = 'America/Tegucigalpa';
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });

function parts(date: Date) {
  return Object.fromEntries(calendar.formatToParts(date).map(part => [part.type, part.value]));
}

export function calendarMonth(date: Date) {
  const local = parts(date);
  return Number(local.year) * 12 + Number(local.month) - 1;
}

export function visitDate(terminal: Terminal) {
  if (!terminal.ultima_visita) return null;
  const date = new Date(terminal.ultima_visita);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function visitLabel(terminal: Terminal) {
  const date = visitDate(terminal);
  if (date) {
    const local = parts(date);
    return `${local.day}/${local.month}/${local.year}`;
  }
  if (terminal.tiene_visitas_registradas === false) return 'Sin visitas registradas';
  if (terminal.tiene_visitas_registradas === true) return 'Sin fecha de visita disponible';
  return 'Visitas no disponibles';
}

export function visitWarning(terminal: Terminal, now = new Date()) {
  if (terminal.tiene_visitas_registradas === false) return 'Sin visitas registradas';
  const date = visitDate(terminal);
  return date && calendarMonth(now) - calendarMonth(date) >= 2
    ? 'Última visita de hace 2 meses calendario o más' : null;
}

// La API usa un intervalo [desde, hasta). La interfaz incluye ambos días.
// Honduras mantiene UTC-06:00; nunca interpretar estos días en la zona del navegador.
export function visitBoundary(day: string, exclusiveEnd = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return undefined;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return undefined;
  if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)}T00:00:00-06:00`;
}

export function visitFilters(params: URLSearchParams): Partial<SearchState> {
  const presencia = params.get('visitas'), months = params.get('visita_antiguedad_meses');
  return {
    ...(presencia === 'con' || presencia === 'sin' ? { visitas: presencia } : {}),
    ...(months === '2' || months === '3' ? { visita_antiguedad_meses: months } : {}),
    ...(visitBoundary(params.get('visita_desde') || '') ? { visita_desde: params.get('visita_desde')! } : {}),
    ...(visitBoundary(params.get('visita_hasta') || '') ? { visita_hasta: params.get('visita_hasta')! } : {})
  };
}

export function matchesVisitFilters(terminal: Terminal, state: SearchState, now = new Date()) {
  if (state.visitas && terminal.tiene_visitas_registradas !== (state.visitas === 'con')) return false;
  const date = visitDate(terminal);
  if (state.visita_antiguedad_meses && (!date || !terminal.activa || calendarMonth(now) - calendarMonth(date) < Number(state.visita_antiguedad_meses))) return false;
  const from = state.visita_desde && visitBoundary(state.visita_desde);
  const until = state.visita_hasta && visitBoundary(state.visita_hasta, true);
  if (from && (!date || !terminal.activa || date < new Date(from))) return false;
  if (until && (!date || !terminal.activa || date >= new Date(until))) return false;
  return true;
}

export function compareVisitDates(left: Terminal, right: Terminal, direction: SearchState['direccion']) {
  const a = visitDate(left)?.getTime(), b = visitDate(right)?.getTime();
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return (a - b) * (direction === 'asc' ? 1 : -1);
}
