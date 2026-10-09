import { beforeEach, describe, expect, it } from 'vitest';
import { clearUserData, replaceOfflineTerminals, searchOffline } from '../offline';
import type { SearchState, Terminal } from '../types';

const state: SearchState = { q: 'norte', campo: 'todos', pagina: 1, limite: 20, estado: 'activas', orden: 'NombreComercial', direccion: 'asc', filtros: { Zona: 'Norte' } };
const rows: Terminal[] = [
  { terminal: '001', activa: true, version: '1', datos_excel: { NombreComercial: 'B', Zona: 'Norte' } },
  { terminal: '002', activa: true, version: '1', datos_excel: { NombreComercial: 'A', Zona: 'Sur' } }
];
beforeEach(async () => { await clearUserData('u1'); await clearUserData('u2'); });
describe('copia offline', () => {
  it('combina búsqueda, filtro, orden y paginación', async () => {
    await replaceOfflineTerminals('u1', rows);
    const result = await searchOffline('u1', state);
    expect(result.datos.map((row) => row.terminal)).toEqual(['001']);
    expect(result.paginacion.total).toBe(1);
  });
  it('aísla registros por usuario y los elimina al cerrar sesión', async () => {
    await replaceOfflineTerminals('u1', rows); await replaceOfflineTerminals('u2', [rows[1]]);
    expect((await searchOffline('u2', { ...state, q: '', filtros: {} })).paginacion.total).toBe(1);
    await clearUserData('u1');
    expect((await searchOffline('u1', { ...state, q: '', filtros: {} })).paginacion.total).toBe(0);
    expect((await searchOffline('u2', { ...state, q: '', filtros: {} })).paginacion.total).toBe(1);
  });
});
