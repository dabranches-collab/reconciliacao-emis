-- Revoga concessões antigas explícitas e executa métricas de leitura com as
-- políticas RLS do utilizador autenticado.
alter function public.rt_v2_open_age_metrics(uuid) security invoker;
revoke all on function public.rt_v2_open_age_metrics(uuid) from public,anon;
grant execute on function public.rt_v2_open_age_metrics(uuid) to authenticated;

revoke all on function public.increment_rt_v2_live_reconciled(uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.increment_rt_v2_live_reconciled(uuid,bigint)
  to service_role;

-- A finalização monolítica foi substituída pelo workflow durável por fases.
revoke all on function public.finalize_rt_v2_import(uuid)
  from public,anon,authenticated;
