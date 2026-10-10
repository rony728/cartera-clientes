import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { AuthProvider } from '../Auth';
import { clearUserData, offlineMeta } from '../offline';
import type { Terminal } from '../types';

const authenticatedUser = {
  id: '1',
  nombre: 'Administrador de prueba',
  usuario: 'admin.prueba',
  rol: 'ADMIN' as const,
  autenticado: true as const
};

const records = Array.from({ length: 1_000 }, (_, index): Terminal => {
  const number = index + 1;
  return {
    terminal: String(number).padStart(8, '0'),
    activa: true,
    version: '1',
    datos_excel: {
      NombreComercial: number === 284 ? 'Ferretería Terminal 284' : `Comercio ${number}`,
      CodigoComercio: String(number).padStart(7, '0'),
      SeriePOS: number === 284 ? 'SERIE-ESPECIAL-284' : `SERIE-${number}`,
      Inventario: `INV-${String(number).padStart(4, '0')}`,
      CampoDinamico: number === 284 ? 'Valor local completo' : `Valor ${number}`
    }
  };
});

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  }));
}

function terminalPage(url: URL) {
  const q = normalized(url.searchParams.get('q'));
  const page = Number(url.searchParams.get('pagina') || 1);
  const limit = Number(url.searchParams.get('limite') || 20);
  const filtered = q
    ? records.filter((record) => [record.terminal, ...Object.values(record.datos_excel)]
      .some((value) => normalized(value).includes(q)))
    : records;
  const start = (page - 1) * limit;
  return {
    datos: filtered.slice(start, start + limit),
    paginacion: {
      pagina: page,
      limite: limit,
      total: filtered.length,
      total_paginas: Math.ceil(filtered.length / limit)
    }
  };
}

function installApiMock() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/api/v1/auth/me')) return json(authenticatedUser);
    if (url.pathname.endsWith('/api/v1/auth/csrf')) return json({ csrf_token: 'csrf-de-prueba' });
    if (url.pathname.endsWith('/api/v1/terminales/filtros/opciones')) {
      return json({ datos: {}, campos: ['NombreComercial', 'CodigoComercio', 'SeriePOS', 'Inventario', 'CampoDinamico'] });
    }
    const detail = url.pathname.match(/\/api\/v1\/terminales\/([^/]+)$/u);
    if (detail) {
      const record = records.find((item) => item.terminal === decodeURIComponent(detail[1]));
      return record ? json(record) : json({ mensaje: 'No encontrado' }, 404);
    }
    if (url.pathname.endsWith('/api/v1/terminales')) return json(terminalPage(url));
    return json({ mensaje: 'Solicitud inesperada' }, 500);
  });
}

function setConnection(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
  onlineManager.setOnline(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

async function waitForDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

describe('flujo completo online → offline → online', () => {
  beforeEach(async () => {
    await clearUserData('1');
    setConnection(true);
  });

  afterEach(() => {
    setConnection(true);
    vi.restoreAllMocks();
  });

  it('consulta los 1,000 registros locales, abre la ficha y vuelve a la API', async () => {
    const fetchMock = installApiMock();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } }
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/comercios']}>
          <AuthProvider><App /></AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText('En línea')).toBeInTheDocument();
    await waitFor(async () => expect((await offlineMeta('1'))?.count).toBe(1_000));

    const search = screen.getByRole('textbox', { name: 'Buscar comercios' });
    await user.type(search, '00000284');
    await waitForDebounce();
    expect(await screen.findByRole('link', { name: /Ferretería Terminal 284/u })).toBeInTheDocument();
    await user.clear(search);
    await waitForDebounce();

    await act(async () => setConnection(false));
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
    const callsAtOffline = fetchMock.mock.calls.length;

    await user.clear(search);
    await user.type(search, '00000284');
    await waitForDebounce();
    expect(await screen.findByRole('link', { name: /Ferretería Terminal 284/u })).toBeInTheDocument();
    expect(screen.getByText('1 resultados')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'serie-especial-284');
    await waitForDebounce();
    expect(await screen.findByRole('link', { name: /Ferretería Terminal 284/u })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '00000284');
    await waitForDebounce();
    await user.click(await screen.findByRole('link', { name: /Ferretería Terminal 284/u }));
    expect(await screen.findByText('Historial de cambios')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ferretería Terminal 284' })).toBeInTheDocument();
    expect(screen.getByText('Valor local completo')).toBeInTheDocument();
    expect(screen.getByText('El historial no está disponible en esta copia local.')).toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(callsAtOffline);

    const callsBeforeReconnect = fetchMock.mock.calls.length;
    await act(async () => setConnection(true));
    expect(await screen.findByText('En línea')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeReconnect));
    expect(await screen.findByRole('heading', { name: 'Ferretería Terminal 284' })).toBeInTheDocument();
  }, 15_000);
});
