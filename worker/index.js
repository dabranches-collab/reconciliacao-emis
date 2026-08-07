import {WorkflowEntrypoint} from 'cloudflare:workers';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const safeName=value=>String(value||'extract.xlsx').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-160);

async function authenticate(request,env){
  const authorization=request.headers.get('Authorization');
  if(!authorization?.startsWith('Bearer '))throw new Response('Sessão em falta.',{status:401});
  const response=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY}});
  if(!response.ok)throw new Response('Sessão inválida ou expirada.',{status:401});
  return{user:await response.json(),authorization};
}

async function batchForUser(env,authorization,batchId,userId){
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/import_batches?id=eq.${encodeURIComponent(batchId)}&uploaded_by=eq.${encodeURIComponent(userId)}&select=id,file_sha256,original_filename,upload_id,storage_path,expected_file_size,upload_parts_total`,{headers:{Authorization:authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY}});
  if(!response.ok)throw new Response('Não foi possível validar a importação.',{status:502});
  const rows=await response.json();if(rows.length!==1)throw new Response('Importação inexistente ou sem autorização.',{status:404});
  return rows[0];
}

async function updateBatch(env,authorization,batchId,values){
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/import_batches?id=eq.${encodeURIComponent(batchId)}`,{method:'PATCH',headers:{Authorization:authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(values)});
  if(!response.ok)throw new Response(`Não foi possível guardar o estado do upload: ${await response.text()}`,{status:502});
}

async function completedParts(env,authorization,batchId){
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/import_upload_parts?batch_id=eq.${encodeURIComponent(batchId)}&select=part_number,etag,byte_size&order=part_number.asc`,{headers:{Authorization:authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY}});
  if(!response.ok)throw new Response('Não foi possível recuperar as partes já enviadas.',{status:502});
  return await response.json();
}

const completedMap=parts=>Object.fromEntries(parts.map(part=>[part.part_number,part.etag]));

async function saveCompletedPart(env,authorization,batchId,part,byteSize){
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/import_upload_parts?on_conflict=batch_id,part_number`,{method:'POST',headers:{Authorization:authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({batch_id:batchId,part_number:part.partNumber,etag:part.etag,byte_size:byteSize,completed_at:new Date().toISOString()})});
  if(!response.ok)throw new Response(`Não foi possível registar a parte recebida: ${await response.text()}`,{status:502});
}

async function serviceRequest(env,path,{method='GET',body,prefer}={}){
  if(!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Segredo SUPABASE_SERVICE_ROLE_KEY não configurado.');
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:env.SUPABASE_SERVICE_ROLE_KEY,...(body?{'Content-Type':'application/json'}:{}),...(prefer?{Prefer:prefer}:{})},body:body?JSON.stringify(body):undefined});
  if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  const text=await response.text();return text?JSON.parse(text):null;
}

async function workflowBatch(env,batchId){
  const rows=await serviceRequest(env,`import_batches?id=eq.${encodeURIComponent(batchId)}&select=id,analysis_id,uploaded_by,original_filename,status,processing_stage,movement_count,inserted_count,duplicate_count,rejected_count`);
  if(rows.length!==1)throw new Error('Lote inexistente.');return rows[0];
}

async function workflowCheckpoint(env,batchId,section,unit,status,details={}){
  await serviceRequest(env,'import_job_checkpoints?on_conflict=batch_id,stage,unit',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{batch_id:batchId,stage:'dashboard_summary',unit,unit_count:6,status,details,started_at:new Date().toISOString(),completed_at:status==='completed'?new Date().toISOString():null,updated_at:new Date().toISOString()}});
}

