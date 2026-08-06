create or replace function public.refresh_reconciliation_dashboard_summary(p_analysis_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_summary jsonb;
begin
  if not exists(select 1 from public.analyses a where a.id=p_analysis_id and (a.created_by=auth.uid() or private.is_admin())) then raise exception 'Sem permissão.'; end if;

  with base as (
    select m.*,
      case
        when description_normalized like '%comiss%' then 'commission'
        when description_normalized like '%atm%' then 'atm'
        when description_normalized like '%pos%' then 'pos'
        when description_normalized like '%transf%' or description_normalized like '%trf%' or description_normalized like '% nib%' or description_normalized like '%hbmb%' then 'transfer'
        when description_normalized like '%servic%' or description_normalized like '%pagamento%' then 'service'
        else 'other'
      end movement_type,
      max(coalesce(accounting_date,movement_date)) over() cutoff
    from public.movements m where analysis_id=p_analysis_id
  ), type_rows as (
    select movement_type,count(*) total,count(*) filter(where status in ('automatic','manual')) reconciled,
      count(*) filter(where status='unreconciled') unreconciled,count(*) filter(where status='missing_idtr') missing
    from base group by movement_type
  ), age_rows as (
    select case
      when cutoff-coalesce(accounting_date,movement_date)=0 then 'D+0'
      when cutoff-coalesce(accounting_date,movement_date)=1 then 'D+1'
      when cutoff-coalesce(accounting_date,movement_date)=2 then 'D+2'
      when cutoff-coalesce(accounting_date,movement_date)=3 then 'D+3'
      when cutoff-coalesce(accounting_date,movement_date)<=7 then 'D+4–7' else 'D+8+' end bucket,
      count(*) total,count(*) filter(where status='automatic') automatic,
      count(*) filter(where status in ('unreconciled','missing_idtr')) unreconciled,round(sum(amount)::numeric,2) amount
    from base group by 1
  ), idtr_delays as (
    select idtr,max(coalesce(accounting_date,movement_date))-min(coalesce(accounting_date,movement_date)) delay
    from base where reconciliation_method='idtr' group by idtr
  ), timing as (
    select count(*) total_groups,coalesce(avg(delay),0) average_days,
      count(*) filter(where delay=0) d0,count(*) filter(where delay=1) d1,count(*) filter(where delay=2) d2,
      count(*) filter(where delay=3) d3,count(*) filter(where delay>3) d4
    from idtr_delays
  ), method_rows as (
    select reconciliation_method,count(*) movement_count from base
    where status='automatic' and reconciliation_method is not null group by reconciliation_method
  ), ordered as (
    select amount,balance,row_number() over(order by accounting_date,movement_date,movement_time,source_row,id) first_n,
      row_number() over(order by accounting_date desc,movement_date desc,movement_time desc,source_row desc,id desc) last_n
    from base
  ), aggregate_values as (
    select count(*) movements,count(*) filter(where status='automatic') automatic,count(*) filter(where status='manual') manual,
      count(*) filter(where status='unreconciled') unreconciled,count(*) filter(where status='missing_idtr') missing,
      round(sum(amount)::numeric,2) net,round((sum(abs(amount)) filter(where amount<0))::numeric,2) debits,
      round((sum(amount) filter(where amount>0))::numeric,2) credits,min(coalesce(accounting_date,movement_date)) first_day,
      max(coalesce(accounting_date,movement_date)) last_day from base
  ), balances as (
    select max(balance-amount) filter(where first_n=1) opening_balance,max(balance) filter(where last_n=1) closing_balance from ordered
  )
  select coalesce(a.result_summary,'{}'::jsonb) || jsonb_build_object(
    'periodStart',v.first_day,'reportDate',v.last_day,'accountingBalance',b.closing_balance,
    'totals',jsonb_build_object('movements',v.movements,'automatic',v.automatic,'manual',v.manual,'unreconciled',v.unreconciled,'missingIdtr',v.missing,'amount',v.net),
    'rawAmounts',jsonb_build_object('debits',v.debits,'credits',v.credits,'net',v.net,'openingBalance',b.opening_balance,'closingBalance',b.closing_balance),
    'movementTypes',coalesce((select jsonb_object_agg(movement_type,jsonb_build_object('total',total,'reconciled',reconciled,'unreconciled',unreconciled,'missingIdtr',missing)) from type_rows),'{}'::jsonb),
    'ageBuckets',coalesce((select jsonb_object_agg(bucket,jsonb_build_object('total',total,'automatic',automatic,'unreconciled',unreconciled,'amount',amount)) from age_rows),'{}'::jsonb),
    'reconciliationTiming',(select jsonb_build_object('averageDays',average_days,'totalGroups',total_groups,'buckets',jsonb_build_object('D+0',d0,'D+1',d1,'D+2',d2,'D+3',d3,'D+4+',d4)) from timing),
    'reconciliationMethods',coalesce((select jsonb_object_agg(reconciliation_method,movement_count) from method_rows),'{}'::jsonb)
  ) into v_summary
  from public.analyses a cross join aggregate_values v cross join balances b where a.id=p_analysis_id;

  update public.analyses set result_summary=v_summary,period_start=(v_summary->>'periodStart')::date,
    current_report_date=(v_summary->>'reportDate')::date,accounting_balance=(v_summary->>'accountingBalance')::numeric,
    status='completed',updated_at=now() where id=p_analysis_id;
  return v_summary;
end; $$;

revoke execute on function public.refresh_reconciliation_dashboard_summary(uuid) from public,anon;
grant execute on function public.refresh_reconciliation_dashboard_summary(uuid) to authenticated;
