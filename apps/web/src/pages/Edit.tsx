import { useEffect,useMemo,useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Link,useLocation,useNavigate,useParams } from 'react-router-dom';
import { api,ApiError } from '../api';
import { EDITABLE_FIELDS,INTERNAL_FIELDS,metaFor } from '../fields';
import type { Terminal } from '../types';
import type { CommerceRouteState } from '../navigation';

interface UpdateResponse { terminal:Terminal;propagacion:{campo:string;estado:string}[];envio_excel:{estado:string;campos:string[]} }
const PRIMARY_EDIT_FIELDS=['NombreComercial','SeriePOS','Atendio','Celular','Correo','RedSimcard','SerieSimcard'];
const LOCATION_FIELDS=new Set(['Zona','Ciudad','Direccion','Ubicacion']);
const EDIT_GROUPS=[
 {name:'Comercio',matches:(field:string)=>metaFor(field).group==='Comercio'&&!LOCATION_FIELDS.has(field)},
 {name:'Equipo POS',matches:(field:string)=>metaFor(field).group==='Terminal y equipo'},
 {name:'Conectividad',matches:(field:string)=>metaFor(field).group==='Conectividad'},
 {name:'Ubicación',matches:(field:string)=>LOCATION_FIELDS.has(field)},
 {name:'Contacto y gestión',matches:(field:string)=>metaFor(field).group==='Contacto y gestión'},
 {name:'Información adicional',matches:(field:string)=>metaFor(field).group==='Información adicional'}
];

