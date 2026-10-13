import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, getCommercePhoto, importSnapshot, saveCommercePhoto, searchParams, setCsrfToken } from '../api';

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
  it('confirma explícitamente la importación manual desde el Dashboard', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ ok: true, sincronizacion: { id: 1, estado: 'COMPLETADA', total_registros: 1_000 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    setCsrfToken('token-importacion');
    await importSnapshot(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/sincronizaciones');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({
      confirmar_importacion: true,
      confirmar_inactivacion_masiva: true
    });
    expect(new Headers(options?.headers).get('X-CSRF-Token')).toBe('token-importacion');
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
  it('consulta y guarda fotografías como binario autenticado con CSRF', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(new Blob(['webp'], { type: 'image/webp' }), { status: 200, headers: { 'Last-Modified': 'Mon, 12 Oct 2026 00:00:00 GMT' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    setCsrfToken('token-foto');
    const result = await getCommercePhoto('000 123');
    expect(result?.blob).toBeInstanceOf(Blob);
    const file = new File(['jpeg'], 'controlada.jpg', { type: 'image/jpeg' });
    await saveCommercePhoto('000 123', file, false);
    expect(fetchMock.mock.calls[0][0]).toContain('/000%20123/fotografia');
    const upload = fetchMock.mock.calls[1][1]!;
    expect(upload.method).toBe('POST');
    expect(upload.body).toBe(file);
    expect(new Headers(upload.headers).get('Content-Type')).toBe('image/jpeg');
    expect(new Headers(upload.headers).get('X-CSRF-Token')).toBe('token-foto');
  });
});
