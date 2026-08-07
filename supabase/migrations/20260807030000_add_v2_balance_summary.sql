create or replace function private.enrich_rt_v2_balance_summary(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_series_id uuid;v_summary jsonb;
begin
  select series_id into v_series_id from public.rt_v2_imports where id=p_import_id;
  if v_series_id is null then raise exception 'Importação V2 não encontrada.'; end if;
  with bounds as(
    select min(accounting_date) first_date,max(accounting_date) last_date from public.rt_v2_movements where series_id=v_series_id
  ),summary as(
    select round(coalesce(sum(m.amount) filter(where m.status='open'),0)::numeric,2) gross_open_balance,
      count(*) filter(where m.status='open')::bigint gross_open_movements,
      round(coalesce(sum(m.amount) filter(where m.status='open' and m.accounting_date=b.first_date),0)::numeric,2) opening_boundary_balance,
      count(*) filter(where m.status='open' and m.accounting_date=b.first_date)::bigint opening_boundary_movements,
      b.first_date,b.last_date
    from public.rt_v2_movements m cross join bounds b where m.series_id=v_series_id group by b.first_date,b.last_date
  ) select jsonb_build_object(
    'grossOpenBalance',gross_open_balance,'grossOpenMovements',gross_open_movements,
    'openingBoundaryBalance',opening_boundary_balance,'openingBoundaryMovements',opening_boundary_movements,
    'adjustedOpenBalance',gross_open_balance-opening_boundary_balance,
    'adjustedOpenMovements',gross_open_movements-opening_boundary_movements,
    'firstDate',first_date,'lastDate',last_date) into v_summary from summary;
  update public.rt_v2_calculations set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('balanceSummary',v_summary)
  where series_id=v_series_id and metric='dashboard';
  return v_summary;
end;$$;
alter function private.enrich_rt_v2_balance_summary(uuid) set statement_timeout='0';

create or replace function public.finalize_rt_v2_import_phase_as_owner(p_import_id uuid,p_actor_id uuid,p_phase text,p_bucket integer default null,p_bucket_count integer default null)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_owner uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Função exclusiva do serviço.'; end if;
  select uploaded_by into v_owner from public.rt_v2_imports where id=p_import_id;
  if v_owner is null or v_owner<>p_actor_id then raise exception 'Importação inexistente ou utilizador incompatível.'; end if;
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  case p_phase when 'initialize' then return private.initialize_rt_v2_finalization(p_import_id);when 'primary' then return private.finalize_rt_v2_primary_bucket(p_import_id,p_bucket,p_bucket_count);when 'secondary' then return private.finalize_rt_v2_secondary_bucket(p_import_id,p_bucket,p_bucket_count);when 'metrics' then return private.finalize_rt_v2_metrics(p_import_id);when 'balances' then return private.enrich_rt_v2_balance_summary(p_import_id);else raise exception 'Fase inválida.';end case;
end;$$;
alter function public.finalize_rt_v2_import_phase_as_owner(uuid,uuid,text,integer,integer) set statement_timeout='0';
revoke all on function public.finalize_rt_v2_import_phase_as_owner(uuid,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.finalize_rt_v2_import_phase_as_owner(uuid,uuid,text,integer,integer) to service_role;
