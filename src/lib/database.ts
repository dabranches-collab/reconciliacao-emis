import type { AnalysisResult, Movement } from '../types';
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase';

export type PersistenceContext={url:string;key:string;accessToken:string;analysisId:string;batchId:string};
export type ImportStatus='processing'|'completed'|'failed';
export type CentralImport={id:string;reportDate:string|null;filename:string;uploadedAt:string;uploadedBy:string;movementCount:number;insertedCount:number;duplicateCount:number;errorCount:number;status:ImportStatus;failureMessage:string|null;completedAt:string|null};
export type AuditLog={id:number;actor:string;email:string;action:string;entityType:string;details:Record<string,unknown>;createdAt:string};
export type BoundaryBalanceSummary={totalOpenGroups:number;totalOpenBalance:number;openingGroups:number;openingBalance:number;closingGroups:number;closingBalance:number;operationalGroups:number;operationalBalance:number};
export type UnreconciledAgeCounts={all:number;d0:number;upTo1:number;upTo2:number;atLeast1:number;atLeast2:number;atLeast3:number};

export async function loadBoundaryBalanceSummary(analysisId:string):Promise<BoundaryBalanceSummary>{
  const query=await supabase.rpc('get_boundary_balance_summary',{p_analysis_id:analysisId,p_window_days:2}).single();
  if(query.error)throw query.error;
  const row=query.data as Record<string,unknown>;
  return{totalOpenGroups:Number(row.total_open_groups),totalOpenBalance:Number(row.total_open_balance),openingGroups:Number(row.opening_groups),openingBalance:Number(row.opening_balance),closingGroups:Number(row.closing_groups),closingBalance:Number(row.closing_balance),operationalGroups:Number(row.operational_groups),operationalBalance:Number(row.operational_balance)};
}

export async function loadUnreconciledAgeCounts(analysisId:string,cutoff:string,excludeOpening=true):Promise<UnreconciledAgeCounts>{
  const query=await supabase.rpc('get_unreconciled_age_counts',{p_analysis_id:analysisId,p_cutoff:cutoff,p_exclude_opening:excludeOpening}).single();
  if(query.error)throw query.error;
  const row=query.data as Record<string,unknown>;
  return{all:Number(row.all_count),d0:Number(row.d0_count),upTo1:Number(row.up_to_1_count),upTo2:Number(row.up_to_2_count),atLeast1:Number(row.at_least_1_count),atLeast2:Number(row.at_least_2_count),atLeast3:Number(row.at_least_3_count)};
}

export async function preparePersistentImport(file:File,fileHash:string):Promise<{context:PersistenceContext;duplicate:boolean}>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session) throw new Error('A sessão terminou. Entre novamente antes de importar.');
  let {data:analysis,error:analysisError}=await supabase.from('analyses').select('id').eq('name','Reconciliação Real Time').order('created_at',{ascending:true}).limit(1).maybeSingle();
  if(analysisError) throw analysisError;
  if(!analysis){const created=await supabase.from('analyses').insert({name:'Reconciliação Real Time',created_by:session.user.id,status:'processing'}).select('id').single();if(created.error)throw created.error;analysis=created.data;}
  const existing=await supabase.from('import_batches').select('id,status').eq('analysis_id',analysis.id).eq('file_sha256',fileHash).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data){
    const context={url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY,accessToken:session.access_token,analysisId:analysis.id,batchId:existing.data.id};
    if(existing.data.status==='completed')return{duplicate:true,context};
    const resumed=await supabase.from('import_batches').update({status:'processing',failure_message:null,error_count:0}).eq('id',existing.data.id);
    if(resumed.error)throw resumed.error;
    await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'import_resumed',entity_type:'import_batch',entity_id:existing.data.id,analysis_id:analysis.id,details:{filename:file.name}});
    return{duplicate:false,context};
  }
  const storagePath=`${session.user.id}/${fileHash}/${file.name.replace(/[^a-z0-9._-]+/gi,'_')}`;
  const batch=await supabase.from('import_batches').insert({analysis_id:analysis.id,report_date:null,original_filename:file.name,storage_path:storagePath,file_sha256:fileHash,uploaded_by:session.user.id,status:'processing'}).select('id').single();
  if(batch.error)throw batch.error;
  await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'import_started',entity_type:'import_batch',entity_id:batch.data.id,analysis_id:analysis.id});
  return{duplicate:false,context:{url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY,accessToken:session.access_token,analysisId:analysis.id,batchId:batch.data.id}};
}

