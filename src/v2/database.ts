import {supabase} from '../lib/supabase';
import type {ImportProgress,ImportSink,LiveMovementTypeCounts,PersistedMovement} from './importPipeline';

export type V2ImportContext={seriesId:string;importId:string};
export type V2Dashboard={state:'pending'|'processing'|'completed'|'failed';ruleVersion:string;calculatedAt:string|null;result:Record<string,unknown>|null;error:string|null};
export type V2LiveStats={withNativeIdtr:number;withoutNativeIdtr:number;reference26:number;amountCents:number;provisionalReconciled:number;estimatedRows:number;movementTypes:LiveMovementTypeCounts};
export type ActiveV2Import={id:string;original_filename:string;state:string;stage:string;progress:number;error_message:string|null;source_rows:number;inserted_rows:number;duplicate_rows:number;rejected_rows:number;heartbeat_at:string|null;live_stats:Partial<V2LiveStats>|null};
export type V2BalanceAnomaly={id:number;series_id:string;import_id:string;source_row:number;accounting_date:string;system_date:string|null;system_time:string|null;account:string;currency:string;operation_number:string|null;amount:number;balance:number|null;expected_balance:number|null;raw_description:string|null;native_idtr:string|null;reference_26:string|null;status:string;reconciliation_method:string|null};
export type V2BalanceContextMovement=Pick<V2BalanceAnomaly,'id'|'source_row'|'accounting_date'|'system_date'|'system_time'|'operation_number'|'amount'|'balance'|'raw_description'|'native_idtr'|'reference_26'|'status'|'reconciliation_method'>;
export type V2BalanceAnomalyContext={previous:V2BalanceContextMovement|null;next:V2BalanceContextMovement|null};
const cleanServerStage=(value:unknown)=>String(value??'').replace(/\u00e2\u20ac\u201d/g,'-');
let cachedSeriesId:string|null=null;
async function loadSeriesId(){
  if(cachedSeriesId)return cachedSeriesId;
  const series=await supabase.from('rt_v2_series').select('id').order('created_at',{ascending:true}).limit(1).maybeSingle();
  if(series.error)throw series.error;
  if(series.data)cachedSeriesId=series.data.id;
  return cachedSeriesId;
}

export async function prepareV2Import(file:File,fileHash:string):Promise<{context:V2ImportContext;duplicate:boolean}>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('A sessão terminou. Entre novamente antes de importar.');
  let series=(await supabase.from('rt_v2_series').select('id').order('created_at',{ascending:true}).limit(1).maybeSingle());
  if(series.error)throw series.error;
  if(!series.data){series=await supabase.from('rt_v2_series').insert({created_by:session.user.id}).select('id').single();if(series.error)throw series.error;}
  cachedSeriesId=series.data!.id;
  const existing=await supabase.from('rt_v2_imports').select('id,state').eq('series_id',series.data!.id).eq('file_sha256',fileHash).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data){
    if(existing.data.state==='completed')return {context:{seriesId:series.data!.id,importId:existing.data.id},duplicate:true};
    const reset=await supabase.from('rt_v2_imports').update({state:'validating',stage:'A validar cabeçalhos',progress:1,error_message:null,heartbeat_at:new Date().toISOString()}).eq('id',existing.data.id);
    if(reset.error)throw reset.error;
    return {context:{seriesId:series.data!.id,importId:existing.data.id},duplicate:false};
  }
  const created=await supabase.from('rt_v2_imports').insert({series_id:series.data!.id,original_filename:file.name,file_sha256:fileHash,file_size:file.size,uploaded_by:session.user.id,state:'validating',stage:'A validar cabeçalhos',progress:1}).select('id').single();
  if(created.error)throw created.error;
  await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'v2_import_started',entity_type:'rt_v2_import',entity_id:created.data.id,details:{filename:file.name,fileSize:file.size,fileHash}});
  return {context:{seriesId:series.data!.id,importId:created.data.id},duplicate:false};
}

