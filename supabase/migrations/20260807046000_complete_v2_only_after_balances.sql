-- A importação só pode ficar concluída depois de os saldos terem sido
-- enriquecidos. Antes, a fase de métricas publicava 100% alguns segundos cedo.

create or replace function private.finalize_rt_v2_metrics(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_import public.rt_v2_imports%rowtype;v_rule constant text:='rt-v2.0.0';v_groups bigint:=0;
begin
  select * into v_import from public.rt_v2_imports where id=p_import_id for update;
  if v_import.id is null then raise exception 'Importação V2 não encontrada.'; end if;
  if v_import.state='completed' then return jsonb_build_object('status','completed'); end if;
  update public.rt_v2_imports set state='calculating',stage='A atualizar indicadores afetados',progress=94,heartbeat_at=now() where id=p_import_id;
  delete from public.rt_v2_daily_metrics d using private.rt_v2_affected_dates a where a.import_id=p_import_id and d.series_id=v_import.series_id and d.metric_date=a.metric_date;
  insert into public.rt_v2_daily_metrics(series_id,metric_date,movements,reconciled,open,missing_native_idtr,amount,rule_version)
  select v_import.series_id,m.accounting_date,count(*),count(*) filter(where m.status in('reconciled','manual')),count(*) filter(where m.status='open'),count(*) filter(where m.native_idtr is null),round(sum(m.amount)::numeric,2),v_rule
  from public.rt_v2_movements m join private.rt_v2_affected_dates a on a.import_id=p_import_id and a.metric_date=m.accounting_date where m.series_id=v_import.series_id group by m.accounting_date;
  select count(*) into v_groups from public.rt_v2_reconciliation_groups where series_id=v_import.series_id;
  with bounds as(select max(accounting_date) cutoff from public.rt_v2_movements where series_id=v_import.series_id),
  age as(select case private.rt_v2_working_days(m.accounting_date,b.cutoff) when 0 then 'D+0' when 1 then 'D+1' when 2 then 'D+2' when 3 then 'D+3' else case when private.rt_v2_working_days(m.accounting_date,b.cutoff)<=7 then 'D+4–7' else 'D+8+' end end bucket,count(*) total from public.rt_v2_movements m cross join bounds b where m.series_id=v_import.series_id and m.status='open' group by 1),
  timing as(select case operational_delay when 0 then 'D+0' when 1 then 'D+1' when 2 then 'D+2' when 3 then 'D+3' else 'D+4+' end bucket,count(*) reconciliations,sum(movement_count) movements from public.rt_v2_reconciliation_groups where series_id=v_import.series_id group by 1),
  totals as(select count(*) movements,count(*) filter(where status in('reconciled','manual')) reconciled,count(*) filter(where status='open') open,round(sum(amount)::numeric,2) amount,count(*) filter(where balance_sequence_valid=false) balance_anomalies,min(accounting_date) first_date,max(accounting_date) cutoff from public.rt_v2_movements where series_id=v_import.series_id)
  update public.rt_v2_calculations c set state='processing',calculated_at=now(),result=jsonb_build_object(
    'totals',(select to_jsonb(totals) from totals),
    'openByAge',coalesce((select jsonb_object_agg(bucket,total) from age),'{}'::jsonb),
    'reconciledByDelay',coalesce((select jsonb_object_agg(bucket,movements) from timing),'{}'::jsonb),
    'reconciliationsByDelay',coalesce((select jsonb_object_agg(bucket,reconciliations) from timing),'{}'::jsonb),
    'averageReconciliationDays',(select round(sum(operational_delay*movement_count)::numeric/nullif(sum(movement_count),0),2) from public.rt_v2_reconciliation_groups where series_id=v_import.series_id),
    'groupCount',v_groups,'ruleVersion',v_rule
  ) where c.series_id=v_import.series_id and c.metric='dashboard';
  update public.rt_v2_imports set stage='A calcular saldos e fronteira inicial',progress=98,heartbeat_at=now() where id=p_import_id;
  return jsonb_build_object('status','metrics_completed','groups',v_groups,'ruleVersion',v_rule);
end;$$;
alter function private.finalize_rt_v2_metrics(uuid) set statement_timeout='0';

create or replace function private.enrich_rt_v2_balance_summary(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_import public.rt_v2_imports%rowtype;v_summary jsonb;v_actor uuid:=auth.uid();v_rule constant text:='rt-v2.0.0';
begin
  select * into v_import from public.rt_v2_imports where id=p_import_id for update;
  if v_import.id is null then raise exception 'Importação V2 não encontrada.'; end if;
  if v_import.state='completed' then return jsonb_build_object('status','completed'); end if;
  with bounds as(
    select min(accounting_date) first_date,max(accounting_date) last_date from public.rt_v2_movements where series_id=v_import.series_id
  ),summary as(
    select round(coalesce(sum(m.amount) filter(where m.status='open'),0)::numeric,2) gross_open_balance,
      count(*) filter(where m.status='open')::bigint gross_open_movements,
      round(coalesce(sum(m.amount) filter(where m.status='open' and m.accounting_date=b.first_date),0)::numeric,2) opening_boundary_balance,
      count(*) filter(where m.status='open' and m.accounting_date=b.first_date)::bigint opening_boundary_movements,
      b.first_date,b.last_date
    from public.rt_v2_movements m cross join bounds b where m.series_id=v_import.series_id group by b.first_date,b.last_date
  ) select jsonb_build_object(
    'grossOpenBalance',gross_open_balance,'grossOpenMovements',gross_open_movements,
    'openingBoundaryBalance',opening_boundary_balance,'openingBoundaryMovements',opening_boundary_movements,
    'adjustedOpenBalance',gross_open_balance-opening_boundary_balance,
    'adjustedOpenMovements',gross_open_movements-opening_boundary_movements,
    'firstDate',first_date,'lastDate',last_date) into v_summary from summary;
  update public.rt_v2_calculations set state='completed',calculated_at=now(),result=coalesce(result,'{}'::jsonb)||jsonb_build_object('balanceSummary',v_summary)
  where series_id=v_import.series_id and metric='dashboard';
  update public.rt_v2_imports set state='completed',stage='Importação, reconciliação e indicadores concluídos',progress=100,completed_at=now(),heartbeat_at=now(),period_start=(select min(accounting_date) from public.rt_v2_movements where import_id=p_import_id),period_end=(select max(accounting_date) from public.rt_v2_movements where import_id=p_import_id) where id=p_import_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(v_actor,'v2_import_completed','rt_v2_import',p_import_id::text,jsonb_build_object('ruleVersion',v_rule,'mode','incremental_phased'));
  delete from private.rt_v2_affected_dates where import_id=p_import_id;
  return jsonb_build_object('status','completed','summary',v_summary);
end;$$;
alter function private.enrich_rt_v2_balance_summary(uuid) set statement_timeout='0';
