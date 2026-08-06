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

async function api(request,env,url){
  const {user,authorization}=await authenticate(request,env);
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
