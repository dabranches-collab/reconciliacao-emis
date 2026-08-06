create or replace function public.refresh_accumulated_reconciliation_bucket(p_analysis_id uuid,p_bucket integer,p_bucket_count integer default 512)
returns bigint language plpgsql security definer set search_path=public as $$
declare changed_rows bigint; first_day date;
begin
  select a.period_start into first_day from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin());
  if first_day is null then raise exception 'Análise inexistente ou sem período inicial.'; end if;
  if p_bucket<0 or p_bucket>=p_bucket_count or p_bucket_count<>512 then raise exception 'Configuração de bloco inválida.'; end if;
  with balances as (
    select m.idtr,count(*) n,abs(round(sum(m.amount)::numeric,2))<=0.005 closes,max(coalesce(m.accounting_date,m.movement_date)) last_seen
    from public.movements m where m.analysis_id=p_analysis_id and m.idtr is not null and mod(abs(hashtext(m.idtr)::bigint),512)=p_bucket group by m.idtr
  ), desired as (
    select *,n>=2 and closes reconciled,not (n>=2 and closes) and last_seen<=first_day+2 is_opening from balances
  )
  update public.movements movement set
    status=case when desired.reconciled then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end,
    opening_boundary=desired.is_opening,
    reconciliation_method=case when desired.reconciled then 'idtr' else null end,
    reconciliation_key=case when desired.reconciled then desired.idtr else null end,
    reconciliation_rule_version=case when desired.reconciled then 'rt-v2' else null end
  from desired where movement.analysis_id=p_analysis_id and movement.idtr=desired.idtr and movement.status in ('automatic','unreconciled')
    and (movement.status is distinct from case when desired.reconciled then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end
      or movement.opening_boundary is distinct from desired.is_opening
      or movement.reconciliation_method is distinct from case when desired.reconciled then 'idtr' else null end
      or movement.reconciliation_key is distinct from case when desired.reconciled then desired.idtr else null end
      or movement.reconciliation_rule_version is distinct from case when desired.reconciled then 'rt-v2' else null end);
  get diagnostics changed_rows=row_count; return changed_rows;
end; $$;
revoke all on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) from public,anon;
grant execute on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) to authenticated;
