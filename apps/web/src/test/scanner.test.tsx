import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Scanner,{cameraErrorMessage,scannerCapabilityError} from '../components/Scanner';

const scannerMocks=vi.hoisted(()=>({decode:vi.fn(),list:vi.fn()}));
vi.mock('@zxing/browser',()=>({
 BrowserMultiFormatReader:class BrowserMultiFormatReader{
  static listVideoInputDevices(){return scannerMocks.list();}
  decodeFromConstraints(...args:unknown[]){return scannerMocks.decode(...args);}
 }
}));

function namedError(name:string){return{name};}

beforeEach(()=>{
 scannerMocks.decode.mockReset();scannerMocks.list.mockReset().mockResolvedValue([]);
 Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn(),enumerateDevices:vi.fn()}});
});

describe('escáner con fallback ZXing',()=>{
 it('detecta capacidades sin depender de BarcodeDetector',()=>{
  expect(scannerCapabilityError()).toBe('');
  Object.defineProperty(window,'isSecureContext',{configurable:true,value:false});
  expect(scannerCapabilityError()).toContain('HTTPS');
  Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});
  expect(scannerCapabilityError()).toContain('no permite acceder');
 });

 it('prefiere la cámara trasera y reintenta sin restricción cuando no es compatible',async()=>{
  const controls={stop:vi.fn()};
  scannerMocks.decode.mockRejectedValueOnce(namedError('OverconstrainedError')).mockResolvedValueOnce(controls);
  render(<Scanner onResult={vi.fn()} onClose={vi.fn()}/>);
  await waitFor(()=>expect(scannerMocks.decode).toHaveBeenCalledTimes(2));
  expect(scannerMocks.decode.mock.calls[0][0]).toEqual({video:{facingMode:{ideal:'environment'}}});
  expect(scannerMocks.decode.mock.calls[1][0]).toEqual({video:true});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });

 it.each([
  ['NotAllowedError','Permiso de cámara denegado'],
  ['NotFoundError','No se encontró una cámara'],
  ['NotReadableError','La cámara está ocupada'],
  ['Error','No se pudo iniciar el escáner']
 ])('explica el error de cámara %s',async(name,message)=>{
  scannerMocks.decode.mockRejectedValue(namedError(name));
  render(<Scanner onResult={vi.fn()} onClose={vi.fn()}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(cameraErrorMessage(namedError(name))).toContain(message);
 });

 it('detiene controles y todas las pistas al cerrar',async()=>{
  const controlStop=vi.fn(),trackStop=vi.fn();
  scannerMocks.decode.mockImplementation(async(_constraints:unknown,element:HTMLVideoElement)=>{
   Object.defineProperty(element,'srcObject',{configurable:true,writable:true,value:{getTracks:()=>[{stop:trackStop}],getVideoTracks:()=>[]}});
   return{stop:controlStop};
  });
  const close=vi.fn(),user=userEvent.setup();
  render(<Scanner onResult={vi.fn()} onClose={close}/>);
  await waitFor(()=>expect(scannerMocks.decode).toHaveBeenCalled());
  await user.click(screen.getByRole('button',{name:'Cerrar'}));
  expect(controlStop).toHaveBeenCalled();expect(trackStop).toHaveBeenCalled();expect(close).toHaveBeenCalled();
 });

 it('entrega el texto detectado y detiene la cámara',async()=>{
  const controlStop=vi.fn(),result=vi.fn();let callback:((value:{getText:()=>string})=>void)|undefined;
  scannerMocks.decode.mockImplementation(async(_constraints:unknown,_element:HTMLVideoElement,scanCallback:typeof callback)=>{callback=scanCallback;return{stop:controlStop};});
  render(<Scanner onResult={result} onClose={vi.fn()}/>);
  await waitFor(()=>expect(scannerMocks.decode).toHaveBeenCalled());
  callback?.({getText:()=> 'INV-001'});
  await waitFor(()=>expect(result).toHaveBeenCalledWith('INV-001'));
  expect(controlStop).toHaveBeenCalled();
 });

 it('permite cambiar de cámara y conserva nombres descriptivos aun sin etiquetas',async()=>{
  scannerMocks.decode.mockResolvedValue({stop:vi.fn()});
  scannerMocks.list.mockResolvedValue([{deviceId:'front',label:'Frontal'},{deviceId:'rear',label:''}]);
  const user=userEvent.setup();render(<Scanner onResult={vi.fn()} onClose={vi.fn()}/>);
  const selector=await screen.findByRole('combobox',{name:'Cámara'});
  expect(screen.getByRole('option',{name:'Cámara 2'})).toBeInTheDocument();
  await user.selectOptions(selector,'front');
  await waitFor(()=>expect(scannerMocks.decode).toHaveBeenLastCalledWith({video:{deviceId:{exact:'front'}}},expect.any(HTMLVideoElement),expect.any(Function)));
 });
});
