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

export function searchParams(state: SearchState) {
  const params = new URLSearchParams({ campo: state.campo, pagina: String(state.pagina), limite: String(state.limite), estado: state.estado, orden: state.orden, direccion: state.direccion });
  if (state.q) params.set('q', state.q);
  Object.entries(state.filtros).forEach(([key,value]) => { if (value) params.set(key,value); });
  return params;
}
export const searchTerminals = (state: SearchState, signal?: AbortSignal) => api<Page<Terminal>>(`/api/v1/terminales?${searchParams(state)}`, { signal });
