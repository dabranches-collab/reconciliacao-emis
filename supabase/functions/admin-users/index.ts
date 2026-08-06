import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
type UserRole='administrator'|'analyst'|'auditor';
type Body={action?:'create'|'update'|'set_active';userId?:string;email?:string;fullName?:string;role?:UserRole;password?:string;isActive?:boolean};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const validPassword=(value:string)=>value.length>=8&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value)&&/[^A-Za-z0-9]/.test(value);

Deno.serve(async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return json({error:'Método não permitido.'},405);
  try{
    const authorization=request.headers.get('Authorization');
    if(!authorization?.startsWith('Bearer '))return json({error:'Sessão inválida.'},401);
    const url=Deno.env.get('SUPABASE_URL')??'',anon=Deno.env.get('SUPABASE_ANON_KEY')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
    const callerClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await callerClient.auth.getUser(authorization.slice(7));
    if(userError||!userData.user)return json({error:'Sessão inválida ou expirada.'},401);
    const {data:caller,error:callerError}=await admin.from('profiles').select('id,role,is_active').eq('id',userData.user.id).single();
    if(callerError||caller?.role!=='administrator'||!caller.is_active)return json({error:'Apenas administradores ativos podem gerir utilizadores.'},403);
    const body=await request.json() as Body,fullName=body.fullName?.trim(),role=body.role;
    const roles:UserRole[]=['administrator','analyst','auditor'];
    if(body.action==='create'){
      const email=body.email?.trim().toLowerCase(),password=body.password??'';
      if(!email||!fullName||!role||!roles.includes(role))return json({error:'Preencha nome, email e perfil.'},400);
      if(!validPassword(password))return json({error:'A palavra-passe deve ter 8 ou mais caracteres, com maiúscula, minúscula, número e símbolo.'},400);
      const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName}});
      if(createError||!created.user)return json({error:createError?.message??'Não foi possível criar o utilizador.'},400);
      const {error:profileError}=await admin.from('profiles').update({full_name:fullName,role,is_active:true}).eq('id',created.user.id);
      if(profileError)return json({error:profileError.message},400);
      await admin.from('audit_logs').insert({actor_id:caller.id,action:'user_created',entity_type:'user',entity_id:created.user.id,details:{email,full_name:fullName,role}});
      return json({ok:true,userId:created.user.id});
    }
    if(!body.userId)return json({error:'Utilizador em falta.'},400);
    if(body.action==='update'){
      if(!fullName||!role||!roles.includes(role))return json({error:'Preencha nome e perfil.'},400);
      if(body.userId===caller.id&&role!=='administrator')return json({error:'Não pode retirar o seu próprio acesso de administrador.'},400);
      const {error:authError}=await admin.auth.admin.updateUserById(body.userId,{user_metadata:{full_name:fullName}});if(authError)return json({error:authError.message},400);
      const {error:profileError}=await admin.from('profiles').update({full_name:fullName,role}).eq('id',body.userId);if(profileError)return json({error:profileError.message},400);
      await admin.from('audit_logs').insert({actor_id:caller.id,action:'user_updated',entity_type:'user',entity_id:body.userId,details:{full_name:fullName,role}});return json({ok:true});
    }
    if(body.action==='set_active'){
      if(typeof body.isActive!=='boolean')return json({error:'Estado inválido.'},400);
      if(body.userId===caller.id&&!body.isActive)return json({error:'Não pode suspender a sua própria conta.'},400);
      const {error:authError}=await admin.auth.admin.updateUserById(body.userId,{ban_duration:body.isActive?'none':'876000h'});if(authError)return json({error:authError.message},400);
      const {error:profileError}=await admin.from('profiles').update({is_active:body.isActive}).eq('id',body.userId);if(profileError)return json({error:profileError.message},400);
      await admin.from('audit_logs').insert({actor_id:caller.id,action:body.isActive?'user_reactivated':'user_suspended',entity_type:'user',entity_id:body.userId,details:{is_active:body.isActive}});return json({ok:true});
    }
    return json({error:'Operação inválida.'},400);
  }catch(error){return json({error:error instanceof Error?error.message:'Erro inesperado.'},500);}
});
