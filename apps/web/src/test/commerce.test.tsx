import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
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
 getColumnWidths:vi.fn(),
 saveColumns:vi.fn(),
 saveColumnWidths:vi.fn(),
 exportTerminals:vi.fn(),
 user:{id:'1',nombre:'Prueba',usuario:'prueba',rol:'ADMIN',autenticado:true},
 offline:false
}));

vi.mock('../Auth',()=>({useAuth:()=>({user:mocks.user,offline:mocks.offline})}));
vi.mock('../api',()=>({api:mocks.api,searchTerminals:mocks.searchTerminals}));
vi.mock('../offline',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('../offline')>();
 return {...actual,downloadOffline:vi.fn(),getColumns:mocks.getColumns,getColumnWidths:mocks.getColumnWidths,offlineFilterOptions:vi.fn().mockResolvedValue({datos:{},campos:[]}),offlineMeta:vi.fn().mockResolvedValue(null),saveColumns:mocks.saveColumns,saveColumnWidths:mocks.saveColumnWidths,searchOffline:mocks.searchOffline};
});
vi.mock('../export',()=>({exportTerminals:mocks.exportTerminals}));

const terminal:Terminal={terminal:'00001234',activa:true,version:'1',ubicacion_interna:'Pista',referencia_interna:'Frente a farmacia',datos_excel:{NombreComercial:'Café Central',SeriePOS:'SER-0007',Inventario:'INV-0042',Ciudad:'Danlí',CodigoComercio:'00077',Correo:'ana@example.com',Celular:'09990000',Atendio:'Ana López',SerieSimcard:'0000004567',RedSimcard:'Tigo'}};
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
  mocks.getColumnWidths.mockReset().mockResolvedValue({NombreComercial:300});
  mocks.saveColumns.mockReset().mockResolvedValue(undefined);
  mocks.saveColumnWidths.mockReset().mockResolvedValue(undefined);
  mocks.exportTerminals.mockReset().mockResolvedValue(undefined);
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

 it('limpia el texto desde el buscador sin cambiar campo, filtros u orden ni abrir el escáner',async()=>{
  const user=userEvent.setup();
  renderCommerce('/comercios?campo=SeriePOS&q=SER-0007&pagina=2&Ciudad=Danl%C3%AD&orden=Terminal&direccion=desc');
  const input=await screen.findByRole('textbox',{name:'Buscar comercios'});
  const searchContainer=input.closest<HTMLElement>('.search-input')!;
  const clear=within(searchContainer).getByRole('button',{name:'Limpiar búsqueda'});
  const scanner=within(searchContainer).getByRole('button',{name:'Escanear código'});
  expect(Array.from(searchContainer.querySelectorAll('button'))).toEqual([clear,scanner]);
  await user.click(clear);
  expect(input).toHaveValue('');
  expect(within(searchContainer).queryByRole('button',{name:'Limpiar búsqueda'})).not.toBeInTheDocument();
  expect(within(searchContainer).getByRole('button',{name:'Escanear código'})).toBeInTheDocument();
  expect(screen.getByRole('combobox',{name:'Buscar en'})).toHaveValue('SeriePOS');
  expect(screen.getByRole('button',{name:'Filtros (1)'})).toBeInTheDocument();
  expect(document.querySelector('.modal')).toBeNull();
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({
   q:'',campo:'SeriePOS',pagina:1,orden:'Terminal',direccion:'desc',filtros:expect.objectContaining({Ciudad:'Danlí'})
  }),expect.any(AbortSignal)));
 });

 it('no muestra el control de limpieza cuando el buscador está vacío',async()=>{
  renderCommerce();
  await screen.findByRole('textbox',{name:'Buscar comercios'});
  expect(screen.queryByRole('button',{name:'Limpiar búsqueda'})).not.toBeInTheDocument();
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

 it('muestra Celular y copia las siete acciones móviles en el orden requerido',async()=>{
  const user=userEvent.setup();
  const writeText=vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue(undefined);
  renderCommerce();
  const commerceLink=await screen.findByRole('link',{name:'Café Central'});
  expect(commerceLink).toHaveAttribute('href','/comercios/00001234');
  const card=commerceLink.closest('article')!;
  const cardFields=card.querySelector('dl')!;
  expect(within(cardFields).getByText('Celular')).toBeInTheDocument();
  expect(within(cardFields).queryByText('Red SIM')).not.toBeInTheDocument();
  const copyActions=card.querySelector<HTMLElement>('.card-copy-actions')!;
  expect(within(copyActions).getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual([
   'Copiar Terminal','Copiar Correo','Copiar Celular','Copiar Atendió','Copiar Código','Copiar Serie SIM','Copiar Serie POS'
  ]);
  expect(within(card).queryByRole('button',{name:'Copiar Inventario'})).not.toBeInTheDocument();
  await user.click(within(card).getByRole('button',{name:'Copiar Terminal'}));
  expect(writeText).toHaveBeenLastCalledWith('00001234');
  expect(screen.getByRole('status')).toHaveTextContent('Terminal: Copiado');
  await user.click(within(card).getByRole('button',{name:'Copiar Serie POS'}));
  expect(writeText).toHaveBeenLastCalledWith('SER-0007');
  await user.click(within(card).getByRole('button',{name:'Copiar Código'}));
  expect(writeText).toHaveBeenLastCalledWith('00077');
  expect(screen.getByRole('heading',{name:'Café Central'})).toBeInTheDocument();
  expect(within(card).getByText('Pista')).toHaveClass('internal-location');
  const tableName=document.querySelector('.commerce-name-cell');
  expect(tableName).toHaveTextContent('Café Central');
  expect(tableName).toHaveTextContent('Pista');
 });

 it('no reserva la línea de ubicación interna cuando está vacía',async()=>{
  mocks.searchTerminals.mockResolvedValue({...page,datos:[{...terminal,ubicacion_interna:null}]});
  renderCommerce();
  const card=(await screen.findByRole('link',{name:'Café Central'})).closest('article')!;
  expect(card.querySelector('.internal-location')).toBeNull();
 });

 it('oculta una acción de copia cuando el valor está vacío',async()=>{
  mocks.searchTerminals.mockResolvedValue({...page,datos:[{...terminal,datos_excel:{...terminal.datos_excel,Correo:'  '}}]});
  renderCommerce();
  const card=(await screen.findByRole('link',{name:'Café Central'})).closest('article')!;
  expect(within(card).queryByRole('button',{name:'Copiar Correo'})).not.toBeInTheDocument();
  expect(within(card).getByRole('button',{name:'Copiar Celular'})).toBeInTheDocument();
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

 it('restaura y persiste el ancho de columna sin activar el ordenamiento',async()=>{
  renderCommerce();
  await screen.findByRole('link',{name:'Café Central'});
  await waitFor(()=>expect(mocks.getColumnWidths).toHaveBeenCalledWith('1'));
  const separator=screen.getByRole('separator',{name:'Redimensionar Nombre comercial'});
  expect(separator).toHaveAttribute('aria-valuenow','300');
  fireEvent.keyDown(separator,{key:'ArrowRight'});
  await waitFor(()=>expect(mocks.saveColumnWidths).toHaveBeenLastCalledWith('1',expect.objectContaining({NombreComercial:310})));
  expect(screen.getByRole('button',{name:'Ordenar por Nombre comercial, actualmente ascendente'})).toBeInTheDocument();
  fireEvent.pointerDown(separator,{clientX:100});
  fireEvent.pointerMove(window,{clientX:160});
  fireEvent.pointerUp(window,{clientX:160});
  await waitFor(()=>expect(mocks.saveColumnWidths).toHaveBeenLastCalledWith('1',expect.objectContaining({NombreComercial:370})));
  expect(document.querySelector('.commerce-table col')).toHaveStyle({width:'370px'});
 });

 it('envía todas las variantes equivalentes en una consulta paginada al backend',async()=>{
  renderCommerce('/comercios?Comunicacion=GPRS');
  await screen.findByRole('link',{name:'Café Central'});
  await waitFor(()=>{
   expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({filtros:expect.objectContaining({Comunicacion:'GPRS'}),variantes:{Comunicacion:['GPRS',' Gprs ']},pagina:1,limite:20}),expect.any(AbortSignal));
   expect(mocks.searchTerminals).toHaveBeenCalledTimes(1);
  });
 });

 it('exporta todas las variantes equivalentes del filtro online',async()=>{
  const user=userEvent.setup();
  renderCommerce('/comercios?Comunicacion=GPRS');
  await screen.findByRole('link',{name:'Café Central'});
  mocks.searchTerminals.mockClear();
  await user.click(screen.getByRole('button',{name:/Herramientas/u}));
  await user.click(screen.getByRole('menuitem',{name:'Exportar .xlsx'}));
  await waitFor(()=>expect(mocks.exportTerminals).toHaveBeenCalledWith([terminal],['Inventario','SeriePOS'],false));
  expect(mocks.searchTerminals).toHaveBeenCalledWith(expect.objectContaining({filtros:expect.objectContaining({Comunicacion:'GPRS'}),variantes:{Comunicacion:['GPRS',' Gprs ']},pagina:1,limite:100}),undefined);
 });

 it('ofrece limpiar búsqueda y quitar filtros en un estado vacío',async()=>{
  mocks.searchTerminals.mockResolvedValue({datos:[],paginacion:{pagina:1,limite:20,total:0,total_paginas:0}});
  const user=userEvent.setup();
  renderCommerce('/comercios?q=inexistente&Ciudad=Danl%C3%AD');
  expect(await screen.findByRole('button',{name:'Quitar filtros'})).toBeInTheDocument();
  const clear=screen.getAllByRole('button',{name:'Limpiar búsqueda'})[0];
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

describe('visitas en listado móvil y escritorio',()=>{
 beforeEach(()=>{
  mocks.user.id='1';
  mocks.offline=false;
  mocks.searchTerminals.mockReset().mockResolvedValue({...page,datos:[
   {...terminal,ultima_visita:'2026-08-31T23:00:00-06:00',tiene_visitas_registradas:true},
   {...terminal,terminal:'00002',datos_excel:{NombreComercial:'Sin visitas'},ultima_visita:null,tiene_visitas_registradas:false},
   {...terminal,terminal:'00003',datos_excel:{NombreComercial:'Solo siguiente mes'},ultima_visita:null,tiene_visitas_registradas:true}
  ]});
  mocks.api.mockReset().mockResolvedValue({datos:{Comunicacion:['GPRS',' Gprs ']},campos:[]});
  mocks.getColumns.mockResolvedValue(['Inventario','SeriePOS']);
  mocks.getColumnWidths.mockResolvedValue({});
  mocks.saveColumnWidths.mockReset().mockResolvedValue(undefined);
 });

 it('presenta fecha al final de la tarjeta y en columna, con advertencias accesibles sin alterar copias',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  try{
   renderCommerce();
   const card=(await screen.findByRole('link',{name:'Café Central'})).closest('article')!;
   expect(within(card).getByText('31/08/2026')).toBeInTheDocument();
   expect(card.querySelector('footer')).toHaveTextContent('Última visita31/08/2026');
   expect(card.querySelector('footer')!.previousElementSibling).toHaveTextContent('Ver detalles');
   expect(within(card).getByRole('img',{name:'Última visita de hace 2 meses calendario o más'})).toBeInTheDocument();
   expect(within(card).getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual(['Copiar Terminal','Copiar Correo','Copiar Celular','Copiar Atendió','Copiar Código','Copiar Serie SIM','Copiar Serie POS']);
   const noVisits=(screen.getByRole('link',{name:'Sin visitas'})).closest('article')!;
   expect(within(noVisits).getByText('Sin visitas registradas')).toBeInTheDocument();
   expect(within(noVisits).getByRole('img',{name:'Sin visitas registradas'})).toBeInTheDocument();
   const future=screen.getByRole('link',{name:'Solo siguiente mes'}).closest('article')!;
   expect(within(future).queryByRole('img')).not.toBeInTheDocument();
   expect(within(future).getByText('Sin fecha de visita disponible')).toBeInTheDocument();
   const table=screen.getByRole('table');
   expect(within(table).getByText('31/08/2026')).toBeInTheDocument();
   expect(within(table).getAllByRole('img')).toHaveLength(2);
   expect(mocks.searchTerminals).toHaveBeenCalledTimes(1);
   expect(mocks.api).toHaveBeenCalledWith('/api/v1/terminales/filtros/opciones');
  }finally{vi.useRealTimers();}
 });

 it('ordena en el backend en ambas direcciones y permite redimensionar la columna',async()=>{
  const user=userEvent.setup();renderCommerce('/comercios?pagina=2');
  await user.click(await screen.findByRole('button',{name:'Ordenar por Última visita'}));
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenLastCalledWith(expect.objectContaining({orden:'ultima_visita',direccion:'asc',pagina:1,limite:20}),expect.any(AbortSignal)));
  await user.click(screen.getByRole('button',{name:'Ordenar por Última visita, actualmente ascendente'}));
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenLastCalledWith(expect.objectContaining({orden:'ultima_visita',direccion:'desc'}),expect.any(AbortSignal)));
  const separator=screen.getByRole('separator',{name:'Redimensionar Última visita'});
  fireEvent.keyDown(separator,{key:'ArrowRight'});
  expect(mocks.saveColumnWidths).toHaveBeenLastCalledWith('1',expect.objectContaining({ultima_visita:230}));
 });

 it('conserva visitas, búsqueda y orden al paginar y regresar de una ficha',async()=>{
  const user=userEvent.setup();
  renderNavigation('/comercios?q=Caf%C3%A9&visita_antiguedad_meses=2&visita_desde=2026-01-01&visita_hasta=2026-08-31&orden=ultima_visita&direccion=desc');
  await user.click(await screen.findByRole('button',{name:'Siguiente'}));
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenLastCalledWith(expect.objectContaining({q:'Café',visita_antiguedad_meses:'2',visita_desde:'2026-01-01',visita_hasta:'2026-08-31',orden:'ultima_visita',direccion:'desc',pagina:2}),expect.any(AbortSignal)));
  await user.click(screen.getByRole('link',{name:'Café Central'}));
  await user.click(screen.getByRole('link',{name:'Volver al contexto exacto'}));
  expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
  expect(screen.getByRole('combobox',{name:'Ordenar por'})).toHaveValue('ultima_visita');
 });

 it.each(['','con','sin','2','3'])('selecciona el filtro %s sin filtrar filas en el navegador',async(value)=>{
  const user=userEvent.setup();renderCommerce(`/comercios?pagina=2${value===''?'&visitas=con':''}`);
  await user.click(await screen.findByRole('button',{name:/^Filtros/u}));
  await user.selectOptions(screen.getByRole('combobox',{name:'Visitas técnicas'}),value);
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenLastCalledWith(expect.objectContaining(value==='2'||value==='3'?{visita_antiguedad_meses:value,pagina:1}:value?{visitas:value,pagina:1}:{pagina:1}),expect.any(AbortSignal)));
  // La página del servidor se muestra completa; el cliente no vuelve a filtrar.
  expect(screen.getByRole('link',{name:'Solo siguiente mes'})).toBeInTheDocument();
 });

 it('envía rango y variantes juntos en una página del servidor; limpiar conserva la búsqueda',async()=>{
  const user=userEvent.setup();renderCommerce('/comercios?Comunicacion=GPRS&visitas=con&q=Caf%C3%A9');
  await user.click(await screen.findByRole('button',{name:'Filtros (2)'}));
  fireEvent.change(screen.getByLabelText('Última visita desde'),{target:{value:'2026-08-01'}});
  fireEvent.change(screen.getByLabelText('Última visita hasta'),{target:{value:'2026-08-31'}});
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenLastCalledWith(expect.objectContaining({visitas:'con',visita_desde:'2026-08-01',visita_hasta:'2026-08-31',variantes:{Comunicacion:['GPRS',' Gprs ']},pagina:1,limite:20}),expect.any(AbortSignal)));
  await user.click(screen.getByRole('button',{name:'Limpiar filtros'}));
  await waitFor(()=>expect(mocks.searchTerminals).toHaveBeenLastCalledWith(expect.objectContaining({q:'Café',filtros:expect.objectContaining({Comunicacion:''})}),expect.any(AbortSignal)));
  expect(mocks.searchTerminals.mock.lastCall![0].visitas).toBeUndefined();
 });

 it('permite recuperar la consulta comercial tras un error de filtros de visitas',async()=>{
  mocks.searchTerminals.mockImplementation((state:SearchState)=>state.visitas?Promise.reject(new Error('indisponible')):Promise.resolve(page));
  const user=userEvent.setup();renderCommerce('/comercios?visitas=con&q=Caf%C3%A9');
  await user.click(await screen.findByRole('button',{name:'Consultar sin filtros de visitas'}));
  expect(await screen.findByRole('link',{name:'Café Central'})).toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:'Buscar comercios'})).toHaveValue('Café');
 });
});


it('no conserva resultados de otro usuario mientras carga su página',async()=>{
 mocks.user.id='1';mocks.offline=false;
 mocks.api.mockResolvedValue({datos:{},campos:[]});
 mocks.searchTerminals.mockResolvedValue(page);
 const user=userEvent.setup();renderCommerce();
 await screen.findByRole('link',{name:'Café Central'});
 mocks.searchTerminals.mockImplementation(()=>new Promise(()=>{}));
 mocks.user.id='otro-usuario';
 try{
  await user.click(screen.getByRole('button',{name:/^Filtros/u}));
  expect(await screen.findByText('Cargando resultados…')).toBeInTheDocument();
  expect(screen.queryByRole('link',{name:'Café Central'})).not.toBeInTheDocument();
 }finally{mocks.user.id='1';}
});
