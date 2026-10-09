export type Role = 'ADMIN' | 'USUARIO';
export interface User { id: string; nombre: string; usuario: string; rol: Role; autenticado: true }
export type ExcelData = Record<string, string | number | boolean | null>;
export interface Terminal { terminal: string; activa: boolean; version: string | number; datos_excel: ExcelData; fecha_actualizacion?: string; fecha_ultima_sincronizacion?: string }
export interface Pagination { pagina: number; limite: number; total: number; total_paginas: number }
export interface Page<T> { datos: T[]; paginacion: Pagination }
export interface HistoryEntry { id: string; campo: string; valor_anterior: unknown; valor_anterior_presente: boolean; valor_nuevo: unknown; valor_nuevo_presente: boolean; origen: 'PWA'|'EXCEL'|'SISTEMA'; fecha: string; responsable?: string; estado_excel?: string }
export interface SearchState { q: string; campo: string; pagina: number; limite: number; estado: string; orden: string; direccion: 'asc'|'desc'; filtros: Record<string,string> }
