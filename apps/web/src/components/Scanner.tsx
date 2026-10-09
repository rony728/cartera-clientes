import { useEffect,useRef,useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

type TorchCapabilities = MediaTrackCapabilities & { torch?:boolean };
type TorchConstraint = MediaTrackConstraintSet & { torch:boolean };

export default function Scanner({onResult,onClose}:{onResult:(value:string)=>void;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null),track=useRef<MediaStreamTrack|null>(null);
 const[error,setError]=useState(''),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[selected,setSelected]=useState(''),[torchAvailable,setTorchAvailable]=useState(false),[torchOn,setTorchOn]=useState(false);
 useEffect(()=>{let controls:{stop:()=>void}|undefined;const reader=new BrowserMultiFormatReader();BrowserMultiFormatReader.listVideoInputDevices().then(async list=>{setDevices(list);const id=selected||list.at(-1)?.deviceId;if(!id)throw new Error('No se encontró una cámara.');controls=await reader.decodeFromVideoDevice(id,video.current!,result=>{if(result){controls?.stop();onResult(result.getText());}});track.current=(video.current?.srcObject as MediaStream|null)?.getVideoTracks()[0]||null;setTorchAvailable(Boolean((track.current?.getCapabilities() as TorchCapabilities|undefined)?.torch));}).catch(e=>setError(e?.name==='NotAllowedError'?'Permiso de cámara denegado.':'El escáner no está disponible en este dispositivo.'));return()=>{controls?.stop();track.current=null;};},[selected,onResult]);
 async function toggleTorch(){if(!track.current)return;try{const next=!torchOn;await track.current.applyConstraints({advanced:[{torch:next} as TorchConstraint]});setTorchOn(next);}catch{setTorchAvailable(false);setError('Este navegador no pudo controlar la linterna.');}}
 return <div className="modal" role="dialog" aria-modal="true" aria-label="Escanear código"><div className="modal-card"><h2>Escanear código</h2>{devices.length>1&&<label>Cámara<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Automática</option>{devices.map(d=><option value={d.deviceId} key={d.deviceId}>{d.label||'Cámara'}</option>)}</select></label>}<video ref={video} muted playsInline/>{torchAvailable&&<button type="button" onClick={toggleTorch}>{torchOn?'Apagar linterna':'Encender linterna'}</button>}{error&&<div className="alert error">{error}</div>}<p className="muted">La imagen se procesa únicamente en este dispositivo.</p><button onClick={onClose}>Cerrar</button></div></div>;
}
