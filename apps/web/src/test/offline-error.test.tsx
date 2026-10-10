import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Commerce from '../pages/Commerce';

vi.mock('../Auth', () => ({
  useAuth: () => ({
    user: { id: '1', nombre: 'Prueba', usuario: 'prueba', rol: 'ADMIN', autenticado: true },
    offline: true
  })
}));

vi.mock('../offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../offline')>();
  return {
    ...actual,
    getColumns: vi.fn().mockResolvedValue([]),
    offlineFilterOptions: vi.fn().mockResolvedValue({ datos: {}, campos: [] }),
    offlineMeta: vi.fn().mockResolvedValue({ count: 1_000, updatedAt: new Date().toISOString() }),
    searchOffline: vi.fn().mockRejectedValue(new Error('detalle interno que no debe mostrarse'))
  };
});

describe('errores de lectura offline', () => {
  it('no presenta un fallo de IndexedDB como cero coincidencias ni revela detalles internos', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Commerce /></MemoryRouter>
      </QueryClientProvider>
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error al leer datos locales');
    expect(alert).toHaveTextContent('La copia no fue eliminada');
    expect(alert).not.toHaveTextContent('Sin coincidencias');
    expect(alert).not.toHaveTextContent('detalle interno');
  });
});