export class ImportFinalizationWorkflow extends WorkflowEntrypoint{
  async run(event,step){
    const {batchId}=event.payload;
    const batch=await step.do('validar lote',{retries:{limit:3,delay:'5 seconds',backoff:'exponential'},timeout:'2 minutes'},async()=>{
      const row=await workflowBatch(this.env,batchId),accounted=Number(row.inserted_count)+Number(row.duplicate_count)+Number(row.rejected_count||0);
      if(Number(row.movement_count)<=0||accounted!==Number(row.movement_count))throw new Error(`Contagem incompleta: ${accounted}/${row.movement_count}.`);
      await serviceRequest(this.env,`import_batches?id=eq.${encodeURIComponent(batchId)}`,{method:'PATCH',prefer:'return=minimal',body:{status:'processing',processing_stage:'dashboard_summary',progress_percent:99,heartbeat_at:new Date().toISOString(),attempt_count:1,failure_message:null}});
      return row;
    });
    const sections=['totals','movement_types','age','timing','methods','balances'];
    for(let index=0;index<sections.length;index++){
      const section=sections[index];
      await step.do(`resumo ${index+1} ${section}`,{retries:{limit:5,delay:'10 seconds',backoff:'exponential'},timeout:'10 minutes'},async context=>{
        await workflowCheckpoint(this.env,batchId,section,index+1,'processing',{attempt:context.attempt});
        await serviceRequest(this.env,'rpc/refresh_reconciliation_dashboard_section',{method:'POST',body:{p_analysis_id:batch.analysis_id,p_section:section}});
        await workflowCheckpoint(this.env,batchId,section,index+1,'completed',{attempt:context.attempt});
        await serviceRequest(this.env,`import_batches?id=eq.${encodeURIComponent(batchId)}`,{method:'PATCH',prefer:'return=minimal',body:{heartbeat_at:new Date().toISOString(),validation_summary:{dashboardSectionsCompleted:index+1,dashboardSectionsTotal:sections.length}}});
        return{section,index:index+1};
      });
    }
    await step.do('concluir lote atomicamente',{retries:{limit:3,delay:'10 seconds',backoff:'exponential'},timeout:'2 minutes'},async()=>{
      const completedAt=new Date().toISOString();
      await serviceRequest(this.env,'rpc/finalize_import_atomically',{method:'POST',body:{p_analysis_id:batch.analysis_id,p_batch_id:batchId,p_completed_at:completedAt}});
      await serviceRequest(this.env,'audit_logs',{method:'POST',prefer:'return=minimal',body:{actor_id:batch.uploaded_by,action:'import_completed',entity_type:'import_batch',entity_id:batchId,analysis_id:batch.analysis_id,details:{filename:batch.original_filename,executor:'cloudflare_workflow'}}});
    });
    return{batchId,status:'completed'};
  }
}

