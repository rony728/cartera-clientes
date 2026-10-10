import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { act,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link,MemoryRouter,Route,Routes,useLocation,type InitialEntry } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Commerce from '../pages/Commerce';
import type { SearchState,Terminal } from '../types';
import type { CommerceRouteState } from '../navigation';

const mocks=vi.hoisted(()=>({
 searchTerminals:vi.fn(),
 api:vi.fn(),
 searchOffline:vi.fn(),
 writeText:vi.fn(),
 getColumns:vi.fn(),
 saveColumns:vi.fn(),
 user:{id:'1',nombre:'Prueba',usuario:'prueba',rol:'ADMIN',autenticado:true},
 offline:false
}));

vi.mock('../Auth',()=>({useAuth:()=>({user:mocks.user,offline:mocks.offline})}));
vi.mock('../api',()=>({api:mocks.api,searchTerminals:mocks.searchTerminals}));
vi.mock('../offline',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('../offline')>();
 return {...actual,downloadOffline:vi.fn(),getColumns:mocks.getColumns,offlineFilterOptions:vi.fn().mockResolvedValue({datos:{},campos:[]}),offlineMeta:vi.fn().mockResolvedValue(null),saveColumns:mocks.saveColumns,searchOffline:mocks.searchOffline};
});
vi.mock('../export',()=>({exportTerminals:vi.fn()}));

const terminal:Terminal={terminal:'00001234',activa:true,version:'1',datos_excel:{NombreComercial:'Café Central',SeriePOS:'SER-0007',Inventario:'INV-0042',Ciudad:'Danlí',CodigoComercio:''}};
const page={datos:[terminal],paginacion:{pagina:1,limite:20,total:1,total_paginas:2}};

function renderCommerce(entry:InitialEntry='/comercios'){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><Commerce/></MemoryRouter></QueryClientProvider>);
}

function DetailReturn(){
 const state=useLocation().state as CommerceRouteState;
 return <><p>Ficha abierta</p><Link to={`/comercios${state.search}`} state={{restoreScroll:state.restoreScroll}}>Volver al contexto exacto</Link><Link to="/comercios?q=otro" state={{restoreScroll:state.restoreScroll}}>Volver a otro contexto</Link></>;
}

function renderNavigation(entry:InitialEntry){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><Routes><Route path="/comercios" element={<Commerce/>}/><Route path="/comercios/:terminal" element={<DetailReturn/>}/></Routes></MemoryRouter></QueryClientProvider>);
}

