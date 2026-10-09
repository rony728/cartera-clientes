import { openDB } from 'idb';
import { searchTerminals } from './api';
import { FILTER_FIELDS, INTERNAL_FIELDS } from './fields';
import type { ExcelData, Page, SearchState, Terminal, User } from './types';

const dbPromise = openDB('cartera-clientes', 1, {
  upgrade(db) {
    const terminals = db.createObjectStore('terminales', { keyPath: 'key' });
    terminals.createIndex('userId', 'userId');
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('preferences', { keyPath: 'key' });
  }
});

const accessHours = Number(import.meta.env.VITE_OFFLINE_ACCESS_HOURS || 24);
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export function normalizeOfflineText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .trim();
}

function normalizeFieldName(value: string) {
  return normalizeOfflineText(value).replace(/[^\p{L}\p{N}]/gu, '');
}

export function excelValue(datosExcel: ExcelData, field: string) {
  if (Object.prototype.hasOwnProperty.call(datosExcel, field)) return datosExcel[field];
  const normalizedField = normalizeFieldName(field);
  const matchingKey = Object.keys(datosExcel).find((key) => normalizeFieldName(key) === normalizedField);
  return matchingKey === undefined ? undefined : datosExcel[matchingKey];
}

function searchableValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(searchableValues);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(searchableValues);
  return [value];
}

function terminalSearchValues(terminal: Terminal) {
  return [
    terminal.terminal,
    ...Object.entries(terminal.datos_excel)
      .filter(([field]) => !INTERNAL_FIELDS.has(field))
      .flatMap(([, value]) => searchableValues(value))
  ];
}

export async function saveOfflineAuth(user: User) {
  const db = await dbPromise;
  await db.put('meta', {
    key: `auth:${user.id}`,
    user,
    authorizedUntil: Date.now() + accessHours * 3_600_000
  });
  await db.put('meta', { key: 'lastUser', userId: user.id });
}

export async function getOfflineAuth(): Promise<User | null> {
  const db = await dbPromise;
  const last = await db.get('meta', 'lastUser');
  if (!last) return null;
  const auth = await db.get('meta', `auth:${last.userId}`);
  return auth?.authorizedUntil > Date.now() ? auth.user : null;
}

export async function clearUserData(userId: string) {
  const db = await dbPromise;
  const tx = db.transaction(['terminales', 'meta', 'preferences'], 'readwrite');
  let cursor = await tx.objectStore('terminales').index('userId').openCursor(IDBKeyRange.only(userId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore('meta').delete(`auth:${userId}`);
  await tx.objectStore('preferences').delete(`columns:${userId}`);
  const last = await tx.objectStore('meta').get('lastUser');
  if (last?.userId === userId) await tx.objectStore('meta').delete('lastUser');
  await tx.done;
}

export async function replaceOfflineTerminals(userId: string, rows: Terminal[]) {
  const db = await dbPromise;
  const tx = db.transaction(['terminales', 'meta'], 'readwrite');
  let cursor = await tx.objectStore('terminales').index('userId').openCursor(IDBKeyRange.only(userId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  for (const terminal of rows) {
    await tx.objectStore('terminales').put({ key: `${userId}:${terminal.terminal}`, userId, ...terminal });
  }
  await tx.objectStore('meta').put({
    key: `sync:${userId}`,
    updatedAt: new Date().toISOString(),
    count: rows.length,
    complete: true
  });
  await tx.done;
}

export async function downloadOffline(user: User, onProgress: (done: number, total: number) => void) {
  const rows: Terminal[] = [];
  let page = 1;
  while (true) {
    const result = await searchTerminals({
      q: '',
      campo: 'todos',
      pagina: page,
      limite: 100,
      estado: user.rol === 'ADMIN' ? 'todas' : 'activas',
      orden: 'NombreComercial',
      direccion: 'asc',
      filtros: {}
    });
    rows.push(...result.datos);
    onProgress(rows.length, result.paginacion.total);
    if (rows.length >= result.paginacion.total) break;
    page += 1;
  }
  await replaceOfflineTerminals(user.id, rows);
  await saveOfflineAuth(user);
  return rows.length;
}

export async function offlineMeta(userId: string) {
  return (await dbPromise).get('meta', `sync:${userId}`);
}

export async function getColumns(userId: string, defaults: string[]) {
  const preference = await (await dbPromise).get('preferences', `columns:${userId}`);
  return preference?.columns || defaults;
}

export async function saveColumns(userId: string, columns: string[]) {
  await (await dbPromise).put('preferences', { key: `columns:${userId}`, columns });
}

export async function allOffline(userId: string): Promise<Terminal[]> {
  return (await dbPromise).getAllFromIndex('terminales', 'userId', userId);
}

export async function offlineTerminal(userId: string, terminal: string): Promise<Terminal | undefined> {
  return (await dbPromise).get('terminales', `${userId}:${terminal}`);
}

export async function offlineFilterOptions(userId: string) {
  const rows = await allOffline(userId);
  const fields = Array.from(new Set(
    rows.flatMap((row) => Object.keys(row.datos_excel).filter((field) => !INTERNAL_FIELDS.has(field)))
  )).sort(collator.compare);
  const datos = Object.fromEntries(FILTER_FIELDS.map((field) => {
    const values = Array.from(new Set(rows
      .map((row) => excelValue(row.datos_excel, field))
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(String)))
      .sort(collator.compare);
    return [field, values];
  }));
  return { datos, campos: fields };
}

export async function searchOffline(userId: string, state: SearchState): Promise<Page<Terminal>> {
  let rows = await allOffline(userId);
  const term = normalizeOfflineText(state.q);

  rows = rows.filter((terminal) => (
    state.estado === 'todas'
    || (state.estado === 'activas' ? terminal.activa : !terminal.activa)
  ));

  if (term) {
    rows = rows.filter((terminal) => {
      const values = state.campo === 'todos'
        ? terminalSearchValues(terminal)
        : [state.campo === 'terminal'
          ? terminal.terminal
          : excelValue(terminal.datos_excel, state.campo)];
      return values.some((value) => normalizeOfflineText(value).includes(term));
    });
  }

  rows = rows.filter((terminal) => Object.entries(state.filtros).every(([field, value]) => (
    !value || normalizeOfflineText(excelValue(terminal.datos_excel, field)) === normalizeOfflineText(value)
  )));

  const sortValue = (terminal: Terminal) => String(
    state.orden === 'Terminal'
      ? terminal.terminal
      : excelValue(terminal.datos_excel, state.orden) ?? ''
  );
  const direction = state.direccion === 'asc' ? 1 : -1;
  rows.sort((left, right) => {
    const comparison = collator.compare(sortValue(left), sortValue(right));
    return comparison === 0
      ? collator.compare(left.terminal, right.terminal)
      : comparison * direction;
  });

  const total = rows.length;
  const start = (state.pagina - 1) * state.limite;
  return {
    datos: rows.slice(start, start + state.limite),
    paginacion: {
      pagina: state.pagina,
      limite: state.limite,
      total,
      total_paginas: Math.ceil(total / state.limite)
    }
  };
}
