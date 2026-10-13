export interface FieldMeta { key: string; label: string; group: string; priority?: boolean; internal?: boolean }
const known: FieldMeta[] = [
  ['NombreComercial','Nombre comercial','Comercio',true], ['CodigoComercio','Código de comercio','Comercio',true],
  ['CategoriaComercio','Categoría','Comercio'], ['Zona','Zona','Comercio'], ['Ciudad','Ciudad','Comercio'],
  ['Direccion','Dirección','Comercio'], ['Ubicacion','Ubicación','Comercio'], ['Inventario','Inventario','Terminal y equipo',true],
  ['SeriePOS','Serie POS','Terminal y equipo',true], ['Modelo','Modelo','Terminal y equipo',true],
  ['Comunicacion','Comunicación','Terminal y equipo',true], ['PLATAFORMA','Plataforma','Terminal y equipo'],
  ['RedSimcard','Red SIM','Conectividad',true], ['SerieSimcard','Serie SIM / Chip','Conectividad',true],
  ['IP','IP','Conectividad'], ['Mascara','Máscara','Conectividad'], ['Gateway','Gateway','Conectividad'],
  ['DNS','DNS','Conectividad'], ['DNS2','DNS 2','Conectividad'], ['Atendio','Atendió','Contacto y gestión',true],
  ['Celular','Celular','Contacto y gestión'], ['Correo','Correo','Contacto y gestión',true],
  ['TecnicoAsignado','Técnico asignado','Contacto y gestión',true]
].map(([key,label,group,priority]) => ({key:String(key),label:String(label),group:String(group),priority:Boolean(priority)}));
const internal: FieldMeta[] = [
  {key:'ubicacion_interna',label:'Ubicación interna',group:'Datos internos',internal:true},
  {key:'referencia_interna',label:'Referencia interna',group:'Datos internos',internal:true}
];
export const FIELD_META = new Map([...known,...internal].map((field) => [field.key, field]));
export const EDITABLE_FIELDS = new Set([...known,...internal].map((field) => field.key));
export const INTERNAL_FIELDS = new Set(['ItemInternalId','@odata.etag','version','activa','fecha_creacion','fecha_actualizacion','fecha_ultima_sincronizacion']);
export const metaFor = (key: string): FieldMeta => FIELD_META.get(key) || { key, label: key.replace(/([a-z])([A-Z])/gu,'$1 $2'), group: 'Información adicional' };
export const PRIORITY_FIELDS = known.filter((f) => f.priority).map((f) => f.key);
export const FILTER_FIELDS = ['TecnicoAsignado','Zona','Ciudad','CategoriaComercio','Modelo','Comunicacion','RedSimcard'];
export const SEARCH_FIELDS = ['todos','terminal',...known.map((f)=>f.key),...internal.map((f)=>f.key)];
