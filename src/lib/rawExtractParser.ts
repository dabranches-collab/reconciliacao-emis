import type { AnalysisResult, Movement, ReconciliationStatus } from '../types';
import { normalizeIdtr } from './reconciliation';
import { classifyMovement, type MovementTypeKey } from './movementType';
import type { AnalysisProgress } from './excel';

type ZipEntry = { name:string; method:number; compressedSize:number; offset:number };
type TypeTotals = { total:number; reconciled:number; unreconciled:number; missingIdtr:number };
const decoder = new TextDecoder();
const xmlText = (value:string) => value.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const iso = (value:unknown) => { const s=String(value??'').replace(/\D/g,''); return s.length===8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:''; };
const colIndex = (ref:string) => { let n=0; for(const c of ref.match(/[A-Z]+/)?.[0]??'') n=n*26+c.charCodeAt(0)-64; return n-1; };

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

export async function analyzeRawExtract(fileName:string,buffer:ArrayBuffer,onProgress:(p:AnalysisProgress)=>void):Promise<AnalysisResult>{
  const zip=entries(buffer), sheet=zip.find(e=>e.name==='xl/worksheets/sheet1.xml'), strings=zip.find(e=>e.name==='xl/sharedStrings.xml');
  if(!sheet||!strings) throw new Error('Não foi encontrada a folha principal ou o dicionário do extrato.');
  onProgress({percent:4,stage:'A ler o dicionário do extrato'}); const shared=parseStrings(await entryText(buffer,strings));
  const types=Object.fromEntries((['pos','atm','transfer','commission','service','other'] as MovementTypeKey[]).map(k=>[k,{total:0,reconciled:0,unreconciled:0,missingIdtr:0}])) as Record<MovementTypeKey,TypeTotals>;
  const groups=new Map<string,[number,number,number,number]>(); let header=-1,valid=0,minOperational='',maxOperational='',maxAccounting='',closingBalance:number|null=null,openingBalance:number|null=null;
  onProgress({percent:12,stage:'A identificar e agrupar movimentos do extrato'});
  await scanRows(buffer,sheet,shared,async(row,n)=>{
    if(header<0){if(row.includes('MRCCB')) header=n;return;}
    const signed=Number(row[9]); if(!Number.isFinite(signed)) return; valid++; if(openingBalance===null&&Number.isFinite(Number(row[12]))) openingBalance=Number(row[12])-signed;
    const operational=iso(row[14]); if(operational) minOperational=!minOperational||operational<minOperational?operational:minOperational;
    const idtr=normalizeIdtr(row[21]); if(idtr){const day=operational?Math.floor(Date.parse(operational)/86400000):0,current=groups.get(idtr);if(current){current[0]+=Math.round(signed*100);current[1]=Math.min(current[1],day);current[2]=Math.max(current[2],day);current[3]++;}else groups.set(idtr,[Math.round(signed*100),day,day,1]);}
    maxOperational=[maxOperational,operational].sort().at(-1)??maxOperational; maxAccounting=[maxAccounting,iso(row[16])].sort().at(-1)??maxAccounting; closingBalance=Number(row[12]);
    if(valid%10000===0) onProgress({percent:12+Math.min(36,Math.round(valid/25000)),stage:'A agrupar movimentos por IDTR',processed:valid,total:valid});
  });
  if(header<0) throw new Error('Este ficheiro não contém os cabeçalhos de um extrato Real Time (MRCCB, MRVLR, MRDTSIS…).');
  const timingBuckets:Record<string,number>={'D+0':0,'D+1':0,'D+2':0,'D+3':0,'D+4+':0}; let timingDays=0,timingGroups=0;
  for(const [sum,min,max] of groups.values()) if(sum===0){const delay=Math.max(0,max-min);timingGroups++;timingDays+=delay;timingBuckets[delay===0?'D+0':delay===1?'D+1':delay===2?'D+2':delay===3?'D+3':'D+4+']++;}
  const reportDate=maxAccounting||maxOperational, samples:Movement[]=[], sampleCounts:Record<ReconciliationStatus,number>={automatic:0,manual:0,unreconciled:0,missing_idtr:0,data_error:0};
  const totals={movements:0,automatic:0,manual:0,unreconciled:0,missingIdtr:0,amountCents:0}; let debitCents=0,creditCents=0; const ageBuckets:Record<string,{total:number;automatic:number;unreconciled:number;amount:number}>={};
  const dailyCents:Record<string,{movements:number;automatic:number;unreconciled:number;missingIdtr:number;amount:number}>={};
  onProgress({percent:52,stage:'A validar grupos e calcular a idade das pendências'}); let processed=0;
  await scanRows(buffer,sheet,shared,async(row,n)=>{
    if(n<=header) return; const signed=Number(row[9]); if(!Number.isFinite(signed)) return; processed++;
    const idtr=normalizeIdtr(row[21]), status:ReconciliationStatus=!idtr?'missing_idtr':groups.get(idtr)?.[0]===0?'automatic':'unreconciled';
    const operational=iso(row[14]), age=operational&&reportDate?Math.max(0,Math.round((Date.parse(reportDate)-Date.parse(operational))/86400000)):0; const bucket=age===0?'D+0':age===1?'D+1':age===2?'D+2':age===3?'D+3':age<=7?'D+4–7':'D+8+';
    const b=ageBuckets[bucket]??={total:0,automatic:0,unreconciled:0,amount:0};b.total++;b.amount+=signed;if(status==='automatic')b.automatic++;else b.unreconciled++;
    totals.movements++;totals.amountCents+=Math.round(signed*100);if(signed<0)debitCents+=Math.abs(Math.round(signed*100));else creditCents+=Math.round(signed*100);if(status==='automatic')totals.automatic++;else if(status==='missing_idtr')totals.missingIdtr++;else totals.unreconciled++;
    const accounting=iso(row[16])||operational; if(accounting){const day=dailyCents[accounting]??={movements:0,automatic:0,unreconciled:0,missingIdtr:0,amount:0};day.movements++;day.amount+=Math.round(signed*100);if(status==='automatic')day.automatic++;else if(status==='missing_idtr')day.missingIdtr++;else day.unreconciled++;}
    const description=String(row[11]??''), t=types[classifyMovement(description)];t.total++;if(status==='automatic')t.reconciled++;else if(status==='missing_idtr')t.missingIdtr++;else t.unreconciled++;
    if(sampleCounts[status]<300){samples.push({id:`${fileName}:${n}`,row:n,reportDate:operational,account:String(row[1]??''),amount:signed,currency:String(row[10]??''),operationNumber:String(row[7]??''),description,complementaryInfo:String(row[21]??''),idtr,status});sampleCounts[status]++;}
    if(processed%10000===0) onProgress({percent:52+Math.round((processed/Math.max(1,valid))*46),stage:'A validar movimentos e calcular indicadores',processed,total:valid,liveTotals:{movements:totals.movements,automatic:totals.automatic,unreconciled:totals.unreconciled,missingIdtr:totals.missingIdtr},liveMovementTypes:types});
  });
  onProgress({percent:100,stage:'Análise do extrato concluída'});
  const dailyMetrics=Object.fromEntries(Object.entries(dailyCents).map(([day,value])=>[day,{...value,amount:value.amount/100}]));
  return {sourceMode:'raw_extract',periodStart:minOperational,reportDate,accountingBalance:closingBalance,movements:samples,groups:[],totals:{movements:totals.movements,automatic:totals.automatic,manual:0,unreconciled:totals.unreconciled,missingIdtr:totals.missingIdtr,amount:totals.amountCents/100},movementTypes:types,ageBuckets,rawAmounts:{debits:debitCents/100,credits:creditCents/100,net:totals.amountCents/100,openingBalance,closingBalance},reconciliationTiming:{averageDays:timingGroups?timingDays/timingGroups:0,totalGroups:timingGroups,buckets:timingBuckets},dailyMetrics};
}