export class V2FinalizationWorkflow extends WorkflowEntrypoint{
  async run(event,step){
    const {importId,actorId}=event.payload,phase=event.payload.phase??'initialize',startBucket=Number(event.payload.startBucket??0),persistedBucketCount=Number(event.payload.bucketCount??0);
    const call=async(phase,bucket=null,bucketCount=null)=>{
      const result=await serviceRequest(this.env,'rpc/finalize_rt_v2_import_phase_as_owner',{method:'POST',body:{p_import_id:importId,p_actor_id:actorId,p_phase:phase,p_bucket:bucket,p_bucket_count:bucketCount}});
      const movements=Number(result?.movements??0);
      if((phase==='primary'||phase==='secondary')&&movements>0)await serviceRequest(this.env,'rpc/increment_rt_v2_live_reconciled',{method:'POST',body:{p_import_id:importId,p_delta:movements}});
      return result;
    };
    // Smaller deterministic buckets keep each Supabase request below its HTTP
    // ceiling. Deterministic child IDs make retries reuse the same workflow
    // instead of creating competing copies that fight for database locks.
    // Os buckets partilham tabelas de candidatos. Executá-los em paralelo
    // provoca lock_timeout e retries longos no Postgres; sequencial é mais
    // rápido e previsível, mantendo o paralelismo apenas entre tarefas da app.
    // 128/64 mantém cada chamada abaixo do limite de 2 minutos do gateway
    // PostgREST mesmo quando a série já contém vários milhões de movimentos.
    // O trabalho total é equivalente, mas deixa de ser repetido após um 504.
    // Continuações criadas antes da 2.1.2 não transportavam bucketCount e
    // pertencem ao plano legado 64/32. Preservá-lo evita mudar a grelha a meio.
    const primaryBucketCount=phase==='primary'?(persistedBucketCount||(startBucket>0?64:128)):128;
    const secondaryBucketCount=phase==='primary'?(primaryBucketCount===64?32:64):(phase==='secondary'?(persistedBucketCount||(startBucket>0?32:64)):64);
    const chunkSize=8,parallelBucketCount=1;
    const continueInChild=async params=>{
      const id=`v2-${importId}-${params.phase}-${params.startBucket}`;
      try{
        await this.env.V2_IMPORT_FINALIZATION.create({id,params});
        return{id,status:'started'};
      }
      catch(error){
        const existing=await this.env.V2_IMPORT_FINALIZATION.get(id),status=await existing.status();
        if(['errored','terminated'].includes(status.status))await existing.restart();
        return{id,status:status.status==='errored'||status.status==='terminated'?'restarted':'already_running'};
      }
    };
    if(phase==='initialize')await step.do('preparar finalização v2',{retries:{limit:3,delay:'15 seconds',backoff:'exponential'},timeout:'5 minutes'},async()=>call('initialize'));
    const currentPhase=phase==='initialize'?'primary':phase,bucketCount=currentPhase==='primary'?primaryBucketCount:secondaryBucketCount;
    const endBucket=Math.min(bucketCount,startBucket+chunkSize);
    let firstParallelBucket=startBucket;
    if(startBucket===0){
      await step.do(`${currentPhase==='primary'?'idtr':'secundária'} 1 de ${bucketCount}`,{retries:{limit:5,delay:'10 seconds',backoff:'exponential'},timeout:'5 minutes'},async()=>call(currentPhase,0,bucketCount));
      firstParallelBucket=1;
    }
    for(let bucket=firstParallelBucket;bucket<endBucket;bucket+=parallelBucketCount){
      const buckets=Array.from({length:Math.min(parallelBucketCount,endBucket-bucket)},(_,offset)=>bucket+offset);
      await step.do(`${currentPhase==='primary'?'idtr':'secundária'} ${buckets[0]+1}-${buckets.at(-1)+1} de ${bucketCount}`,{retries:{limit:5,delay:'10 seconds',backoff:'exponential'},timeout:'5 minutes'},async()=>Promise.all(buckets.map(currentBucket=>call(currentPhase,currentBucket,bucketCount))));
    }
    if(endBucket<bucketCount){
      const next={importId,actorId,phase:currentPhase,startBucket:endBucket,bucketCount};
      await step.do(`continuar ${currentPhase} em nova execução`,{retries:{limit:5,delay:'10 seconds',backoff:'exponential'},timeout:'2 minutes'},async()=>continueInChild(next));
      return{importId,status:'continued',phase:currentPhase,nextBucket:endBucket};
    }
    if(currentPhase==='primary'){
      await step.do('iniciar reconciliação secundária',{retries:{limit:5,delay:'10 seconds',backoff:'exponential'},timeout:'2 minutes'},async()=>continueInChild({importId,actorId,phase:'secondary',startBucket:0,bucketCount:secondaryBucketCount}));
      return{importId,status:'continued',phase:'secondary',nextBucket:0};
    }
    await step.do('calcular indicadores v2',{retries:{limit:5,delay:'15 seconds',backoff:'exponential'},timeout:'10 minutes'},async()=>call('metrics'));
    await step.do('calcular saldos e fronteira v2',{retries:{limit:5,delay:'15 seconds',backoff:'exponential'},timeout:'10 minutes'},async()=>call('balances'));
    return{importId,status:'completed'};
  }
}

