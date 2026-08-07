create or replace function private.auto_close_rt_v2_single_idtr_proposals(p_series_id uuid,p_refresh_metrics boolean default true)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_rule constant text:='rt-v2.1.0';v_count bigint:=0;v_dates date[];
begin
  perform pg_advisory_xact_lock(hashtextextended('rt-v2-single-idtr-proposals:'||p_series_id::text,0));
  create temporary table rt_v2_single_idtr_proposals(proposal_id uuid,idtr text,movement_count integer,balance numeric,first_date date,last_date date) on commit drop;
  create temporary table rt_v2_single_idtr_groups(group_id uuid,proposal_id uuid) on commit drop;
  insert into rt_v2_single_idtr_proposals
  select p.id,min(m.native_idtr),count(*)::integer,round(sum(m.amount)::numeric,2),min(m.accounting_date),max(m.accounting_date)
  from public.rt_v2_reconciliation_proposals p join public.rt_v2_proposal_movements pm on pm.proposal_id=p.id join public.rt_v2_movements m on m.id=pm.movement_id
  where p.series_id=p_series_id and p.status='pending' and m.status='open'
  group by p.id,p.movement_count having count(*)=p.movement_count and count(*)>=2 and count(*) filter(where m.native_idtr is null)=0 and count(distinct m.native_idtr)=1 and abs(round(sum(m.amount)::numeric,2))<=0.005;
  with inserted as (
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay,justification)
    select p_series_id,'idtr',idtr,v_rule,movement_count,balance,first_date,last_date,private.rt_v2_working_days(first_date,last_date),'Subconjunto inequívoco com o mesmo IDTR e saldo zero' from rt_v2_single_idtr_proposals returning id,reconciliation_key
  ) insert into rt_v2_single_idtr_groups
    select i.id,p.proposal_id from inserted i join rt_v2_single_idtr_proposals p on p.idtr=i.reconciliation_key;
  insert into public.rt_v2_group_movements(group_id,movement_id)
  select g.group_id,pm.movement_id from rt_v2_single_idtr_groups g join public.rt_v2_proposal_movements pm on pm.proposal_id=g.proposal_id;
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='idtr',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm join rt_v2_single_idtr_groups g on g.group_id=gm.group_id where gm.movement_id=m.id and m.status='open';
  get diagnostics v_count=row_count;
  update public.rt_v2_reconciliation_proposals p set status='approved',reviewed_at=now(),review_note='Confirmação automática: todas as linhas têm o mesmo IDTR e saldo zero.',updated_at=now()
  where p.id in(select proposal_id from rt_v2_single_idtr_proposals);
  select array_agg(distinct d) into v_dates from (select first_date d from rt_v2_single_idtr_proposals union select last_date from rt_v2_single_idtr_proposals) q;
  if p_refresh_metrics and v_count>0 then perform private.rt_v2_refresh_after_proposal_decision(p_series_id,v_dates); end if;
  return jsonb_build_object('status','completed','movements',v_count,'proposals',(select count(*) from rt_v2_single_idtr_proposals));
end;$$;
alter function private.auto_close_rt_v2_single_idtr_proposals(uuid,boolean) set statement_timeout='0';

create or replace function private.rt_v2_refresh_proposals_on_calculation()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare i integer;
begin
  if new.state='calculating' and old.state is distinct from new.state then
    for i in 0..15 loop perform private.auto_close_rt_v2_unique_comparable_pairs(new.series_id,i,16,new.id); end loop;
    perform private.refresh_rt_v2_reconciliation_proposals(new.series_id,new.id);
    perform private.auto_close_rt_v2_single_idtr_proposals(new.series_id,false);
    perform private.refresh_rt_v2_reconciliation_proposals(new.series_id,new.id);
  end if;
  return new;
end;$$;
