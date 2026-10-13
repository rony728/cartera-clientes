import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter,Route,Routes,useLocation } from 'react-router-dom';
import { describe,expect,it,vi } from 'vitest';
import Edit from '../pages/Edit';
import type { Terminal } from '../types';
import type { CommerceRouteState } from '../navigation';

const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../api',()=>({
  api:mocks.api,
  ApiError:class ApiError extends Error{constructor(public status:number,message:string,public data?:unknown){super(message);}}
}));

const terminal:Terminal={
  terminal:'00000284',activa:true,version:'7',
  ubicacion_interna:'Pista',referencia_interna:'Entrada lateral',
  datos_excel:{IP:'10.0.0.1',DNS:'8.8.8.8',Zona:'Centro',CodigoComercio:'00077',NombreComercial:'Comercio original',SeriePOS:'000SERIE',Atendio:'Ana',Celular:'09999999',Correo:'ana@example.com',RedSimcard:'Tigo',SerieSimcard:'000123',Inventario:'0000456',TecnicoAsignado:'Luis',CampoDinamico:'visible'}
};

function Result(){
 const location=useLocation();
 const state=location.state as CommerceRouteState|null;
 return <><p>{state?.message}</p><output aria-label="Posición de retorno">{state?.restoreScroll?`${state.restoreScroll.key}:${state.restoreScroll.y}`:''}</output></>;
}

function renderEdit(state?:CommerceRouteState){
 const queryClient=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[{pathname:'/comercios/00000284/editar',state}]}><Routes>
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

 it('edita campos internos con referencia multilínea sin mezclarlos con Excel',async()=>{
  mocks.api.mockImplementation(async(_path:string,options?:RequestInit)=>{
   if(!options?.method)return terminal;
   return {terminal:{...terminal,version:'8',ubicacion_interna:'Caja 2',referencia_interna:'Segundo nivel'},propagacion:[],envio_excel:{estado:'NO_APLICA',campos:[]}};
  });
  const user=userEvent.setup();renderEdit();
  const location=await screen.findByRole('textbox',{name:'Ubicación interna'});
  const reference=screen.getByRole('textbox',{name:'Referencia interna'});
  expect(reference.tagName).toBe('TEXTAREA');
  expect(screen.getByText('Estos datos se guardan solo en la aplicación y no se envían a Excel.')).toBeInTheDocument();
  await user.clear(location);await user.type(location,'Caja 2');
  await user.clear(reference);await user.type(reference,'Segundo nivel');
  await user.click(screen.getByRole('button',{name:'Guardar cambios'}));
  await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(2));
  const [,options]=mocks.api.mock.calls[1] as [string,RequestInit];
  expect(JSON.parse(String(options.body))).toEqual({version:'7',cambios:{ubicacion_interna:'Caja 2',referencia_interna:'Segundo nivel'}});
  expect(await screen.findByText('Cambios internos guardados en PostgreSQL.')).toBeInTheDocument();
 });

 it('conserva el contexto y el scroll al cancelar la edición',async()=>{
  mocks.api.mockResolvedValue(terminal);
  const user=userEvent.setup();
  renderEdit({search:'?campo=NombreComercial&q=original&pagina=2',restoreScroll:{key:'campo=NombreComercial&pagina=2&q=original',y:640}});
  await screen.findByRole('textbox',{name:'Nombre comercial'});
  await user.click(screen.getByRole('link',{name:'Cancelar'}));
  expect(screen.getByRole('status',{name:'Posición de retorno'})).toHaveTextContent('campo=NombreComercial&pagina=2&q=original:640');
 });
});
