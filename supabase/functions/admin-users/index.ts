import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
type UserRole='platform_owner'|'client_admin'|'analyst'|'auditor';
type Body={action?:'create'|'update'|'set_active'|'set_pin';userId?:string;email?:string;fullName?:string;role?:UserRole;pin?:string;isActive?:boolean};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const validPin=(value:string)=>/^\d{4}$/.test(value);
const encoder=new TextEncoder();
async function derivedPassword(email:string,pin:string,pepper:string){
  const key=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(`${email}:${pin}`));
  const token=btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return `Aa1!${token}`;
}

Deno.serve(async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return json({error:'Método não permitido.'},405);
  try{
    const authorization=request.headers.get('Authorization');
    if(!authorization?.startsWith('Bearer '))return json({error:'Sessão inválida.'},401);
    const url=Deno.env.get('SUPABASE_URL')??'',anon=Deno.env.get('SUPABASE_ANON_KEY')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',pepper=Deno.env.get('PIN_PEPPER')??service;
    if(pepper.length<32)return json({error:'O acesso por PIN não está configurado.'},503);
    const callerClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await callerClient.auth.getUser(authorization.slice(7));
    if(userError||!userData.user)return json({error:'Sessão inválida ou expirada.'},401);
    const {data:caller,error:callerError}=await admin.from('profiles').select('id,role,is_active').eq('id',userData.user.id).single();
    if(callerError||!['platform_owner','client_admin'].includes(caller?.role)||!caller.is_active)return json({error:'Apenas administradores autorizados podem gerir utilizadores.'},403);
    const body=await request.json() as Body,fullName=body.fullName?.trim(),role=body.role;
    const roles:UserRole[]=['client_admin','analyst','auditor'];
    if(body.action==='create'){
      const email=body.email?.trim().toLowerCase(),pin=body.pin??'';
      if(!email||!fullName||!role||!roles.includes(role))return json({error:'Preencha nome, email e perfil.'},400);
      if(!validPin(pin))return json({error:'O PIN deve ter exatamente 4 algarismos.'},400);
      const password=await derivedPassword(email,pin,pepper);
      const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName}});
      if(createError||!created.user)return json({error:createError?.message??'Não foi possível criar o utilizador.'},400);
      const {error:profileError}=await admin.from('profiles').update({full_name:fullName,role,is_active:true,pin_enabled:true}).eq('id',created.user.id);
      if(profileError)return json({error:profileError.message},400);
      await admin.from('audit_logs').insert({actor_id:caller.id,action:'user_created',entity_type:'user',entity_id:created.user.id,details:{email,full_name:fullName,role}});
      return json({ok:true,userId:created.user.id});
    }
    if(!body.userId)return json({error:'Utilizador em falta.'},400);
    const {data:target,error:targetError}=await admin.from('profiles').select('id,email,role,is_active').eq('id',body.userId).single();
    if(targetError||!target)return json({error:'Utilizador não encontrado.'},404);
    if(target.role==='platform_owner'&&body.action!=='set_pin')return json({error:'A conta do proprietário da plataforma está protegida.'},403);
    if(body.action==='set_pin'){
      const pin=body.pin??'';
      if(!validPin(pin))return json({error:'O PIN deve ter exatamente 4 algarismos.'},400);
      if(target.role==='platform_owner'&&caller.role!=='platform_owner')return json({error:'Apenas o proprietário pode alterar o seu PIN.'},403);
      const password=await derivedPassword(target.email.toLowerCase(),pin,pepper);
      const {error:authError}=await admin.auth.admin.updateUserById(target.id,{password});if(authError)return json({error:authError.message},400);
      const {error:profileError}=await admin.from('profiles').update({pin_enabled:true}).eq('id',target.id);if(profileError)return json({error:profileError.message},400);
      await admin.from('pin_login_attempts').delete().eq('email',target.email.toLowerCase());
      await admin.from('audit_logs').insert({actor_id:caller.id,action:'user_pin_updated',entity_type:'user',entity_id:target.id,details:{}});
      return json({ok:true});
    }
    if(body.action==='update'){
      if(!fullName||!role||!roles.includes(role))return json({error:'Preencha nome e perfil.'},400);
      if(body.userId===caller.id&&role!==caller.role)return json({error:'Não pode alterar o perfil da sua própria conta administrativa.'},400);
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