async function v2ImportForUser(env,authorization,importId,userId){
  const response=await fetch(`${env.SUPABASE_URL}/rest/v1/rt_v2_imports?id=eq.${encodeURIComponent(importId)}&uploaded_by=eq.${encodeURIComponent(userId)}&select=id,uploaded_by,state,stage,progress,heartbeat_at,error_message`,{headers:{Authorization:authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY}});
  if(!response.ok)throw new Response('Não foi possível validar a importação V2.',{status:502});
  const rows=await response.json();if(rows.length!==1)throw new Response('Importação V2 inexistente ou sem autorização.',{status:404});
  return rows[0];
}

async function api(request,env,url){
  const {user,authorization}=await authenticate(request,env);
  const v2FinalizeMatch=url.pathname.match(/^\/api\/v2\/imports\/([^/]+)\/finalize$/);
  if(v2FinalizeMatch){
    const importId=decodeURIComponent(v2FinalizeMatch[1]),row=await v2ImportForUser(env,authorization,importId,user.id);
    if(request.method==='GET'){
      return json({importId:row.id,import:row});
    }
    if(request.method==='POST'){
      const heartbeatAge=Date.now()-new Date(row.heartbeat_at??0).getTime();
      if(['reconciling','calculating'].includes(row.state)&&Number(row.progress)>=82&&heartbeatAge<5*60_000)return json({importId:row.id,jobId:null,status:{status:'running'},resumed:false},202);
      const instanceId=`v2-${row.id}-root`;let instance;
      try{instance=await env.V2_IMPORT_FINALIZATION.create({id:instanceId,params:{importId:row.id,actorId:user.id}});}
      catch(error){
        instance=await env.V2_IMPORT_FINALIZATION.get(instanceId);
        const state=await instance.status();if(['errored','terminated'].includes(state.status))await instance.restart();
      }
      return json({importId:row.id,jobId:instanceId,status:await instance.status()},202);
    }
  }
  if(request.method==='POST'&&url.pathname==='/api/imports/multipart/create'){
    const body=await request.json(),fileSize=Number(body.fileSize),partSize=8*1024*1024;
    if(!body.batchId||!body.fileHash||!Number.isSafeInteger(fileSize)||fileSize<=0)return json({error:'Dados do ficheiro inválidos.'},400);
    const batch=await batchForUser(env,authorization,body.batchId,user.id);
    if(batch.file_sha256!==body.fileHash)return json({error:'O hash não corresponde ao lote preparado.'},409);
    if(batch.upload_id&&batch.storage_path&&Number(batch.expected_file_size)===fileSize)return json({batchId:batch.id,uploadId:batch.upload_id,objectKey:batch.storage_path,partSize,fileSize,fileHash:body.fileHash,completed:completedMap(await completedParts(env,authorization,batch.id))});
    const objectKey=`${user.id}/${batch.id}/${body.fileHash}/${safeName(body.filename)}`;
    const upload=await env.IMPORT_FILES.createMultipartUpload(objectKey,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    await updateBatch(env,authorization,batch.id,{upload_id:upload.uploadId,storage_path:objectKey,expected_file_size:fileSize,upload_parts_total:Math.ceil(fileSize/partSize),upload_parts_completed:0,processing_stage:'uploading',progress_percent:0,heartbeat_at:new Date().toISOString()});
    return json({batchId:batch.id,uploadId:upload.uploadId,objectKey,partSize,fileSize,fileHash:body.fileHash,completed:{}});
  }
  const partMatch=url.pathname.match(/^\/api\/imports\/multipart\/([^/]+)\/part\/(\d+)$/);
  if(request.method==='PUT'&&partMatch){
    const batchId=decodeURIComponent(partMatch[1]),partNumber=Number(partMatch[2]);if(!request.body||partNumber<1)return json({error:'Parte inválida.'},400);
    const batch=await batchForUser(env,authorization,batchId,user.id),uploadId=request.headers.get('X-Upload-Id'),objectKey=request.headers.get('X-Object-Key');
    if(!uploadId||uploadId!==batch.upload_id||!objectKey||objectKey!==batch.storage_path)return json({error:'Sessão de upload incompatível.'},409);
    const bytes=await request.arrayBuffer();if(!bytes.byteLength)return json({error:'Parte vazia.'},400);
    const part=await env.IMPORT_FILES.resumeMultipartUpload(objectKey,uploadId).uploadPart(partNumber,bytes);
    await saveCompletedPart(env,authorization,batchId,part,bytes.byteLength);
    const parts=await completedParts(env,authorization,batchId);
    await updateBatch(env,authorization,batchId,{upload_parts_completed:parts.length,heartbeat_at:new Date().toISOString()});
    return json({etag:part.etag,partNumber:part.partNumber});
  }
  const completeMatch=url.pathname.match(/^\/api\/imports\/multipart\/([^/]+)\/complete$/);
  if(request.method==='POST'&&completeMatch){
    const batchId=decodeURIComponent(completeMatch[1]),body=await request.json(),batch=await batchForUser(env,authorization,batchId,user.id);
    if(body.uploadId!==batch.upload_id||body.objectKey!==batch.storage_path)return json({error:'Conclusão de upload incompatível.'},409);
    const persisted=await completedParts(env,authorization,batchId),parts=persisted.map(part=>({partNumber:part.part_number,etag:part.etag}));
    if(parts.length!==Number(batch.upload_parts_total)||persisted.reduce((sum,part)=>sum+Number(part.byte_size),0)!==Number(batch.expected_file_size))return json({error:'O ficheiro ainda não foi recebido integralmente.'},409);
    const object=await env.IMPORT_FILES.resumeMultipartUpload(body.objectKey,body.uploadId).complete(parts);
    if(object.size!==Number(batch.expected_file_size))return json({error:'O ficheiro guardado não tem o tamanho esperado.'},422);
    await updateBatch(env,authorization,batchId,{stored_file_size:object.size,upload_parts_completed:parts.length,processing_stage:'uploaded',progress_percent:18,heartbeat_at:new Date().toISOString(),failure_message:null});
    return json({batchId,objectKey:object.key,size:object.size,etag:object.etag,status:'uploaded'});
  }
  const finalizeMatch=url.pathname.match(/^\/api\/imports\/([^/]+)\/finalize$/);
  if(request.method==='GET'&&finalizeMatch){
    const batchId=decodeURIComponent(finalizeMatch[1]),batch=await batchForUser(env,authorization,batchId,user.id);
    const instance=await env.IMPORT_FINALIZATION.get(`import-${batch.id}`);
    return json({batchId:batch.id,status:await instance.status()});
  }
  if(request.method==='POST'&&finalizeMatch){
    const batchId=decodeURIComponent(finalizeMatch[1]),batch=await batchForUser(env,authorization,batchId,user.id);
    const instanceId=`import-${batch.id}`;let instance;
    try{instance=await env.IMPORT_FINALIZATION.create({id:instanceId,params:{batchId:batch.id}});}catch(error){
      instance=await env.IMPORT_FINALIZATION.get(instanceId);
      const state=await instance.status();if(['errored','terminated'].includes(state.status))await instance.restart();
    }
    await updateBatch(env,authorization,batch.id,{job_id:instanceId,processing_stage:'dashboard_summary',progress_percent:99,heartbeat_at:new Date().toISOString(),failure_message:null});
    return json({batchId:batch.id,jobId:instanceId,status:await instance.status()},202);
  }
  return json({error:'Endpoint inexistente.'},404);
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/'))try{return await api(request,env,url);}catch(error){if(error instanceof Response)return error;console.error(error);return json({error:'Falha interna no serviço de importação.'},500);}
    return env.ASSETS.fetch(request);
  }
};
