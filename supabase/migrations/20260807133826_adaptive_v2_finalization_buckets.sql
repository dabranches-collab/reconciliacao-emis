create or replace function private.initialize_rt_v2_finalization(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
  v_import public.rt_v2_imports%rowtype;
  v_rule constant text:='rt-v2.0.0';
  v_primary_candidates bigint:=0;
  v_secondary_candidates bigint:=0;
begin
  select * into v_import from public.rt_v2_imports where id=p_import_id for update;
  if v_import.id is null then raise exception 'Importação V2 não encontrada.'; end if;
  if v_import.state='completed' then return jsonb_build_object('status','completed'); end if;

  update public.rt_v2_imports
  set state='reconciling',stage='A preparar reconciliação central',progress=81,heartbeat_at=now(),error_message=null
  where id=p_import_id;

  insert into public.rt_v2_calculations(series_id,metric,rule_version,state,started_at)
  values(v_import.series_id,'dashboard',v_rule,'processing',now())
  on conflict(series_id,metric) do update
  set rule_version=excluded.rule_version,state='processing',error_message=null,started_at=now(),calculated_at=null;

  insert into private.rt_v2_affected_dates(import_id,metric_date)
  select p_import_id,accounting_date
  from public.rt_v2_movements
  where import_id=p_import_id
  group by accounting_date
  on conflict do nothing;

  insert into public.rt_v2_reconciliation_alerts(series_id,import_id,alert_type,reconciliation_key,new_movement_count)
  select v_import.series_id,p_import_id,'idtr_reappeared_after_reconciliation',m.native_idtr,count(*)
  from public.rt_v2_movements m
  where m.import_id=p_import_id and m.native_idtr is not null and exists(
    select 1 from public.rt_v2_reconciliation_groups g
    where g.series_id=v_import.series_id and g.method='idtr' and g.reconciliation_key=m.native_idtr
  )
  group by m.native_idtr
  on conflict(import_id,alert_type,reconciliation_key)
  do update set new_movement_count=excluded.new_movement_count;

  select count(distinct native_idtr) into v_primary_candidates
  from public.rt_v2_movements
  where import_id=p_import_id and status='open' and native_idtr is not null;

  select count(*) into v_secondary_candidates from (
    select operation_number,description_normalized,abs(amount)
    from public.rt_v2_movements
    where import_id=p_import_id and status='open' and amount<>0
      and coalesce(operation_number,'')<>'' and coalesce(description_normalized,'')<>''
    group by operation_number,description_normalized,abs(amount)
  ) candidates;

  return jsonb_build_object(
    'status','initialized',
    'primaryCandidates',v_primary_candidates,
    'secondaryCandidates',v_secondary_candidates,
    'operationalOpenMovements',(
      select count(*) from public.rt_v2_movements
      where series_id=v_import.series_id and status='open'
    ),
    'operationalWindowDays',7
  );
end;$$;

alter function private.initialize_rt_v2_finalization(uuid) set statement_timeout='0';
