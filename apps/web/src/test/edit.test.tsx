import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter,Route,Routes,useLocation } from 'react-router-dom';
import { describe,expect,it,vi } from 'vitest';
import Edit from '../pages/Edit';
import type { Terminal } from '../types';

const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../api',()=>({
  api:mocks.api,
  ApiError:class ApiError extends Error{constructor(public status:number,message:string,public data?:unknown){super(message);}}
}));

const terminal:Terminal={
  terminal:'00000284',activa:true,version:'7',
  datos_excel:{NombreComercial:'Comercio original',Celular:'09999999',CampoDinamico:'visible'}
};

function Result(){
 const location=useLocation();
 return <p>{(location.state as {message?:string}|null)?.message}</p>;
}

function renderEdit(){
 const queryClient=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/comercios/00000284/editar']}><Routes>
  <Route path="/comercios/:terminal/editar" element={<Edit/>}/>
  <Route path="/comercios/:terminal" element={<Result/>}/>
 </Routes></MemoryRouter></QueryClientProvider>);
}

describe('edición y propagación V2',()=>{
 it('envía solo campos modificados con un guardado y deja columnas no soportadas en solo lectura',async()=>{
  mocks.api.mockImplementation(async(_path:string,options?:RequestInit)=>{
   if(!options?.method)return terminal;
   return {terminal:{...terminal,version:'8',datos_excel:{...terminal.datos_excel,NombreComercial:'Nuevo nombre',Celular:''}},propagacion:[
    {campo:'NombreComercial',estado:'ENVIADO'},{campo:'Celular',estado:'ENVIADO'}
   ],envio_excel:{estado:'ENVIADO',campos:['NombreComercial','Celular']}};
  });
  const user=userEvent.setup();renderEdit();
  const name=await screen.findByRole('textbox',{name:'Nombre comercial'});
  const phone=screen.getByRole('textbox',{name:'Celular'});
  const dynamic=screen.getByRole('textbox',{name:/Campo Dinamico/u});
  expect(dynamic).toBeDisabled();
  expect(screen.getByText('Solo lectura: pendiente de integración con Excel.')).toBeInTheDocument();
  await user.clear(name);await user.type(name,'Nuevo nombre');await user.clear(phone);
  await user.click(screen.getAllByRole('button',{name:'Guardar cambios'})[0]);
  await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(2));
  const [,options]=mocks.api.mock.calls[1] as [string,RequestInit];
  expect(JSON.parse(String(options.body))).toEqual({version:'7',cambios:{NombreComercial:'Nuevo nombre',Celular:''}});
  expect(await screen.findByText('Guardado en PostgreSQL y enviado para conciliación con Excel.')).toBeInTheDocument();
 });
});
