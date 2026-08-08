import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
const encoder=new TextEncoder();
const validPin=(value:string)=>/^\d{4}$/.test(value);
const genericError='Email ou PIN inválidos.';

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
    const {email:rawEmail,pin:rawPin}=await request.json() as {email?:string;pin?:string};
    const email=rawEmail?.trim().toLowerCase()??'',pin=rawPin??'';
    if(!email||!validPin(pin))return json({error:genericError},401);
    const url=Deno.env.get('SUPABASE_URL')??'',anon=Deno.env.get('SUPABASE_ANON_KEY')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',pepper=Deno.env.get('PIN_PEPPER')??service;
    if(!url||!anon||!service||pepper.length<32)return json({error:'O acesso por PIN não está configurado.'},503);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const now=new Date(),windowAgo=new Date(now.getTime()-15*60*1000).toISOString();
    const {data:attempt}=await admin.from('pin_login_attempts').select('failed_count,window_started_at,locked_until').eq('email',email).maybeSingle();
    if(attempt?.locked_until&&new Date(attempt.locked_until)>now)return json({error:'Demasiadas tentativas. Aguarde 15 minutos.'},429);
    const {data:profile}=await admin.from('profiles').select('id,is_active,pin_enabled').eq('email',email).maybeSingle();
    let session:null|{access_token:string;refresh_token:string;expires_in:number}=null;
    if(profile?.is_active&&profile.pin_enabled){
      const password=await derivedPassword(email,pin,pepper);
      const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data}=await authClient.auth.signInWithPassword({email,password});
      if(data.session)session={access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_in:data.session.expires_in};
    }
    if(!session){
      const inWindow=Boolean(attempt?.window_started_at&&attempt.window_started_at>=windowAgo),failed=(inWindow?Number(attempt?.failed_count??0):0)+1;
      await admin.from('pin_login_attempts').upsert({email,failed_count:failed,window_started_at:inWindow?attempt?.window_started_at:now.toISOString(),locked_until:failed>=5?new Date(now.getTime()+15*60*1000).toISOString():null,updated_at:now.toISOString()});
      return json({error:failed>=5?'Demasiadas tentativas. Aguarde 15 minutos.':genericError},failed>=5?429:401);
    }
    await admin.from('pin_login_attempts').delete().eq('email',email);
    await admin.from('audit_logs').insert({actor_id:profile.id,action:'login',entity_type:'session',entity_id:profile.id,details:{method:'pin'}});
    return json({session});
  }catch{return json({error:'Não foi possível iniciar sessão.'},500);}
});
