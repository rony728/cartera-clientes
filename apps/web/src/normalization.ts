export interface ValueGroup { value:string;label:string;variants:string[] }
export interface DistributionGroup extends ValueGroup { total:number }

const preferredLabels=new Map([
 ['gprs','GPRS'],
 ['ip','IP'],
 ['wifi','WIFI'],
 ['claro','CLARO']
]);

export function normalizeCategoryKey(value:unknown){
 return String(value??'').trim().replace(/\s+/gu,' ').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('es');
}

export function categoryLabel(value:unknown){
 const trimmed=String(value??'').trim().replace(/\s+/gu,' ');
 return preferredLabels.get(normalizeCategoryKey(trimmed))||trimmed;
}

export function groupEquivalentValues(values:string[]):ValueGroup[]{
 const grouped=new Map<string,string[]>();
 for(const original of values){
  const key=normalizeCategoryKey(original);
  if(!key)continue;
  const variants=grouped.get(key)||[];
  if(!variants.includes(original))variants.push(original);
  grouped.set(key,variants);
 }
 return Array.from(grouped.values()).map(variants=>{const display=preferredVariant(variants);return{value:categoryLabel(display),label:categoryLabel(display),variants};});
}

export function groupDistribution(rows:{valor:string;total:number}[]):DistributionGroup[]{
 const grouped=new Map<string,DistributionGroup>();
 for(const row of rows){
  const key=normalizeCategoryKey(row.valor);
  if(!key)continue;
  const current=grouped.get(key);
  if(current){current.total+=row.total;if(!current.variants.includes(row.valor))current.variants.push(row.valor);}
  else grouped.set(key,{value:categoryLabel(row.valor),label:categoryLabel(row.valor),variants:[row.valor],total:row.total});
 }
 return Array.from(grouped.values()).map(group=>{const display=preferredVariant(group.variants);return{...group,value:categoryLabel(display),label:categoryLabel(display)};}).sort((left,right)=>right.total-left.total||left.label.localeCompare(right.label,'es'));
}

function preferredVariant(variants:string[]){
 return [...variants].sort((left,right)=>accentCount(left)-accentCount(right)||left.trim().length-right.trim().length||left.localeCompare(right,'es'))[0];
}

function accentCount(value:string){return(value.normalize('NFD').match(/\p{M}/gu)||[]).length;}
