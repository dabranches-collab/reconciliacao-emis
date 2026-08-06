revoke execute on function public.refresh_accumulated_reconciliation(uuid) from public, anon;
revoke execute on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) from public, anon;
revoke execute on function public.refresh_boundary_balance_summary(uuid,integer) from public, anon;
revoke execute on function public.refresh_reconciliation_daily_metrics(uuid) from public, anon;
revoke execute on function public.refresh_secondary_reconciliation(uuid) from public, anon;

grant execute on function public.refresh_accumulated_reconciliation(uuid) to authenticated;
grant execute on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) to authenticated;
grant execute on function public.refresh_boundary_balance_summary(uuid,integer) to authenticated;
grant execute on function public.refresh_reconciliation_daily_metrics(uuid) to authenticated;
grant execute on function public.refresh_secondary_reconciliation(uuid) to authenticated;
