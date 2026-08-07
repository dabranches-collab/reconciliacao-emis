-- Os atalhos cumulativos de Movimentos usam a mesma contagem operacional dos
-- cartões D+0/D+1/D+2: sábado e domingo não criam artificialmente mais idade.
create or replace function public.rt_v2_open_age_metrics(p_series_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  with boundary as (
    select max(accounting_date)::date as latest_date
    from public.rt_v2_movements
    where series_id = p_series_id
  ), cutoffs as (
    select b.latest_date,
      (select d::date from generate_series(b.latest_date-14,b.latest_date-1,interval '1 day') d where extract(isodow from d)<6 order by d desc offset 0 limit 1) d1,
      (select d::date from generate_series(b.latest_date-14,b.latest_date-1,interval '1 day') d where extract(isodow from d)<6 order by d desc offset 1 limit 1) d2,
      (select d::date from generate_series(b.latest_date-14,b.latest_date-1,interval '1 day') d where extract(isodow from d)<6 order by d desc offset 2 limit 1) d3
    from boundary b
  )
  select jsonb_build_object(
    'latest_date', max(c.latest_date),
    'same_day', count(*) filter (where m.accounting_date = c.latest_date),
    'at_least_1', count(*) filter (where m.accounting_date <= c.d1),
    'at_least_2', count(*) filter (where m.accounting_date <= c.d2),
    'at_least_3', count(*) filter (where m.accounting_date <= c.d3),
    'all_open', count(*)
  )
  from public.rt_v2_movements m cross join cutoffs c
  where m.series_id = p_series_id and m.status = 'open';
$$;

revoke all on function public.rt_v2_open_age_metrics(uuid) from public;
grant execute on function public.rt_v2_open_age_metrics(uuid) to authenticated;
