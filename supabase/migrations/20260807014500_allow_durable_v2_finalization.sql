create or replace function public.finalize_rt_v2_import_as_owner(p_import_id uuid,p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_owner uuid;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception 'Esta função só pode ser executada pelo serviço de finalização.';
  end if;
  select uploaded_by into v_owner from public.rt_v2_imports where id=p_import_id;
  if v_owner is null or v_owner<>p_actor_id then
    raise exception 'Importação inexistente ou utilizador incompatível.';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  return private.finalize_rt_v2_import(p_import_id);
end;
$$;

alter function public.finalize_rt_v2_import_as_owner(uuid,uuid) set statement_timeout='0';

revoke all on function public.finalize_rt_v2_import_as_owner(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_rt_v2_import_as_owner(uuid,uuid) to service_role;
