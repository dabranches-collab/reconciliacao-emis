alter table public.movements add column if not exists opening_boundary boolean not null default false;
create index if not exists movements_operational_pending_idx on public.movements (analysis_id,status,movement_date) where opening_boundary=false;

create or replace function public.refresh_accumulated_reconciliation_bucket(p_analysis_id uuid,p_bucket integer,p_bucket_count integer default 16)
returns bigint language plpgsql security definer set search_path=public as $$
declare changed_rows bigint;
begin
  if p_bucket<0 or p_bucket>=p_bucket_count then raise exception 'Bloco inválido.'; end if;
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  with bounds as (select min(coalesce(movement_date,accounting_date)) first_day from public.movements where analysis_id=p_analysis_id),
  balances as (
    select m.idtr,abs(round(sum(m.amount)::numeric,2))<=0.005 closes,max(coalesce(m.movement_date,m.accounting_date)) last_seen,bounds.first_day
    from public.movements m cross join bounds where m.analysis_id=p_analysis_id and m.idtr is not null
      and mod(abs(hashtext(m.idtr)::bigint),p_bucket_count)=p_bucket group by m.idtr,bounds.first_day
  )
  update public.movements movement set
    status=case when balances.closes then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end,
    opening_boundary=(not balances.closes and balances.last_seen<=balances.first_day+2)
  from balances where movement.analysis_id=p_analysis_id and movement.idtr=balances.idtr and movement.status in ('automatic','unreconciled')
    and (movement.status is distinct from case when balances.closes then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end
      or movement.opening_boundary is distinct from (not balances.closes and balances.last_seen<=balances.first_day+2));
  get diagnostics changed_rows=row_count; return changed_rows;
end; $$;

create or replace function public.refresh_reconciliation_daily_metrics(p_analysis_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  insert into public.daily_metrics(analysis_id,metric_date,movements,automatic,unreconciled,missing_idtr,amount)
  select p_analysis_id,coalesce(movement_date,accounting_date),count(*)::integer,count(*) filter(where status='automatic')::integer,
    count(*) filter(where status='unreconciled')::integer,count(*) filter(where status='missing_idtr')::integer,coalesce(sum(amount),0)
  from public.movements where analysis_id=p_analysis_id and coalesce(movement_date,accounting_date) is not null group by coalesce(movement_date,accounting_date)
  on conflict(analysis_id,metric_date) do update set movements=excluded.movements,automatic=excluded.automatic,unreconciled=excluded.unreconciled,missing_idtr=excluded.missing_idtr,amount=excluded.amount;
end; $$;

drop function if exists public.get_unreconciled_age_counts(uuid,date);
create function public.get_unreconciled_age_counts(p_analysis_id uuid,p_cutoff date,p_exclude_opening boolean default true)
returns table(all_count bigint,d0_count bigint,up_to_1_count bigint,up_to_2_count bigint,at_least_1_count bigint,at_least_2_count bigint,at_least_3_count bigint)
language sql stable security invoker set search_path=public as $$
 select count(*)::bigint,count(*) filter(where movement_date=p_cutoff)::bigint,count(*) filter(where movement_date between p_cutoff-1 and p_cutoff)::bigint,
 count(*) filter(where movement_date between p_cutoff-2 and p_cutoff)::bigint,count(*) filter(where movement_date<=p_cutoff-1)::bigint,
 count(*) filter(where movement_date<=p_cutoff-2)::bigint,count(*) filter(where movement_date<=p_cutoff-3)::bigint
 from public.movements where analysis_id=p_analysis_id and status='unreconciled' and (not p_exclude_opening or not opening_boundary);
$$;
grant execute on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) to authenticated;
grant execute on function public.refresh_reconciliation_daily_metrics(uuid) to authenticated;
grant execute on function public.get_unreconciled_age_counts(uuid,date,boolean) to authenticated;
