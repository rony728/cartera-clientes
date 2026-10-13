import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import App from '../App';

const mocks=vi.hoisted(()=>({role:'ADMIN' as'ADMIN'|'USUARIO'}));
vi.mock('../Auth',()=>({useAuth:()=>({user:{id:'1',nombre:'Prueba',usuario:'prueba',rol:mocks.role,autenticado:true},loading:false,offline:false})}));
vi.mock('../components/Layout',async()=>{const{Outlet}=await import('react-router-dom');return{Layout:()=> <Outlet/>};});
vi.mock('../pages/Commerce',()=>({default:()=> <p>Cartera autorizada</p>}));
vi.mock('../pages/Synchronization',()=>({default:()=> <p>Sincronización autorizada</p>}));

function renderRoute(){const client=new QueryClient();return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/menu/sincronizacion']}><App/></MemoryRouter></QueryClientProvider>);}

describe('permiso de la ruta de sincronización',()=>{
 beforeEach(()=>{mocks.role='ADMIN';});
 it('permite entrar a ADMIN',async()=>{renderRoute();expect(await screen.findByText('Sincronización autorizada')).toBeInTheDocument();});
 it('redirige a USUARIO hacia Comercios',async()=>{mocks.role='USUARIO';renderRoute();expect(await screen.findByText('Cartera autorizada')).toBeInTheDocument();expect(screen.queryByText('Sincronización autorizada')).not.toBeInTheDocument();});
});
