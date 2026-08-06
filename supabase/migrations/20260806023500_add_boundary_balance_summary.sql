create or replace function public.get_boundary_balance_summary(
  p_analysis_id uuid,
  p_window_days integer default 2
)
returns table (
  total_open_groups bigint,
  total_open_balance numeric,
  opening_groups bigint,
  opening_balance numeric,
  closing_groups bigint,
  closing_balance numeric,
  operational_groups bigint,
  operational_balance numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with movement_days as (
    select idtr, coalesce(movement_date, accounting_date) as movement_day, amount
    from public.movements
    where analysis_id = p_analysis_id and idtr is not null
  ), bounds as (
    select min(movement_day) as first_day, max(movement_day) as last_day
    from movement_days
  ), idtr_groups as (
    select idtr, min(movement_day) as first_seen, max(movement_day) as last_seen,
           round(sum(amount)::numeric, 2) as balance
    from movement_days
    group by idtr
  ), open_groups as (
    select groups.*, bounds.first_day, bounds.last_day
    from idtr_groups groups cross join bounds
    where abs(groups.balance) > 0.005
  )
  select
    count(*)::bigint,
    coalesce(round(sum(balance)::numeric, 2), 0),
    count(*) filter (where last_seen <= first_day + p_window_days)::bigint,
    coalesce(round(sum(balance) filter (where last_seen <= first_day + p_window_days)::numeric, 2), 0),
    count(*) filter (where last_seen > first_day + p_window_days and first_seen >= last_day - p_window_days)::bigint,
    coalesce(round(sum(balance) filter (where last_seen > first_day + p_window_days and first_seen >= last_day - p_window_days)::numeric, 2), 0),
    count(*) filter (where last_seen > first_day + p_window_days and first_seen < last_day - p_window_days)::bigint,
    coalesce(round(sum(balance) filter (where last_seen > first_day + p_window_days and first_seen < last_day - p_window_days)::numeric, 2), 0)
  from open_groups;
$$;

grant execute on function public.get_boundary_balance_summary(uuid, integer) to authenticated;
