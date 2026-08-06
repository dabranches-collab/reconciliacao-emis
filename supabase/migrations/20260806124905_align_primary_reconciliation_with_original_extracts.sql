create or replace function public.refresh_accumulated_reconciliation_bucket(p_analysis_id uuid,p_bucket integer,p_bucket_count integer default 16)
returns bigint language plpgsql security definer set search_path=public as $$
declare changed_rows bigint;
begin
  if p_bucket<0 or p_bucket>=p_bucket_count then raise exception 'Bloco inválido.'; end if;
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  with bounds as (select min(coalesce(accounting_date,movement_date)) first_day from public.movements where analysis_id=p_analysis_id), balances as (
    select m.idtr,count(*) n,abs(round(sum(m.amount)::numeric,2))<=0.005 closes,max(coalesce(m.accounting_date,m.movement_date)) last_seen,bounds.first_day
    from public.movements m cross join bounds where m.analysis_id=p_analysis_id and m.idtr is not null and mod(abs(hashtext(m.idtr)::bigint),p_bucket_count)=p_bucket group by m.idtr,bounds.first_day
  )
  update public.movements movement set
    status=case when balances.n>=2 and balances.closes then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end,
    opening_boundary=(not (balances.n>=2 and balances.closes) and balances.last_seen<=balances.first_day+2),
    reconciliation_method=case when balances.n>=2 and balances.closes then 'idtr' else null end,
    reconciliation_key=case when balances.n>=2 and balances.closes then balances.idtr else null end,
    reconciliation_rule_version=case when balances.n>=2 and balances.closes then 'rt-v2' else null end
  from balances where movement.analysis_id=p_analysis_id and movement.idtr=balances.idtr and movement.status in ('automatic','unreconciled');
  get diagnostics changed_rows=row_count; return changed_rows;
end; $$;
revoke all on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) from public;
grant execute on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) to authenticated;
