create or replace function public.rt_v2_import_closure_count(p_import_id uuid)
returns bigint
language sql
stable
security invoker
set search_path=public
as $$
  select coalesce(sum(g.movement_count),0)::bigint
  from public.rt_v2_reconciliation_groups g
  where g.closed_by_import_id=p_import_id;
$$;

revoke all on function public.rt_v2_import_closure_count(uuid) from public,anon;
grant execute on function public.rt_v2_import_closure_count(uuid) to authenticated,service_role;
