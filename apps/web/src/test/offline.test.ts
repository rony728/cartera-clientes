import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearUserData,
  getColumns,
  getColumnWidths,
  getOfflineAuth,
  offlineFilterOptions,
  offlineTerminal,
  replaceOfflineTerminals,
  saveColumns,
  saveColumnWidths,
  saveOfflineAuth,
  searchOffline
} from '../offline';
import type { SearchState, Terminal } from '../types';

const baseState: SearchState = {
  q: '',
  campo: 'todos',
  pagina: 1,
  limite: 20,
  estado: 'activas',
  orden: 'NombreComercial',
  direccion: 'asc',
  filtros: {}
};

const rows: Terminal[] = [
  {
    terminal: '00001234',
    activa: true,
    version: '1',
    ubicacion_interna: 'Pista',
    referencia_interna: 'Entrada frente a farmacia',
    datos_excel: {
      NombreComercial: 'Ferretería El Águila',
      CodigoComercio: '00077',
      SeriePOS: 'SÉRIE-ÁBC-09',
      Inventario: 'INV-001',
      Zona: 'Nórte',
      Ciudad: 'Tegucigalpa',
      Comunicacion: ' Gprs ',
      CampoDinamico: 'Referencia especial'
    }
  },
  {
    terminal: '00005678',
    activa: true,
    version: '2',
    datos_excel: {
      NombreComercial: 'Abarrotes Central',
      CodigoComercio: '00120',
      SeriePOS: 'SERIE-XYZ-10',
      Inventario: 'INV-002',
      Zona: 'Sur',
      Ciudad: 'San Pedro Sula',
      Comunicacion: 'GPRS'
    }
  },
  {
    terminal: '00009000',
    activa: false,
    version: '3',
    datos_excel: {
      NombreComercial: 'Ferretería Cerrada',
      CodigoComercio: '00900',
      SeriePOS: 'SERIE-CERRADA',
      Inventario: 'INV-003',
      Zona: 'Norte'
    }
  }
];

beforeEach(async () => {
  await clearUserData('u1');
  await clearUserData('u2');
});

afterEach(() => vi.restoreAllMocks());

