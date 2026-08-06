create index if not exists rt_v2_movements_series_status_date_idx
  on public.rt_v2_movements(series_id,status,accounting_date desc,id desc);

create table public.rt_v2_reconciliation_alerts (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.rt_v2_series(id) on delete cascade,
  import_id uuid not null references public.rt_v2_imports(id) on delete cascade,
  alert_type text not null check (alert_type in ('idtr_reappeared_after_reconciliation')),
  reconciliation_key text not null,
  new_movement_count bigint not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_note text,
  unique(import_id,alert_type,reconciliation_key)
);
alter table public.rt_v2_reconciliation_alerts enable row level security;
create policy rt_v2_reconciliation_alerts_read on public.rt_v2_reconciliation_alerts for select to authenticated using ((select private.is_active_user()));
revoke all on public.rt_v2_reconciliation_alerts from anon;
grant select on public.rt_v2_reconciliation_alerts to authenticated;

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

  create temporary table if not exists rt_v2_affected_dates(metric_date date primary key) on commit drop;
  create temporary table if not exists rt_v2_affected_idtrs(idtr text primary key) on commit drop;
  create temporary table if not exists rt_v2_idtr_groups(group_id uuid,idtr text) on commit drop;
  truncate rt_v2_affected_dates;truncate rt_v2_affected_idtrs;truncate rt_v2_idtr_groups;
  insert into rt_v2_affected_dates select distinct accounting_date from public.rt_v2_movements where import_id=p_import_id;
  insert into rt_v2_affected_idtrs select distinct native_idtr from public.rt_v2_movements where import_id=p_import_id and status='open' and native_idtr is not null;
  insert into public.rt_v2_reconciliation_alerts(series_id,import_id,alert_type,reconciliation_key,new_movement_count)
  select v_import.series_id,p_import_id,'idtr_reappeared_after_reconciliation',m.native_idtr,count(*)
  from public.rt_v2_movements m
  where m.import_id=p_import_id and m.native_idtr is not null and exists (
    select 1 from public.rt_v2_reconciliation_groups g
    where g.series_id=v_import.series_id and g.method='idtr' and g.reconciliation_key=m.native_idtr
  )
  group by m.native_idtr
  on conflict(import_id,alert_type,reconciliation_key) do update set new_movement_count=excluded.new_movement_count;

  with candidates as (
    select m.native_idtr,count(*) movement_count,round(sum(m.amount)::numeric,2) balance,min(m.accounting_date) first_date,max(m.accounting_date) last_date
    from public.rt_v2_movements m join rt_v2_affected_idtrs a on a.idtr=m.native_idtr
    where m.series_id=v_import.series_id and m.status='open'
    group by m.native_idtr having count(*)>=2 and abs(round(sum(m.amount)::numeric,2))<=0.005
  ), inserted as (
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay)
    select v_import.series_id,'idtr',native_idtr,v_rule,movement_count,balance,first_date,last_date,private.rt_v2_working_days(first_date,last_date) from candidates
    returning id,reconciliation_key
  ) insert into rt_v2_idtr_groups select id,reconciliation_key from inserted;

  insert into public.rt_v2_group_movements(group_id,movement_id)
  select g.group_id,m.id from rt_v2_idtr_groups g join public.rt_v2_movements m on m.series_id=v_import.series_id and m.native_idtr=g.idtr and m.status='open';
  insert into rt_v2_affected_dates
  select distinct m.accounting_date from public.rt_v2_group_movements gm join rt_v2_idtr_groups g on g.group_id=gm.group_id join public.rt_v2_movements m on m.id=gm.movement_id
  on conflict do nothing;
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='idtr',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm join rt_v2_idtr_groups g on g.group_id=gm.group_id
  where gm.movement_id=m.id and m.series_id=v_import.series_id and m.status='open';

  update public.rt_v2_imports set stage='A emparelhar movimentos restantes',progress=88,heartbeat_at=now() where id=p_import_id;
  create temporary table if not exists rt_v2_affected_secondary(operation_number text,description_normalized text,absolute_amount numeric(20,2),primary key(operation_number,description_normalized,absolute_amount)) on commit drop;
  create temporary table if not exists rt_v2_pairs(pair_key text,positive_id bigint,negative_id bigint,movement_count integer,first_date date,last_date date) on commit drop;
  create temporary table if not exists rt_v2_pair_groups(group_id uuid,pair_key text) on commit drop;
  truncate rt_v2_affected_secondary;truncate rt_v2_pairs;truncate rt_v2_pair_groups;
  insert into rt_v2_affected_secondary
  select distinct operation_number,description_normalized,abs(amount)
  from public.rt_v2_movements
  where import_id=p_import_id and status='open' and amount<>0 and coalesce(operation_number,'')<>'' and coalesce(description_normalized,'')<>'';

  insert into rt_v2_pairs
  with ranked as (
    select m.id,m.operation_number,m.description_normalized,abs(m.amount) absolute_amount,m.accounting_date,
      case when m.amount>0 then 1 else -1 end direction,
      row_number() over(partition by m.operation_number,m.description_normalized,abs(m.amount),case when m.amount>0 then 1 else -1 end order by m.accounting_date,m.id) pair_number
    from public.rt_v2_movements m join rt_v2_affected_secondary a on a.operation_number=m.operation_number and a.description_normalized=m.description_normalized and a.absolute_amount=abs(m.amount)
    where m.series_id=v_import.series_id and m.status='open' and m.amount<>0
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
  insert into rt_v2_affected_dates select first_date from rt_v2_pairs union select last_date from rt_v2_pairs on conflict do nothing;
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='operation_description',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm join rt_v2_pair_groups g on g.group_id=gm.group_id
  where gm.movement_id=m.id and m.series_id=v_import.series_id and m.status='open';

  update public.rt_v2_imports set state='calculating',stage='A atualizar indicadores afetados',progress=94,heartbeat_at=now() where id=p_import_id;
  delete from public.rt_v2_daily_metrics d using rt_v2_affected_dates a where d.series_id=v_import.series_id and d.metric_date=a.metric_date;
  insert into public.rt_v2_daily_metrics(series_id,metric_date,movements,reconciled,open,missing_native_idtr,amount,rule_version)
  select v_import.series_id,m.accounting_date,count(*),count(*) filter(where m.status in ('reconciled','manual')),count(*) filter(where m.status='open'),count(*) filter(where m.native_idtr is null),round(sum(m.amount)::numeric,2),v_rule
  from public.rt_v2_movements m join rt_v2_affected_dates a on a.metric_date=m.accounting_date
  where m.series_id=v_import.series_id group by m.accounting_date;

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
    'groupCount',v_groups,'ruleVersion',v_rule
  ) where c.series_id=v_import.series_id and c.metric='dashboard';

  update public.rt_v2_imports set state='completed',stage='Importação, reconciliação e indicadores concluídos',progress=100,completed_at=now(),heartbeat_at=now(),period_start=(select min(accounting_date) from public.rt_v2_movements where import_id=p_import_id),period_end=(select max(accounting_date) from public.rt_v2_movements where import_id=p_import_id) where id=p_import_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(v_actor,'v2_import_completed','rt_v2_import',p_import_id::text,jsonb_build_object('ruleVersion',v_rule,'groups',v_groups,'mode','incremental'));
  return jsonb_build_object('status','completed','importId',p_import_id,'groups',v_groups,'ruleVersion',v_rule,'mode','incremental');
exception when others then
  update public.rt_v2_imports set state='failed',stage='Falha na finalização',error_message=sqlerrm,heartbeat_at=now() where id=p_import_id;
  update public.rt_v2_calculations set state='failed',error_message=sqlerrm,calculated_at=now() where series_id=v_import.series_id and metric='dashboard';
  raise;
end;
$$;

alter function private.finalize_rt_v2_import(uuid) set statement_timeout='0';
