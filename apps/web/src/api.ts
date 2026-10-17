import { visitBoundary } from './visitas';
import type { Page, SearchState, Terminal, User } from './types';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3005').replace(/\/$/u, '');
export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}
let csrfToken = '';
export const setCsrfToken = (token: string) => { csrfToken = token; };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.method && !['GET', 'HEAD'].includes(options.method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include', cache: 'no-store' });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith('/login')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, data?.mensaje || data?.error || 'No se pudo completar la solicitud.', data);
  }
  return data as T;
}

export async function getCsrf() {
  const result = await api<{csrf_token:string}>('/api/v1/auth/csrf'); setCsrfToken(result.csrf_token); return result.csrf_token;
}
export const getMe = () => api<User>('/api/v1/auth/me');
export async function login(usuario: string, password: string) {
  await getCsrf();
  const result = await api<{usuario:User;csrf_token:string}>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ usuario, password }) });
  setCsrfToken(result.csrf_token); return result.usuario;
}
export const logout = () => api('/api/v1/auth/logout', { method: 'POST' });

export interface CommercePhotoResponse {
  blob: Blob;
  lastModified: string | null;
}

async function photoRequest(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.method && !['GET', 'HEAD'].includes(options.method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...options, headers, credentials: 'include', cache: 'no-store'
  });
  if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
  return response;
}

export async function getCommercePhoto(terminal: string, signal?: AbortSignal): Promise<CommercePhotoResponse | null> {
  const response = await photoRequest(`/api/v1/terminales/${encodeURIComponent(terminal)}/fotografia`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.mensaje || 'No se pudo cargar la fotografía.', data);
  }
  return { blob: await response.blob(), lastModified: response.headers.get('Last-Modified') };
}

export async function saveCommercePhoto(terminal: string, file: File, replace: boolean) {
  const response = await photoRequest(`/api/v1/terminales/${encodeURIComponent(terminal)}/fotografia`, {
    method: replace ? 'PUT' : 'POST', headers: { 'Content-Type': file.type }, body: file
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.mensaje || 'No se pudo guardar la fotografía.', data);
  }
  return data as { ok: true };
}

export function importSnapshot(confirmMassDeactivation = false) {
  return api('/api/v1/sincronizaciones', {
    method: 'POST',
    body: JSON.stringify({
      confirmar_importacion: true,
      ...(confirmMassDeactivation ? { confirmar_inactivacion_masiva: true } : {})
    })
  });
}

export function searchParams(state: SearchState) {
  const params = new URLSearchParams({ campo: state.campo, pagina: String(state.pagina), limite: String(state.limite), estado: state.estado, orden: state.orden, direccion: state.direccion });
  if (state.q) params.set('q', state.q);
  Object.entries(state.filtros).forEach(([key,value]) => { if (value) params.set(key,value); });
  if(state.variantes && Object.keys(state.variantes).length) params.set('filtros_variantes',JSON.stringify(state.variantes));
  if(state.visitas) params.set('visitas',state.visitas);
  if(state.visita_antiguedad_meses) params.set('visita_antiguedad_meses',state.visita_antiguedad_meses);
  if(state.visita_desde) params.set('visita_desde',visitBoundary(state.visita_desde) || state.visita_desde);
  if(state.visita_hasta) params.set('visita_hasta',visitBoundary(state.visita_hasta,true) || state.visita_hasta);
  return params;
}
export const searchTerminals = (state: SearchState, signal?: AbortSignal) => api<Page<Terminal>>(`/api/v1/terminales?${searchParams(state)}`, { signal });
