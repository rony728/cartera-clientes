import { render,screen } from '@testing-library/react';
import { describe,expect,it } from 'vitest';
import { CommercePhoto,type PhotoState } from '../components/CommercePhoto';
import { safeCell } from '../export';

describe('seguridad y estados de interfaz',()=>{
 it('neutraliza fórmulas de Excel sin alterar identificadores',()=>{
  expect(safeCell('00123')).toBe('00123');
  expect(safeCell('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
  expect(safeCell('+123')).toBe("'+123");
 });
 it.each<PhotoState>([
  {status:'empty'}, {status:'loading'}, {status:'error',message:'Fallo sintético'}
 ])('renderiza el estado de fotografía $status',state=>{
  render(<CommercePhoto state={state}/>);expect(screen.getByText('Fotografía del comercio')).toBeInTheDocument();
 });
});