const movementRow=(context:V2ImportContext,row:PersistedMovement)=>({
  series_id:context.seriesId,import_id:context.importId,source_row:row.sourceRow,fingerprint:row.fingerprint,
  raw_system_date:String(row.raw.systemDate??''),raw_system_time:String(row.raw.systemTime??''),raw_accounting_period:String(row.raw.accountingDate??''),raw_account:String(row.raw.account??''),raw_amount:String(row.raw.amount??''),raw_currency:String(row.raw.currency??''),raw_operation_number:String(row.raw.operationNumber??''),raw_description:String(row.raw.description??''),raw_observations:String(row.raw.observations??''),raw_complementary_info:String(row.raw.complementaryInfo??''),raw_balance:String(row.raw.balance??''),
  system_date:row.systemDate,system_time:row.systemTime,accounting_date:row.accountingDate,account:row.account,amount:row.amountCents/100,currency:row.currency,operation_number:row.operationNumber,description_normalized:row.descriptionNormalized,balance:row.balanceCents===null?null:row.balanceCents/100,balance_sequence_valid:row.balanceSequenceValid,expected_balance:row.expectedBalanceCents===null?null:row.expectedBalanceCents/100,native_idtr:row.nativeIdtr,reference_26:row.reference26,status:'open',
});

export function createV2ImportSink(context:V2ImportContext,onProgress:(value:ImportProgress)=>void,estimatedRows=0):ImportSink{
  return {
    async persist(rows){
      const query=await supabase.from('rt_v2_movements').upsert(rows.map(row=>movementRow(context,row)),{onConflict:'series_id,fingerprint',ignoreDuplicates:true}).select('id');
      if(query.error)throw query.error;
      const inserted=query.data?.length??0;
      return {inserted,duplicates:rows.length-inserted};
    },
    async progress(value){
      onProgress(value);
      const stage=value.stage==='reconciling'?'reconciling':value.stage;
      const progress=value.stage==='validating'?2:value.stage==='ingesting'?Math.min(78,5+Math.round(value.processed/Math.max(1,estimatedRows)*73)):value.stage==='reconciling'?80:value.stage==='failed'?0:100;
      const live_stats={withNativeIdtr:value.withNativeIdtr,withoutNativeIdtr:value.withoutNativeIdtr,reference26:value.reference26,amountCents:value.amountCents,provisionalReconciled:value.provisionalReconciled,estimatedRows,movementTypes:value.movementTypes};
      const update=await supabase.from('rt_v2_imports').update({state:stage,stage:value.message,progress,source_rows:value.processed,inserted_rows:value.inserted,duplicate_rows:value.duplicates,rejected_rows:value.rejected,live_stats,heartbeat_at:new Date().toISOString(),error_message:value.stage==='failed'?value.message:null}).eq('id',context.importId);
      if(update.error)throw update.error;
    },
  };
}

export async function finalizeV2Import(context:V2ImportContext){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('A sessão terminou. Entre novamente antes de finalizar a importação.');
  const response=await fetch(`/api/v2/imports/${encodeURIComponent(context.importId)}/finalize`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});
  if(!response.ok)throw new Error(`Não foi possível iniciar a reconciliação central: ${await response.text()}`);
  return await response.json() as Record<string,unknown>;
}

export async function loadV2ImportState(importId:string){
  const query=await supabase.from('rt_v2_imports').select('state,stage,progress,error_message,source_rows,inserted_rows').eq('id',importId).single();
  if(query.error)throw query.error;
  return {...query.data,stage:cleanServerStage(query.data.stage)} as {state:string;stage:string;progress:number;error_message:string|null;source_rows:number;inserted_rows:number};
}