describe('interfaz de Comercios',()=>{
 beforeEach(()=>{
  mocks.searchTerminals.mockReset().mockImplementation((state:SearchState)=>Promise.resolve({...page,paginacion:{...page.paginacion,pagina:state.pagina}}));
  mocks.api.mockReset().mockResolvedValue({datos:{Ciudad:['Danlí'],Comunicacion:['GPRS',' Gprs ']},campos:['NombreComercial','SeriePOS','Inventario','Ciudad','Comunicacion','CampoDinamico']});
  mocks.searchOffline.mockReset().mockResolvedValue(page);
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.getColumns.mockReset().mockResolvedValue(['Inventario','SeriePOS']);
  mocks.saveColumns.mockReset().mockResolvedValue(undefined);
  mocks.offline=false;
  Object.defineProperty(window,'scrollY',{configurable:true,value:0});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:mocks.writeText}});
 });

 it('usa NombreComercial por defecto y respeta parámetros explícitos',async()=>{
  const first=renderCommerce();
  expect(await screen.findByRole('combobox',{name:'Buscar en'})).toHaveValue('NombreComercial');
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({campo:'NombreComercial',pagina:1}),expect.any(AbortSignal)));
  first.unmount();
  renderCommerce('/comercios?campo=SeriePOS&q=SER-0007&pagina=2&Ciudad=Danl%C3%AD');
  expect(await screen.findByRole('combobox',{name:'Buscar en'})).toHaveValue('SeriePOS');
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({campo:'SeriePOS',q:'SER-0007',pagina:2,filtros:expect.objectContaining({Ciudad:'Danlí'})}),expect.any(AbortSignal)));
  expect(screen.getByRole('button',{name:'Filtros (1)'})).toBeInTheDocument();
 });

 it('abre y cierra Herramientas y Filtros con controles accesibles',async()=>{
  const user=userEvent.setup();
  renderCommerce('/comercios?Ciudad=Danl%C3%AD&pagina=2');
  await screen.findByRole('link',{name:'Café Central'});
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:/Herramientas/u}));
  expect(screen.getByRole('menuitem',{name:/Actualizar datos/u})).toBeInTheDocument();
  expect(screen.getByRole('menuitem',{name:'Columnas'})).toBeInTheDocument();
  expect(screen.getByRole('menuitem',{name:'Exportar .xlsx'})).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  const filters=screen.getByRole('button',{name:'Filtros (1)'});
  expect(screen.queryByText('Aplicar y cerrar')).not.toBeInTheDocument();
  await user.click(filters);
  expect(screen.getByText('Aplicar y cerrar')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Aplicar y cerrar'}));
  expect(screen.queryByText('Aplicar y cerrar')).not.toBeInTheDocument();
  expect(filters).toHaveTextContent('(1)');
  await user.click(screen.getByRole('button',{name:/Herramientas/u}));
  await user.click(screen.getByRole('menuitem',{name:'Columnas'}));
  expect(mocks.getColumns).toHaveBeenCalledWith('1',expect.any(Array));
  expect(screen.getByText('Columnas visibles')).toBeInTheDocument();
 });

 it('copia identificadores sin activar la navegación de la tarjeta',async()=>{
  const user=userEvent.setup();
  const writeText=vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue(undefined);
  renderCommerce();
  const commerceLink=await screen.findByRole('link',{name:'Café Central'});
  expect(commerceLink).toHaveAttribute('href','/comercios/00001234');
  await user.click(screen.getByRole('button',{name:'Copiar Terminal'}));
  expect(writeText).toHaveBeenLastCalledWith('00001234');
  expect(screen.getByRole('status')).toHaveTextContent('Terminal: Copiado');
  await user.click(screen.getByRole('button',{name:'Copiar Serie POS'}));
  expect(writeText).toHaveBeenLastCalledWith('SER-0007');
  await user.click(screen.getByRole('button',{name:'Copiar Inventario'}));
  expect(writeText).toHaveBeenLastCalledWith('INV-0042');
  expect(screen.getByRole('heading',{name:'Café Central'})).toBeInTheDocument();
  expect(screen.getAllByText('Sin dato').length).toBeGreaterThan(0);
 });

 it('mantiene filtros al paginar y conserva la búsqueda offline por campo',async()=>{
  const user=userEvent.setup();
  renderCommerce('/comercios?campo=Inventario&q=INV&Ciudad=Danl%C3%AD');
  await screen.findByRole('link',{name:'Café Central'});
  await user.click(screen.getByRole('button',{name:'Siguiente'}));
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({campo:'Inventario',q:'INV',pagina:2,filtros:expect.objectContaining({Ciudad:'Danlí'})}),expect.any(AbortSignal)));
 });

 it('aplica el campo explícito también en la búsqueda offline',async()=>{
  mocks.offline=true;
  renderCommerce('/comercios?campo=terminal&q=00001234');
  await screen.findByRole('link',{name:'Café Central'});
  expect(mocks.searchOffline).toHaveBeenCalledWith('1',expect.objectContaining({campo:'terminal',q:'00001234'}));
  expect(mocks.searchTerminals).not.toHaveBeenCalled();
 });

 it('mantiene preferencias y reordena columnas con controles descriptivos',async()=>{
  const user=userEvent.setup();
  renderCommerce();
  await screen.findByRole('link',{name:'Café Central'});
  await user.click(screen.getByRole('button',{name:/Herramientas/u}));
  await user.click(screen.getByRole('menuitem',{name:'Columnas'}));
  const moveUp=screen.getByRole('button',{name:'Mover Inventario hacia arriba'});
  const moveDown=screen.getByRole('button',{name:'Mover Inventario hacia abajo'});
  expect(moveUp).toBeDisabled();
  expect(moveDown).toBeEnabled();
  await user.click(moveDown);
  expect(mocks.saveColumns).toHaveBeenLastCalledWith('1',['SeriePOS','Inventario']);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Mover Inventario hacia arriba'})).toBeEnabled());
  await user.click(screen.getByRole('checkbox',{name:/Campo Dinamico/u}));
  expect(mocks.saveColumns).toHaveBeenLastCalledWith('1',['SeriePOS','Inventario','CampoDinamico']);
 });

 it('expone aria-sort y anuncia la dirección activa',async()=>{
  const user=userEvent.setup();
  renderCommerce();
  await screen.findByRole('link',{name:'Café Central'});
  const nameSort=screen.getByRole('button',{name:'Ordenar por Nombre comercial, actualmente ascendente'});
  expect(nameSort.closest('th')).toHaveAttribute('aria-sort','ascending');
  expect(screen.getByRole('button',{name:'Ordenar por Terminal'}).closest('th')).toHaveAttribute('aria-sort','none');
  await user.click(nameSort);
  expect(await screen.findByRole('button',{name:'Ordenar por Nombre comercial, actualmente descendente'})).toBeInTheDocument();
 });

 it('consulta todas las variantes equivalentes online sin alterar los valores',async()=>{
  renderCommerce('/comercios?Comunicacion=GPRS');
  await screen.findByRole('link',{name:'Café Central'});
  await waitFor(()=>{
   expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({filtros:expect.objectContaining({Comunicacion:'GPRS'})}),expect.any(AbortSignal));
   expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({filtros:expect.objectContaining({Comunicacion:' Gprs '})}),expect.any(AbortSignal));
  });
 });

 it('ofrece limpiar búsqueda y quitar filtros en un estado vacío',async()=>{
  mocks.searchTerminals.mockResolvedValue({datos:[],paginacion:{pagina:1,limite:20,total:0,total_paginas:0}});
  const user=userEvent.setup();
  renderCommerce('/comercios?q=inexistente&Ciudad=Danl%C3%AD');
  const clear=await screen.findByRole('button',{name:'Limpiar búsqueda'});
  expect(screen.getByRole('button',{name:'Quitar filtros'})).toBeInTheDocument();
  await user.click(clear);
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({q:'',filtros:expect.objectContaining({Ciudad:'Danlí'})}),expect.any(AbortSignal)));
 });

 it('anuncia el fallo de copia sin navegar',async()=>{
  const user=userEvent.setup();
  const writeText=vi.spyOn(navigator.clipboard,'writeText').mockRejectedValueOnce(new Error('denegado'));
  renderCommerce();
  await screen.findByRole('link',{name:'Café Central'});
  await user.click(screen.getByRole('button',{name:'Copiar Terminal'}));
  expect(writeText).toHaveBeenCalledWith('00001234');
  expect(screen.getByRole('status')).toHaveTextContent('Terminal: No se pudo copiar');
  expect(screen.getByRole('heading',{name:'Café Central'})).toBeInTheDocument();
 });

 it('restaura el scroll al volver al contexto exacto de búsqueda',async()=>{
  const user=userEvent.setup(),scrollTo=vi.spyOn(window,'scrollTo').mockImplementation(()=>undefined);
  Object.defineProperty(window,'scrollY',{configurable:true,value:486});
  renderNavigation('/comercios?pagina=2&campo=NombreComercial&q=Caf%C3%A9');
  await user.click(await screen.findByRole('link',{name:'Café Central'}));
  expect(screen.getByText('Ficha abierta')).toBeInTheDocument();
  await user.click(screen.getByRole('link',{name:'Volver al contexto exacto'}));
  await waitFor(()=>expect(scrollTo).toHaveBeenCalledWith({top:486,left:0,behavior:'auto'}));
 });

 it('descarta una posición guardada si cambió el contexto de búsqueda',async()=>{
  const user=userEvent.setup();
  const scrollTo=vi.spyOn(window,'scrollTo').mockImplementation(()=>undefined);
  renderCommerce({pathname:'/comercios',search:'?q=otro',state:{restoreScroll:{key:'q=anterior',y:900}}});
  await screen.findByRole('link',{name:'Café Central'});
  const search=screen.getByRole('textbox',{name:'Buscar comercios'});
  await user.clear(search);await user.type(search,'anterior');
  await act(async()=>{await new Promise(resolve=>window.setTimeout(resolve,350));});
  expect(scrollTo).not.toHaveBeenCalled();
 });
});
