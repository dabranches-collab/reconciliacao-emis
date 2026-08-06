import type { AnalysisResult, Movement, ReconciliationStatus } from '../types';
import { normalizeIdtr } from './reconciliation';
import { classifyMovement, type MovementTypeKey } from './movementType';
import type { AnalysisProgress } from './excel';
import type { PersistenceContext } from './database';
import { operationalDaysBetween } from './operationalDays';

type ZipEntry = { name:string; method:number; compressedSize:number; offset:number };
type TypeTotals = { total:number; reconciled:number; unreconciled:number; missingIdtr:number };
const decoder = new TextDecoder();
const xmlText = (value:string) => value.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const iso = (value:unknown) => { const s=String(value??'').replace(/\D/g,''); return s.length===8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:''; };
const colIndex = (ref:string) => { let n=0; for(const c of ref.match(/[A-Z]+/)?.[0]??'') n=n*26+c.charCodeAt(0)-64; return n-1; };
const timeValue=(value:unknown)=>{const digits=String(value??'').replace(/\D/g,'').padStart(6,'0').slice(-6);return `${digits.slice(0,2)}:${digits.slice(2,4)}:${digits.slice(4)}`;};
export const movementFingerprint=(values:unknown[])=>{let a=2166136261,b=2246822507;const text=values.map(value=>String(value??'').trim()).join('\u001f');for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);a=Math.imul(a^code,16777619);b=Math.imul(b^code,3266489917);}return `${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`;};
const headerKey=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const descriptionKey=(value:unknown)=>headerKey(value).replace(/^anl\s+/,'');
const reference26=(value:unknown)=>/^\s*\/(26\d+)\s*$/.exec(String(value??''))?.[1]??null;
type Columns={account:number;value:number;currency:number;description:number;balance:number;systemDate:number;systemTime:number;accountingDate:number;operation:number;observations:number;complementary:number};
const aliases:Record<keyof Columns,string[]>={
  account:['Conta contabilística','MRCCB'],value:['Valor do movimento','MRVLR'],currency:['Moeda','MRMOED'],description:['Descritivo movimento','MRDMOV'],balance:['Saldo após movimento','MRSALD'],systemDate:['Data de sistema','MRDTSIS'],systemTime:['Hora de sistema','MRHORA'],accountingDate:['Periodo contabilístico de lançamento','MRDATL'],operation:['Número da operação','MRNOPR'],observations:['Observações','MROBS'],complementary:['Informação Complementar do movimento','GBMRINFC'],
};
function resolveColumns(row:unknown[]):Columns|null{
  const found=new Map(row.map((value,index)=>[headerKey(value),index])); const result={} as Columns;
  for(const [field,names] of Object.entries(aliases) as [keyof Columns,string[]][]){const index=names.map(headerKey).map(name=>found.get(name)).find(value=>value!==undefined);if(index===undefined)return null;result[field]=index;}
  return result;
}
async function persistMovements(context:PersistenceContext,rows:Record<string,unknown>[]){
  if(!rows.length)return;
  const response=await fetch(`${context.url}/rest/v1/movements?on_conflict=analysis_id,fingerprint`,{method:'POST',headers:{apikey:context.key,Authorization:`Bearer ${context.accessToken}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(rows)});
  if(!response.ok)throw new Error(`Não foi possível guardar os movimentos na base central (${response.status}): ${await response.text()}`);
}

function entries(buffer:ArrayBuffer):ZipEntry[]{
  const bytes=new Uint8Array(buffer), view=new DataView(buffer); let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
  if(eocd<0) throw new Error('O ficheiro não é um XLSX válido.');
  const count=view.getUint16(eocd+10,true), start=view.getUint32(eocd+16,true), result:ZipEntry[]=[]; let p=start;
  for(let i=0;i<count;i++){
    if(view.getUint32(p,true)!==0x02014b50) break;
    const method=view.getUint16(p+10,true), compressedSize=view.getUint32(p+20,true), nameLen=view.getUint16(p+28,true), extraLen=view.getUint16(p+30,true), commentLen=view.getUint16(p+32,true), local=view.getUint32(p+42,true);
    result.push({name:decoder.decode(bytes.subarray(p+46,p+46+nameLen)),method,compressedSize,offset:local}); p+=46+nameLen+extraLen+commentLen;
  }
  return result;
}
function compressedSlice(buffer:ArrayBuffer, entry:ZipEntry){ const v=new DataView(buffer), name=v.getUint16(entry.offset+26,true), extra=v.getUint16(entry.offset+28,true), start=entry.offset+30+name+extra; return new Blob([new Uint8Array(buffer,start,entry.compressedSize)]); }
function streamEntry(buffer:ArrayBuffer, entry:ZipEntry):ReadableStream<Uint8Array>{
  const stream=compressedSlice(buffer,entry).stream() as ReadableStream<Uint8Array>;
  if(entry.method===0) return stream;
  if(entry.method!==8) throw new Error('Método de compressão XLSX não suportado.');
  return stream.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array,Uint8Array>);
}
async function entryText(buffer:ArrayBuffer, entry:ZipEntry){ return new Response(streamEntry(buffer,entry)).text(); }
function parseStrings(xml:string){ const values:string[]=[]; for(const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) values.push(xmlText(match[1])); return values; }
function parseRow(xml:string, shared:string[]){
  const row:unknown[]=[];
  for(const cell of xml.matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/g)){
    const ref=/\br="([A-Z]+\d+)"/.exec(cell[1])?.[1]; if(!ref) continue;
    const raw=/<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1]??''; const type=/\bt="([^"]+)"/.exec(cell[1])?.[1];
    row[colIndex(ref)]=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?xmlText(cell[2]):raw===''?'':Number.isFinite(Number(raw))?Number(raw):xmlText(raw);
  }
  return row;
}
async function scanRows(buffer:ArrayBuffer, entry:ZipEntry, shared:string[], onRow:(row:unknown[],rowNumber:number)=>void|Promise<void>){
  const reader=streamEntry(buffer,entry).getReader(); let carry='', count=0;
  while(true){ const {done,value}=await reader.read(); if(done) break; carry+=decoder.decode(value,{stream:true}); let end:number;
    while((end=carry.indexOf('</row>'))>=0){ const close=end+6, start=carry.lastIndexOf('<row',end); if(start>=0){count++;await onRow(parseRow(carry.slice(start,close),shared),count);} carry=carry.slice(close); }
    if(carry.length>2_000_000) carry=carry.slice(-200_000);
  }
}

export async function analyzeRawExtract(fileName:string,buffer:ArrayBuffer,onProgress:(p:AnalysisProgress)=>void,persistence?:PersistenceContext):Promise<AnalysisResult>{
  const zip=entries(buffer), sheet=zip.find(e=>e.name==='xl/worksheets/sheet1.xml'), strings=zip.find(e=>e.name==='xl/sharedStrings.xml');
  if(!sheet||!strings) throw new Error('Não foi encontrada a folha principal ou o dicionário do extrato.');
  onProgress({percent:4,stage:'A ler o dicionário do extrato'}); const shared=parseStrings(await entryText(buffer,strings));
  const types=Object.fromEntries((['pos','atm','transfer','commission','service','other'] as MovementTypeKey[]).map(k=>[k,{total:0,reconciled:0,unreconciled:0,missingIdtr:0}])) as Record<MovementTypeKey,TypeTotals>;
  const groups=new Map<string,[number,number,number,number]>(); let header=-1,columns:Columns|null=null,valid=0,minAccounting='',maxSystem='',maxAccounting='',closingBalance:number|null=null,openingBalance:number|null=null,balanceErrors=0;const previousBalances=new Map<string,number>();
  onProgress({percent:12,stage:'A identificar e agrupar movimentos do extrato'});
  await scanRows(buffer,sheet,shared,async(row,n)=>{
    if(header<0){const resolved=resolveColumns(row);if(resolved){columns=resolved;header=n;}return;} const c=columns!;
    const signed=Number(row[c.value]); if(!Number.isFinite(signed)) return; valid++; const balance=Number(row[c.balance]),account=String(row[c.account]??'');if(openingBalance===null&&Number.isFinite(balance)) openingBalance=balance-signed;
    const systemDate=iso(row[c.systemDate]),accounting=iso(row[c.accountingDate])||systemDate;if(accounting) minAccounting=!minAccounting||accounting<minAccounting?accounting:minAccounting;
    const previous=previousBalances.get(account);if(previous!==undefined&&Number.isFinite(balance)&&Math.abs(previous+signed-balance)>0.011)balanceErrors++;if(Number.isFinite(balance))previousBalances.set(account,balance);
    const idtr=normalizeIdtr(row[c.complementary]); if(idtr){const day=accounting?Math.floor(Date.parse(accounting)/86400000):0,current=groups.get(idtr);if(current){current[0]+=Math.round(signed*100);current[1]=Math.min(current[1],day);current[2]=Math.max(current[2],day);current[3]++;}else groups.set(idtr,[Math.round(signed*100),day,day,1]);}
    maxSystem=[maxSystem,systemDate].sort().at(-1)??maxSystem; maxAccounting=[maxAccounting,accounting].sort().at(-1)??maxAccounting; closingBalance=balance;
    if(valid%10000===0) onProgress({percent:12+Math.min(36,Math.round(valid/25000)),stage:'A agrupar movimentos por IDTR',processed:valid,total:valid});
  });
  if(header<0) throw new Error('Não foram encontrados todos os cabeçalhos obrigatórios do extrato Real Time.');
  if(balanceErrors)throw new Error(`A sequência contabilística contém ${balanceErrors.toLocaleString('pt-AO')} inconsistência(s) entre o valor e o saldo.`);
  const timingBuckets:Record<string,number>={'D+0':0,'D+1':0,'D+2':0,'D+3':0,'D+4+':0}; let timingDays=0,timingGroups=0;
  for(const [sum,min,max] of groups.values()) if(sum===0){const delay=operationalDaysBetween(new Date(min*86400000).toISOString().slice(0,10),new Date(max*86400000).toISOString().slice(0,10));timingGroups++;timingDays+=delay;timingBuckets[delay===0?'D+0':delay===1?'D+1':delay===2?'D+2':delay===3?'D+3':'D+4+']++;}
  const reportDate=maxAccounting||maxSystem, samples:Movement[]=[], sampleCounts:Record<ReconciliationStatus,number>={automatic:0,manual:0,unreconciled:0,missing_idtr:0,data_error:0};
  const totals={movements:0,automatic:0,manual:0,unreconciled:0,missingIdtr:0,amountCents:0}; let debitCents=0,creditCents=0; const ageBuckets:Record<string,{total:number;automatic:number;unreconciled:number;amount:number}>={};
  const dailyCents:Record<string,{movements:number;automatic:number;unreconciled:number;missingIdtr:number;amount:number}>={};
  onProgress({percent:52,stage:persistence?'A validar e guardar movimentos na base central':'A validar grupos e calcular a idade das pendências'}); let processed=0;const databaseRows:Record<string,unknown>[]=[];
  await scanRows(buffer,sheet,shared,async(row,n)=>{
    if(n<=header) return; const c=columns!,signed=Number(row[c.value]); if(!Number.isFinite(signed)) return; processed++;
    const complementary=String(row[c.complementary]??''),observations=String(row[c.observations]??''),idtr=normalizeIdtr(complementary), status:ReconciliationStatus=!idtr?'missing_idtr':groups.get(idtr)?.[0]===0?'automatic':'unreconciled';
    const systemDate=iso(row[c.systemDate]),accounting=iso(row[c.accountingDate])||systemDate,age=accounting&&reportDate?operationalDaysBetween(accounting,reportDate):0; const bucket=age===0?'D+0':age===1?'D+1':age===2?'D+2':age===3?'D+3':age<=7?'D+4–7':'D+8+';
    const b=ageBuckets[bucket]??={total:0,automatic:0,unreconciled:0,amount:0};b.total++;b.amount+=signed;if(status==='automatic')b.automatic++;else b.unreconciled++;
    totals.movements++;totals.amountCents+=Math.round(signed*100);if(signed<0)debitCents+=Math.abs(Math.round(signed*100));else creditCents+=Math.round(signed*100);if(status==='automatic')totals.automatic++;else if(status==='missing_idtr')totals.missingIdtr++;else totals.unreconciled++;
    if(accounting){const day=dailyCents[accounting]??={movements:0,automatic:0,unreconciled:0,missingIdtr:0,amount:0};day.movements++;day.amount+=Math.round(signed*100);if(status==='automatic')day.automatic++;else if(status==='missing_idtr')day.missingIdtr++;else day.unreconciled++;}
    const description=String(row[c.description]??''),descriptionNormalized=descriptionKey(description),t=types[classifyMovement(description)];t.total++;if(status==='automatic')t.reconciled++;else if(status==='missing_idtr')t.missingIdtr++;else t.unreconciled++;
    if(persistence){const account=String(row[c.account]??''),operation=String(row[c.operation]??''),reference=reference26(observations);databaseRows.push({analysis_id:persistence.analysisId,batch_id:persistence.batchId,source_row:n,movement_date:systemDate||null,movement_time:timeValue(row[c.systemTime]),accounting_date:accounting||null,account,amount:signed,currency:String(row[c.currency]??'AOA'),operation_number:operation,description,description_normalized:descriptionNormalized,observations,complementary_info:complementary,balance:Number.isFinite(Number(row[c.balance]))?Number(row[c.balance]):null,idtr,reference_26:reference,status,reconciliation_method:status==='automatic'?'idtr':null,reconciliation_key:status==='automatic'?idtr:null,reconciliation_rule_version:status==='automatic'?'rt-v2':null,fingerprint:movementFingerprint([systemDate,timeValue(row[c.systemTime]),accounting,account,operation,signed,description,observations,complementary])});if(databaseRows.length>=1000){await persistMovements(persistence,databaseRows.splice(0,databaseRows.length));}}
    if(sampleCounts[status]<300){samples.push({id:`${fileName}:${n}`,row:n,reportDate:accounting,account:String(row[c.account]??''),amount:signed,currency:String(row[c.currency]??''),operationNumber:String(row[c.operation]??''),description,complementaryInfo:complementary,idtr,status});sampleCounts[status]++;}
    if(processed%10000===0) onProgress({percent:52+Math.round((processed/Math.max(1,valid))*46),stage:'A validar movimentos e calcular indicadores',processed,total:valid,liveTotals:{movements:totals.movements,automatic:totals.automatic,unreconciled:totals.unreconciled,missingIdtr:totals.missingIdtr},liveMovementTypes:types});
  });
  if(persistence&&databaseRows.length)await persistMovements(persistence,databaseRows);
  onProgress({percent:100,stage:'Análise do extrato concluída'});
  const dailyMetrics=Object.fromEntries(Object.entries(dailyCents).map(([day,value])=>[day,{...value,amount:value.amount/100}]));
  return {sourceMode:'raw_extract',periodStart:minAccounting,reportDate,accountingBalance:closingBalance,movements:samples,groups:[],totals:{movements:totals.movements,automatic:totals.automatic,manual:0,unreconciled:totals.unreconciled,missingIdtr:totals.missingIdtr,amount:totals.amountCents/100},movementTypes:types,ageBuckets,rawAmounts:{debits:debitCents/100,credits:creditCents/100,net:totals.amountCents/100,openingBalance,closingBalance},reconciliationTiming:{averageDays:timingGroups?timingDays/timingGroups:0,totalGroups:timingGroups,buckets:timingBuckets},dailyMetrics};
}