export async function loadActiveV2Import():Promise<ActiveV2Import|null>{
  const seriesId=await loadSeriesId();if(!seriesId)return null;
  const query=await supabase.from('rt_v2_imports')
    .select('id,original_filename,state,stage,progress,error_message,source_rows,inserted_rows,duplicate_rows,rejected_rows,heartbeat_at,live_stats')
    .eq('series_id',seriesId).in('state',['validating','ingesting','reconciling','calculating'])
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(query.error)throw query.error;
  return query.data?{...query.data,stage:cleanServerStage(query.data.stage)} as ActiveV2Import:null;
}

export async function loadV2Dashboard(seriesId:string):Promise<V2Dashboard|null>{
  const query=await supabase.from('rt_v2_calculations').select('state,rule_version,calculated_at,result,error_message').eq('series_id',seriesId).eq('metric','dashboard').maybeSingle();
  if(query.error)throw query.error;if(!query.data)return null;
  return {state:query.data.state as V2Dashboard['state'],ruleVersion:query.data.rule_version,calculatedAt:query.data.calculated_at,result:(query.data.result??{}) as Record<string,unknown>,error:query.data.error_message};
}

export async function loadLatestV2Dashboard():Promise<V2Dashboard|null>{
  const seriesId=await loadSeriesId();
  return seriesId?loadV2Dashboard(seriesId):null;
}

export async function loadV2BalanceAnomalies(limit=50):Promise<V2BalanceAnomaly[]>{
  const seriesId=await loadSeriesId();if(!seriesId)return[];
  const query=await supabase.from('rt_v2_movements').select('id,series_id,import_id,source_row,accounting_date,system_date,system_time,account,currency,operation_number,amount,balance,expected_balance,raw_description,native_idtr,reference_26,status,reconciliation_method').eq('series_id',seriesId).eq('balance_sequence_valid',false).order('accounting_date',{ascending:true}).order('id',{ascending:true}).limit(limit);
  if(query.error)throw query.error;
  return (query.data??[]) as V2BalanceAnomaly[];
}

export async function loadV2BalanceAnomalyContext(anomaly:V2BalanceAnomaly):Promise<V2BalanceAnomalyContext>{
  const columns='id,source_row,accounting_date,system_date,system_time,operation_number,amount,balance,raw_description,native_idtr,reference_26,status,reconciliation_method';
  const base=()=>supabase.from('rt_v2_movements').select(columns).eq('series_id',anomaly.series_id).eq('import_id',anomaly.import_id).eq('account',anomaly.account).eq('currency',anomaly.currency);
  const [previous,next]=await Promise.all([
    base().lt('source_row',anomaly.source_row).order('source_row',{ascending:false}).limit(1).maybeSingle(),
    base().gt('source_row',anomaly.source_row).order('source_row',{ascending:true}).limit(1).maybeSingle(),
  ]);
  if(previous.error)throw previous.error;if(next.error)throw next.error;
  return {previous:previous.data as V2BalanceContextMovement|null,next:next.data as V2BalanceContextMovement|null};
}

export async function loadV2MissingBusinessDays():Promise<string[]>{
  const seriesId=await loadSeriesId();if(!seriesId)return[];
  const query=await supabase.from('rt_v2_daily_metrics').select('metric_date').eq('series_id',seriesId).order('metric_date',{ascending:true});
  if(query.error)throw query.error;
  const dates=(query.data??[]).map(row=>row.metric_date as string);if(dates.length<2)return[];
  const present=new Set(dates),missing:string[]=[];
  const cursor=new Date(`${dates[0]}T00:00:00Z`),end=new Date(`${dates.at(-1)}T00:00:00Z`);
  for(cursor.setUTCDate(cursor.getUTCDate()+1);cursor<end;cursor.setUTCDate(cursor.getUTCDate()+1)){
    const weekday=cursor.getUTCDay(),date=cursor.toISOString().slice(0,10);
    if(weekday!==0&&weekday!==6&&!present.has(date))missing.push(date);
  }
  return missing;
}
