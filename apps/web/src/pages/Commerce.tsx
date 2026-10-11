import { lazy,Suspense,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type MouseEvent,type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link,useLocation,useNavigate,useSearchParams } from 'react-router-dom';
import { useAuth } from '../Auth';
import { api,searchTerminals } from '../api';
import { FILTER_FIELDS,INTERNAL_FIELDS,metaFor,PRIORITY_FIELDS,SEARCH_FIELDS as BASE_SEARCH_FIELDS } from '../fields';
import { downloadOffline,excelValue,getColumns,offlineFilterOptions,offlineMeta,saveColumns,searchOffline } from '../offline';
import type { Page,SearchState,Terminal } from '../types';
import { Icon } from '../components/Icon';
import { exportTerminals } from '../export';
import { groupEquivalentValues,normalizeCategoryKey,type ValueGroup } from '../normalization';
import { clearRememberedCommerceScroll,commerceContextKey,rememberCommerceScroll,rememberedCommerceScroll,type CommerceRouteState,type CommerceScrollState } from '../navigation';

const Scanner=lazy(()=>import('../components/Scanner'));
const defaults:SearchState={q:'',campo:'NombreComercial',pagina:1,limite:20,estado:'activas',orden:'NombreComercial',direccion:'asc',filtros:{}};
const MOBILE_FIELDS=PRIORITY_FIELDS.slice(1);