export async function finalizePersistentImport(result:AnalysisResult,context:PersistenceContext){
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('A sessão terminou durante a importação.');
  const summary={...result,movements:[],groups:[]};
  const counted=await supabase.from('movements').select('id',{count:'exact',head:true}).eq('batch_id',context.batchId);
  if(counted.error)throw counted.error;
  const insertedCount=counted.count??0;
  const duplicateCount=Math.max(0,result.totals.movements-insertedCount);
  const completedAt=new Date().toISOString();
  const batchUpdate=await supabase.from('import_batches').update({report_date:result.reportDate||null,movement_count:result.totals.movements,inserted_count:insertedCount,duplicate_count:duplicateCount,status:'completed',failure_message:null,completed_at:completedAt}).eq('id',context.batchId);
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
  for(let bucket=0;bucket<16;bucket++){
    const refreshed=await supabase.rpc('refresh_accumulated_reconciliation_bucket',{p_analysis_id:context.analysisId,p_bucket:bucket,p_bucket_count:16});
    if(refreshed.error)throw refreshed.error;
  }
  const secondary=await supabase.rpc('refresh_secondary_reconciliation',{p_analysis_id:context.analysisId});
  if(secondary.error)throw secondary.error;
  const rebuiltMetrics=await supabase.rpc('refresh_reconciliation_daily_metrics',{p_analysis_id:context.analysisId});
  if(rebuiltMetrics.error)throw rebuiltMetrics.error;
  const refreshedBoundary=await supabase.rpc('refresh_boundary_balance_summary',{p_analysis_id:context.analysisId,p_window_days:2});
  if(refreshedBoundary.error)throw refreshedBoundary.error;
  const analysisUpdate=await supabase.from('analyses').update({current_report_date:result.reportDate||null,period_start:result.periodStart||null,accounting_balance:result.accountingBalance,status:'completed',result_summary:summary,updated_at:new Date().toISOString()}).eq('id',context.analysisId);
  if(analysisUpdate.error)throw analysisUpdate.error;
  await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'import_completed',entity_type:'import_batch',entity_id:context.batchId,analysis_id:context.analysisId,details:{filename:result.sourceFilename,movements:result.totals.movements,inserted:insertedCount,duplicates:duplicateCount}});
}

export async function failPersistentImport(context:PersistenceContext,message:string){
  const {data:{session}}=await supabase.auth.getSession();
  await supabase.from('import_batches').update({status:'failed',failure_message:message,error_count:1,completed_at:null}).eq('id',context.batchId);
  if(session)await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'import_failed',entity_type:'import_batch',entity_id:context.batchId,analysis_id:context.analysisId,details:{message}});
}

const dbMovement=(row:Record<string,unknown>):Movement=>({id:String(row.id),row:Number(row.source_row),reportDate:String(row.accounting_date??row.movement_date??''),account:String(row.account??''),amount:Number(row.amount),currency:String(row.currency??'AOA'),operationNumber:String(row.operation_number??''),description:String(row.description??''),complementaryInfo:String(row.complementary_info??''),idtr:row.idtr?String(row.idtr):null,status:row.status as Movement['status']});
const movementColumns='id,source_row,movement_date,accounting_date,account,amount,currency,operation_number,description,complementary_info,idtr,status';

export type MovementDateRange={from?:string;to?:string;excludeOpening?:boolean};
export async function loadMovementsByStatus(analysisId:string,statuses:Movement['status'][],limit=1000,offset=0,dateRange:MovementDateRange={},withCount=true){
  if(!statuses.length)return{rows:[] as Movement[],total:0};
  let builder=supabase.from('movements').select(movementColumns,withCount?{count:'exact'}:{}).eq('analysis_id',analysisId).in('status',statuses);
  if(dateRange.excludeOpening!==false)builder=builder.eq('opening_boundary',false);
  if(dateRange.from)builder=builder.gte('accounting_date',dateRange.from);
  if(dateRange.to)builder=builder.lte('accounting_date',dateRange.to);
  const query=await builder.order('accounting_date',{ascending:false}).order('id',{ascending:true}).range(offset,offset+limit-1);
  if(query.error)throw query.error;
  return{rows:(query.data??[]).map(row=>dbMovement(row as Record<string,unknown>)),total:query.count??0};
}

export async function loadAllMovementsByStatus(analysisId:string,statuses:Movement['status'][],onProgress?:(loaded:number,total:number)=>void,dateRange:MovementDateRange={}){
  const pageSize=1000,first=await loadMovementsByStatus(analysisId,statuses,pageSize,0,dateRange,true),total=first.total;
  if(total<=first.rows.length){onProgress?.(first.rows.length,total);return first.rows;}
  const pages:Movement[][]=Array(Math.ceil(total/pageSize));pages[0]=first.rows;
  const offsets=Array.from({length:pages.length-1},(_,index)=>(index+1)*pageSize);
  let cursor=0,loaded=first.rows.length;onProgress?.(loaded,total);
  const worker=async()=>{for(;;){const index=cursor++;if(index>=offsets.length)return;const offset=offsets[index];const page=await loadMovementsByStatus(analysisId,statuses,pageSize,offset,dateRange,false);pages[index+1]=page.rows;loaded+=page.rows.length;onProgress?.(loaded,total);}};
  await Promise.all(Array.from({length:Math.min(6,offsets.length)},()=>worker()));
  return pages.flat();
}