describe('consulta offline', () => {
  it('conserva columnas y anchos en la misma preferencia por usuario', async () => {
    await saveColumns('u1', ['Inventario', 'SeriePOS']);
    await saveColumnWidths('u1', { NombreComercial: 320, Inventario: 140 });

    expect(await getColumns('u1', [])).toEqual(['Inventario', 'SeriePOS']);
    expect(await getColumnWidths('u1')).toEqual({ NombreComercial: 320, Inventario: 140 });

    await saveColumns('u1', ['SeriePOS']);
    expect(await getColumnWidths('u1')).toEqual({ NombreComercial: 320, Inventario: 140 });
  });

  it('encuentra un nombre comercial sin distinguir mayúsculas ni tildes', async () => {
    await replaceOfflineTerminals('u1', rows);

    const result = await searchOffline('u1', { ...baseState, q: 'FERRETERIA' });

    expect(result.datos.map((row) => row.terminal)).toEqual(['00001234']);
  });

  it.each([
    ['terminal', '00123'],
    ['CodigoComercio', '0077'],
    ['SeriePOS', 'serie-abc'],
    ['Inventario', 'inv-001']
  ])('busca coincidencias parciales en %s', async (campo, q) => {
    await replaceOfflineTerminals('u1', rows);

    const result = await searchOffline('u1', { ...baseState, campo, q });

    expect(result.datos.map((row) => row.terminal)).toEqual(['00001234']);
  });

  it('combina búsqueda, filtros, estado, orden y paginación', async () => {
    await replaceOfflineTerminals('u1', rows);

    const firstPage = await searchOffline('u1', {
      ...baseState,
      q: 'ferreteria',
      pagina: 1,
      limite: 1,
      estado: 'todas',
      orden: 'Terminal',
      direccion: 'desc',
      filtros: { Zona: 'norte' }
    });
    const secondPage = await searchOffline('u1', {
      ...baseState,
      q: 'ferreteria',
      pagina: 2,
      limite: 1,
      estado: 'todas',
      orden: 'Terminal',
      direccion: 'desc',
      filtros: { Zona: 'norte' }
    });

    expect(firstPage.datos.map((row) => row.terminal)).toEqual(['00009000']);
    expect(secondPage.datos.map((row) => row.terminal)).toEqual(['00001234']);
    expect(firstPage.paginacion).toMatchObject({ total: 2, total_paginas: 2 });
  });

  it('busca valores dinámicos pero no nombres internos de propiedades', async () => {
    await replaceOfflineTerminals('u1', rows);

    const valueMatch = await searchOffline('u1', { ...baseState, q: 'referencia especial' });
    const propertyName = await searchOffline('u1', { ...baseState, q: 'CampoDinamico' });

    expect(valueMatch.datos.map((row) => row.terminal)).toEqual(['00001234']);
    expect(propertyName.paginacion.total).toBe(0);
  });

  it.each([
    ['todos', 'pista'],
    ['ubicacion_interna', 'pista'],
    ['todos', 'frente a farmacia'],
    ['referencia_interna', 'frente a farmacia']
  ])('encuentra datos internos con búsqueda %s', async (campo, q) => {
    await replaceOfflineTerminals('u1', rows);
    const result = await searchOffline('u1', { ...baseState, campo, q });
    expect(result.datos.map((row) => row.terminal)).toEqual(['00001234']);
  });

  it('mantiene compatibles los registros cacheados antes de existir los campos internos', async () => {
    await replaceOfflineTerminals('u1', [{...rows[1]}]);
    const stored = await offlineTerminal('u1', '00005678');
    expect(stored?.ubicacion_interna).toBeUndefined();
    expect((await searchOffline('u1', {...baseState,q:'central'})).paginacion.total).toBe(1);
  });

  it('resuelve diferencias de espacios, mayúsculas y tildes en nombres de campo', async () => {
    await replaceOfflineTerminals('u1', [{
      terminal: '00009999',
      activa: true,
      version: '1',
      datos_excel: { 'Nombre Comercial': 'Café del Centro', 'Código Comercio': '00042' }
    }]);

    const byName = await searchOffline('u1', { ...baseState, campo: 'NombreComercial', q: 'cafe' });
    const byCode = await searchOffline('u1', { ...baseState, campo: 'CodigoComercio', q: '0042' });

    expect(byName.datos.map((row) => row.terminal)).toEqual(['00009999']);
    expect(byCode.datos.map((row) => row.terminal)).toEqual(['00009999']);
  });

  it('genera opciones de filtros y campos dinámicos desde toda la copia local', async () => {
    await replaceOfflineTerminals('u1', rows);

    const options = await offlineFilterOptions('u1');

    expect(options.datos.Zona).toEqual(['Norte', 'Sur']);
    expect(options.datos.Comunicacion).toEqual(['GPRS']);
    expect(options.campos).toContain('CampoDinamico');
  });

  it('agrupa variantes equivalentes sin modificar los valores almacenados', async () => {
    await replaceOfflineTerminals('u1', rows);

    const result = await searchOffline('u1', { ...baseState, filtros: { Comunicacion: 'GPRS' } });
    const stored = await offlineTerminal('u1', '00001234');

    expect(result.datos.map((row) => row.terminal)).toEqual(['00005678', '00001234']);
    expect(stored?.datos_excel.Comunicacion).toBe(' Gprs ');
  });

  it('devuelve cero para términos realmente ausentes aunque existan registros locales', async () => {
    await replaceOfflineTerminals('u1', rows);

    const result = await searchOffline('u1', { ...baseState, q: 'comercio inexistente' });

    expect(result.paginacion.total).toBe(0);
  });

  it('recorre los 1,000 registros locales y no solo la primera página descargada', async () => {
    const thousandRows = Array.from({ length: 1_000 }, (_, index): Terminal => ({
      terminal: String(index + 1).padStart(8, '0'),
      activa: true,
      version: '1',
      datos_excel: {
        NombreComercial: index === 999 ? 'Ferretería Índice Final' : `Comercio ${index + 1}`,
        CodigoComercio: String(index + 1).padStart(7, '0')
      }
    }));
    await replaceOfflineTerminals('u1', thousandRows);

    const result = await searchOffline('u1', { ...baseState, q: 'ferreteria indice final' });

    expect(result.paginacion.total).toBe(1);
    expect(result.datos[0].terminal).toBe('00001000');
  });

  it('distingue un término ausente de una coincidencia bloqueada por filtros persistentes', async () => {
    await replaceOfflineTerminals('u1', rows);

    const filtered = await searchOffline('u1', {
      ...baseState,
      q: 'ferreteria',
      filtros: { Zona: 'Sur' }
    });
    const withoutFilters = await searchOffline('u1', { ...baseState, q: 'ferreteria' });

    expect(filtered.paginacion.total).toBe(0);
    expect(withoutFilters.datos.map((row) => row.terminal)).toEqual(['00001234']);
  });

  it('abre la ficha completa y conserva identificadores como texto', async () => {
    await replaceOfflineTerminals('u1', rows);

    const terminal = await offlineTerminal('u1', '00001234');

    expect(terminal?.terminal).toBe('00001234');
    expect(typeof terminal?.terminal).toBe('string');
    expect(terminal?.datos_excel.CodigoComercio).toBe('00077');
    expect(terminal?.datos_excel.CampoDinamico).toBe('Referencia especial');
    expect(terminal?.ubicacion_interna).toBe('Pista');
    expect(terminal?.referencia_interna).toBe('Entrada frente a farmacia');
  });

  it('aísla registros por usuario y los elimina al cerrar sesión', async () => {
    await replaceOfflineTerminals('u1', rows);
    await replaceOfflineTerminals('u2', [rows[1]]);

    expect((await searchOffline('u2', baseState)).paginacion.total).toBe(1);
    await clearUserData('u1');
    expect((await searchOffline('u1', baseState)).paginacion.total).toBe(0);
    expect((await searchOffline('u2', baseState)).paginacion.total).toBe(1);
  });

  it('canoniza el identificador de usuario para las claves e índices de IndexedDB', async () => {
    await replaceOfflineTerminals(1, [rows[0]]);

    const result = await searchOffline('1', { ...baseState, q: '00001234' });
    const detail = await offlineTerminal(1, '00001234');

    expect(result.datos.map((row) => row.terminal)).toEqual(['00001234']);
    expect(detail?.terminal).toBe('00001234');
  });

  it('rechaza una autorización local expirada sin eliminar la cartera descargada', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await saveOfflineAuth({
      id: 'u1',
      nombre: 'Usuario uno',
      usuario: 'usuario.uno',
      rol: 'USUARIO',
      autenticado: true
    });
    await replaceOfflineTerminals('u1', [rows[0]]);
    clock.mockReturnValue(now + 25 * 3_600_000);

    expect(await getOfflineAuth()).toBeNull();
    expect((await searchOffline('u1', baseState)).paginacion.total).toBe(1);
    clock.mockRestore();
  });
});

