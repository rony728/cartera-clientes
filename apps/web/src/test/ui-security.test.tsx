import { describe,expect,it } from 'vitest';
import { safeCell } from '../export';

describe('seguridad y estados de interfaz',()=>{
 it('neutraliza fórmulas de Excel sin alterar identificadores',()=>{
  expect(safeCell('00123')).toBe('00123');
  expect(safeCell('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
  expect(safeCell('+123')).toBe("'+123");
 });
});
