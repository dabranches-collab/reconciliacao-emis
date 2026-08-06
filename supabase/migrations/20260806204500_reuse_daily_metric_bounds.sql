create or replace function public.refresh_boundary_balance_summary(p_analysis_id uuid,p_window_days integer default 2)
returns void language plpgsql security definer set search_path=public as $$
declare first_day date; last_day date;
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  select min(metric_date),max(metric_date) into first_day,last_day from public.daily_metrics where analysis_id=p_analysis_id;
  if first_day is null or last_day is null then raise exception 'Série diária inexistente.'; end if;
  insert into public.analysis_boundary_metrics
  with open_groups as (
    select m.idtr,min(coalesce(m.accounting_date,m.movement_date)) first_seen,round(sum(m.amount)::numeric,2) balance,bool_or(m.opening_boundary) opening_boundary
    from public.movements m where m.analysis_id=p_analysis_id and m.status='unreconciled' and m.idtr is not null group by m.idtr
  )
  select p_analysis_id,count(*)::bigint,coalesce(round(sum(balance),2),0),
    count(*) filter(where opening_boundary)::bigint,coalesce(round(sum(balance) filter(where opening_boundary),2),0),
    count(*) filter(where not opening_boundary and first_seen>=last_day-p_window_days)::bigint,
    coalesce(round(sum(balance) filter(where not opening_boundary and first_seen>=last_day-p_window_days),2),0),
    count(*) filter(where not opening_boundary and first_seen<last_day-p_window_days)::bigint,
    coalesce(round(sum(balance) filter(where not opening_boundary and first_seen<last_day-p_window_days),2),0),now()
  from open_groups
  on conflict(analysis_id) do update set total_open_groups=excluded.total_open_groups,total_open_balance=excluded.total_open_balance,
    opening_groups=excluded.opening_groups,opening_balance=excluded.opening_balance,closing_groups=excluded.closing_groups,
    closing_balance=excluded.closing_balance,operational_groups=excluded.operational_groups,operational_balance=excluded.operational_balance,calculated_at=excluded.calculated_at;
end; $$;
revoke all on function public.refresh_boundary_balance_summary(uuid,integer) from public,anon;
grant execute on function public.refresh_boundary_balance_summary(uuid,integer) to authenticated;
