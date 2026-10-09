import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Detail from '../pages/Detail';
import { clearUserData, replaceOfflineTerminals } from '../offline';

vi.mock('../Auth', () => ({
  useAuth: () => ({
    user: { id: 'offline-user', nombre: 'Prueba', usuario: 'prueba', rol: 'ADMIN', autenticado: true },
    offline: true
  })
}));

beforeEach(async () => {
  await clearUserData('offline-user');
  await replaceOfflineTerminals('offline-user', [{
    terminal: '00001234',
    activa: true,
    version: '5',
    datos_excel: {
      NombreComercial: 'Ferretería El Águila',
      CodigoComercio: '00077',
      SeriePOS: 'SERIE-ABC-09',
      Inventario: 'INV-001',
      CampoDinamico: 'Detalle disponible sin conexión'
    }
  }]);
});

describe('ficha offline', () => {
  it('abre el registro completo desde IndexedDB sin consultar la API', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/comercios/00001234']}>
          <Routes>
            <Route path="/comercios/:terminal" element={<Detail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Ferretería El Águila' })).toBeInTheDocument();
    expect(screen.getByText('00077')).toBeInTheDocument();
    expect(screen.getByText('SERIE-ABC-09')).toBeInTheDocument();
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('Detalle disponible sin conexión')).toBeInTheDocument();
    expect(screen.getByText('El historial no está disponible en esta copia local.')).toBeInTheDocument();
  });
});
