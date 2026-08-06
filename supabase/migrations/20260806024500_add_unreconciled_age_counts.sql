create index if not exists movements_analysis_status_date_idx
  on public.movements (analysis_id, status, movement_date);

create or replace function public.get_unreconciled_age_counts(
  p_analysis_id uuid,
  p_cutoff date
)
returns table (
  all_count bigint,
  d0_count bigint,
  up_to_1_count bigint,
  up_to_2_count bigint,
  at_least_1_count bigint,
  at_least_2_count bigint,
  at_least_3_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where movement_date = p_cutoff)::bigint,
    count(*) filter (where movement_date between p_cutoff - 1 and p_cutoff)::bigint,
    count(*) filter (where movement_date between p_cutoff - 2 and p_cutoff)::bigint,
    count(*) filter (where movement_date <= p_cutoff - 1)::bigint,
    count(*) filter (where movement_date <= p_cutoff - 2)::bigint,
    count(*) filter (where movement_date <= p_cutoff - 3)::bigint
  from public.movements
  where analysis_id = p_analysis_id and status = 'unreconciled';
$$;

grant execute on function public.get_unreconciled_age_counts(uuid, date) to authenticated;
