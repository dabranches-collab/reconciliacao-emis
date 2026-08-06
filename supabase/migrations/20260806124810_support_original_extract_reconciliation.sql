alter table public.movements
  add column if not exists observations text,
  add column if not exists reference_26 text,
  add column if not exists description_normalized text,
  add column if not exists reconciliation_method text,
  add column if not exists reconciliation_key text,
  add column if not exists reconciliation_rule_version text;

create index if not exists movements_analysis_reference26_idx on public.movements (analysis_id,reference_26) where reference_26 is not null;
create index if not exists movements_secondary_match_idx on public.movements (analysis_id,operation_number,description_normalized,accounting_date,amount) where status in ('unreconciled','missing_idtr');
create index if not exists movements_accounting_pending_idx on public.movements (analysis_id,status,accounting_date) where opening_boundary=false;

create or replace function public.refresh_secondary_reconciliation(p_analysis_id uuid)
returns bigint language plpgsql security definer set search_path=public as $$
declare changed_rows bigint:=0; stage_rows bigint:=0;
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  with closing_refs as (
    select ref from (
      select coalesce(m.reference_26,substring(m.idtr from 6)) ref,count(*) n,round(sum(m.amount)::numeric,2) balance
      from public.movements m where m.analysis_id=p_analysis_id and (m.reference_26 is not null or m.idtr like 'IDTR=26%')
      group by coalesce(m.reference_26,substring(m.idtr from 6))
    ) grouped where n>=2 and abs(balance)<=0.005
  )
  update public.movements m set status='automatic',reconciliation_method='observation_reference',reconciliation_key='REF26:'||r.ref,reconciliation_rule_version='rt-v2'
  from closing_refs r where m.analysis_id=p_analysis_id and (m.reference_26=r.ref or m.idtr='IDTR='||r.ref) and m.status in ('unreconciled','missing_idtr');
  get diagnostics stage_rows=row_count; changed_rows:=changed_rows+stage_rows;
  with candidates as (
    select m.id,m.operation_number,m.description_normalized,abs(m.amount) amount_abs,case when m.amount>0 then 1 else -1 end sign,
      row_number() over(partition by m.operation_number,m.description_normalized,abs(m.amount),case when m.amount>0 then 1 else -1 end order by m.accounting_date,m.movement_date,m.movement_time,m.id) pair_number
    from public.movements m where m.analysis_id=p_analysis_id and m.status in ('unreconciled','missing_idtr') and m.amount<>0 and coalesce(m.operation_number,'')<>'' and coalesce(m.description_normalized,'')<>''
  ), pairs as (
    select p.id positive_id,n.id negative_id,p.operation_number,p.description_normalized,p.amount_abs,p.pair_number
    from candidates p join candidates n on n.operation_number=p.operation_number and n.description_normalized=p.description_normalized and n.amount_abs=p.amount_abs and n.pair_number=p.pair_number where p.sign=1 and n.sign=-1
  ), matched as (
    select positive_id id,'OP:'||operation_number||':'||md5(description_normalized)||':'||amount_abs::text||':'||pair_number::text key from pairs
    union all select negative_id,'OP:'||operation_number||':'||md5(description_normalized)||':'||amount_abs::text||':'||pair_number::text from pairs
  )
  update public.movements m set status='automatic',reconciliation_method='operation_description',reconciliation_key=matched.key,reconciliation_rule_version='rt-v2' from matched where m.id=matched.id;
  get diagnostics stage_rows=row_count; changed_rows:=changed_rows+stage_rows; return changed_rows;
end; $$;
revoke all on function public.refresh_secondary_reconciliation(uuid) from public;
grant execute on function public.refresh_secondary_reconciliation(uuid) to authenticated;

create or replace function public.refresh_reconciliation_daily_metrics(p_analysis_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  delete from public.daily_metrics where analysis_id=p_analysis_id;
  insert into public.daily_metrics(analysis_id,metric_date,movements,automatic,unreconciled,missing_idtr,amount)
  select p_analysis_id,coalesce(accounting_date,movement_date),count(*)::integer,count(*) filter(where status='automatic')::integer,count(*) filter(where status='unreconciled')::integer,count(*) filter(where status='missing_idtr')::integer,coalesce(sum(amount),0)
  from public.movements where analysis_id=p_analysis_id and coalesce(accounting_date,movement_date) is not null group by coalesce(accounting_date,movement_date);
end; $$;

create or replace function public.get_unreconciled_age_counts(p_analysis_id uuid,p_cutoff date,p_exclude_opening boolean default true)
returns table(all_count bigint,d0_count bigint,up_to_1_count bigint,up_to_2_count bigint,at_least_1_count bigint,at_least_2_count bigint,at_least_3_count bigint)
language sql stable security invoker set search_path=public as $$
 select count(*)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)=p_cutoff)::bigint,count(*) filter(where coalesce(accounting_date,movement_date) between p_cutoff-1 and p_cutoff)::bigint,count(*) filter(where coalesce(accounting_date,movement_date) between p_cutoff-2 and p_cutoff)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)<=p_cutoff-1)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)<=p_cutoff-2)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)<=p_cutoff-3)::bigint
 from public.movements where analysis_id=p_analysis_id and status in ('unreconciled','missing_idtr') and (not p_exclude_opening or not opening_boundary);
$$;
grant execute on function public.get_unreconciled_age_counts(uuid,date,boolean) to authenticated;

