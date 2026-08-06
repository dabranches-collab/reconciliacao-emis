create table if not exists public.analysis_boundary_metrics (
  analysis_id uuid primary key references public.analyses(id) on delete cascade,
  total_open_groups bigint not null default 0,
  total_open_balance numeric not null default 0,
  opening_groups bigint not null default 0,
  opening_balance numeric not null default 0,
  closing_groups bigint not null default 0,
  closing_balance numeric not null default 0,
  operational_groups bigint not null default 0,
  operational_balance numeric not null default 0,
  calculated_at timestamptz not null default now()
);
alter table public.analysis_boundary_metrics enable row level security;
create policy boundary_metrics_read on public.analysis_boundary_metrics for select to authenticated using (private.is_active_user());
grant select on public.analysis_boundary_metrics to authenticated;

create or replace function public.refresh_boundary_balance_summary(p_analysis_id uuid,p_window_days integer default 2)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  insert into public.analysis_boundary_metrics
  with bounds as (
    select min(coalesce(movement_date,accounting_date)) first_day,max(coalesce(movement_date,accounting_date)) last_day
    from public.movements where analysis_id=p_analysis_id
  ), open_groups as (
    select m.idtr,min(coalesce(m.movement_date,m.accounting_date)) first_seen,max(coalesce(m.movement_date,m.accounting_date)) last_seen,
      round(sum(m.amount)::numeric,2) balance,bool_or(m.opening_boundary) opening_boundary,bounds.first_day,bounds.last_day
    from public.movements m cross join bounds where m.analysis_id=p_analysis_id and m.status='unreconciled' and m.idtr is not null
    group by m.idtr,bounds.first_day,bounds.last_day
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

create or replace function public.get_boundary_balance_summary(p_analysis_id uuid,p_window_days integer default 2)
returns table(total_open_groups bigint,total_open_balance numeric,opening_groups bigint,opening_balance numeric,closing_groups bigint,closing_balance numeric,operational_groups bigint,operational_balance numeric)
language sql stable security invoker set search_path=public as $$
 select total_open_groups,total_open_balance,opening_groups,opening_balance,closing_groups,closing_balance,operational_groups,operational_balance
 from public.analysis_boundary_metrics where analysis_id=p_analysis_id;
$$;
grant execute on function public.refresh_boundary_balance_summary(uuid,integer) to authenticated;
grant execute on function public.get_boundary_balance_summary(uuid,integer) to authenticated;
