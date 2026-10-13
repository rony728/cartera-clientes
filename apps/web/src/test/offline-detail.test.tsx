import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    ubicacion_interna: 'Pista',
    referencia_interna: 'Entrada lateral frente a farmacia',
    datos_excel: {
      NombreComercial: 'Ferretería El Águila',
      CodigoComercio: '00077',
      SeriePOS: 'SERIE-ABC-09',
      Atendio: 'Ana López',
      Celular: '09990000',
      Correo: 'ana@example.com',
      RedSimcard: 'Tigo',
      SerieSimcard: '0000004567',
      Inventario: 'INV-001',
      IP: '10.0.0.7',
      TecnicoAsignado: 'Técnico Uno',
      CampoDinamico: 'Detalle disponible sin conexión'
    }
  }]);
});

describe('ficha offline', () => {
  it('abre el registro completo desde IndexedDB sin consultar la API', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/comercios/00001234', state: { search: '?campo=SeriePOS&q=ABC&pagina=2' } }]}>
          <Routes>
            <Route path="/comercios/:terminal" element={<Detail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Ferretería El Águila' })).toBeInTheDocument();
    expect(screen.getByText('Pista')).toBeInTheDocument();
    const commerceLocation = screen.getByText('Comercio y ubicación').closest('details')!;
    expect(within(commerceLocation).getByText('Referencia interna')).toBeInTheDocument();
    expect(within(commerceLocation).getByText('Entrada lateral frente a farmacia')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Volver' })).toHaveAttribute('href', '/comercios?campo=SeriePOS&q=ABC&pagina=2');
    expect(screen.getByText('00077')).toBeInTheDocument();
    expect(screen.getByText('SERIE-ABC-09')).toBeInTheDocument();
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('Detalle disponible sin conexión')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copiar Terminal' })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Copiar Terminal' })[0]);
    expect(writeText).toHaveBeenCalledWith('00001234');
    expect(screen.getByRole('status')).toHaveTextContent('Terminal: Copiado');
    expect(Array.from(document.querySelectorAll('.primary-field-grid .field')).map((element) => element.getAttribute('data-field'))).toEqual([
      'NombreComercial', 'CodigoComercio', 'Terminal', 'SeriePOS', 'Atendio', 'Celular', 'Correo', 'SerieSimcard'
    ]);
    const connectivity = screen.getByText('Conectividad').closest('details')!;
    expect(within(connectivity).getByText('Red SIM')).toBeInTheDocument();
    for (const section of ['Comercio y ubicación', 'Equipo POS', 'Conectividad', 'Contacto y gestión', 'Campos adicionales']) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    const photo = screen.getByText('Fotografía del comercio').closest('.photo-card');
    const history = screen.getByRole('heading', { name: 'Historial de cambios' }).closest('.history');
    expect(photo).not.toBeNull();
    expect(history).not.toBeNull();
    expect(photo!.compareDocumentPosition(history!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('El historial no está disponible en esta copia local.')).toBeInTheDocument();
  });
});
