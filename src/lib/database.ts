import type { AnalysisResult, Movement } from '../types';
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase';

export type PersistenceContext={url:string;key:string;accessToken:string;analysisId:string;batchId:string};
export type CentralImport={id:string;reportDate:string|null;filename:string;uploadedAt:string;uploadedBy:string;movementCount:number;duplicateCount:number;errorCount:number};
export type AuditLog={id:number;actor:string;email:string;action:string;entityType:string;details:Record<string,unknown>;createdAt:string};

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
  const batchUpdate=await supabase.from('import_batches').update({report_date:result.reportDate||null,movement_count:result.totals.movements,inserted_count:result.totals.movements}).eq('id',context.batchId);
  if(batchUpdate.error)throw batchUpdate.error;
  const metrics=Object.entries(result.dailyMetrics??{}).map(([metric_date,value])=>({
    analysis_id:context.analysisId,
    metric_date,
    movements:value.movements,
    automatic:value.automatic,
    unreconciled:value.unreconciled,
    missing_idtr:value.missingIdtr,
    amount:value.amount,
  }));
  if(metrics.length){const saved=await supabase.from('daily_metrics').upsert(metrics,{onConflict:'analysis_id,metric_date'});if(saved.error)throw saved.error;}
  const analysisUpdate=await supabase.from('analyses').update({current_report_date:result.reportDate||null,period_start:result.periodStart||null,accounting_balance:result.accountingBalance,status:'completed',result_summary:summary,updated_at:new Date().toISOString()}).eq('id',context.analysisId);
  if(analysisUpdate.error)throw analysisUpdate.error;
  await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'import_completed',entity_type:'import_batch',entity_id:context.batchId,analysis_id:context.analysisId,details:{filename:result.sourceFilename,movements:result.totals.movements}});
}

const dbMovement=(row:Record<string,unknown>):Movement=>({id:String(row.id),row:Number(row.source_row),reportDate:String(row.movement_date??row.accounting_date??''),account:String(row.account??''),amount:Number(row.amount),currency:String(row.currency??'AOA'),operationNumber:String(row.operation_number??''),description:String(row.description??''),complementaryInfo:String(row.complementary_info??''),idtr:row.idtr?String(row.idtr):null,status:row.status as Movement['status']});
const movementColumns='id,source_row,movement_date,accounting_date,account,amount,currency,operation_number,description,complementary_info,idtr,status';

export async function loadMovementsByStatus(analysisId:string,statuses:Movement['status'][],limit=1000,offset=0){
  if(!statuses.length)return{rows:[] as Movement[],total:0};
  const query=await supabase.from('movements').select(movementColumns,{count:'exact'}).eq('analysis_id',analysisId).in('status',statuses).order('accounting_date',{ascending:false}).range(offset,offset+limit-1);
  if(query.error)throw query.error;
  return{rows:(query.data??[]).map(row=>dbMovement(row as Record<string,unknown>)),total:query.count??0};
}

export async function loadAllMovementsByStatus(analysisId:string,statuses:Movement['status'][],onProgress?:(loaded:number,total:number)=>void){
  const rows:Movement[]=[];let total=0;
  for(let offset=0;;offset+=1000){const page=await loadMovementsByStatus(analysisId,statuses,1000,offset);total=page.total;rows.push(...page.rows);onProgress?.(rows.length,total);if(rows.length>=total||!page.rows.length)break;}
  return rows;
}

export async function loadPersistentResult():Promise<(AnalysisResult&{analysisId:string;lastUploadedAt?:string;uploadedBy?:string;movementTotal?:number;importHistory:CentralImport[]})|null>{
  const latest=await supabase.from('analyses').select('id,result_summary').eq('name','Reconciliação Real Time').eq('status','completed').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;if(!latest.data)return null;
  const analysisId=latest.data.id;
  const summary=latest.data.result_summary as AnalysisResult;
  const initialStates:Movement['status'][]=['unreconciled'];if(summary.totals.missingIdtr>0)initialStates.push('missing_idtr');
  const movementPreview=await loadMovementsByStatus(analysisId,initialStates);
  const batches=await supabase.from('import_batches').select('id,report_date,original_filename,uploaded_at,uploaded_by,movement_count,duplicate_count,error_count,profiles!import_batches_uploaded_by_fkey(full_name,email)').eq('analysis_id',analysisId).order('uploaded_at',{ascending:false}).limit(100);
  if(batches.error)throw batches.error;
  const importHistory:CentralImport[]=(batches.data??[]).map(row=>{const profile=row.profiles as unknown as {full_name?:string;email?:string}|null;return{id:row.id,reportDate:row.report_date,filename:row.original_filename,uploadedAt:row.uploaded_at,uploadedBy:profile?.full_name||profile?.email||'',movementCount:row.movement_count,duplicateCount:row.duplicate_count,errorCount:row.error_count};});
  const lastBatch=importHistory[0];
  return{...summary,analysisId,lastUploadedAt:lastBatch?.uploadedAt,uploadedBy:lastBatch?.uploadedBy,movementTotal:movementPreview.total,importHistory,movements:movementPreview.rows};
}

export async function logPlatformAccess(){const{data:{session}}=await supabase.auth.getSession();if(session)await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'login',entity_type:'session'});}

export async function logPlatformAction(action:string,entityType:string,details:Record<string,unknown>={}){const{data:{session}}=await supabase.auth.getSession();if(session)await supabase.from('audit_logs').insert({actor_id:session.user.id,action,entity_type:entityType,details});}

export async function loadAuditLogs(limit=1000):Promise<AuditLog[]>{
  const query=await supabase.from('audit_logs').select('id,action,entity_type,details,created_at,profiles!audit_logs_actor_id_fkey(full_name,email)').order('created_at',{ascending:false}).limit(limit);
  if(query.error)throw query.error;
  return(query.data??[]).map(row=>{const profile=row.profiles as unknown as {full_name?:string;email?:string}|null;return{id:Number(row.id),actor:profile?.full_name||profile?.email||'Utilizador',email:profile?.email||'',action:row.action,entityType:row.entity_type,details:(row.details??{}) as Record<string,unknown>,createdAt:row.created_at};});
}
