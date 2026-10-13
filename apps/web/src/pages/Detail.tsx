import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link,useLocation,useParams } from 'react-router-dom';
import { useAuth } from '../Auth';
import { api } from '../api';
import { INTERNAL_FIELDS,metaFor } from '../fields';
import { excelValue,offlineTerminal } from '../offline';
import type { HistoryEntry,Page,Terminal } from '../types';
import { Icon } from '../components/Icon';
import { CommercePhoto } from '../components/CommercePhoto';
import type { CommerceRouteState } from '../navigation';

const MAIN_FIELDS=['NombreComercial','CodigoComercio','Terminal','SeriePOS','Atendio','Celular','Correo','SerieSimcard'];
const SECONDARY_GROUPS=[
 {name:'Comercio y ubicación',matches:(field:string)=>metaFor(field).group==='Comercio'},
 {name:'Equipo POS',matches:(field:string)=>metaFor(field).group==='Terminal y equipo'},
 {name:'Conectividad',matches:(field:string)=>metaFor(field).group==='Conectividad'},
 {name:'Contacto y gestión',matches:(field:string)=>metaFor(field).group==='Contacto y gestión'},
 {name:'Campos adicionales',matches:(field:string)=>metaFor(field).group==='Información adicional'}
];

export default function Detail(){
 const{terminal=''}=useParams(),{user,offline}=useAuth(),location=useLocation();
 const routeState=location.state as CommerceRouteState|null;
 const search=routeState?.search||'';
 const returnState=routeState?.restoreScroll?{restoreScroll:routeState.restoreScroll}:undefined;
 const[copied,setCopied]=useState(''),[copyMessage,setCopyMessage]=useState(''),[historyPage,setHistoryPage]=useState(1);
 const query=useQuery({queryKey:['terminal',user?.id,terminal,offline],queryFn:()=>offline?offlineTerminal(user!.id,terminal):api<Terminal>(`/api/v1/terminales/${encodeURIComponent(terminal)}`),networkMode:offline?'always':'online'});
 const history=useQuery({queryKey:['history',terminal,historyPage],queryFn:()=>api<Page<HistoryEntry>>(`/api/v1/terminales/${encodeURIComponent(terminal)}/historial?pagina=${historyPage}&limite=20`),enabled:!offline});
 const t=query.data;
 async function copy(key:string,value:unknown){try{await navigator.clipboard.writeText(String(value??''));setCopied(key);setCopyMessage(`${labelFor(key)}: Copiado`);}catch{setCopyMessage(`${labelFor(key)}: No se pudo copiar`);}window.setTimeout(()=>{setCopied('');setCopyMessage('');},1600);}
 if(query.isPending)return <div className="splash">Cargando ficha…</div>;
 if(query.isError)return <div className="empty" role="alert"><h1>{offline?'Error al leer la ficha local':'No fue posible cargar la ficha'}</h1><p>{offline?'IndexedDB no pudo entregar este registro. La copia local se conserva.':'No se pudo completar la consulta en línea.'}</p><button onClick={()=>query.refetch()}>Reintentar</button></div>;
 if(!t)return <div className="empty"><h1>Terminal no disponible</h1><Link className="button" to={`/comercios${search}`} state={returnState}>Volver a Comercios</Link></div>;
 const entries=Object.entries(t.datos_excel).filter(([key])=>!INTERNAL_FIELDS.has(key)&&!MAIN_FIELDS.includes(key));
 const valueFor=(field:string)=>field==='Terminal'?t.terminal:field==='ubicacion_interna'?t.ubicacion_interna:field==='referencia_interna'?t.referencia_interna:excelValue(t.datos_excel,field);
 return <section className="detail-page">
  <header className="record-heading"><div className="record-actions"><Link className="button back-button" to={`/comercios${search}`} state={returnState}>← Volver</Link>{t.activa&&!offline&&<Link className="button primary edit-commerce" to="editar" state={{search,restoreScroll:routeState?.restoreScroll}}><Icon name="edit"/>Editar comercio</Link>}</div><div className="record-title"><h1>{String(valueFor('NombreComercial')||'Comercio sin nombre')}</h1>{t.ubicacion_interna&&<p className="internal-location">{t.ubicacion_interna}</p>}</div><div className="record-meta"><span>Terminal <strong>{t.terminal}</strong></span><button type="button" className="icon-button" aria-label="Copiar Terminal" onClick={()=>void copy('HeaderTerminal',t.terminal)}><Icon name="copy"/></button><span className={`badge ${t.activa?'success':'muted'}`}>{t.activa?'Activa':'Inactiva'}</span></div></header>
  {routeState?.message&&<div className="alert" role="status">{routeState.message}</div>}
  <section className="primary-data" aria-labelledby="primary-data-title"><h2 id="primary-data-title">Datos principales</h2><div className="field-grid primary-field-grid">{MAIN_FIELDS.map(field=><DetailField key={field} field={field} value={valueFor(field)} copied={copied===field} onCopy={()=>void copy(field,valueFor(field))}/>)}</div></section>
  <div className="detail-groups">{SECONDARY_GROUPS.map(group=>{const values:[string,unknown][]=entries.filter(([key])=>group.matches(key));if(group.name==='Comercio y ubicación')values.push(['referencia_interna',t.referencia_interna]);return <details open={group.name==='Comercio y ubicación'} key={group.name}><summary>{group.name}</summary>{values.length?<div className="field-grid">{values.map(([key,value])=><DetailField key={key} field={key} value={value} copied={copied===key} onCopy={()=>void copy(key,value)}/>)}</div>:<p className="muted">Sin datos adicionales en esta sección.</p>}</details>;})}</div>
  <CommercePhoto terminal={t.terminal} offline={offline}/>
  <section className="history"><h2>Historial de cambios</h2>{offline?<p>El historial no está disponible en esta copia local.</p>:history.data?.datos.length?<><div className="timeline">{history.data.datos.map(h=><article key={h.id}><time>{new Intl.DateTimeFormat('es-HN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(h.fecha))}</time><strong>{metaFor(h.campo).label}</strong><p>{display(h.valor_anterior,h.valor_anterior_presente)} → {display(h.valor_nuevo,h.valor_nuevo_presente)}</p><small>{h.origen}{h.responsable?` · ${h.responsable}`:''}{h.estado_excel?` · Excel: ${h.estado_excel}`:''}</small></article>)}</div><nav className="pagination"><button disabled={historyPage===1} onClick={()=>setHistoryPage(page=>page-1)}>Anterior</button><span>Página {historyPage} de {history.data.paginacion.total_paginas||1}</span><button disabled={historyPage>=history.data.paginacion.total_paginas} onClick={()=>setHistoryPage(page=>page+1)}>Siguiente</button></nav></>:<p>Sin cambios registrados.</p>}</section>
  {copyMessage&&<div className="detail-copy-feedback" role="status" aria-live="polite">{copyMessage}</div>}
 </section>;
}

function DetailField({field,value,copied,onCopy}:{field:string;value:unknown;copied:boolean;onCopy:()=>void}){
 const empty=value===undefined||value===null||String(value).trim()==='';
 return <div className={`field${empty?' empty-field':''}`} data-field={field}><span>{labelFor(field)}</span><div className="field-value-row"><strong>{empty?'—':String(value)}</strong><button type="button" className="icon-button field-copy-button" aria-label={`Copiar ${labelFor(field)}`} disabled={empty} onClick={onCopy}><Icon name="copy"/></button></div>{field==='Celular'&&validPhone(value)&&<div className="quick-links"><a href={`tel:${digits(value)}`}>Llamar</a><a href={`https://wa.me/${digits(value)}`} target="_blank" rel="noreferrer">WhatsApp</a></div>}{copied&&<small className="copied" aria-hidden="true">Copiado</small>}</div>;
}

const labelFor=(field:string)=>field==='HeaderTerminal'||field==='Terminal'?'Terminal':metaFor(field).label;
const digits=(value:unknown)=>String(value??'').replace(/\D/gu,'');
const validPhone=(value:unknown)=>digits(value).length>=8;
const display=(value:unknown,present:boolean)=>present?String(value??'null'):'(ausente)';
