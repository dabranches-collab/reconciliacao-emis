import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json({error:'Método não permitido.'},405);
 try{
  const authorization=request.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return json({error:'Sessão inválida.'},401);
  const url=Deno.env.get('SUPABASE_URL')??'',anon=Deno.env.get('SUPABASE_ANON_KEY')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
  const callerClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await callerClient.auth.getUser(authorization.slice(7));if(userError||!userData.user)return json({error:'Sessão inválida ou expirada.'},401);
  const {data:profile}=await admin.from('profiles').select('id,is_active').eq('id',userData.user.id).single();if(!profile?.is_active)return json({error:'Utilizador sem acesso ativo.'},403);
  const body=await request.json() as {analysisId?:string;movementIds?:string[];justification?:string};const ids=[...new Set(body.movementIds??[])],justification=body.justification?.trim()??'';
  if(!body.analysisId||!ids.length)return json({error:'Selecione pelo menos um movimento.'},400);if(justification.length<10)return json({error:'Indique uma justificação com pelo menos 10 caracteres.'},400);
  const {data:movements,error:movementError}=await admin.from('movements').select('id,analysis_id,amount,status,idtr,movement_date,accounting_date').in('id',ids);if(movementError)return json({error:movementError.message},400);
  if(!movements||movements.length!==ids.length||movements.some(row=>row.analysis_id!==body.analysisId))return json({error:'Existem movimentos inválidos ou fora desta análise.'},400);
  if(movements.some(row=>!['unreconciled','missing_idtr','data_error'].includes(row.status)))return json({error:'Só pode reconciliar manualmente movimentos ainda pendentes.'},400);
  const balance=movements.reduce((sum,row)=>sum+Number(row.amount),0),idtrs=[...new Set(movements.map(row=>row.idtr).filter(Boolean))];
  const {data:group,error:groupError}=await admin.from('reconciliation_groups').insert({analysis_id:body.analysisId,idtr:idtrs.length===1?idtrs[0]:null,status:'manual',balance,justification,rule_version:'manual-v1',reconciled_by:profile.id,reconciled_at:new Date().toISOString()}).select('id').single();if(groupError)return json({error:groupError.message},400);
  const {error:linkError}=await admin.from('reconciliation_group_movements').insert(ids.map(id=>({group_id:group.id,movement_id:id})));if(linkError)return json({error:linkError.message},400);
  const {error:updateError}=await admin.from('movements').update({status:'manual',reconciliation_group_id:group.id}).in('id',ids);if(updateError)return json({error:updateError.message},400);
  const {data:analysis}=await admin.from('analyses').select('result_summary').eq('id',body.analysisId).single();
  if(analysis?.result_summary){const summary=analysis.result_summary as Record<string,unknown>,totals={...((summary.totals??{}) as Record<string,number>)};totals.manual=Number(totals.manual??0)+ids.length;totals.unreconciled=Math.max(0,Number(totals.unreconciled??0)-movements.filter(row=>row.status==='unreconciled').length);totals.missingIdtr=Math.max(0,Number(totals.missingIdtr??0)-movements.filter(row=>row.status==='missing_idtr').length);await admin.from('analyses').update({result_summary:{...summary,totals},updated_at:new Date().toISOString()}).eq('id',body.analysisId);}
  await admin.from('audit_logs').insert({actor_id:profile.id,action:'manual_reconciliation',entity_type:'reconciliation_group',entity_id:group.id,analysis_id:body.analysisId,details:{movement_count:ids.length,balance,justification,idtrs}});
  return json({ok:true,groupId:group.id,count:ids.length,balance});
 }catch(error){return json({error:error instanceof Error?error.message:'Erro inesperado.'},500);}
});
