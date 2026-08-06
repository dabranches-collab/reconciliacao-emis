create table if not exists public.analysis_boundary_bucket_metrics(
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  bucket smallint not null,
  total_open_groups bigint not null default 0,total_open_balance numeric not null default 0,
  opening_groups bigint not null default 0,opening_balance numeric not null default 0,
  closing_groups bigint not null default 0,closing_balance numeric not null default 0,
  operational_groups bigint not null default 0,operational_balance numeric not null default 0,
  calculated_at timestamptz not null default now(),primary key(analysis_id,bucket));
alter table public.analysis_boundary_bucket_metrics enable row level security;
revoke all on public.analysis_boundary_bucket_metrics from public,anon,authenticated;

create index if not exists movements_unreconciled_idtr_bucket64_idx on public.movements
(analysis_id,(mod(abs(hashtext(idtr)::bigint),64)),idtr)
include(amount,accounting_date,movement_date,opening_boundary) where status='unreconciled' and idtr is not null;

create or replace function public.refresh_boundary_balance_bucket(p_analysis_id uuid,p_bucket integer,p_bucket_count integer default 64,p_window_days integer default 2)
returns void language plpgsql security definer set search_path=public as $$
declare last_day date;
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  if p_bucket<0 or p_bucket>=p_bucket_count or p_bucket_count<>64 then raise exception 'Configuração de bloco inválida.'; end if;
  select max(metric_date) into last_day from public.daily_metrics where analysis_id=p_analysis_id;
  insert into public.analysis_boundary_bucket_metrics
  with open_groups as (select m.idtr,min(coalesce(m.accounting_date,m.movement_date)) first_seen,round(sum(m.amount)::numeric,2) balance,bool_or(m.opening_boundary) opening_boundary
    from public.movements m where m.analysis_id=p_analysis_id and m.status='unreconciled' and m.idtr is not null and mod(abs(hashtext(m.idtr)::bigint),64)=p_bucket group by m.idtr)
  select p_analysis_id,p_bucket,count(*)::bigint,coalesce(round(sum(balance),2),0),count(*) filter(where opening_boundary)::bigint,coalesce(round(sum(balance) filter(where opening_boundary),2),0),
    count(*) filter(where not opening_boundary and first_seen>=last_day-p_window_days)::bigint,coalesce(round(sum(balance) filter(where not opening_boundary and first_seen>=last_day-p_window_days),2),0),
    count(*) filter(where not opening_boundary and first_seen<last_day-p_window_days)::bigint,coalesce(round(sum(balance) filter(where not opening_boundary and first_seen<last_day-p_window_days),2),0),now() from open_groups
  on conflict(analysis_id,bucket) do update set total_open_groups=excluded.total_open_groups,total_open_balance=excluded.total_open_balance,opening_groups=excluded.opening_groups,opening_balance=excluded.opening_balance,closing_groups=excluded.closing_groups,closing_balance=excluded.closing_balance,operational_groups=excluded.operational_groups,operational_balance=excluded.operational_balance,calculated_at=excluded.calculated_at;
end; $$;

create or replace function public.finalize_boundary_balance_summary(p_analysis_id uuid,p_bucket_count integer default 64)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  if (select count(*) from public.analysis_boundary_bucket_metrics where analysis_id=p_analysis_id)<>p_bucket_count then raise exception 'Blocos de fronteira incompletos.'; end if;
  insert into public.analysis_boundary_metrics select p_analysis_id,sum(total_open_groups),sum(total_open_balance),sum(opening_groups),sum(opening_balance),sum(closing_groups),sum(closing_balance),sum(operational_groups),sum(operational_balance),now()
  from public.analysis_boundary_bucket_metrics where analysis_id=p_analysis_id
  on conflict(analysis_id) do update set total_open_groups=excluded.total_open_groups,total_open_balance=excluded.total_open_balance,opening_groups=excluded.opening_groups,opening_balance=excluded.opening_balance,closing_groups=excluded.closing_groups,closing_balance=excluded.closing_balance,operational_groups=excluded.operational_groups,operational_balance=excluded.operational_balance,calculated_at=excluded.calculated_at;
end; $$;
revoke all on function public.refresh_boundary_balance_bucket(uuid,integer,integer,integer) from public,anon;
revoke all on function public.finalize_boundary_balance_summary(uuid,integer) from public,anon;
grant execute on function public.refresh_boundary_balance_bucket(uuid,integer,integer,integer) to authenticated;
grant execute on function public.finalize_boundary_balance_summary(uuid,integer) to authenticated;
