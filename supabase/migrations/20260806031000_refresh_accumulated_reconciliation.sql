create or replace function public.refresh_accumulated_reconciliation(p_analysis_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_rows bigint;
begin
  if not exists (
    select 1 from public.analyses a
    where a.id = p_analysis_id
      and (a.created_by = auth.uid() or private.is_admin())
  ) then
    raise exception 'Sem permissão para recalcular esta análise.';
  end if;

  with balances as (
    select idtr, abs(round(sum(amount)::numeric, 2)) <= 0.005 as closes
    from public.movements
    where analysis_id = p_analysis_id and idtr is not null
    group by idtr
  )
  update public.movements movement
  set status = case when balances.closes then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end
  from balances
  where movement.analysis_id = p_analysis_id
    and movement.idtr = balances.idtr
    and movement.status in ('automatic', 'unreconciled')
    and movement.status is distinct from case when balances.closes then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end;

  get diagnostics changed_rows = row_count;

  insert into public.daily_metrics
    (analysis_id, metric_date, movements, automatic, unreconciled, missing_idtr, amount)
  select p_analysis_id, coalesce(movement_date, accounting_date), count(*)::integer,
    count(*) filter (where status = 'automatic')::integer,
    count(*) filter (where status = 'unreconciled')::integer,
    count(*) filter (where status = 'missing_idtr')::integer,
    coalesce(sum(amount), 0)
  from public.movements
  where analysis_id = p_analysis_id and coalesce(movement_date, accounting_date) is not null
  group by coalesce(movement_date, accounting_date)
  on conflict (analysis_id, metric_date) do update set
    movements = excluded.movements, automatic = excluded.automatic,
    unreconciled = excluded.unreconciled, missing_idtr = excluded.missing_idtr,
    amount = excluded.amount;

  return changed_rows;
end;
$$;

revoke all on function public.refresh_accumulated_reconciliation(uuid) from public;
grant execute on function public.refresh_accumulated_reconciliation(uuid) to authenticated;