export async function loadPersistentResult():Promise<(AnalysisResult&{analysisId:string;lastUploadedAt?:string;uploadedBy?:string;movementTotal?:number;importHistory:CentralImport[]})|null>{
  const latest=await supabase.from('analyses').select('id,result_summary').eq('name','Reconciliação Real Time').eq('status','completed').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;if(!latest.data)return null;
  const analysisId=latest.data.id;
  const summary=latest.data.result_summary as AnalysisResult;
  const metricsQuery=await supabase.from('daily_metrics').select('metric_date,movements,automatic,unreconciled,missing_idtr,amount').eq('analysis_id',analysisId).order('metric_date',{ascending:true});
  if(metricsQuery.error)throw metricsQuery.error;
  const dailyMetrics:NonNullable<AnalysisResult['dailyMetrics']>=Object.fromEntries((metricsQuery.data??[]).map(row=>[row.metric_date,{movements:row.movements,automatic:row.automatic,unreconciled:row.unreconciled,missingIdtr:row.missing_idtr,amount:Number(row.amount)}]));
  const consolidatedTotals=Object.values(dailyMetrics).reduce<AnalysisResult['totals']>((totals,day)=>({movements:totals.movements+day.movements,automatic:totals.automatic+day.automatic,manual:totals.manual,unreconciled:totals.unreconciled+day.unreconciled,missingIdtr:totals.missingIdtr+day.missingIdtr,amount:totals.amount+day.amount}),{movements:0,automatic:0,manual:0,unreconciled:0,missingIdtr:0,amount:0});
  const metricDates=Object.keys(dailyMetrics).sort();
  const initialStates:Movement['status'][]=['unreconciled'];if(consolidatedTotals.missingIdtr>0)initialStates.push('missing_idtr');
  const movementPreview=await loadMovementsByStatus(analysisId,initialStates);
  const batches=await supabase.from('import_batches').select('id,report_date,original_filename,uploaded_at,uploaded_by,movement_count,inserted_count,duplicate_count,error_count,status,failure_message,completed_at,profiles!import_batches_uploaded_by_fkey(full_name,email)').eq('analysis_id',analysisId).order('uploaded_at',{ascending:false}).limit(100);
  if(batches.error)throw batches.error;
  const importHistory:CentralImport[]=(batches.data??[]).map(row=>{const profile=row.profiles as unknown as {full_name?:string;email?:string}|null;return{id:row.id,reportDate:row.report_date,filename:row.original_filename,uploadedAt:row.uploaded_at,uploadedBy:profile?.full_name||profile?.email||'',movementCount:row.movement_count,insertedCount:row.inserted_count,duplicateCount:row.duplicate_count,errorCount:row.error_count,status:row.status as ImportStatus,failureMessage:row.failure_message,completedAt:row.completed_at};});
  const lastBatch=importHistory.find(item=>item.status==='completed');
  return{...summary,periodStart:metricDates[0]??summary.periodStart,reportDate:metricDates.at(-1)??summary.reportDate,totals:consolidatedTotals,dailyMetrics,analysisId,lastUploadedAt:lastBatch?.uploadedAt,uploadedBy:lastBatch?.uploadedBy,movementTotal:movementPreview.total,importHistory,movements:movementPreview.rows};
}

export async function logPlatformAccess(){const{data:{session}}=await supabase.auth.getSession();if(session)await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'login',entity_type:'session'});}

export async function logPlatformAction(action:string,entityType:string,details:Record<string,unknown>={}){const{data:{session}}=await supabase.auth.getSession();if(session)await supabase.from('audit_logs').insert({actor_id:session.user.id,action,entity_type:entityType,details});}

export async function reconcileMovementsManually(analysisId:string,movementIds:string[],justification:string){
  const {data,error}=await supabase.functions.invoke('manual-reconcile',{body:{analysisId,movementIds,justification}});
  if(error)throw error;if(data?.error)throw new Error(String(data.error));return data as {ok:true;groupId:string;count:number;balance:number};
}

export async function loadAuditLogs(limit=1000):Promise<AuditLog[]>{
  const query=await supabase.from('audit_logs').select('id,action,entity_type,details,created_at,profiles!audit_logs_actor_id_fkey(full_name,email)').order('created_at',{ascending:false}).limit(limit);
  if(query.error)throw query.error;
  return(query.data??[]).map(row=>{const profile=row.profiles as unknown as {full_name?:string;email?:string}|null;return{id:Number(row.id),actor:profile?.full_name||profile?.email||'Utilizador',email:profile?.email||'',action:row.action,entityType:row.entity_type,details:(row.details??{}) as Record<string,unknown>,createdAt:row.created_at};});
}
