import { useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiError,api,importSnapshot } from '../api';
import { useAuth } from '../Auth';

interface SynchronizationResult {
 sincronizacion:{id:string|number;estado:string;total_registros:number};
}

interface SynchronizationSummary {
 estado:string;
 fecha_fin?:string;
 insertados:number;
 actualizados:number;
 inactivados:number;
 detalle_error?:string;
}

export default function Synchronization(){
 const{offline}=useAuth(),queryClient=useQueryClient(),[message,setMessage]=useState('');
 const last=useQuery({queryKey:['last-sync'],queryFn:()=>api<{datos:SynchronizationSummary[]}>('/api/v1/sincronizaciones?pagina=1&limite=1'),enabled:!offline});
 const sync=useMutation({mutationFn:(confirmMassDeactivation:boolean)=>importSnapshot(confirmMassDeactivation) as Promise<SynchronizationResult>});
 async function startImport(){
  if(!window.confirm('¿Importar manualmente el snapshot configurado en el servidor?'))return;
  setMessage('');
  try{
   const result=await sync.mutateAsync(false);
   setMessage(`Importación ${result.sincronizacion.estado.toLowerCase()}: ${result.sincronizacion.total_registros} registros.`);
  }catch(error){
   const requiresMassConfirmation=error instanceof ApiError&&error.status===409&&(error.data as{codigo?:string}|undefined)?.codigo==='MASS_DEACTIVATION_CONFIRMATION_REQUIRED';
   if(!requiresMassConfirmation||!window.confirm('El snapshot omite más del 10% de las terminales activas. ¿Confirmar su inactivación masiva?')){
    setMessage(error instanceof Error?error.message:'No se pudo completar la importación.');return;
   }
   try{
    const result=await sync.mutateAsync(true);
    setMessage(`Importación ${result.sincronizacion.estado.toLowerCase()}: ${result.sincronizacion.total_registros} registros.`);
   }catch(retryError){setMessage(retryError instanceof Error?retryError.message:'No se pudo completar la importación.');return;}
  }
  await Promise.all([queryClient.invalidateQueries({queryKey:['dashboard']}),queryClient.invalidateQueries({queryKey:['last-sync']})]);
 }
 if(offline)return <div className="empty"><h1>Sincronización con Excel</h1><p>Se requiere conexión para consultar o iniciar una importación.</p><Link className="button" to="/menu">Volver al Menú</Link></div>;
 return <section><div className="page-heading"><div><p className="eyebrow">Administración</p><h1>Sincronización con Excel</h1></div><Link className="button" to="/menu">Volver al Menú</Link></div><section className="admin-sync" aria-labelledby="sync-title"><h2 id="sync-title">Última importación</h2>{last.isPending?<p>Cargando estado…</p>:last.data?.datos?.[0]?<SyncSummary data={last.data.datos[0]}/>:<p>No hay sincronizaciones registradas.</p>}<button type="button" onClick={()=>void startImport()} disabled={sync.isPending}>{sync.isPending?'Importando…':'Importar snapshot ahora'}</button>{message&&<div className="alert" role="status">{message}</div>}<p className="muted">La importación solo se inicia manualmente y requiere confirmación administrativa.</p></section></section>;
}

function SyncSummary({data}:{data:SynchronizationSummary}){
 return <div className="sync-summary"><strong>{data.estado}</strong><span>{data.fecha_fin?new Intl.DateTimeFormat('es-HN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(data.fecha_fin)):'En proceso'}</span><span>Nuevos: {data.insertados}</span><span>Actualizados: {data.actualizados}</span><span>Inactivados: {data.inactivados}</span>{data.detalle_error&&<span>Error: {data.detalle_error}</span>}</div>;
}
