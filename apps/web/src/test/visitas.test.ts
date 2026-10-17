import { describe, expect, it } from 'vitest';
import { calendarMonth, compareVisitDates, matchesVisitFilters, visitBoundary, visitFilters, visitLabel, visitWarning } from '../visitas';
import type { SearchState, Terminal } from '../types';

const terminal = (date: string | null, hasVisits = true): Terminal => ({ terminal:'001',activa:true,version:1,datos_excel:{},ultima_visita:date,tiene_visitas_registradas:hasVisits });
const state: SearchState = { q:'',campo:'NombreComercial',pagina:1,limite:1,estado:'activas',orden:'ultima_visita',direccion:'asc',filtros:{} };
const october = new Date('2026-10-17T12:00:00Z');

describe('última visita y calendario de Honduras', () => {
  it('formatea fechas locales sin confundir medianoche UTC con Honduras', () => {
    expect(visitLabel(terminal('2026-10-02T01:00:00Z'))).toBe('01/10/2026');
    expect(visitLabel(terminal(null,false))).toBe('Sin visitas registradas');
    expect(visitLabel(terminal(null))).toBe('Sin fecha de visita disponible');
    expect(visitLabel({...terminal(null),tiene_visitas_registradas:undefined})).toBe('Visitas no disponibles');
    expect(visitLabel(terminal('incorrecta'))).toBe('Sin fecha de visita disponible');
  });
  it.each([
    ['2026-08-31T23:59:59-06:00',true], ['2026-09-01T00:00:00-06:00',false],
    ['2026-10-31T23:59:59-06:00',false], ['2026-11-01T00:00:00-06:00',false]
  ])('advierte por meses calendario para %s', (date,warning) => {
    expect(Boolean(visitWarning(terminal(date),october))).toBe(warning);
  });
  it('resuelve el cambio de año y el mes local en la frontera UTC', () => {
    expect(visitWarning(terminal('2026-11-30T12:00:00-06:00'),new Date('2027-01-01T06:00:00Z'))).toBeTruthy();
    expect(visitWarning(terminal('2026-12-01T12:00:00-06:00'),new Date('2027-01-01T06:00:00Z'))).toBeNull();
    expect(calendarMonth(new Date('2027-01-01T05:59:59Z'))).toBe(2026*12+11);
  });
  it('distingue ausencia real y registros sin fecha elegible del mes siguiente', () => {
    expect(visitWarning(terminal(null,false),october)).toBe('Sin visitas registradas');
    expect(visitWarning(terminal(null,true),october)).toBeNull();
    expect(visitWarning({...terminal(null),tiene_visitas_registradas:undefined},october)).toBeNull();
    expect(matchesVisitFilters(terminal(null,true),{...state,visitas:'con'},october)).toBe(true);
    expect(matchesVisitFilters(terminal(null,true),{...state,visita_antiguedad_meses:'2'},october)).toBe(false);
  });
  it('construye rango inclusivo con extremo superior exclusivo y valida días reales', () => {
    expect(visitBoundary('2026-12-31',true)).toBe('2027-01-01T00:00:00-06:00');
    expect(visitBoundary('2026-02-30')).toBeUndefined();
    expect(visitFilters(new URLSearchParams('visitas=sin&visita_antiguedad_meses=60&visita_desde=2026-02-30'))).toEqual({visitas:'sin'});
    expect(matchesVisitFilters(terminal('2026-10-31T23:59:59-06:00'),{...state,visita_desde:'2026-10-01',visita_hasta:'2026-10-31'},october)).toBe(true);
    expect(matchesVisitFilters(terminal('2026-11-01T00:00:00-06:00'),{...state,visita_hasta:'2026-10-31'},october)).toBe(false);
  });
  it('ordena fechas por instante, con nulos al final en ambas direcciones', () => {
    const older=terminal('2026-01-01T00:00:00-06:00'), newer=terminal('2026-10-01T00:00:00-06:00'), empty=terminal(null,false);
    expect([empty,newer,older].sort((a,b)=>compareVisitDates(a,b,'asc'))).toEqual([older,newer,empty]);
    expect([empty,older,newer].sort((a,b)=>compareVisitDates(a,b,'desc'))).toEqual([newer,older,empty]);
  });
});
