alter table public.import_batches alter column total_buckets set default 512;

create index if not exists movements_analysis_idtr_bucket512_idx
on public.movements (analysis_id,(mod(abs(hashtext(idtr)::bigint),512)),idtr)
include (amount,accounting_date,movement_date)
where idtr is not null;

create or replace function public.refresh_accumulated_reconciliation_bucket(p_analysis_id uuid,p_bucket integer,p_bucket_count integer default 512)
returns bigint language plpgsql security definer set search_path=public as $$
declare changed_rows bigint; first_day date;
begin
  select a.period_start into first_day from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin());
  if first_day is null then raise exception 'Análise inexistente ou sem período inicial.'; end if;
  if p_bucket<0 or p_bucket>=p_bucket_count then raise exception 'Bloco inválido.'; end if;
  with balances as (
    select m.idtr,count(*) n,abs(round(sum(m.amount)::numeric,2))<=0.005 closes,max(coalesce(m.accounting_date,m.movement_date)) last_seen
    from public.movements m where m.analysis_id=p_analysis_id and m.idtr is not null and mod(abs(hashtext(m.idtr)::bigint),512)=p_bucket group by m.idtr
  )
  update public.movements movement set
    status=case when balances.n>=2 and balances.closes then 'automatic'::public.reconciliation_status else 'unreconciled'::public.reconciliation_status end,
    opening_boundary=(not (balances.n>=2 and balances.closes) and balances.last_seen<=first_day+2),
    reconciliation_method=case when balances.n>=2 and balances.closes then 'idtr' else null end,
    reconciliation_key=case when balances.n>=2 and balances.closes then balances.idtr else null end,
    reconciliation_rule_version=case when balances.n>=2 and balances.closes then 'rt-v2' else null end
  from balances where p_bucket_count=512 and movement.analysis_id=p_analysis_id and movement.idtr=balances.idtr and movement.status in ('automatic','unreconciled');
  get diagnostics changed_rows=row_count; return changed_rows;
end; $$;
revoke all on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) from public,anon;
grant execute on function public.refresh_accumulated_reconciliation_bucket(uuid,integer,integer) to authenticated;
