import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCommercePhoto, saveCommercePhoto } from '../api';
import { Icon } from './Icon';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function CommercePhoto({ terminal, offline }: { terminal: string; offline: boolean }) {
  const queryClient = useQueryClient();
  const [imageUrl, setImageUrl] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: ['commerce-photo', terminal],
    queryFn: ({ signal }) => getCommercePhoto(terminal, signal),
    enabled: !offline,
    retry: false
  });
  const mutation = useMutation({
    mutationFn: ({ file, replace }: { file: File; replace: boolean }) => saveCommercePhoto(terminal, file, replace),
    onSuccess: async () => {
      setMessage('Fotografía guardada.');
      await queryClient.invalidateQueries({ queryKey: ['commerce-photo', terminal] });
    },
    onError: (error: Error) => setMessage(error.message || 'No se pudo guardar la fotografía.')
  });

  useEffect(() => {
    if (!query.data?.blob) {
      setImageUrl('');
      return;
    }
    const url = URL.createObjectURL(query.data.blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [query.data]);

  useEffect(() => {
    if (!viewerOpen) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewerOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [viewerOpen]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (offline) {
      setMessage('Se requiere conexión para subir fotografías');
      return;
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      setMessage('Solo se permiten fotografías JPEG, PNG o WebP.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setMessage('La fotografía supera el límite de 8 MiB.');
      return;
    }
    setMessage('');
    mutation.mutate({ file, replace: Boolean(query.data) });
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) setViewerOpen(false);
  }

  const busy = query.isPending || mutation.isPending;
  const hasPhoto = Boolean(query.data && imageUrl);
  return <section className="photo-card" aria-labelledby="commerce-photo-title">
    <div className="photo-heading">
      <div>
        <h2 id="commerce-photo-title">Fotografía del comercio</h2>
        <p>{mutation.isPending ? 'Optimizando y guardando fotografía…' : query.isPending && !offline ? 'Cargando fotografía…' : hasPhoto ? 'Fotografía disponible' : 'Sin fotografía'}</p>
      </div>
      {mutation.isPending && <span className="photo-busy" role="status">Subiendo…</span>}
    </div>

    {query.isError ? <div className="photo-placeholder photo-error" role="alert">
      <Icon name="camera"/><strong>No se pudo cargar la fotografía</strong>
      <button type="button" onClick={() => void query.refetch()}>Reintentar</button>
    </div> : hasPhoto ? <button type="button" className="photo-preview" aria-label="Ampliar fotografía del comercio" onClick={() => setViewerOpen(true)}>
      <img src={imageUrl} alt={`Fotografía del comercio de la terminal ${terminal}`}/>
    </button> : <div className="photo-placeholder">
      <Icon name="camera"/><strong>{offline ? 'Fotografía no disponible sin conexión' : busy ? 'Cargando fotografía…' : 'Sin fotografía'}</strong>
    </div>}

    <div className="photo-actions">
      {hasPhoto && <button type="button" onClick={() => setViewerOpen(true)}>Ampliar</button>}
      <label className={`button ${hasPhoto ? '' : 'primary'}${offline || mutation.isPending ? ' disabled' : ''}`}>
        {hasPhoto ? 'Reemplazar' : 'Agregar fotografía'}
        <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={offline || mutation.isPending} onChange={choosePhoto}/>
      </label>
      <label className={`button photo-camera-action${offline || mutation.isPending ? ' disabled' : ''}`}>
        Tomar fotografía
        <input className="visually-hidden" type="file" accept="image/*" capture="environment" disabled={offline || mutation.isPending} onChange={choosePhoto}/>
      </label>
    </div>
    {offline && <p className="photo-offline">Se requiere conexión para subir fotografías</p>}
    {message && <p className={mutation.isError ? 'alert error' : 'alert'} role="status" aria-live="polite">{message}</p>}

    {viewerOpen && hasPhoto && <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Fotografía ampliada del comercio" onMouseDown={closeFromBackdrop}>
      <div className="photo-viewer-content">
        <button ref={closeButton} type="button" className="photo-viewer-close" aria-label="Cerrar fotografía ampliada" onClick={() => setViewerOpen(false)}>×</button>
        <img src={imageUrl} alt={`Fotografía ampliada del comercio de la terminal ${terminal}`}/>
      </div>
    </div>}
  </section>;
}
