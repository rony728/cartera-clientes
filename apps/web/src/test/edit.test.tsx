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
  datos_excel:{IP:'10.0.0.1',DNS:'8.8.8.8',Zona:'Centro',CodigoComercio:'00077',NombreComercial:'Comercio original',SeriePOS:'000SERIE',Atendio:'Ana',Celular:'09999999',Correo:'ana@example.com',RedSimcard:'Tigo',SerieSimcard:'000123',Inventario:'0000456',TecnicoAsignado:'Luis',CampoDinamico:'visible'}
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
  const email=screen.getByRole('textbox',{name:'Correo'});
  const dynamic=screen.getByRole('textbox',{name:/Campo Dinamico/u});
  expect(screen.queryByRole('textbox',{name:'Terminal'})).not.toBeInTheDocument();
  expect(screen.getByText('00000284')).toBeInTheDocument();
  expect(phone).toHaveAttribute('type','tel');
  expect(phone).toHaveAttribute('inputmode','tel');
  expect(email).toHaveAttribute('type','email');
  expect(screen.getByRole('textbox',{name:'Serie POS'})).toHaveValue('000SERIE');
  expect(screen.getByRole('textbox',{name:'Serie SIM / Chip'})).toHaveValue('000123');
  const editableOrder=Array.from(document.querySelectorAll('.edit-form input')).map(input=>input.parentElement?.firstChild?.textContent);
  expect(editableOrder.slice(0,7)).toEqual(['Nombre comercial','Serie POS','Atendió','Celular','Correo','Red SIM','Serie SIM / Chip']);
  for(const field of [name,screen.getByRole('textbox',{name:'Serie POS'}),screen.getByRole('textbox',{name:'Atendió'}),phone,email,screen.getByRole('textbox',{name:'Red SIM'}),screen.getByRole('textbox',{name:'Serie SIM / Chip'})]){
   await user.tab();expect(field).toHaveFocus();
  }
  for(const section of ['Comercio','Equipo POS','Conectividad','Ubicación','Contacto y gestión','Información adicional'])expect(screen.getByText(section)).toBeInTheDocument();
  expect(dynamic).toBeDisabled();
  expect(screen.getByText('Solo lectura: pendiente de integración con Excel.')).toBeInTheDocument();
  await user.clear(name);await user.type(name,'Nuevo nombre');await user.clear(phone);
  expect(screen.getAllByRole('button',{name:'Guardar cambios'})).toHaveLength(1);
  await user.click(screen.getByRole('button',{name:'Guardar cambios'}));
  await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(2));
  const [,options]=mocks.api.mock.calls[1] as [string,RequestInit];
  expect(JSON.parse(String(options.body))).toEqual({version:'7',cambios:{NombreComercial:'Nuevo nombre',Celular:''}});
  expect(await screen.findByText('Guardado en PostgreSQL y enviado para conciliación con Excel.')).toBeInTheDocument();
 });
});
