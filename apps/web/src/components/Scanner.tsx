import { useCallback,useEffect,useRef,useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

type TorchCapabilities = MediaTrackCapabilities & { torch?:boolean };
type TorchConstraint = MediaTrackConstraintSet & { torch:boolean };
type ScannerControls = { stop:()=>void };

export function scannerCapabilityError() {
 if(window.isSecureContext===false)return 'El escáner requiere una conexión HTTPS segura.';
 if(!navigator.mediaDevices||typeof navigator.mediaDevices.getUserMedia!=='function')return 'Este navegador no permite acceder a la cámara.';
 return '';
}

export function cameraErrorMessage(error:unknown) {
 const name=error instanceof DOMException?error.name:(error as {name?:string}|null)?.name;
 if(name==='NotAllowedError'||name==='SecurityError')return 'Permiso de cámara denegado. Habilítalo en la configuración del navegador.';
 if(name==='NotFoundError'||name==='DevicesNotFoundError')return 'No se encontró una cámara disponible.';
 if(name==='NotReadableError'||name==='TrackStartError'||name==='AbortError')return 'La cámara está ocupada o no pudo iniciarse.';
 if(name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError')return 'La cámara no admite la configuración solicitada.';
 return 'No se pudo iniciar el escáner en este dispositivo.';
}

function isConstraintError(error:unknown){
 const name=error instanceof DOMException?error.name:(error as {name?:string}|null)?.name;
 return name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError';
}

export default function Scanner({onResult,onClose}:{onResult:(value:string)=>void;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null),track=useRef<MediaStreamTrack|null>(null),controls=useRef<ScannerControls|null>(null);
 const[error,setError]=useState(''),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[selected,setSelected]=useState(''),[torchAvailable,setTorchAvailable]=useState(false),[torchOn,setTorchOn]=useState(false);
 const stopCamera=useCallback(()=>{
  const activeControls=controls.current;controls.current=null;
  activeControls?.stop();
  const stream=video.current?.srcObject as MediaStream|null;
  stream?.getTracks().forEach(currentTrack=>currentTrack.stop());
  if(video.current)video.current.srcObject=null;
  track.current=null;
  setTorchAvailable(false);setTorchOn(false);
 },[]);
 useEffect(()=>{
  let cancelled=false,completed=false;
  const capabilityError=scannerCapabilityError();
  if(capabilityError){setError(capabilityError);return;}
  setError('');
  const reader=new BrowserMultiFormatReader();
  const scan=async()=>{
   try{
    const callback=(result:{getText:()=>string}|undefined)=>{
     if(!result||completed||cancelled)return;
     completed=true;stopCamera();onResult(result.getText());
    };
    const constraints:MediaStreamConstraints=selected?{video:{deviceId:{exact:selected}}}:{video:{facingMode:{ideal:'environment'}}};
    let activeControls:ScannerControls;
    try{
     activeControls=await reader.decodeFromConstraints(constraints,video.current!,callback);
    }catch(initialError){
     if(selected||!isConstraintError(initialError))throw initialError;
     activeControls=await reader.decodeFromConstraints({video:true},video.current!,callback);
    }
    if(cancelled||completed){activeControls.stop();return;}
    controls.current=activeControls;
    track.current=(video.current?.srcObject as MediaStream|null)?.getVideoTracks()[0]||null;
    setTorchAvailable(Boolean((track.current?.getCapabilities() as TorchCapabilities|undefined)?.torch));
    try{const available=await BrowserMultiFormatReader.listVideoInputDevices();if(!cancelled)setDevices(available);}catch{/* La enumeración es opcional; el stream activo continúa. */}
   }catch(startError){if(!cancelled){stopCamera();setError(cameraErrorMessage(startError));}}
  };
  void scan();
  return()=>{cancelled=true;stopCamera();};
 },[onResult,selected,stopCamera]);
 async function toggleTorch(){if(!track.current)return;try{const next=!torchOn;await track.current.applyConstraints({advanced:[{torch:next} as TorchConstraint]});setTorchOn(next);}catch{setTorchAvailable(false);setError('Este navegador no pudo controlar la linterna.');}}
 function close(){stopCamera();onClose();}
 return <div className="modal" role="dialog" aria-modal="true" aria-label="Escanear código"><div className="modal-card"><h2>Escanear código</h2>{devices.length>1&&<label>Cámara<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Automática</option>{devices.map((device,index)=><option value={device.deviceId} key={device.deviceId||index}>{device.label||`Cámara ${index+1}`}</option>)}</select></label>}<video ref={video} muted playsInline/>{torchAvailable&&<button type="button" onClick={toggleTorch}>{torchOn?'Apagar linterna':'Encender linterna'}</button>}{error&&<div className="alert error" role="alert">{error}</div>}<p className="muted">La imagen se procesa únicamente en este dispositivo. Admite códigos QR y códigos de barras.</p><button type="button" onClick={close}>Cerrar</button></div></div>;
}
