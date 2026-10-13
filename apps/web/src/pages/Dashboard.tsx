import { useQuery } from '@tanstack/react-query';
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
import { api } from '../api';
import { useAuth } from '../Auth';
import { metaFor } from '../fields';
import { groupDistribution } from '../normalization';

interface DashboardData {
  indicadores: Record<string, number | null>;
  distribuciones: Record<string, { valor: string; total: number }[]>;
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
  const { offline } = useAuth();
  const nav = useNavigate();
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/api/v1/terminales/dashboard/resumen'),
    enabled: !offline
  });
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
          <div className="chart-table-wrap"><table className="chart-table" aria-labelledby={`chart-${field}`}><tbody>{chartData.map(item=><tr key={item.value}><th scope="row"><button type="button" onClick={()=>openFilter(item.value)} aria-label={`Filtrar ${metaFor(field).label} por ${item.label}`}>{item.label}</button></th><td aria-label={`Cantidad: ${item.total}`}>{item.total}</td></tr>)}</tbody></table></div>
        </article>;
      })}
    </div>
  </section>;
}
