import { Icon } from './Icon';

export type PhotoState =
  | { status:'empty' }
  | { status:'loading' }
  | { status:'error'; message?:string }
  | { status:'ready'; url:string; alt:string };

export function CommercePhoto({state={status:'empty'}}:{state?:PhotoState}) {
  return <div className="photo-card" aria-live="polite">
    <div className={`photo-placeholder photo-${state.status}`}>
      {state.status==='ready'?<img src={state.url} alt={state.alt} style={{width:'100%',height:160,objectFit:'cover',borderRadius:11}}/>:<Icon name="camera"/>}
      <strong>Fotografía del comercio</strong>
      {state.status==='empty'&&<span>Sin fotografía</span>}
      {state.status==='loading'&&<span>Cargando fotografía…</span>}
      {state.status==='error'&&<span>{state.message||'No se pudo cargar la fotografía'}</span>}
    </div>
    <button disabled title="Requiere endpoints y almacenamiento de fotografías">Agregar o reemplazar · Próximamente</button>
  </div>;
}
