import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, searchParams, setCsrfToken } from '../api';

afterEach(() => vi.restoreAllMocks());
describe('cliente API seguro', () => {
  it('siempre usa credenciales y no almacena secretos', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await api('/prueba');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/prueba'), expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    expect(localStorage.length).toBe(0);
  });
  it('envía CSRF únicamente en operaciones mutables', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    setCsrfToken('token-memoria');
    await api('/cambio', { method: 'PATCH', body: '{}' });
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('token-memoria');
  });
  it('serializa búsqueda, filtros, orden y paginación', () => {
    const params=searchParams({q:'norte',campo:'Ciudad',pagina:3,limite:20,estado:'activas',orden:'Terminal',direccion:'desc',filtros:{Zona:'Norte',Ciudad:''}});
    expect(params.get('q')).toBe('norte');expect(params.get('Zona')).toBe('Norte');expect(params.has('Ciudad')).toBe(false);expect(params.get('pagina')).toBe('3');expect(params.get('direccion')).toBe('desc');
  });
  it('notifica una sesión expirada sin exponer la respuesta', async () => {
    const listener=vi.fn();window.addEventListener('session-expired',listener,{once:true});
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({mensaje:'No autorizado'}),{status:401,headers:{'Content-Type':'application/json'}}));
    await expect(api('/api/v1/auth/me')).rejects.toMatchObject({status:401});expect(listener).toHaveBeenCalledOnce();
  });
});