export default function Commerce(){
 const{user,offline}=useAuth(),navigate=useNavigate(),location=useLocation();
 const[params,setParams]=useSearchParams(),[typed,setTyped]=useState(params.get('q')||''),[scan,setScan]=useState(false),[filtersOpen,setFiltersOpen]=useState(false),[toolsOpen,setToolsOpen]=useState(false),[columnsOpen,setColumnsOpen]=useState(false),[columns,setColumns]=useState(PRIORITY_FIELDS.slice(1,7)),[sync,setSync]=useState<{done:number;total:number}|null>(null),[notice,setNotice]=useState('');
 const toolsRef=useRef<HTMLDivElement>(null),filtersRef=useRef<HTMLDivElement>(null);
 const state=useMemo<SearchState>(()=>({...defaults,q:params.get('q')||'',campo:params.get('campo')||defaults.campo,pagina:Number(params.get('pagina')||1),estado:params.get('estado')||'activas',orden:params.get('orden')||'NombreComercial',direccion:params.get('direccion')==='desc'?'desc':'asc',filtros:Object.fromEntries(FILTER_FIELDS.map(f=>[f,params.get(f)||'']))}),[params]);
 const lastAppliedQuery=useRef(state.q);
 useEffect(()=>{if(user)void getColumns(user.id,PRIORITY_FIELDS.slice(1,7)).then(setColumns);},[user]);
 useEffect(()=>{if(state.q!==lastAppliedQuery.current){lastAppliedQuery.current=state.q;setTyped(state.q);}},[state.q]);
 useEffect(()=>{if(typed===lastAppliedQuery.current)return;const id=setTimeout(()=>{setParams(previous=>{const next=new URLSearchParams(previous);if(typed)next.set('q',typed);else next.delete('q');next.set('pagina','1');return next;},{replace:true});lastAppliedQuery.current=typed;},300);return()=>clearTimeout(id);},[typed,setParams]);
 useDismissable(toolsOpen,()=>setToolsOpen(false),toolsRef);
 useDismissable(filtersOpen,()=>setFiltersOpen(false),filtersRef);
 const options=useQuery({queryKey:['filter-options',offline,user?.id],queryFn:()=>offline?offlineFilterOptions(user!.id):api<{datos:Record<string,string[]>;campos:string[]}>('/api/v1/terminales/filtros/opciones'),enabled:!!user,networkMode:offline?'always':'online'});
 const groupedOptions=useMemo(()=>Object.fromEntries(FILTER_FIELDS.map(field=>[field,groupEquivalentValues(options.data?.datos[field]||[])])) as Record<string,ValueGroup[]>,[options.data]);
 const filterVariants=useMemo(()=>Object.fromEntries(FILTER_FIELDS.filter(field=>state.filtros[field]).map(field=>{const selected=state.filtros[field],group=groupedOptions[field]?.find(option=>normalizeCategoryKey(option.value)===normalizeCategoryKey(selected));return[field,group?.variants||[selected]];})),[groupedOptions,state.filtros]);
 const hasSelectedFilters=FILTER_FIELDS.some(field=>state.filtros[field]);
 const query=useQuery({queryKey:['terminales',user?.id,state,offline,filterVariants],queryFn:({signal})=>offline?searchOffline(user!.id,state):searchOnlineWithVariants(state,filterVariants,signal),enabled:!!user&&(offline||!hasSelectedFilters||options.isSuccess),networkMode:offline?'always':'online'});
 const discoveredFields=(query.data?.datos||[]).flatMap(row=>Object.keys(row.datos_excel));
 const SEARCH_FIELDS=Array.from(new Set([...BASE_SEARCH_FIELDS,...(options.data?.campos||[]),...discoveredFields])).filter(field=>!INTERNAL_FIELDS.has(field));
 const update=useCallback((key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);if(key!=='pagina')next.set('pagina','1');setParams(next);},[params,setParams]);
 const activeFilterCount=FILTER_FIELDS.filter(field=>state.filtros[field]).length+(state.estado!=='activas'?1:0);
 const clearFilters=useCallback(()=>{const next=new URLSearchParams(params);FILTER_FIELDS.forEach(field=>next.delete(field));next.delete('estado');next.set('pagina','1');setParams(next);},[params,setParams]);
 const clearSearch=useCallback(()=>{const next=new URLSearchParams(params);next.delete('q');next.set('pagina','1');setTyped('');setParams(next);},[params,setParams]);
 const sortBy=useCallback((field:string)=>{const next=new URLSearchParams(params);next.set('orden',field);next.set('direccion',state.orden===field&&state.direccion==='asc'?'desc':'asc');next.set('pagina','1');setParams(next);},[params,setParams,state.direccion,state.orden]);
 const scanned=useCallback((value:string)=>{setScan(false);setTyped(value);update('campo','todos');},[update]);
 async function download(){if(!user||offline)return;setSync({done:0,total:0});try{const count=await downloadOffline(user,(done,total)=>setSync({done,total}));setNotice(`${count} registros disponibles sin conexión.`);}catch{setNotice('No se pudo actualizar la copia local; se conservó la anterior.');}finally{setSync(null);}}
 async function matchingRows(){if(offline)return(await searchOffline(user!.id,{...state,pagina:1,limite:Number.MAX_SAFE_INTEGER})).datos;return allOnlineRows(state,filterVariants);}
 async function exportAll(){try{setNotice('Preparando exportación…');const rows=await matchingRows();await exportTerminals(rows,columns,offline);setNotice(`${rows.length} registros exportados con los filtros actuales.`);}catch{setNotice('No se pudo generar la exportación.');}}
 function changeColumns(next:string[]){setColumns(next);if(user)void saveColumns(user.id,next);}
 function moveColumn(field:string,direction:-1|1){const index=columns.indexOf(field),target=index+direction;if(index<0||target<0||target>=columns.length)return;const next=[...columns];[next[index],next[target]]=[next[target],next[index]];changeColumns(next);}
 const rows=(query.data as Page<Terminal>|undefined)?.datos||[],page=query.data?.paginacion;
 const selectableColumns=Array.from(new Set([...PRIORITY_FIELDS.slice(1),...(options.data?.campos||[]),...rows.flatMap(row=>Object.keys(row.datos_excel))])).filter(field=>field!=='NombreComercial'&&!INTERNAL_FIELDS.has(field));
 const orderedSelectableColumns=[...columns.filter(field=>selectableColumns.includes(field)),...selectableColumns.filter(field=>!columns.includes(field))];
 const contextKey=commerceContextKey(params),routeState=location.state as CommerceRouteState|null,savedScroll=routeState?.restoreScroll??rememberedCommerceScroll(),restored=useRef(''),discardedRestore=useRef(false);
 useLayoutEffect(()=>{
  const saved=savedScroll;
  if(!saved)return;
  if(saved.key!==contextKey){discardedRestore.current=true;clearRememberedCommerceScroll();return;}
  if(discardedRestore.current)return;
  if(!query.isSuccess)return;
  const marker=`${saved.key}:${saved.y}`;
  if(restored.current===marker)return;
  restored.current=marker;
  window.scrollTo({top:Math.max(0,saved.y),left:0,behavior:'auto'});
  clearRememberedCommerceScroll();
 },[contextKey,query.isSuccess,rows.length,savedScroll]);
 function detailState():CommerceRouteState{
  const restoreScroll:CommerceScrollState={key:contextKey,y:window.scrollY};
  rememberCommerceScroll(restoreScroll);
  return{search:`?${params}`,restoreScroll};
 }
 function openDetail(terminal:string){navigate(`/comercios/${encodeURIComponent(terminal)}`,{state:detailState()});}
 function followDetail(event:MouseEvent<HTMLAnchorElement>,terminal:string){if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();openDetail(terminal);}
 return <section className="commerce-page">
  <div className="commerce-heading"><div><p className="eyebrow">Directorio operativo</p><div className="commerce-title"><h1>Comercios</h1><span>{page?`${page.total} resultados`:'Buscando…'}</span></div></div><div className="tools" ref={toolsRef}><button type="button" aria-haspopup="menu" aria-expanded={toolsOpen} onClick={()=>setToolsOpen(v=>!v)}><Icon name="menu"/>Herramientas</button>{toolsOpen&&<div className="tools-menu" role="menu"><button role="menuitem" onClick={()=>{setToolsOpen(false);void download();}} disabled={offline||!!sync}><Icon name="refresh"/>{sync?`${sync.done}/${sync.total}`:'Actualizar datos'}</button><button role="menuitem" onClick={()=>{setToolsOpen(false);setColumnsOpen(v=>!v);}}>Columnas</button><button role="menuitem" onClick={()=>{setToolsOpen(false);void exportAll();}}>Exportar .xlsx</button></div>}</div></div>
  {columnsOpen&&<section className="search-panel column-picker" aria-labelledby="columns-title"><div className="panel-heading"><strong id="columns-title">Columnas visibles</strong><button type="button" onClick={()=>setColumnsOpen(false)}>Cerrar</button></div><div className="column-list">{orderedSelectableColumns.map(field=>{const selected=columns.includes(field),index=columns.indexOf(field);return <div className="column-row" key={field}><input id={`column-${field}`} type="checkbox" checked={selected} onChange={event=>changeColumns(event.target.checked?[...columns,field]:columns.filter(column=>column!==field))}/><label htmlFor={`column-${field}`}>{metaFor(field).label}</label><div className="column-order"><button type="button" aria-label={`Mover ${metaFor(field).label} hacia arriba`} disabled={!selected||index===0} onClick={()=>moveColumn(field,-1)}>↑</button><button type="button" aria-label={`Mover ${metaFor(field).label} hacia abajo`} disabled={!selected||index===columns.length-1} onClick={()=>moveColumn(field,1)}>↓</button></div></div>;})}</div></section>}
  {notice&&<div className="alert" role="status">{notice}</div>}
  <div className="search-panel commerce-search"><div className="search-row"><div className="search-input"><Icon name="search"/><input aria-label="Buscar comercios" placeholder="Buscar comercios" value={typed} onChange={e=>setTyped(e.target.value)}/><button type="button" className="icon-button" aria-label="Escanear código" onClick={()=>setScan(true)}><Icon name="scan"/></button></div><select aria-label="Buscar en" value={state.campo} onChange={e=>update('campo',e.target.value)}>{SEARCH_FIELDS.map(f=><option key={f} value={f}>{f==='todos'?'Todos los campos':f==='terminal'?'Terminal':metaFor(f).label}</option>)}</select><div className="filters-wrap" ref={filtersRef}><button type="button" className={activeFilterCount?'has-active-filters':''} aria-expanded={filtersOpen} aria-controls="commerce-filters" onClick={()=>setFiltersOpen(v=>!v)}>Filtros{activeFilterCount?` (${activeFilterCount})`:''}</button>{filtersOpen&&<div className="filters" id="commerce-filters">{FILTER_FIELDS.map(f=><label key={f}>{metaFor(f).label}<select value={state.filtros[f]} onChange={e=>update(f,e.target.value)}><option value="">Todos</option>{groupedOptions[f]?.map(option=><option key={normalizeCategoryKey(option.value)} value={option.value}>{option.label}</option>)}</select></label>)}{user?.rol==='ADMIN'&&<label>Estado<select value={state.estado} onChange={e=>update('estado',e.target.value)}><option value="activas">Activas</option><option value="inactivas">Inactivas</option><option value="todas">Todas</option></select></label>}<div className="filter-actions">{activeFilterCount>0&&<button type="button" onClick={clearFilters}>Limpiar filtros</button>}<button type="button" className="primary" onClick={()=>setFiltersOpen(false)}>Aplicar y cerrar</button></div></div>}</div><div className="compact-sort"><label><span>Ordenar</span><select aria-label="Ordenar por" value={state.orden} onChange={e=>update('orden',e.target.value)}>{['NombreComercial','Terminal','CodigoComercio','Ciudad','TecnicoAsignado'].map(f=><option key={f} value={f}>{metaFor(f).label}</option>)}</select></label><button type="button" aria-label={`Orden ${state.direccion==='asc'?'ascendente':'descendente'}`} onClick={()=>update('direccion',state.direccion==='asc'?'desc':'asc')}>{state.direccion==='asc'?'A–Z':'Z–A'}</button></div></div></div>
  {query.isPending?<div className="skeleton-list">Cargando resultados…</div>:query.isError?<div className="empty" role="alert"><h2>{offline?'Error al leer datos locales':'No fue posible cargar la cartera'}</h2><p>{offline?'IndexedDB no pudo entregar la copia de este usuario. La copia no fue eliminada.':'No se pudo completar la consulta en línea.'}</p><button onClick={()=>query.refetch()}>Reintentar</button></div>:rows.length===0?<div className="empty search-empty"><h2>Sin coincidencias</h2><p>{activeFilterCount?'No hay registros que combinen la búsqueda y los filtros activos.':state.q?'La búsqueda no coincide con ningún comercio disponible.':offline?'No hay registros disponibles en la copia local.':'No hay comercios disponibles.'}</p><div className="empty-actions">{state.q&&<button type="button" onClick={clearSearch}>Limpiar búsqueda</button>}{activeFilterCount>0&&<button type="button" onClick={clearFilters}>Quitar filtros</button>}</div></div>:<><div className="mobile-cards">{rows.map(t=><TerminalCard terminal={t} searchState={{search:`?${params}`}} onOpen={followDetail} key={t.terminal}/>)}</div>{columns.length>6&&<p className="table-scroll-hint">Desplaza la tabla horizontalmente para ver todas las columnas.</p>}<div className={`table-wrap${columns.length>6?' has-overflow-hint':''}`} tabIndex={columns.length>6?0:undefined} aria-label={columns.length>6?'Tabla de comercios con desplazamiento horizontal':undefined}><table className="commerce-table" style={{minWidth:`max(100%, ${380+columns.length*110}px)`}}><colgroup><col className="commerce-name-column"/><col className="commerce-terminal-column"/>{columns.map(f=><col key={f}/>)}</colgroup><thead><tr><Sortable label="Nombre comercial" field="NombreComercial" activeField={state.orden} direction={state.direccion} sortBy={sortBy}/><Sortable label="Terminal" field="Terminal" activeField={state.orden} direction={state.direccion} sortBy={sortBy}/>{columns.map(f=><th key={f}>{metaFor(f).label}</th>)}</tr></thead><tbody>{rows.map(t=><tr key={t.terminal} onClick={()=>openDetail(t.terminal)} onKeyDown={e=>{if(e.key==='Enter')openDetail(t.terminal);}} tabIndex={0}><td title={String(excelValue(t.datos_excel,'NombreComercial')||'')}>{String(excelValue(t.datos_excel,'NombreComercial')||'')}</td><td><strong>{t.terminal}</strong></td>{columns.map(f=><td title={String(excelValue(t.datos_excel,f)??'')} key={f}>{String(excelValue(t.datos_excel,f)??'')}</td>)}</tr>)}</tbody></table></div><nav className="pagination"><button disabled={state.pagina<=1} onClick={()=>update('pagina',String(state.pagina-1))}>Anterior</button><span>Página {state.pagina} de {page?.total_paginas||1}</span><button disabled={!page||state.pagina>=page.total_paginas} onClick={()=>update('pagina',String(state.pagina+1))}>Siguiente</button></nav></>}
  {scan&&<Suspense fallback={<div className="modal">Cargando escáner…</div>}><Scanner onResult={scanned} onClose={()=>setScan(false)}/></Suspense>}<OfflineStatus userId={user!.id}/>
 </section>;
}

