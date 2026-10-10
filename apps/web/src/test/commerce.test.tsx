import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Commerce from '../pages/Commerce';
import type { SearchState,Terminal } from '../types';

const mocks=vi.hoisted(()=>({
 searchTerminals:vi.fn(),
 api:vi.fn(),
 searchOffline:vi.fn(),
 writeText:vi.fn(),
 offline:false
}));

vi.mock('../Auth',()=>({useAuth:()=>({user:{id:'1',nombre:'Prueba',usuario:'prueba',rol:'ADMIN',autenticado:true},offline:mocks.offline})}));
vi.mock('../api',()=>({api:mocks.api,searchTerminals:mocks.searchTerminals}));
vi.mock('../offline',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('../offline')>();
 return {...actual,downloadOffline:vi.fn(),getColumns:vi.fn().mockResolvedValue([]),offlineFilterOptions:vi.fn().mockResolvedValue({datos:{},campos:[]}),offlineMeta:vi.fn().mockResolvedValue(null),saveColumns:vi.fn(),searchOffline:mocks.searchOffline};
});
vi.mock('../export',()=>({exportTerminals:vi.fn()}));

const terminal:Terminal={terminal:'00001234',activa:true,version:'1',datos_excel:{NombreComercial:'Café Central',SeriePOS:'SER-0007',Inventario:'INV-0042',Ciudad:'Danlí',CodigoComercio:''}};
const page={datos:[terminal],paginacion:{pagina:1,limite:20,total:1,total_paginas:2}};

function renderCommerce(entry='/comercios'){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><Commerce/></MemoryRouter></QueryClientProvider>);
}

describe('interfaz de Comercios',()=>{
 beforeEach(()=>{
  mocks.searchTerminals.mockReset().mockImplementation((state:SearchState)=>Promise.resolve({...page,paginacion:{...page.paginacion,pagina:state.pagina}}));
  mocks.api.mockReset().mockResolvedValue({datos:{Ciudad:['Danlí']},campos:['NombreComercial','SeriePOS','Inventario','Ciudad']});
  mocks.searchOffline.mockReset().mockResolvedValue(page);
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.offline=false;
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
});
