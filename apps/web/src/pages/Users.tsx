import { useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
interface ManagedUser{id:string;nombre:string;usuario:string;rol:'ADMIN'|'USUARIO';activo:boolean}

export default function Users(){
 const client=useQueryClient(),[form,setForm]=useState({nombre:'',usuario:'',password:'',rol:'USUARIO' as 'ADMIN'|'USUARIO'});
 const query=useQuery({queryKey:['users'],queryFn:()=>api<{datos:ManagedUser[]}>('/api/v1/usuarios')});
 const change=useMutation({mutationFn:({path,method='PATCH',body}:{path:string;method?:string;body:unknown})=>api(path,{method,body:JSON.stringify(body)}),onSuccess:()=>client.invalidateQueries({queryKey:['users']})});
 function create(e:FormEvent){e.preventDefault();change.mutate({path:'/api/v1/usuarios',method:'POST',body:form});}
 return <section><div className="page-heading"><div><p className="eyebrow">Administración</p><h1>Usuarios</h1></div></div>
 <form className="user-form" onSubmit={create}><h2>Crear usuario</h2><label>Nombre<input required value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></label><label>Usuario<input required value={form.usuario} onChange={e=>setForm({...form,usuario:e.target.value})}/></label><label>Contraseña temporal<input type="password" minLength={12} required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><label>Rol<select value={form.rol} onChange={e=>setForm({...form,rol:e.target.value as 'ADMIN'|'USUARIO'})}><option>USUARIO</option><option>ADMIN</option></select></label><button className="primary" disabled={change.isPending}>Crear usuario</button></form>
 {change.error&&<div className="alert error">{change.error.message}</div>}<div className="user-list">{query.data?.datos.map(u=><article key={u.id}><div><strong>{u.nombre}</strong><span>@{u.usuario}</span></div><span className={`badge ${u.activo?'success':'muted'}`}>{u.activo?'Activo':'Inactivo'}</span><label>Rol<select aria-label={`Rol de ${u.nombre}`} value={u.rol} onChange={e=>change.mutate({path:`/api/v1/usuarios/${u.id}`,body:{nombre:u.nombre,rol:e.target.value}})}><option>USUARIO</option><option>ADMIN</option></select></label><button onClick={()=>change.mutate({path:`/api/v1/usuarios/${u.id}/estado`,body:{activo:!u.activo}})}>{u.activo?'Desactivar':'Activar'}</button><button onClick={()=>{const password=prompt('Nueva contraseña segura');if(password)change.mutate({path:`/api/v1/usuarios/${u.id}/password`,method:'POST',body:{password}});}}>Restablecer contraseña</button></article>)}</div></section>;
}