function useDismissable(open:boolean,close:()=>void,ref:RefObject<HTMLElement|null>){
 useEffect(()=>{if(!open)return;const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};const onPointer=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))close();};document.addEventListener('keydown',onKey);document.addEventListener('pointerdown',onPointer);return()=>{document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onPointer);};},[open,close,ref]);
}

function TerminalCard({terminal,searchState,onOpen}:{terminal:Terminal;searchState:CommerceRouteState;onOpen:(event:MouseEvent<HTMLAnchorElement>,terminal:string)=>void}){
 const[copied,setCopied]=useState('');
 const href=`/comercios/${encodeURIComponent(terminal.terminal)}`;
 async function copy(label:string,value:string){try{await navigator.clipboard.writeText(value);setCopied(`${label}: Copiado`);}catch{setCopied(`${label}: No se pudo copiar`);}window.setTimeout(()=>setCopied(''),1800);}
 const copyFields=[{field:'Terminal',label:'Terminal',value:terminal.terminal},{field:'SeriePOS',label:'Serie POS',value:excelValue(terminal.datos_excel,'SeriePOS')},{field:'Inventario',label:'Inventario',value:excelValue(terminal.datos_excel,'Inventario')}];
 return <article className="terminal-card"><header><h2><Link to={href} state={searchState} onClick={event=>onOpen(event,terminal.terminal)}>{String(excelValue(terminal.datos_excel,'NombreComercial')||'Sin nombre')}</Link></h2><strong>{terminal.terminal}</strong></header><dl>{MOBILE_FIELDS.map(field=>{const value=excelValue(terminal.datos_excel,field);if(value===undefined)return null;const empty=value===null||String(value).trim()==='';return <div key={field} className={empty?'empty-value':''}><dt>{metaFor(field).label}</dt><dd>{empty?'Sin dato':String(value)}</dd></div>;})}</dl><div className="card-copy-actions" aria-label="Copiar datos">{copyFields.map(({field,label,value})=>value!==undefined&&value!==null&&String(value)!==''&&<button type="button" key={field} aria-label={`Copiar ${label}`} onClick={()=>void copy(label,String(value))}><Icon name="copy"/>{label}</button>)}</div><Link className="card-detail-link" to={href} state={searchState} onClick={event=>onOpen(event,terminal.terminal)}>Ver detalles</Link><span className="sr-only" role="status" aria-live="polite">{copied}</span>{copied&&<span className="copy-toast" aria-hidden="true">{copied.split(': ')[1]}</span>}</article>;
}

