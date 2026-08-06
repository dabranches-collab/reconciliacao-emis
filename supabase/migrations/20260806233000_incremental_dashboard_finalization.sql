create or replace function public.refresh_reconciliation_dashboard_section(
  p_analysis_id uuid,
  p_section text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_patch jsonb := '{}'::jsonb;
  v_role text := current_setting('request.jwt.claim.role',true);
begin
  if v_role <> 'service_role' and not exists(
    select 1 from public.analyses a
    where a.id=p_analysis_id
      and (a.created_by=auth.uid() or private.is_admin())
  ) then raise exception 'Sem permissão.'; end if;

  if p_section='totals' then
    select jsonb_build_object(
      'periodStart',min(coalesce(accounting_date,movement_date)),
      'reportDate',max(coalesce(accounting_date,movement_date)),
      'totals',jsonb_build_object(
        'movements',count(*),
        'automatic',count(*) filter(where status='automatic'),
        'manual',count(*) filter(where status='manual'),
        'unreconciled',count(*) filter(where status='unreconciled'),
        'missingIdtr',count(*) filter(where status='missing_idtr'),
        'amount',round(coalesce(sum(amount),0)::numeric,2)
      ),
      'rawAmounts',jsonb_build_object(
        'debits',round(coalesce(sum(abs(amount)) filter(where amount<0),0)::numeric,2),
        'credits',round(coalesce(sum(amount) filter(where amount>0),0)::numeric,2),
        'net',round(coalesce(sum(amount),0)::numeric,2)
      )
    ) into v_patch from public.movements where analysis_id=p_analysis_id;
  elsif p_section='movement_types' then
    with rows as (
      select case
        when description_normalized like '%comiss%' then 'commission'
        when description_normalized like '%atm%' then 'atm'
        when description_normalized like '%pos%' then 'pos'
        when description_normalized like '%transf%' or description_normalized like '%trf%' or description_normalized like '% nib%' or description_normalized like '%hbmb%' then 'transfer'
        when description_normalized like '%servic%' or description_normalized like '%pagamento%' then 'service'
        else 'other' end movement_type,
        count(*) total,count(*) filter(where status in ('automatic','manual')) reconciled,
        count(*) filter(where status='unreconciled') unreconciled,
        count(*) filter(where status='missing_idtr') missing
      from public.movements where analysis_id=p_analysis_id group by 1
    ) select jsonb_build_object('movementTypes',coalesce(jsonb_object_agg(movement_type,
      jsonb_build_object('total',total,'reconciled',reconciled,'unreconciled',unreconciled,'missingIdtr',missing)),'{}'::jsonb))
      into v_patch from rows;
  elsif p_section='age' then
    with cutoff as (select max(coalesce(accounting_date,movement_date)) day from public.movements where analysis_id=p_analysis_id), rows as (
      select case when c.day-coalesce(m.accounting_date,m.movement_date)=0 then 'D+0'
        when c.day-coalesce(m.accounting_date,m.movement_date)=1 then 'D+1'
        when c.day-coalesce(m.accounting_date,m.movement_date)=2 then 'D+2'
        when c.day-coalesce(m.accounting_date,m.movement_date)=3 then 'D+3'
        when c.day-coalesce(m.accounting_date,m.movement_date)<=7 then 'D+4–7' else 'D+8+' end bucket,
        count(*) total,count(*) filter(where status='automatic') automatic,
        count(*) filter(where status in ('unreconciled','missing_idtr')) unreconciled,
        round(coalesce(sum(amount),0)::numeric,2) amount
      from public.movements m cross join cutoff c where m.analysis_id=p_analysis_id group by 1
    ) select jsonb_build_object('ageBuckets',coalesce(jsonb_object_agg(bucket,
      jsonb_build_object('total',total,'automatic',automatic,'unreconciled',unreconciled,'amount',amount)),'{}'::jsonb))
      into v_patch from rows;
  elsif p_section='timing' then
    with delays as (
      select idtr,max(coalesce(accounting_date,movement_date))-min(coalesce(accounting_date,movement_date)) delay
      from public.movements where analysis_id=p_analysis_id and reconciliation_method='idtr' and idtr is not null group by idtr
    ) select jsonb_build_object('reconciliationTiming',jsonb_build_object(
      'averageDays',coalesce(avg(delay),0),'totalGroups',count(*),'buckets',jsonb_build_object(
        'D+0',count(*) filter(where delay=0),'D+1',count(*) filter(where delay=1),
        'D+2',count(*) filter(where delay=2),'D+3',count(*) filter(where delay=3),
        'D+4+',count(*) filter(where delay>3)))) into v_patch from delays;
  elsif p_section='methods' then
    with rows as (
      select reconciliation_method,count(*) movement_count from public.movements
      where analysis_id=p_analysis_id and status='automatic' and reconciliation_method is not null group by reconciliation_method
    ) select jsonb_build_object('reconciliationMethods',coalesce(jsonb_object_agg(reconciliation_method,movement_count),'{}'::jsonb))
      into v_patch from rows;
  elsif p_section='balances' then
    with first_row as (
      select balance-amount opening_balance from public.movements where analysis_id=p_analysis_id
      order by accounting_date,movement_date,movement_time,source_row,id limit 1
    ), last_row as (
      select balance closing_balance from public.movements where analysis_id=p_analysis_id
      order by accounting_date desc,movement_date desc,movement_time desc,source_row desc,id desc limit 1
    ) select jsonb_build_object('accountingBalance',l.closing_balance,'rawAmounts',
      coalesce(a.result_summary->'rawAmounts','{}'::jsonb)||jsonb_build_object('openingBalance',f.opening_balance,'closingBalance',l.closing_balance))
      into v_patch from public.analyses a cross join first_row f cross join last_row l where a.id=p_analysis_id;
  else raise exception 'Secção inválida: %',p_section; end if;

  update public.analyses set result_summary=coalesce(result_summary,'{}'::jsonb)||coalesce(v_patch,'{}'::jsonb),
    period_start=coalesce((v_patch->>'periodStart')::date,period_start),
    current_report_date=coalesce((v_patch->>'reportDate')::date,current_report_date),
    accounting_balance=coalesce((v_patch->>'accountingBalance')::numeric,accounting_balance),updated_at=now()
  where id=p_analysis_id;
  return coalesce(v_patch,'{}'::jsonb);
end;
$$;

revoke execute on function public.refresh_reconciliation_dashboard_section(uuid,text) from public,anon;
grant execute on function public.refresh_reconciliation_dashboard_section(uuid,text) to authenticated,service_role;

create index if not exists movements_analysis_order_idx on public.movements
  (analysis_id,accounting_date,movement_date,movement_time,source_row,id);

create index if not exists movements_analysis_method_idtr_idx on public.movements
  (analysis_id,reconciliation_method,idtr) where reconciliation_method='idtr';