export default function Edit(){
 const{terminal=''}=useParams(),nav=useNavigate(),location=useLocation(),client=useQueryClient();
 const routeState=location.state as CommerceRouteState|null,search=routeState?.search||'',restoreScroll=routeState?.restoreScroll;
 const[values,setValues]=useState<Record<string,unknown>>({}),[conflict,setConflict]=useState<Terminal|null>(null);
 const query=useQuery({queryKey:['terminal',terminal,false],queryFn:()=>api<Terminal>(`/api/v1/terminales/${encodeURIComponent(terminal)}`)});
 useEffect(()=>{if(query.data)setValues({...query.data.datos_excel,ubicacion_interna:query.data.ubicacion_interna??'',referencia_interna:query.data.referencia_interna??''});},[query.data]);
 const changes=useMemo(()=>Object.fromEntries(Object.entries(values).filter(([key,value])=>{const original=key==='ubicacion_interna'||key==='referencia_interna'?query.data?.[key]??'':query.data?.datos_excel[key];return JSON.stringify(original)!==JSON.stringify(value);})),[values,query.data]);
 const dirty=Object.keys(changes).length>0;
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty)event.preventDefault();};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[dirty]);
 const detail=`/comercios/${encodeURIComponent(terminal)}`;
 const mutation=useMutation({
  mutationFn:()=>api<UpdateResponse>(`/api/v1/terminales/${encodeURIComponent(terminal)}`,{method:'PATCH',body:JSON.stringify({version:query.data!.version,cambios:changes})}),
  onSuccess:async data=>{client.setQueryData(['terminal',terminal,false],data.terminal);await client.invalidateQueries({queryKey:['terminales']});const state=data.envio_excel.estado;const message=state==='NO_APLICA'?'Cambios internos guardados en PostgreSQL.':state==='ERROR'?'Guardado en PostgreSQL; falló el envío de la actualización a Excel.':state==='INCIERTO'?'Guardado en PostgreSQL; Microsoft Graph aceptó el envío, pero su registro quedó incierto.':state==='PENDIENTE'?'Guardado en PostgreSQL; el envío a Excel no pudo iniciarse y permanece pendiente.':'Guardado en PostgreSQL y enviado para conciliación con Excel.';nav(detail,{replace:true,state:{message,search,restoreScroll}});},
  onError:error=>{if(error instanceof ApiError&&error.status===409&&(error.data as {codigo?:string})?.codigo==='VERSION_CONFLICT')setConflict((error.data as {terminal:Terminal}).terminal);}
 });
 function submit(event:FormEvent){event.preventDefault();if(dirty&&!mutation.isPending)mutation.mutate();}
 function setField(field:string,value:string){setValues(current=>({...current,[field]:value}));}
 if(!query.data)return <div className="splash">Cargando edición…</div>;
 const fields=Object.keys(query.data.datos_excel).filter(field=>!INTERNAL_FIELDS.has(field));
 const primaryFields=PRIMARY_EDIT_FIELDS.filter(field=>fields.includes(field));
 const secondaryFields=fields.filter(field=>!PRIMARY_EDIT_FIELDS.includes(field));
 return <form className="edit-form" onSubmit={submit} noValidate>
  <header className="edit-heading"><div><h1>Editar comercio</h1><p>Los cambios compatibles se conciliarán con Excel.</p></div></header>
  <div className="terminal-identity"><span>Terminal</span><strong>{terminal}</strong><small>Identificador no editable</small></div>
  {dirty&&<div className="alert">Hay {Object.keys(changes).length} cambios pendientes.</div>}
  {mutation.error&&!conflict&&<div className="alert error">{mutation.error.message}</div>}
  {conflict&&<div className="alert error"><strong>Conflicto de versión.</strong><p>Otra persona modificó esta terminal. Tus cambios permanecen en pantalla; compara antes de recargar.</p><div className="conflict-grid">{Object.entries(changes).map(([field,local])=><div key={field}><b>{metaFor(field).label}</b><span>Tu valor: {String(local??'')}</span><span>Actual: {String(field==='ubicacion_interna'||field==='referencia_interna'?conflict[field]??'':conflict.datos_excel[field]??'')}</span></div>)}</div><button type="button" onClick={()=>{setConflict(null);void query.refetch();}}>Descartar edición local y recargar</button></div>}
  <fieldset className="edit-section primary-edit-section"><legend>Datos principales</legend><div className="form-grid">{primaryFields.map(field=><EditField key={field} field={field} value={values[field]} editable={EDITABLE_FIELDS.has(field)} onChange={value=>setField(field,value)}/>)}</div></fieldset>
  <fieldset className="edit-section internal-edit-section"><legend>Datos internos de la PWA</legend><p className="muted">Estos datos se guardan solo en la aplicación y no se envían a Excel.</p><div className="form-grid"><EditField field="ubicacion_interna" value={values.ubicacion_interna} editable onChange={value=>setField('ubicacion_interna',value)}/><EditField field="referencia_interna" value={values.referencia_interna} editable onChange={value=>setField('referencia_interna',value)}/></div></fieldset>
  <div className="edit-sections">{EDIT_GROUPS.map(group=>{const grouped=secondaryFields.filter(field=>group.matches(field));if(!grouped.length)return null;return <fieldset className="edit-section" key={group.name}><legend>{group.name}</legend><div className="form-grid">{grouped.map(field=><EditField key={field} field={field} value={values[field]} editable={EDITABLE_FIELDS.has(field)} onChange={value=>setField(field,value)}/>)}</div></fieldset>;})}</div>
  <div className="sticky-actions" aria-label="Acciones de edición"><Link className="button" to={detail} state={{search,restoreScroll}}>Cancelar</Link><button className="primary" disabled={!dirty||mutation.isPending}>{mutation.isPending?'Guardando…':'Guardar cambios'}</button></div>
 </form>;
}

function EditField({field,value,editable,onChange}:{field:string;value:unknown;editable:boolean;onChange:(value:string)=>void}){
 const input=fieldInput(field);
 return <label>{metaFor(field).label}{field==='referencia_interna'?<textarea rows={3} value={String(value??'')} disabled={!editable} onChange={event=>onChange(event.target.value)}/>:<input type={input.type} inputMode={input.inputMode} autoComplete={input.autoComplete} value={String(value??'')} disabled={!editable} aria-describedby={editable?undefined:`unsupported-${field}`} onChange={event=>onChange(event.target.value)}/>} {!editable&&<small id={`unsupported-${field}`}>Solo lectura: pendiente de integración con Excel.</small>}</label>;
}

function fieldInput(field:string):{type:'text'|'email'|'tel';inputMode?:'tel';autoComplete?:string}{
 if(field==='Correo')return{type:'email',autoComplete:'email'};
 if(field==='Celular')return{type:'tel',inputMode:'tel',autoComplete:'tel'};
 if(field==='NombreComercial')return{type:'text',autoComplete:'organization'};
 if(field==='Atendio')return{type:'text',autoComplete:'name'};
 return{type:'text',autoComplete:'off'};
}
