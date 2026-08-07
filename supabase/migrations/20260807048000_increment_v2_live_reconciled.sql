create or replace function public.increment_rt_v2_live_reconciled(
  p_import_id uuid,
  p_delta bigint
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rt_v2_imports
  set live_stats = jsonb_set(
    coalesce(live_stats, '{}'::jsonb),
    '{provisionalReconciled}',
    to_jsonb(coalesce((live_stats->>'provisionalReconciled')::bigint, 0) + greatest(p_delta, 0)),
    true
  )
  where id = p_import_id and p_delta > 0;
$$;

revoke all on function public.increment_rt_v2_live_reconciled(uuid,bigint) from public;
grant execute on function public.increment_rt_v2_live_reconciled(uuid,bigint) to service_role;
