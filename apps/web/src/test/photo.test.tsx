import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercePhoto } from '../components/CommercePhoto';

const apiMocks = vi.hoisted(() => ({
  getCommercePhoto: vi.fn(),
  saveCommercePhoto: vi.fn()
}));

vi.mock('../api', () => apiMocks);

function renderPhoto(offline = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CommercePhoto terminal="000123" offline={offline}/></QueryClientProvider>);
}

beforeEach(() => {
  apiMocks.getCommercePhoto.mockReset().mockResolvedValue(null);
  apiMocks.saveCommercePhoto.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:foto-controlada'),
    revokeObjectURL: vi.fn()
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('fotografía del comercio', () => {
  it('muestra el estado vacío y sube una imagen nueva', async () => {
    renderPhoto();
    const input = await screen.findByLabelText('Agregar fotografía');
    const file = new File(['jpeg-controlado'], 'comercio.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(apiMocks.saveCommercePhoto).toHaveBeenCalledWith('000123', file, false));
    expect(await screen.findByRole('status')).toHaveTextContent('Fotografía guardada.');
  });

  it('informa un error de carga y permite reintentar', async () => {
    apiMocks.getCommercePhoto.mockRejectedValueOnce(new Error('fallo controlado')).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    renderPhoto();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la fotografía');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(apiMocks.getCommercePhoto).toHaveBeenCalledTimes(2));
  });

  it('muestra el error devuelto al subir sin bloquear la ficha', async () => {
    apiMocks.saveCommercePhoto.mockRejectedValueOnce(new Error('No se pudo procesar la fotografía.'));
    renderPhoto();
    const input = await screen.findByLabelText('Agregar fotografía');
    fireEvent.change(input, { target: { files: [new File(['jpeg'], 'fallo.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByRole('status')).toHaveTextContent('No se pudo procesar la fotografía.');
    expect(screen.getByRole('heading', { name: 'Fotografía del comercio' })).toBeInTheDocument();
  });

  it('reemplaza la imagen existente y abre/cierra el visor con Escape', async () => {
    apiMocks.getCommercePhoto.mockResolvedValue({ blob: new Blob(['webp'], { type: 'image/webp' }), lastModified: null });
    const user = userEvent.setup();
    renderPhoto();
    expect(await screen.findByRole('button', { name: 'Ampliar fotografía del comercio' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ampliar' }));
    expect(screen.getByRole('dialog', { name: 'Fotografía ampliada del comercio' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const file = new File(['png-controlado'], 'reemplazo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Reemplazar'), { target: { files: [file] } });
    await waitFor(() => expect(apiMocks.saveCommercePhoto).toHaveBeenCalledWith('000123', file, true));
  });

  it('desactiva las cargas offline y muestra el mensaje requerido', () => {
    renderPhoto(true);
    expect(screen.getByText('Se requiere conexión para subir fotografías')).toBeInTheDocument();
    expect(screen.getByLabelText('Agregar fotografía')).toBeDisabled();
    expect(screen.getByLabelText('Tomar fotografía')).toBeDisabled();
    expect(apiMocks.getCommercePhoto).not.toHaveBeenCalled();
  });

  it('valida formato y tamaño antes de consultar el backend', async () => {
    renderPhoto();
    const input = await screen.findByLabelText('Agregar fotografía');
    fireEvent.change(input, { target: { files: [new File(['pdf'], 'archivo.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByRole('status')).toHaveTextContent('Solo se permiten fotografías JPEG, PNG o WebP.');
    expect(apiMocks.saveCommercePhoto).not.toHaveBeenCalled();
  });
});
