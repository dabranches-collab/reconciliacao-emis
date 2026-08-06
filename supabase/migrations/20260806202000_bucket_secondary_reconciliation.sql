create index if not exists movements_analysis_ref26_bucket64_idx on public.movements
(analysis_id,(mod(abs(hashtext(coalesce(reference_26,substring(idtr from 6))))::bigint,64)))
include (reference_26,idtr,amount) where reference_26 is not null or idtr like 'IDTR=26%';

create index if not exists movements_analysis_operation_bucket64_idx on public.movements
(analysis_id,(mod(abs(hashtext(operation_number||'|'||description_normalized||'|'||abs(amount)::text))::bigint,64)))
include (operation_number,description_normalized,amount,accounting_date,movement_date,movement_time,id)
where status in ('unreconciled','missing_idtr') and amount<>0 and operation_number<>'' and description_normalized<>'';

create or replace function public.refresh_secondary_reconciliation_bucket(p_analysis_id uuid,p_stage text,p_bucket integer,p_bucket_count integer default 64)
returns bigint language plpgsql security definer set search_path=public as $$
declare changed_rows bigint;
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;
  if p_bucket<0 or p_bucket>=p_bucket_count or p_bucket_count<>64 then raise exception 'Configuração de bloco inválida.'; end if;
  if p_stage='reference' then
    with closing_refs as (
      select ref from (select coalesce(m.reference_26,substring(m.idtr from 6)) ref,count(*) n,round(sum(m.amount)::numeric,2) balance
      from public.movements m where m.analysis_id=p_analysis_id and (m.reference_26 is not null or m.idtr like 'IDTR=26%')
        and mod(abs(hashtext(coalesce(m.reference_26,substring(m.idtr from 6))))::bigint,64)=p_bucket
      group by coalesce(m.reference_26,substring(m.idtr from 6))) grouped where n>=2 and abs(balance)<=0.005)
    update public.movements m set status='automatic',reconciliation_method='observation_reference',reconciliation_key='REF26:'||r.ref,reconciliation_rule_version='rt-v2'
    from closing_refs r where m.analysis_id=p_analysis_id and (m.reference_26=r.ref or m.idtr='IDTR='||r.ref) and m.status in ('unreconciled','missing_idtr');
  elsif p_stage='operation' then
    with candidates as (
      select m.id,m.operation_number,m.description_normalized,abs(m.amount) amount_abs,case when m.amount>0 then 1 else -1 end sign,
        row_number() over(partition by m.operation_number,m.description_normalized,abs(m.amount),case when m.amount>0 then 1 else -1 end order by m.accounting_date,m.movement_date,m.movement_time,m.id) pair_number
      from public.movements m where m.analysis_id=p_analysis_id and m.status in ('unreconciled','missing_idtr') and m.amount<>0 and m.operation_number<>'' and m.description_normalized<>''
        and mod(abs(hashtext(m.operation_number||'|'||m.description_normalized||'|'||abs(m.amount)::text))::bigint,64)=p_bucket
    ), pairs as (select p.id positive_id,n.id negative_id,p.operation_number,p.description_normalized,p.amount_abs,p.pair_number from candidates p join candidates n on n.operation_number=p.operation_number and n.description_normalized=p.description_normalized and n.amount_abs=p.amount_abs and n.pair_number=p.pair_number where p.sign=1 and n.sign=-1),
    matched as (select positive_id id,'OP:'||operation_number||':'||md5(description_normalized)||':'||amount_abs::text||':'||pair_number::text key from pairs union all select negative_id,'OP:'||operation_number||':'||md5(description_normalized)||':'||amount_abs::text||':'||pair_number::text from pairs)
    update public.movements m set status='automatic',reconciliation_method='operation_description',reconciliation_key=matched.key,reconciliation_rule_version='rt-v2' from matched where m.id=matched.id;
  else raise exception 'Fase secundária inválida.';
  end if;
  get diagnostics changed_rows=row_count; return changed_rows;
end; $$;
revoke all on function public.refresh_secondary_reconciliation_bucket(uuid,text,integer,integer) from public,anon;
grant execute on function public.refresh_secondary_reconciliation_bucket(uuid,text,integer,integer) to authenticated;
