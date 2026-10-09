import { openDB } from 'idb';
import type { SearchState, Terminal, User } from './types';
import { searchTerminals } from './api';

const dbPromise = openDB('cartera-clientes', 1, { upgrade(db) {
  const terminals = db.createObjectStore('terminales', { keyPath: 'key' }); terminals.createIndex('userId','userId');
  db.createObjectStore('meta', { keyPath: 'key' }); db.createObjectStore('preferences', { keyPath: 'key' });
}});
const accessHours = Number(import.meta.env.VITE_OFFLINE_ACCESS_HOURS || 24);

export async function saveOfflineAuth(user: User) {
  const db=await dbPromise; await db.put('meta',{key:`auth:${user.id}`,user,authorizedUntil:Date.now()+accessHours*3600000});
  await db.put('meta',{key:'lastUser',userId:user.id});
}
export async function getOfflineAuth(): Promise<User|null> {
  const db=await dbPromise; const last=await db.get('meta','lastUser'); if(!last) return null;
  const auth=await db.get('meta',`auth:${last.userId}`); return auth?.authorizedUntil>Date.now()?auth.user:null;
}
export async function clearUserData(userId:string) {
  const db=await dbPromise; const tx=db.transaction(['terminales','meta','preferences'],'readwrite');
  let cursor=await tx.objectStore('terminales').index('userId').openCursor(IDBKeyRange.only(userId));
  while(cursor){ await cursor.delete(); cursor=await cursor.continue(); }
  await tx.objectStore('meta').delete(`auth:${userId}`); await tx.objectStore('preferences').delete(`columns:${userId}`);
  const last=await tx.objectStore('meta').get('lastUser'); if(last?.userId===userId) await tx.objectStore('meta').delete('lastUser'); await tx.done;
}
export async function replaceOfflineTerminals(userId:string, rows:Terminal[]) {
  const db=await dbPromise; const tx=db.transaction(['terminales','meta'],'readwrite');
  let cursor=await tx.objectStore('terminales').index('userId').openCursor(IDBKeyRange.only(userId));
  while(cursor){await cursor.delete();cursor=await cursor.continue();}
  for(const terminal of rows) await tx.objectStore('terminales').put({key:`${userId}:${terminal.terminal}`,userId,...terminal});
  await tx.objectStore('meta').put({key:`sync:${userId}`,updatedAt:new Date().toISOString(),count:rows.length,complete:true}); await tx.done;
}
export async function downloadOffline(user:User,onProgress:(done:number,total:number)=>void) {
  const rows:Terminal[]=[]; let page=1;
  while(true) { const result=await searchTerminals({q:'',campo:'todos',pagina:page,limite:100,estado:user.rol==='ADMIN'?'todas':'activas',orden:'NombreComercial',direccion:'asc',filtros:{}}); rows.push(...result.datos); onProgress(rows.length,result.paginacion.total); if(rows.length>=result.paginacion.total)break; page++; }
  await replaceOfflineTerminals(user.id,rows); await saveOfflineAuth(user); return rows.length;
}
export async function offlineMeta(userId:string){return (await dbPromise).get('meta',`sync:${userId}`);}
export async function getColumns(userId:string,defaults:string[]){const preference=await (await dbPromise).get('preferences',`columns:${userId}`);return preference?.columns||defaults;}
export async function saveColumns(userId:string,columns:string[]){await (await dbPromise).put('preferences',{key:`columns:${userId}`,columns});}
export async function allOffline(userId:string):Promise<Terminal[]>{return (await dbPromise).getAllFromIndex('terminales','userId',userId);}
export async function offlineTerminal(userId:string,terminal:string):Promise<Terminal|undefined>{return (await dbPromise).get('terminales',`${userId}:${terminal}`);}
export async function searchOffline(userId:string,state:SearchState){
  let rows=await allOffline(userId); const term=state.q.toLocaleLowerCase('es');
  rows=rows.filter(t=>state.estado==='todas'||(state.estado==='activas'?t.activa:!t.activa));
  if(term) rows=rows.filter(t=>{const vals=state.campo==='todos'?[t.terminal,...Object.values(t.datos_excel)]:[state.campo==='terminal'?t.terminal:t.datos_excel[state.campo]];return vals.some(v=>String(v??'').toLocaleLowerCase('es').includes(term));});
  rows=rows.filter(t=>Object.entries(state.filtros).every(([k,v])=>!v||String(t.datos_excel[k]??'')===v));
  const key=(t:Terminal)=>String(state.orden==='Terminal'?t.terminal:t.datos_excel[state.orden]??''); rows.sort((a,b)=>key(a).localeCompare(key(b),'es')*(state.direccion==='asc'?1:-1));
  const total=rows.length,start=(state.pagina-1)*state.limite; return {datos:rows.slice(start,start+state.limite),paginacion:{pagina:state.pagina,limite:state.limite,total,total_paginas:Math.ceil(total/state.limite)}};
}
