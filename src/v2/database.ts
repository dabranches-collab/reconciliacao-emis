import {supabase} from '../lib/supabase';
import type {ImportProgress,ImportSink,PersistedMovement} from './importPipeline';

export type V2ImportContext={seriesId:string;importId:string};
export type V2Dashboard={state:'pending'|'processing'|'completed'|'failed';ruleVersion:string;calculatedAt:string|null;result:Record<string,unknown>|null;error:string|null};

export async function prepareV2Import(file:File,fileHash:string):Promise<{context:V2ImportContext;duplicate:boolean}>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('A sessão terminou. Entre novamente antes de importar.');
  let series=(await supabase.from('rt_v2_series').select('id').order('created_at',{ascending:true}).limit(1).maybeSingle());
  if(series.error)throw series.error;
  if(!series.data){series=await supabase.from('rt_v2_series').insert({created_by:session.user.id}).select('id').single();if(series.error)throw series.error;}
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

export function createV2ImportSink(context:V2ImportContext,onProgress:(value:ImportProgress)=>void):ImportSink{
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
      const progress=value.stage==='validating'?2:value.stage==='ingesting'?Math.min(78,5+Math.log10(Math.max(10,value.processed))*12):value.stage==='reconciling'?80:value.stage==='failed'?0:100;
      const update=await supabase.from('rt_v2_imports').update({state:stage,stage:value.message,progress,source_rows:value.processed,inserted_rows:value.inserted,duplicate_rows:value.duplicates,rejected_rows:value.rejected,heartbeat_at:new Date().toISOString(),error_message:value.stage==='failed'?value.message:null}).eq('id',context.importId);
      if(update.error)throw update.error;
    },
  };
}

export async function finalizeV2Import(context:V2ImportContext){
  const query=await supabase.rpc('finalize_rt_v2_import',{p_import_id:context.importId});
  if(query.error)throw query.error;
  return query.data as Record<string,unknown>;
}

export async function loadV2Dashboard(seriesId:string):Promise<V2Dashboard|null>{
  const query=await supabase.from('rt_v2_calculations').select('state,rule_version,calculated_at,result,error_message').eq('series_id',seriesId).eq('metric','dashboard').maybeSingle();
  if(query.error)throw query.error;if(!query.data)return null;
  return {state:query.data.state as V2Dashboard['state'],ruleVersion:query.data.rule_version,calculatedAt:query.data.calculated_at,result:query.data.result as Record<string,unknown>|null,error:query.data.error_message};
}

export async function loadLatestV2Dashboard():Promise<V2Dashboard|null>{
  const series=await supabase.from('rt_v2_series').select('id').order('created_at',{ascending:true}).limit(1).maybeSingle();
  if(series.error)throw series.error;
  return series.data?loadV2Dashboard(series.data.id):null;
}
