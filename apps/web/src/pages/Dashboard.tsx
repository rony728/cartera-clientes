import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { ApiError, api, importSnapshot } from '../api';
import { useAuth } from '../Auth';
import { metaFor } from '../fields';
import { groupDistribution } from '../normalization';

interface DashboardData {
  indicadores: Record<string, number | null>;
  distribuciones: Record<string, { valor: string; total: number }[]>;
}

interface SynchronizationResult {
  sincronizacion: { id: string | number; estado: string; total_registros: number };
}

interface SynchronizationSummary {
  estado: string;
  fecha_fin?: string;
  insertados: number;
  actualizados: number;
  inactivados: number;
  detalle_error?: string;
}

const labels: Record<string, string> = {
  activas: 'Terminales activas',
  inactivas: 'Terminales inactivas',
  tecnicos: 'Técnicos',
  zonas: 'Zonas',
  ciudades: 'Ciudades',
  categorias: 'Categorías'
};

export default function Dashboard() {
  const { user, offline } = useAuth();
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/api/v1/terminales/dashboard/resumen'),
    enabled: !offline
  });
  const last = useQuery({
    queryKey: ['last-sync'],
    queryFn: () => api<{ datos: SynchronizationSummary[] }>('/api/v1/sincronizaciones?pagina=1&limite=1'),
    enabled: user?.rol === 'ADMIN' && !offline
  });
  const sync = useMutation({
    mutationFn: (confirmMassDeactivation: boolean) => (
      importSnapshot(confirmMassDeactivation) as Promise<SynchronizationResult>
    )
  });

  async function startImport() {
    if (!window.confirm('¿Importar manualmente el snapshot configurado en el servidor?')) return;
    setMessage('');
    try {
      const result = await sync.mutateAsync(false);
      setMessage(`Importación ${result.sincronizacion.estado.toLowerCase()}: ${result.sincronizacion.total_registros} registros.`);
    } catch (error) {
      const requiresMassConfirmation = error instanceof ApiError
        && error.status === 409
        && (error.data as { codigo?: string } | undefined)?.codigo === 'MASS_DEACTIVATION_CONFIRMATION_REQUIRED';
      if (!requiresMassConfirmation || !window.confirm(
        'El snapshot omite más del 10% de las terminales activas. ¿Confirmar su inactivación masiva?'
      )) {
        setMessage(error instanceof Error ? error.message : 'No se pudo completar la importación.');
        return;
      }
      try {
        const result = await sync.mutateAsync(true);
        setMessage(`Importación ${result.sincronizacion.estado.toLowerCase()}: ${result.sincronizacion.total_registros} registros.`);
      } catch (retryError) {
        setMessage(retryError instanceof Error ? retryError.message : 'No se pudo completar la importación.');
        return;
      }
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['last-sync'] })
    ]);
  }

  if (offline) {
    return <div className="empty">
      <h1>Dashboard</h1>
      <p>Los indicadores requieren conexión para evitar mostrar agregados desactualizados.</p>
    </div>;
  }
  const data = query.data;
  return <section>
    <div className="page-heading">
      <div><p className="eyebrow">Resumen operativo</p><h1>Dashboard</h1></div>
      <button onClick={() => nav('/comercios')}>Buscar comercios</button>
    </div>
    <div className="stats">
      {Object.entries(data?.indicadores || {}).filter(([, value]) => value !== null).map(([key, value]) => (
        <article key={key}><strong>{value}</strong><span>{labels[key] || key}</span></article>
      ))}
    </div>
    <div className="charts">
      {Object.entries(data?.distribuciones || {}).map(([field, rawData]) => {
        const chartData=groupDistribution(rawData);
        const openFilter=(value:string)=>nav(`/comercios?${field}=${encodeURIComponent(value)}`);
        return <article className="chart-card" key={field}>
          <h2 id={`chart-${field}`}>{metaFor(field).label}</h2>
          <div className="visual-chart" aria-hidden="true"><ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="label" width={95} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total" fill="#a71930" radius={[0, 4, 4, 0]} onClick={(item) => {
                const selected = item as unknown as { value?: string; payload?: { value?: string } };
                const value = selected.value ?? selected.payload?.value;
                if (value) openFilter(value);
              }} />
            </BarChart>
          </ResponsiveContainer></div>
          <div className="chart-table-wrap"><table className="chart-table" aria-labelledby={`chart-${field}`}><thead><tr><th>Categoría</th><th>Cantidad</th></tr></thead><tbody>{chartData.map(item=><tr key={item.value}><td><button type="button" onClick={()=>openFilter(item.value)} aria-label={`Filtrar ${metaFor(field).label} por ${item.label}`}>{item.label}</button></td><td>{item.total}</td></tr>)}</tbody></table></div>
        </article>;
      })}
    </div>
    {user?.rol === 'ADMIN' && <section className="admin-sync">
      <h2>Sincronización con Excel</h2>
      {last.data?.datos?.[0]
        ? <SyncSummary data={last.data.datos[0]} />
        : <p>No hay sincronizaciones registradas.</p>}
      <button onClick={() => void startImport()} disabled={sync.isPending}>Importar snapshot ahora</button>
      {message && <div className="alert">{message}</div>}
      <p className="muted">La importación solo se inicia manualmente y requiere confirmación administrativa.</p>
    </section>}
  </section>;
}

function SyncSummary({ data }: { data: SynchronizationSummary }) {
  return <div className="sync-summary">
    <strong>{data.estado}</strong>
    <span>{data.fecha_fin
      ? new Intl.DateTimeFormat('es-HN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.fecha_fin))
      : 'En proceso'}</span>
    <span>Nuevos: {data.insertados}</span>
    <span>Actualizados: {data.actualizados}</span>
    <span>Inactivados: {data.inactivados}</span>
    {data.detalle_error && <span>Error: {data.detalle_error}</span>}
  </div>;
}
