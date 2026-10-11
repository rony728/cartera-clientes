import { beforeEach,describe,expect,it } from 'vitest';
import { clearRememberedCommerceScroll,commerceContextKey,rememberCommerceScroll,rememberedCommerceScroll } from '../navigation';

describe('contexto de navegación de Comercios',()=>{
 beforeEach(()=>window.history.replaceState({key:'router-key',idx:4,usr:null},''));

 it('produce la misma clave para los mismos parámetros aunque cambie su orden',()=>{
  expect(commerceContextKey('q=Caf%C3%A9&pagina=2&Ciudad=Danl%C3%AD')).toBe(commerceContextKey('Ciudad=Danl%C3%AD&pagina=2&q=Caf%C3%A9'));
 });

 it('distingue cualquier cambio de búsqueda, filtros, orden o página',()=>{
  const base=commerceContextKey('q=Cafe&Ciudad=Danli&orden=NombreComercial&pagina=2');
  expect(commerceContextKey('q=Cafe&Ciudad=Tegucigalpa&orden=NombreComercial&pagina=2')).not.toBe(base);
  expect(commerceContextKey('q=Cafe&Ciudad=Danli&orden=Terminal&pagina=2')).not.toBe(base);
  expect(commerceContextKey('q=Cafe&Ciudad=Danli&orden=NombreComercial&pagina=3')).not.toBe(base);
 });

 it('añade y consume el marcador sin alterar el estado interno del historial',()=>{
  rememberCommerceScroll({key:'pagina=2&q=Cafe',y:720});
  expect(rememberedCommerceScroll()).toEqual({key:'pagina=2&q=Cafe',y:720});
  expect(window.history.state).toMatchObject({key:'router-key',idx:4,usr:null});
  clearRememberedCommerceScroll();
  expect(rememberedCommerceScroll()).toBeUndefined();
  expect(window.history.state).toEqual({key:'router-key',idx:4,usr:null});
 });
});