async function searchOnlineWithVariants(state:SearchState,variants:Record<string,string[]>,signal?:AbortSignal):Promise<Page<Terminal>>{
 if(!requiresVariantExpansion(state,variants))return searchTerminals(state,signal);
 const rows=sortOnlineRows(await collectVariantRows(state,variants,signal),state),total=rows.length,start=(state.pagina-1)*state.limite;
 return{datos:rows.slice(start,start+state.limite),paginacion:{pagina:state.pagina,limite:state.limite,total,total_paginas:Math.ceil(total/state.limite)}};
}

async function allOnlineRows(state:SearchState,variants:Record<string,string[]>,signal?:AbortSignal){
 if(requiresVariantExpansion(state,variants))return sortOnlineRows(await collectVariantRows(state,variants,signal),state);
 const rows:Terminal[]=[];
 for(let page=1;;page++){
  const result=await searchTerminals({...state,pagina:page,limite:100},signal);
  rows.push(...result.datos);
  if(rows.length>=result.paginacion.total)break;
 }
 return rows;
}

function requiresVariantExpansion(state:SearchState,variants:Record<string,string[]>){
 return Object.entries(state.filtros).filter(([,value])=>value).some(([field,value])=>{const values=variants[field]||[value];return values.length!==1||values[0]!==value;});
}