it('filtra visitas antes de paginar la copia local y conserva nulos al final', async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  try{
    await replaceOfflineTerminals('u1',[
      {...rows[0],ultima_visita:'2026-07-31T23:59:59-06:00',tiene_visitas_registradas:true},
      {...rows[1],ultima_visita:'2026-08-31T23:59:59-06:00',tiene_visitas_registradas:true},
      {...rows[0],terminal:'00003',ultima_visita:null,tiene_visitas_registradas:false},
      {...rows[0],terminal:'00004',ultima_visita:null,tiene_visitas_registradas:true}
    ]);
    const query={...baseState,orden:'ultima_visita',limite:1,visita_antiguedad_meses:'2' as const};
    const first=await searchOffline('u1',query), second=await searchOffline('u1',{...query,pagina:2});
    expect(first.paginacion).toEqual({pagina:1,limite:1,total:2,total_paginas:2});
    expect(first.datos[0].terminal).toBe(rows[0].terminal);
    expect(second.datos[0].terminal).toBe(rows[1].terminal);
    expect((await searchOffline('u1',{...baseState,visitas:'sin'})).datos.map(t=>t.terminal)).toEqual(['00003']);
    expect((await searchOffline('u1',{...baseState,visitas:'con'})).datos).toHaveLength(3);
    expect((await searchOffline('u1',{...baseState,visita_antiguedad_meses:'3'})).datos).toHaveLength(1);
    expect((await searchOffline('u1',{...baseState,visita_desde:'2026-08-01',visita_hasta:'2026-08-31'})).datos[0].terminal).toBe(rows[1].terminal);
    expect((await searchOffline('u1',{...baseState,orden:'ultima_visita',direccion:'desc'})).datos.slice(0,2).map(t=>t.terminal)).toEqual([rows[1].terminal,rows[0].terminal]);
  }finally{vi.useRealTimers();}
});
