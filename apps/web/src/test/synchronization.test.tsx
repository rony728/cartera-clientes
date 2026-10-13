import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Menu from '../pages/Menu';
import Synchronization from '../pages/Synchronization';
import { ApiError } from '../api';

const mocks=vi.hoisted(()=>({api:vi.fn(),importSnapshot:vi.fn(),role:'ADMIN' as'ADMIN'|'USUARIO',offline:false}));
vi.mock('../Auth',()=>({useAuth:()=>({user:{id:'1',nombre:'Prueba',usuario:'prueba',rol:mocks.role,autenticado:true},offline:mocks.offline,signOut:vi.fn()})}));
vi.mock('../api',()=>({
 api:mocks.api,importSnapshot:mocks.importSnapshot,
 ApiError:class ApiError extends Error{constructor(public status:number,message:string,public data?:unknown){super(message);}}
}));

function renderPage(page:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>);}

describe('sincronización dentro de Menú',()=>{
 beforeEach(()=>{
  mocks.role='ADMIN';mocks.offline=false;mocks.api.mockReset().mockResolvedValue({datos:[{estado:'COMPLETADA',fecha_fin:'2026-10-12T15:00:00Z',insertados:4,actualizados:3,inactivados:2}]});
  mocks.importSnapshot.mockReset().mockResolvedValue({sincronizacion:{id:1,estado:'COMPLETADA',total_registros:1000}});
 });

 it('ofrece el acceso solo a ADMIN',()=>{
  const first=renderPage(<Menu/>);
  expect(screen.getByRole('link',{name:/Sincronización con Excel/u})).toHaveAttribute('href','/menu/sincronizacion');
  first.unmount();mocks.role='USUARIO';renderPage(<Menu/>);
  expect(screen.queryByRole('link',{name:/Sincronización con Excel/u})).not.toBeInTheDocument();
 });

 it('muestra el resumen existente y conserva la confirmación manual',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true),user=userEvent.setup();renderPage(<Synchronization/>);
  expect(await screen.findByText('COMPLETADA')).toBeInTheDocument();
  expect(screen.getByText('Nuevos: 4')).toBeInTheDocument();expect(screen.getByText('Actualizados: 3')).toBeInTheDocument();expect(screen.getByText('Inactivados: 2')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Importar snapshot ahora'}));
  await waitFor(()=>expect(mocks.importSnapshot).toHaveBeenCalledWith(false));
  expect(confirm).toHaveBeenCalledWith('¿Importar manualmente el snapshot configurado en el servidor?');
  expect(await screen.findByRole('status')).toHaveTextContent('Importación completada: 1000 registros.');
 });

 it('bloquea consulta e importación sin conexión',()=>{
  mocks.offline=true;renderPage(<Synchronization/>);
  expect(screen.getByText('Se requiere conexión para consultar o iniciar una importación.')).toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Importar snapshot ahora'})).not.toBeInTheDocument();
 });

 it('mantiene la segunda confirmación para bajas masivas',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValueOnce(true).mockReturnValueOnce(true),user=userEvent.setup();
  mocks.importSnapshot.mockRejectedValueOnce(new ApiError(409,'Se requiere confirmación',{codigo:'MASS_DEACTIVATION_CONFIRMATION_REQUIRED'})).mockResolvedValueOnce({sincronizacion:{id:2,estado:'COMPLETADA',total_registros:900}});
  renderPage(<Synchronization/>);await screen.findByText('COMPLETADA');
  await user.click(screen.getByRole('button',{name:'Importar snapshot ahora'}));
  await waitFor(()=>expect(mocks.importSnapshot).toHaveBeenNthCalledWith(2,true));
  expect(mocks.importSnapshot).toHaveBeenNthCalledWith(1,false);expect(confirm).toHaveBeenCalledTimes(2);
 });
});