async function collectVariantRows(state:SearchState,variants:Record<string,string[]>,signal?:AbortSignal){
 const selected=Object.entries(state.filtros).filter(([,value])=>value),combinations=selected.reduce<Record<string,string>[]>((items,[field,value])=>items.flatMap(item=>(variants[field]||[value]).map(variant=>({...item,[field]:variant}))),[{}]);
 const unique=new Map<string,Terminal>();
 for(const filters of combinations){
  let page=1;
  while(true){
   const result=await searchTerminals({...state,filtros:{...state.filtros,...filters},pagina:page,limite:100},signal);
   result.datos.forEach(row=>unique.set(row.terminal,row));
   if(page>=result.paginacion.total_paginas)break;
   page++;
  }
 }
 return Array.from(unique.values());
}

function sortOnlineRows(rows:Terminal[],state:SearchState){
 const collator=new Intl.Collator('es',{sensitivity:'base',numeric:true}),direction=state.direccion==='asc'?1:-1;
 const sortValue=(terminal:Terminal)=>String(state.orden==='Terminal'?terminal.terminal:excelValue(terminal.datos_excel,state.orden)??'');
 rows.sort((left,right)=>{const comparison=collator.compare(sortValue(left),sortValue(right));return comparison===0?collator.compare(left.terminal,right.terminal):comparison*direction;});
 return rows;
}

function Sortable({label,field,activeField,direction,sortBy}:{label:string;field:string;activeField:string;direction:'asc'|'desc';sortBy:(field:string)=>void}){const active=activeField===field,spoken=direction==='asc'?'ascendente':'descendente';return <th aria-sort={active?(direction==='asc'?'ascending':'descending'):'none'}><button className="table-sort" aria-label={active?`Ordenar por ${label}, actualmente ${spoken}`:`Ordenar por ${label}`} onClick={()=>sortBy(field)}>{label}{active&&<span aria-hidden="true"> {direction==='asc'?'↑':'↓'}</span>}</button></th>;}
function OfflineStatus({userId}:{userId:string}){const[meta,setMeta]=useState<{updatedAt?:string;count?:number}|null>(null);useEffect(()=>{void offlineMeta(userId).then(setMeta);},[userId]);return <p className="offline-status">{meta?.updatedAt?`Copia local: ${meta.count} registros · ${new Intl.DateTimeFormat('es-HN',{dateStyle:'short',timeStyle:'short'}).format(new Date(meta.updatedAt))}`:'Sin copia completa para uso offline'}</p>;}
