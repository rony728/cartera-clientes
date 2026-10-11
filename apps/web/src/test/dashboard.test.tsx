import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter,Route,Routes,useLocation } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Dashboard from '../pages/Dashboard';

const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../Auth',()=>({useAuth:()=>({user:{id:'1',nombre:'Prueba',usuario:'prueba',rol:'USUARIO',autenticado:true},offline:false})}));
vi.mock('../api',()=>({api:mocks.api,importSnapshot:vi.fn(),ApiError:class ApiError extends Error{}}));
vi.mock('recharts',()=>({
 ResponsiveContainer:({children}:{children:React.ReactNode})=><div>{children}</div>,
 BarChart:({children}:{children:React.ReactNode})=><div>{children}</div>,
 CartesianGrid:()=>null,XAxis:()=>null,YAxis:()=>null,Tooltip:()=>null,Bar:()=>null
}));

function Location(){const location=useLocation();return <p data-testid="location">{location.pathname}{location.search}</p>;}
function renderDashboard(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/dashboard']}><Routes><Route path="/dashboard" element={<Dashboard/>}/><Route path="/comercios" element={<Location/>}/></Routes></MemoryRouter></QueryClientProvider>);}

describe('Dashboard accesible',()=>{
 beforeEach(()=>mocks.api.mockReset().mockImplementation((path:string)=>{
  if(String(path).includes('dashboard'))return Promise.resolve({indicadores:{activas:3},distribuciones:{Comunicacion:[{valor:'GPRS',total:2},{valor:' Gprs ',total:3},{valor:'Wifi',total:1}]}});
  return Promise.resolve({datos:[]});
 }));

 it('agrupa cantidades, ofrece una tabla accesible y conserva navegación',async()=>{
  const user=userEvent.setup();
  renderDashboard();
  const table=await screen.findByRole('table',{name:'Comunicación'});
  expect(table).toHaveTextContent('GPRS');
  expect(table).toHaveTextContent('5');
  expect(table).toHaveTextContent('WIFI');
  expect(screen.queryByRole('button',{name:'Importar snapshot ahora'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Filtrar Comunicación por GPRS'}));
  expect(screen.getByTestId('location')).toHaveTextContent('/comercios?Comunicacion=GPRS');
 });
});
