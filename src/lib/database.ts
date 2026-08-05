import type { AnalysisResult, Movement } from '../types';
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase';

export type PersistenceContext={url:string;key:string;accessToken:string;analysisId:string;batchId:string};

export async function preparePersistentImport(file:File,fileHash:string):Promise<{context:PersistenceContext;duplicate:boolean}>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session) throw new Error('A sessão terminou. Entre novamente antes de importar.');
  let {data:analysis,error:analysisError}=await supabase.from('analyses').select('id').eq('name','Reconciliação Real Time').order('created_at',{ascending:true}).limit(1).maybeSingle();
  if(analysisError) throw analysisError;
  if(!analysis){const created=await supabase.from('analyses').insert({name:'Reconciliação Real Time',created_by:session.user.id,status:'processing'}).select('id').single();if(created.error)throw created.error;analysis=created.data;}
  const existing=await supabase.from('import_batches').select('id').eq('analysis_id',analysis.id).eq('file_sha256',fileHash).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data)return{duplicate:true,context:{url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY,accessToken:session.access_token,analysisId:analysis.id,batchId:existing.data.id}};
  const storagePath=`${session.user.id}/${fileHash}/${file.name.replace(/[^a-z0-9._-]+/gi,'_')}`;
  const batch=await supabase.from('import_batches').insert({analysis_id:analysis.id,report_date:null,original_filename:file.name,storage_path:storagePath,file_sha256:fileHash,uploaded_by:session.user.id}).select('id').single();
  if(batch.error)throw batch.error;
  await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'import_started',entity_type:'import_batch',entity_id:batch.data.id,analysis_id:analysis.id});
  return{duplicate:false,context:{url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY,accessToken:session.access_token,analysisId:analysis.id,batchId:batch.data.id}};
}

export async function finalizePersistentImport(result:AnalysisResult,context:PersistenceContext){
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('A sessão terminou durante a importação.');
  const summary={...result,movements:[],groups:[]};
  const analysisUpdate=await supabase.from('analyses').update({current_report_date:result.reportDate||null,period_start:result.periodStart||null,accounting_balance:result.accountingBalance,status:'completed',result_summary:summary,updated_at:new Date().toISOString()}).eq('id',context.analysisId);
  if(analysisUpdate.error)throw analysisUpdate.error;
  const batchUpdate=await supabase.from('import_batches').update({report_date:result.reportDate||null,movement_count:result.totals.movements,inserted_count:result.totals.movements}).eq('id',context.batchId);
  if(batchUpdate.error)throw batchUpdate.error;
  const metrics=Object.entries(result.dailyMetrics??{}).map(([metric_date,value])=>({analysis_id:context.analysisId,metric_date,...value,missing_idtr:value.missingIdtr}));
  if(metrics.length){const saved=await supabase.from('daily_metrics').upsert(metrics,{onConflict:'analysis_id,metric_date'});if(saved.error)throw saved.error;}
  await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'import_completed',entity_type:'import_batch',entity_id:context.batchId,analysis_id:context.analysisId,details:{filename:result.sourceFilename,movements:result.totals.movements}});
}

const dbMovement=(row:Record<string,unknown>):Movement=>({id:String(row.id),row:Number(row.source_row),reportDate:String(row.movement_date??row.accounting_date??''),account:String(row.account??''),amount:Number(row.amount),currency:String(row.currency??'AOA'),operationNumber:String(row.operation_number??''),description:String(row.description??''),complementaryInfo:String(row.complementary_info??''),idtr:row.idtr?String(row.idtr):null,status:row.status as Movement['status']});

export async function loadPersistentResult():Promise<(AnalysisResult&{analysisId:string})|null>{
  const latest=await supabase.from('analyses').select('id,result_summary').eq('name','Reconciliação Real Time').eq('status','completed').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;if(!latest.data)return null;
  let movementsQuery=await supabase.from('movements').select('id,source_row,movement_date,accounting_date,account,amount,currency,operation_number,description,complementary_info,idtr,status').eq('analysis_id',latest.data.id).in('status',['unreconciled','missing_idtr']).order('accounting_date',{ascending:false}).limit(1000);
  if(movementsQuery.error)throw movementsQuery.error;
  if(!movementsQuery.data.length)movementsQuery=await supabase.from('movements').select('id,source_row,movement_date,accounting_date,account,amount,currency,operation_number,description,complementary_info,idtr,status').eq('analysis_id',latest.data.id).order('accounting_date',{ascending:false}).limit(1000);
  const summary=latest.data.result_summary as AnalysisResult;
  return{...summary,analysisId:latest.data.id,movements:(movementsQuery.data??[]).map(row=>dbMovement(row as Record<string,unknown>))};
}

export async function logPlatformAccess(){const{data:{session}}=await supabase.auth.getSession();if(session)await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'login',entity_type:'session'});}
