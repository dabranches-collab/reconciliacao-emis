create or replace function private.rt_v2_working_days(p_from date,p_to date)
returns integer language sql stable set search_path=public as $$
  select case when p_from is null or p_to is null or p_from>=p_to then 0 else count(*)::integer end
  from generate_series(p_from+1,p_to,interval '1 day') day
  left join public.rt_v2_operational_calendar calendar on calendar.calendar_date=day::date
  where coalesce(calendar.is_working_day,extract(isodow from day)<6);
$$;

create or replace function private.finalize_rt_v2_import(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare
  v_import public.rt_v2_imports%rowtype;
  v_actor uuid:=auth.uid();
  v_rule constant text:='rt-v2.0.0';
  v_groups bigint:=0;
begin
  select * into v_import from public.rt_v2_imports where id=p_import_id for update;
  if v_import.id is null then raise exception 'Importação V2 não encontrada.'; end if;
  if v_actor is null or (v_import.uploaded_by<>v_actor and not private.is_admin()) then raise exception 'Sem permissão para finalizar esta importação.'; end if;
  if v_import.state='completed' then return jsonb_build_object('status','completed','importId',p_import_id); end if;

  update public.rt_v2_imports set state='reconciling',stage='A reconciliar grupos IDTR',progress=82,heartbeat_at=now(),error_message=null where id=p_import_id;
  insert into public.rt_v2_calculations(series_id,metric,rule_version,state,started_at)
  values (v_import.series_id,'dashboard',v_rule,'processing',now())
  on conflict(series_id,metric) do update set rule_version=excluded.rule_version,state='processing',result=null,error_message=null,started_at=now(),calculated_at=null;

  create temporary table if not exists rt_v2_idtr_groups(group_id uuid,idtr text) on commit drop;
  truncate rt_v2_idtr_groups;
  with candidates as (
    select native_idtr,count(*) movement_count,round(sum(amount)::numeric,2) balance,min(accounting_date) first_date,max(accounting_date) last_date
    from public.rt_v2_movements where series_id=v_import.series_id and status='open' and native_idtr is not null
    group by native_idtr having count(*)>=2 and abs(round(sum(amount)::numeric,2))<=0.005
  ), inserted as (
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay)
    select v_import.series_id,'idtr',native_idtr,v_rule,movement_count,balance,first_date,last_date,private.rt_v2_working_days(first_date,last_date) from candidates
    returning id,reconciliation_key
  ) insert into rt_v2_idtr_groups select id,reconciliation_key from inserted;

  insert into public.rt_v2_group_movements(group_id,movement_id)
  select g.group_id,m.id from rt_v2_idtr_groups g join public.rt_v2_movements m on m.series_id=v_import.series_id and m.native_idtr=g.idtr and m.status='open';
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='idtr',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm where gm.movement_id=m.id and m.series_id=v_import.series_id and m.status='open';

  update public.rt_v2_imports set stage='A emparelhar movimentos restantes',progress=88,heartbeat_at=now() where id=p_import_id;
  create temporary table if not exists rt_v2_pairs(pair_key text,positive_id bigint,negative_id bigint,movement_count integer,first_date date,last_date date) on commit drop;
  create temporary table if not exists rt_v2_pair_groups(group_id uuid,pair_key text) on commit drop;
  truncate rt_v2_pairs;truncate rt_v2_pair_groups;
  insert into rt_v2_pairs
  with ranked as (
    select id,operation_number,description_normalized,abs(amount) absolute_amount,accounting_date,
      case when amount>0 then 1 else -1 end direction,
      row_number() over(partition by operation_number,description_normalized,abs(amount),case when amount>0 then 1 else -1 end order by accounting_date,id) pair_number
    from public.rt_v2_movements
    where series_id=v_import.series_id and status='open' and amount<>0 and coalesce(operation_number,'')<>'' and coalesce(description_normalized,'')<>''
  ) select concat_ws(chr(31),p.operation_number,p.description_normalized,p.absolute_amount,p.pair_number),p.id,n.id,2,least(p.accounting_date,n.accounting_date),greatest(p.accounting_date,n.accounting_date)
    from ranked p join ranked n on n.operation_number=p.operation_number and n.description_normalized=p.description_normalized and n.absolute_amount=p.absolute_amount and n.pair_number=p.pair_number and n.direction=-1
    where p.direction=1;
  with inserted as (
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay)
    select v_import.series_id,'operation_description',pair_key,v_rule,2,0,first_date,last_date,private.rt_v2_working_days(first_date,last_date) from rt_v2_pairs
    returning id,reconciliation_key
  ) insert into rt_v2_pair_groups select id,reconciliation_key from inserted;
  insert into public.rt_v2_group_movements(group_id,movement_id)
  select g.group_id,p.positive_id from rt_v2_pair_groups g join rt_v2_pairs p using(pair_key)
  union all select g.group_id,p.negative_id from rt_v2_pair_groups g join rt_v2_pairs p using(pair_key);
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='operation_description',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm where gm.movement_id=m.id and m.series_id=v_import.series_id and m.status='open';

  update public.rt_v2_imports set state='calculating',stage='A calcular indicadores centrais',progress=94,heartbeat_at=now() where id=p_import_id;
  delete from public.rt_v2_daily_metrics where series_id=v_import.series_id;
  insert into public.rt_v2_daily_metrics(series_id,metric_date,movements,reconciled,open,missing_native_idtr,amount,rule_version)
  select v_import.series_id,accounting_date,count(*),count(*) filter(where status in ('reconciled','manual')),count(*) filter(where status='open'),count(*) filter(where native_idtr is null),round(sum(amount)::numeric,2),v_rule
  from public.rt_v2_movements where series_id=v_import.series_id group by accounting_date;

  select count(*) into v_groups from public.rt_v2_reconciliation_groups where series_id=v_import.series_id;
  with bounds as (select max(accounting_date) cutoff from public.rt_v2_movements where series_id=v_import.series_id),
  age as (
    select case private.rt_v2_working_days(m.accounting_date,b.cutoff) when 0 then 'D+0' when 1 then 'D+1' when 2 then 'D+2' when 3 then 'D+3' else case when private.rt_v2_working_days(m.accounting_date,b.cutoff)<=7 then 'D+4–7' else 'D+8+' end end bucket,count(*) total
    from public.rt_v2_movements m cross join bounds b where m.series_id=v_import.series_id and m.status='open' group by 1
  ), timing as (select case operational_delay when 0 then 'D+0' when 1 then 'D+1' when 2 then 'D+2' when 3 then 'D+3' else 'D+4+' end bucket,count(*) total from public.rt_v2_reconciliation_groups where series_id=v_import.series_id group by 1),
  totals as (select count(*) movements,count(*) filter(where status in ('reconciled','manual')) reconciled,count(*) filter(where status='open') open,round(sum(amount)::numeric,2) amount,count(*) filter(where balance_sequence_valid=false) balance_anomalies,min(accounting_date) first_date,max(accounting_date) cutoff from public.rt_v2_movements where series_id=v_import.series_id)
  update public.rt_v2_calculations c set state='completed',calculated_at=now(),result=jsonb_build_object(
    'totals',(select to_jsonb(totals) from totals),
    'openByAge',coalesce((select jsonb_object_agg(bucket,total) from age),'{}'::jsonb),
    'reconciledByDelay',coalesce((select jsonb_object_agg(bucket,total) from timing),'{}'::jsonb),
    'averageReconciliationDays',(select round(avg(operational_delay)::numeric,2) from public.rt_v2_reconciliation_groups where series_id=v_import.series_id),
    'groupCount',v_groups,
    'ruleVersion',v_rule
  ) where c.series_id=v_import.series_id and c.metric='dashboard';

  update public.rt_v2_imports set state='completed',stage='Importação, reconciliação e indicadores concluídos',progress=100,completed_at=now(),heartbeat_at=now(),period_start=(select min(accounting_date) from public.rt_v2_movements where import_id=p_import_id),period_end=(select max(accounting_date) from public.rt_v2_movements where import_id=p_import_id) where id=p_import_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(v_actor,'v2_import_completed','rt_v2_import',p_import_id::text,jsonb_build_object('ruleVersion',v_rule,'groups',v_groups));
  return jsonb_build_object('status','completed','importId',p_import_id,'groups',v_groups,'ruleVersion',v_rule);
exception when others then
  update public.rt_v2_imports set state='failed',stage='Falha na finalização',error_message=sqlerrm,heartbeat_at=now() where id=p_import_id;
  update public.rt_v2_calculations set state='failed',error_message=sqlerrm,calculated_at=now() where series_id=v_import.series_id and metric='dashboard';
  raise;
end;
$$;

create or replace function public.finalize_rt_v2_import(p_import_id uuid)
returns jsonb language sql security definer set search_path=public,private as $$
  select private.finalize_rt_v2_import(p_import_id);
$$;

revoke all on function public.finalize_rt_v2_import(uuid) from public,anon;
grant execute on function public.finalize_rt_v2_import(uuid) to authenticated;
revoke all on function private.finalize_rt_v2_import(uuid) from public,anon,authenticated;
grant execute on function private.finalize_rt_v2_import(uuid) to postgres,service_role;
