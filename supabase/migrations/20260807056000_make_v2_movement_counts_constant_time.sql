-- Resultados lê o cálculo central já consolidado. Este RPC serve apenas os
-- três contadores do menu Movimentos e deve responder em tempo constante.
create or replace function public.rt_v2_movement_metrics(p_series_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('totals',jsonb_build_object(
    'movements',coalesce(sum(movements),0)::bigint,
    'reconciled',coalesce(sum(reconciled),0)::bigint,
    'open',coalesce(sum(open),0)::bigint))
  from public.rt_v2_daily_metrics where series_id=p_series_id;
$$;
revoke execute on function public.rt_v2_movement_metrics(uuid) from public,anon;
grant execute on function public.rt_v2_movement_metrics(uuid) to authenticated,service_role;
