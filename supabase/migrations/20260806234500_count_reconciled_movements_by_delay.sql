create or replace function public.rt_v2_movement_metrics(p_series_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with delay_rows as (
    select
      case operational_delay
        when 0 then 'D+0'
        when 1 then 'D+1'
        when 2 then 'D+2'
        when 3 then 'D+3'
        else 'D+4+'
      end as bucket,
      sum(movement_count)::bigint as movements
    from public.rt_v2_reconciliation_groups
    where series_id = p_series_id
    group by 1
  ), method_rows as (
    select method, sum(movement_count)::bigint as movements
    from public.rt_v2_reconciliation_groups
    where series_id = p_series_id
    group by method
  )
  select jsonb_build_object(
    'reconciledByDelay', coalesce(
      (select jsonb_object_agg(bucket, movements) from delay_rows),
      '{}'::jsonb
    ),
    'reconciliationMethods', coalesce(
      (select jsonb_object_agg(method, movements) from method_rows),
      '{}'::jsonb
    )
  );
$$;

revoke execute on function public.rt_v2_movement_metrics(uuid) from public, anon;
grant execute on function public.rt_v2_movement_metrics(uuid) to authenticated, service_role;
