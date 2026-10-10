import { useEffect,useMemo,useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Link,useLocation,useNavigate,useParams } from 'react-router-dom';
import { api,ApiError } from '../api';
import { EDITABLE_FIELDS,INTERNAL_FIELDS,metaFor } from '../fields';
import type { Terminal } from '../types';

interface UpdateResponse { terminal:Terminal;propagacion:{campo:string;estado:string}[];envio_excel:{estado:string;campos:string[]} }

export default function Edit(){
 const{terminal=''}=useParams(),nav=useNavigate(),location=useLocation(),client=useQueryClient();
 const search=(location.state as {search?:string}|null)?.search||'';
 const[values,setValues]=useState<Record<string,unknown>>({}),[conflict,setConflict]=useState<Terminal|null>(null);
 const query=useQuery({queryKey:['terminal',terminal,false],queryFn:()=>api<Terminal>(`/api/v1/terminales/${encodeURIComponent(terminal)}`)});
 useEffect(()=>{if(query.data)setValues(query.data.datos_excel);},[query.data]);
 const changes=useMemo(()=>Object.fromEntries(Object.entries(values).filter(([k,v])=>JSON.stringify(query.data?.datos_excel[k])!==JSON.stringify(v))),[values,query.data]);
 const dirty=Object.keys(changes).length>0;
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty)e.preventDefault();};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[dirty]);
 const detail=`/comercios/${encodeURIComponent(terminal)}`;
 const mutation=useMutation({
  mutationFn:()=>api<UpdateResponse>(`/api/v1/terminales/${encodeURIComponent(terminal)}`,{method:'PATCH',body:JSON.stringify({version:query.data!.version,cambios:changes})}),
  onSuccess:async data=>{client.setQueryData(['terminal',terminal,false],data.terminal);await client.invalidateQueries({queryKey:['terminales']});const state=data.envio_excel.estado;const message=state==='ERROR'?'Guardado en PostgreSQL; falló el envío de la actualización a Excel.':state==='INCIERTO'?'Guardado en PostgreSQL; Microsoft Graph aceptó el envío, pero su registro quedó incierto.':state==='PENDIENTE'?'Guardado en PostgreSQL; el envío a Excel no pudo iniciarse y permanece pendiente.':'Guardado en PostgreSQL y enviado para conciliación con Excel.';nav(detail,{replace:true,state:{message,search}});},
  onError:e=>{if(e instanceof ApiError&&e.status===409&&(e.data as {codigo?:string})?.codigo==='VERSION_CONFLICT')setConflict((e.data as {terminal:Terminal}).terminal);}
 });
 function submit(e:FormEvent){e.preventDefault();if(dirty&&!mutation.isPending)mutation.mutate();}
 if(!query.data)return <div className="splash">Cargando edición…</div>;
 const fields=Object.keys(query.data.datos_excel).filter(k=>!INTERNAL_FIELDS.has(k));
 return <form className="edit-form" onSubmit={submit}>
  <div className="detail-head"><div><Link to={detail} state={{search}}>← Cancelar</Link><h1>Editar comercio</h1><p>Terminal <strong>{terminal}</strong> · no editable</p></div><button className="primary" disabled={!dirty||mutation.isPending}>{mutation.isPending?'Guardando…':'Guardar cambios'}</button></div>
  {dirty&&<div className="alert">Hay {Object.keys(changes).length} cambios pendientes.</div>}
  {mutation.error&&!conflict&&<div className="alert error">{mutation.error.message}</div>}
  {conflict&&<div className="alert error"><strong>Conflicto de versión.</strong><p>Otra persona modificó esta terminal. Tus cambios permanecen en pantalla; compara antes de recargar.</p><div className="conflict-grid">{Object.entries(changes).map(([field,local])=><div key={field}><b>{metaFor(field).label}</b><span>Tu valor: {String(local??'')}</span><span>Actual: {String(conflict.datos_excel[field]??'')}</span></div>)}</div><button type="button" onClick={()=>{setConflict(null);void query.refetch();}}>Descartar edición local y recargar</button></div>}
  <div className="form-grid">{fields.map(field=>{const editable=EDITABLE_FIELDS.has(field);return <label key={field}>{metaFor(field).label}<input value={String(values[field]??'')} disabled={!editable} aria-describedby={editable?undefined:`unsupported-${field}`} onChange={e=>setValues(v=>({...v,[field]:e.target.value}))}/>{!editable&&<small id={`unsupported-${field}`}>Solo lectura: pendiente de integración con Excel.</small>}</label>;})}</div>
  <div className="sticky-actions"><Link className="button" to={detail} state={{search}}>Cancelar</Link><button className="primary" disabled={!dirty||mutation.isPending}>Guardar cambios</button></div>
 </form>;
}
