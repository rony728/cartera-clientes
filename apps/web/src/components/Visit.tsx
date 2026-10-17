import type { Terminal } from '../types';
import { visitLabel, visitWarning, visitDate } from '../visitas';
import { Icon } from './Icon';

export function VisitWarning({ terminal }: { terminal: Terminal }) {
  const warning = visitWarning(terminal);
  return warning ? <span className="visit-warning" role="img" aria-label={warning} title={warning}><Icon name="warning"/></span> : null;
}

export function LastVisit({ terminal }: { terminal: Terminal }) {
  const date = visitDate(terminal), label = visitLabel(terminal);
  return date ? <time dateTime={terminal.ultima_visita!}>{label}</time> : <span title={terminal.tiene_visitas_registradas && terminal.activa ? 'Hay visitas registradas; ninguna fecha es elegible hasta el fin del mes actual en Honduras.' : undefined}>{label}</span>;
}
