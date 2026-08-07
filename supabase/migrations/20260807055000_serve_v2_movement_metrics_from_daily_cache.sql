-- O ecrã Movimentos deve abrir a partir da cache central, sem executar duas
-- contagens sobre milhões de linhas antes de mostrar a primeira página.
create or replace function public.rt_v2_movement_metrics(p_series_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with totals as (
    select sum(movements)::bigint movements,sum(reconciled)::bigint reconciled,
      sum(open)::bigint open
    from public.rt_v2_daily_metrics where series_id=p_series_id
  ), delay_rows as (
    select case operational_delay when 0 then 'D+0' when 1 then 'D+1'
      when 2 then 'D+2' when 3 then 'D+3' else 'D+4+' end bucket,
      count(*)::bigint reconciliations,sum(movement_count)::bigint movements
    from public.rt_v2_reconciliation_groups where series_id=p_series_id group by 1
  ), method_rows as (
    select method,sum(movement_count)::bigint movements
    from public.rt_v2_reconciliation_groups where series_id=p_series_id group by method
  )
  select jsonb_build_object(
    'totals',(select to_jsonb(totals) from totals),
    'reconciledByDelay',coalesce((select jsonb_object_agg(bucket,movements) from delay_rows),'{}'::jsonb),
    'reconciliationsByDelay',coalesce((select jsonb_object_agg(bucket,reconciliations) from delay_rows),'{}'::jsonb),
    'reconciliationMethods',coalesce((select jsonb_object_agg(method,movements) from method_rows),'{}'::jsonb));
$$;
revoke execute on function public.rt_v2_movement_metrics(uuid) from public,anon;
grant execute on function public.rt_v2_movement_metrics(uuid) to authenticated,service_role;

create or replace function public.rt_v2_open_age_metrics(p_series_id uuid)
returns jsonb language sql stable security definer set search_path=public,private as $$
  with boundary as (
    select max(metric_date)::date latest_date from public.rt_v2_daily_metrics where series_id=p_series_id
  ), cutoffs as (
    select b.latest_date,
      (select d::date from generate_series(b.latest_date-14,b.latest_date-1,interval '1 day') d where extract(isodow from d)<6 order by d desc offset 0 limit 1) d1,
      (select d::date from generate_series(b.latest_date-14,b.latest_date-1,interval '1 day') d where extract(isodow from d)<6 order by d desc offset 1 limit 1) d2,
      (select d::date from generate_series(b.latest_date-14,b.latest_date-1,interval '1 day') d where extract(isodow from d)<6 order by d desc offset 2 limit 1) d3
    from boundary b
  )
  select jsonb_build_object('latest_date',max(c.latest_date),
    'same_day',coalesce(sum(d.open) filter(where d.metric_date=c.latest_date),0),
    'at_least_1',coalesce(sum(d.open) filter(where d.metric_date<=c.d1),0),
    'at_least_2',coalesce(sum(d.open) filter(where d.metric_date<=c.d2),0),
    'at_least_3',coalesce(sum(d.open) filter(where d.metric_date<=c.d3),0),
    'all_open',coalesce(sum(d.open),0))
  from public.rt_v2_daily_metrics d cross join cutoffs c where d.series_id=p_series_id;
$$;
revoke all on function public.rt_v2_open_age_metrics(uuid) from public;
grant execute on function public.rt_v2_open_age_metrics(uuid) to authenticated;
