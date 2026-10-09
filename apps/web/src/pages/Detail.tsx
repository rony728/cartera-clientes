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

const groups=['Comercio','Terminal y equipo','Conectividad','Contacto y gestión','Información adicional'];
export default function Detail(){
 const{terminal=''}=useParams(),{user,offline}=useAuth(),location=useLocation();
 const routeState=location.state as {search?:string;message?:string}|null;
 const search=routeState?.search||'';
 const[copied,setCopied]=useState(''),[historyPage,setHistoryPage]=useState(1);
 const query=useQuery({queryKey:['terminal',terminal,offline],queryFn:()=>offline?offlineTerminal(user!.id,terminal):api<Terminal>(`/api/v1/terminales/${encodeURIComponent(terminal)}`)});
 const history=useQuery({queryKey:['history',terminal,historyPage],queryFn:()=>api<Page<HistoryEntry>>(`/api/v1/terminales/${encodeURIComponent(terminal)}/historial?pagina=${historyPage}&limite=20`),enabled:!offline});
 const t=query.data;
 async function copy(key:string,value:unknown){await navigator.clipboard.writeText(String(value??''));setCopied(key);setTimeout(()=>setCopied(''),1400);}
 if(query.isLoading)return <div className="splash">Cargando ficha…</div>;
 if(!t)return <div className="empty"><h1>Terminal no disponible</h1><Link to={`/comercios${search}`}>Volver</Link></div>;
 const entries=Object.entries(t.datos_excel).filter(([k])=>!INTERNAL_FIELDS.has(k));
 return <section><div className="detail-head"><Link to={`/comercios${search}`}>← Comercios</Link><div><p className="eyebrow">Terminal {t.terminal}</p><h1>{String(excelValue(t.datos_excel,'NombreComercial')||'Comercio sin nombre')}</h1><span className={`badge ${t.activa?'success':'muted'}`}>{t.activa?'Activa':'Inactiva'}</span></div>{t.activa&&!offline&&<Link className="button primary" to="editar" state={{search}}>Editar comercio</Link>}</div>
 {routeState?.message&&<div className="alert" role="status">{routeState.message}</div>}
 <CommercePhoto/>
 <div className="detail-groups">{groups.map(group=>{const values=entries.filter(([k])=>metaFor(k).group===group);if(!values.length)return null;return <details open={group==='Comercio'||group==='Terminal y equipo'} key={group}><summary>{group}</summary><div className="field-grid">{values.map(([key,value])=><div className="field" key={key}><span>{metaFor(key).label}</span><div><strong>{String(value??'—')}</strong><button className="icon-button" aria-label={`Copiar ${metaFor(key).label}`} onClick={()=>copy(key,value)}><Icon name="copy"/></button></div>{key==='Celular'&&validPhone(value)&&<div className="quick-links"><a href={`tel:${digits(value)}`}>Llamar</a><a href={`https://wa.me/${digits(value)}`} target="_blank" rel="noreferrer">WhatsApp</a></div>}{copied===key&&<small className="copied">Copiado</small>}</div>)}</div></details>;})}</div>
 <section className="history"><h2>Historial de cambios</h2>{offline?<p>El historial no está disponible en esta copia local.</p>:history.data?.datos.length?<><div className="timeline">{history.data.datos.map(h=><article key={h.id}><time>{new Intl.DateTimeFormat('es-HN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(h.fecha))}</time><strong>{metaFor(h.campo).label}</strong><p>{display(h.valor_anterior,h.valor_anterior_presente)} → {display(h.valor_nuevo,h.valor_nuevo_presente)}</p><small>{h.origen}{h.responsable?` · ${h.responsable}`:''}{h.estado_excel?` · Excel: ${h.estado_excel}`:''}</small></article>)}</div><nav className="pagination"><button disabled={historyPage===1} onClick={()=>setHistoryPage(p=>p-1)}>Anterior</button><span>Página {historyPage} de {history.data.paginacion.total_paginas||1}</span><button disabled={historyPage>=history.data.paginacion.total_paginas} onClick={()=>setHistoryPage(p=>p+1)}>Siguiente</button></nav></>:<p>Sin cambios registrados.</p>}</section></section>;
}
const digits=(v:unknown)=>String(v??'').replace(/\D/gu,'');
const validPhone=(v:unknown)=>digits(v).length>=8;
const display=(v:unknown,p:boolean)=>p?String(v??'null'):'(ausente)';
