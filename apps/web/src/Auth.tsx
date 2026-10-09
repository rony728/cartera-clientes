import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as client from './api';
import { ApiError } from './api';
import { clearUserData, downloadOffline, getOfflineAuth, offlineMeta, saveOfflineAuth } from './offline';
import type { User } from './types';

interface AuthValue { user:User|null; loading:boolean; offline:boolean; signIn:(u:string,p:string)=>Promise<void>; signOut:()=>Promise<void>; refresh:()=>Promise<void> }
const Context=createContext<AuthValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[offline,setOffline]=useState(!navigator.onLine);
  async function refresh(){try{const current=await client.getMe();await client.getCsrf();setUser(current);setOffline(false);await saveOfflineAuth(current);const meta=await offlineMeta(current.id);if(!meta?.updatedAt||Date.now()-new Date(meta.updatedAt).getTime()>3600000)void downloadOffline(current,()=>{}).catch(()=>{});}catch(error){if(error instanceof ApiError&&error.status===401){setUser(null);return;}setOffline(true);setUser(await getOfflineAuth());}}
  useEffect(()=>{refresh().finally(()=>setLoading(false));const online=()=>{setOffline(false);void refresh();},off=()=>setOffline(true),expired=()=>{if(navigator.onLine)setUser(null)};addEventListener('online',online);addEventListener('offline',off);addEventListener('session-expired',expired);return()=>{removeEventListener('online',online);removeEventListener('offline',off);removeEventListener('session-expired',expired);};},[]);
  async function signIn(username:string,password:string){const logged=await client.login(username,password);setUser(logged);setOffline(false);await saveOfflineAuth(logged);}
  async function signOut(){const id=user?.id;try{if(navigator.onLine)await client.logout();}finally{if(id)await clearUserData(id);setUser(null);}}
  return <Context.Provider value={{user,loading,offline,signIn,signOut,refresh}}>{children}</Context.Provider>;
}
export const useAuth=()=>{const value=useContext(Context);if(!value)throw new Error('AuthProvider requerido');return value;};
