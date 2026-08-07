-- Fila auditavel para criterios contabilisticos secundarios. O IDTR e os pares
-- exatos continuam automaticos; grupos agregados ficam pendentes de validacao.

alter table public.rt_v2_movements drop constraint rt_v2_movements_reconciliation_method_check;
alter table public.rt_v2_movements add constraint rt_v2_movements_reconciliation_method_check
  check (reconciliation_method in ('idtr','operation','operation_description','reference_26','manual'));
alter table public.rt_v2_reconciliation_groups drop constraint rt_v2_reconciliation_groups_method_check;
alter table public.rt_v2_reconciliation_groups add constraint rt_v2_reconciliation_groups_method_check
  check (method in ('idtr','operation','operation_description','reference_26','manual'));

create table public.rt_v2_reconciliation_proposals (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.rt_v2_series(id) on delete cascade,
  generated_by_import_id uuid references public.rt_v2_imports(id) on delete set null,
  method text not null check (method in ('operation','operation_description')),
  reconciliation_key text not null,
  rule_version text not null,
  movement_count integer not null check (movement_count >= 2),
  balance numeric(20,2) not null check (abs(balance) <= 0.005),
  first_accounting_date date not null,
  last_accounting_date date not null,
  operational_delay integer not null default 0 check (operational_delay >= 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rt_v2_proposals_pending_key_idx on public.rt_v2_reconciliation_proposals(series_id,method,reconciliation_key) where status='pending';
create index rt_v2_proposals_queue_idx on public.rt_v2_reconciliation_proposals(series_id,status,operational_delay desc,created_at);

create table public.rt_v2_proposal_movements (
  proposal_id uuid not null references public.rt_v2_reconciliation_proposals(id) on delete cascade,
  movement_id bigint not null references public.rt_v2_movements(id) on delete restrict,
  primary key (proposal_id,movement_id)
);
create index rt_v2_proposal_movements_movement_idx on public.rt_v2_proposal_movements(movement_id);

alter table public.rt_v2_reconciliation_proposals enable row level security;
alter table public.rt_v2_proposal_movements enable row level security;
create policy rt_v2_proposals_read on public.rt_v2_reconciliation_proposals for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_proposal_movements_read on public.rt_v2_proposal_movements for select to authenticated using ((select private.is_active_user()));
revoke all on public.rt_v2_reconciliation_proposals,public.rt_v2_proposal_movements from anon;
grant select on public.rt_v2_reconciliation_proposals,public.rt_v2_proposal_movements to authenticated;

create or replace function private.refresh_rt_v2_reconciliation_proposals(p_series_id uuid,p_import_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_rule constant text:='rt-v2.1.0';v_operation bigint:=0;v_description bigint:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('rt-v2-proposals:'||p_series_id::text,0));
  update public.rt_v2_reconciliation_proposals set status='superseded',updated_at=now()
  where series_id=p_series_id and status='pending';

  create temporary table rt_v2_operation_proposals(id uuid,operation_number text) on commit drop;
  with candidates as (
    select operation_number,count(*) movement_count,round(sum(amount)::numeric,2) balance,
      min(accounting_date) first_date,max(accounting_date) last_date
    from public.rt_v2_movements
    where series_id=p_series_id and status='open' and coalesce(operation_number,'')<>''
    group by operation_number having count(*)>=2 and abs(round(sum(amount)::numeric,2))<=0.005
  ), inserted as (
    insert into public.rt_v2_reconciliation_proposals(series_id,generated_by_import_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay)
    select p_series_id,p_import_id,'operation',operation_number,v_rule,movement_count,balance,first_date,last_date,private.rt_v2_working_days(first_date,last_date)
    from candidates returning id,reconciliation_key
  ) insert into rt_v2_operation_proposals select id,reconciliation_key from inserted;
  insert into public.rt_v2_proposal_movements(proposal_id,movement_id)
  select p.id,m.id from rt_v2_operation_proposals p join public.rt_v2_movements m on m.series_id=p_series_id and m.status='open' and m.operation_number=p.operation_number;
  get diagnostics v_operation=row_count;

  create temporary table rt_v2_description_proposals(id uuid,reconciliation_key text) on commit drop;
  with residual as (
    select m.*,trim(regexp_replace(coalesce(m.description_normalized,''),'^anl[- ]*','','i')) comparison_description
    from public.rt_v2_movements m
    where m.series_id=p_series_id and m.status='open' and coalesce(m.operation_number,'')<>'' and coalesce(m.description_normalized,'')<>''
      and not exists(select 1 from public.rt_v2_proposal_movements pm join rt_v2_operation_proposals p on p.id=pm.proposal_id where pm.movement_id=m.id)
  ), candidates as (
    select operation_number,comparison_description,count(*) movement_count,round(sum(amount)::numeric,2) balance,min(accounting_date) first_date,max(accounting_date) last_date
    from residual group by operation_number,comparison_description
    having count(*)>=2 and comparison_description<>'' and abs(round(sum(amount)::numeric,2))<=0.005
  ), inserted as (
    insert into public.rt_v2_reconciliation_proposals(series_id,generated_by_import_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay)
    select p_series_id,p_import_id,'operation_description',concat_ws(chr(31),operation_number,comparison_description),v_rule,movement_count,balance,first_date,last_date,private.rt_v2_working_days(first_date,last_date)
    from candidates returning id,reconciliation_key
  ) insert into rt_v2_description_proposals select id,reconciliation_key from inserted;
  insert into public.rt_v2_proposal_movements(proposal_id,movement_id)
  select p.id,m.id from rt_v2_description_proposals p join public.rt_v2_movements m on m.series_id=p_series_id and m.status='open'
   and concat_ws(chr(31),m.operation_number,trim(regexp_replace(coalesce(m.description_normalized,''),'^anl[- ]*','','i')))=p.reconciliation_key;
  get diagnostics v_description=row_count;
  return jsonb_build_object('status','refreshed','operationMovements',v_operation,'descriptionMovements',v_description);
end;$$;
alter function private.refresh_rt_v2_reconciliation_proposals(uuid,uuid) set statement_timeout='0';

create or replace function private.rt_v2_refresh_after_proposal_decision(p_series_id uuid,p_dates date[])
returns void language plpgsql security definer set search_path=public,private as $$
declare v_rule constant text:='rt-v2.1.0';
begin
  delete from public.rt_v2_daily_metrics where series_id=p_series_id and metric_date=any(p_dates);
  insert into public.rt_v2_daily_metrics(series_id,metric_date,movements,reconciled,open,missing_native_idtr,amount,open_amount,with_idtr,without_idtr,reconciled_idtr,reconciled_without_idtr,balance_anomalies,rule_version)
  select p_series_id,m.accounting_date,count(*),count(*) filter(where status in('reconciled','manual')),count(*) filter(where status='open'),count(*) filter(where native_idtr is null),round(sum(amount)::numeric,2),round(coalesce(sum(amount) filter(where status='open'),0)::numeric,2),count(*) filter(where native_idtr is not null),count(*) filter(where native_idtr is null),count(*) filter(where status in('reconciled','manual') and reconciliation_method='idtr'),count(*) filter(where status in('reconciled','manual') and native_idtr is null),count(*) filter(where balance_sequence_valid=false),v_rule
  from public.rt_v2_movements m where m.series_id=p_series_id and m.accounting_date=any(p_dates) group by m.accounting_date;
  with bounds as(select min(metric_date) first_date,max(metric_date) last_date from public.rt_v2_daily_metrics where series_id=p_series_id),
  totals as(select sum(movements)::bigint movements,sum(reconciled)::bigint reconciled,sum(open)::bigint open,sum(with_idtr)::bigint with_idtr,sum(without_idtr)::bigint without_idtr,sum(reconciled_idtr)::bigint reconciled_idtr,sum(reconciled_without_idtr)::bigint reconciled_without_idtr,round(sum(amount)::numeric,2) amount,sum(balance_anomalies)::bigint balance_anomalies from public.rt_v2_daily_metrics where series_id=p_series_id),
  age as(select case private.rt_v2_working_days(d.metric_date,b.last_date) when 0 then 'D+0' when 1 then 'D+1' when 2 then 'D+2' when 3 then 'D+3' else case when private.rt_v2_working_days(d.metric_date,b.last_date)<=7 then 'D+4–7' else 'D+8+' end end bucket,sum(d.open)::bigint total from public.rt_v2_daily_metrics d cross join bounds b where d.series_id=p_series_id group by 1),
  timing as(select case operational_delay when 0 then 'D+0' when 1 then 'D+1' when 2 then 'D+2' when 3 then 'D+3' else 'D+4+' end bucket,count(*) reconciliations,sum(movement_count) movements from public.rt_v2_reconciliation_groups where series_id=p_series_id group by 1),
  balance as(select round(coalesce(sum(open_amount),0)::numeric,2) gross,sum(open)::bigint open_count,round(coalesce(max(open_amount) filter(where metric_date=b.first_date),0)::numeric,2) boundary,coalesce(max(open) filter(where metric_date=b.first_date),0)::bigint boundary_count,b.first_date,b.last_date from public.rt_v2_daily_metrics cross join bounds b where series_id=p_series_id group by b.first_date,b.last_date)
  update public.rt_v2_calculations c set rule_version=v_rule,calculated_at=now(),result=coalesce(c.result,'{}'::jsonb)||jsonb_build_object(
    'totals',(select to_jsonb(totals) from totals),'openByAge',coalesce((select jsonb_object_agg(bucket,total) from age),'{}'::jsonb),
    'reconciledByDelay',coalesce((select jsonb_object_agg(bucket,movements) from timing),'{}'::jsonb),'reconciliationsByDelay',coalesce((select jsonb_object_agg(bucket,reconciliations) from timing),'{}'::jsonb),
    'averageReconciliationDays',(select round(sum(operational_delay*movement_count)::numeric/nullif(sum(movement_count),0),2) from public.rt_v2_reconciliation_groups where series_id=p_series_id),
    'groupCount',(select count(*) from public.rt_v2_reconciliation_groups where series_id=p_series_id),'ruleVersion',v_rule,
    'balanceSummary',(select jsonb_build_object('grossOpenBalance',gross,'grossOpenMovements',open_count,'openingBoundaryBalance',boundary,'openingBoundaryMovements',boundary_count,'adjustedOpenBalance',gross-boundary,'adjustedOpenMovements',open_count-boundary_count,'firstDate',first_date,'lastDate',last_date) from balance)
  ) where c.series_id=p_series_id and c.metric='dashboard';
end;$$;

create or replace function public.review_rt_v2_reconciliation_proposals(p_proposal_ids uuid[],p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_actor uuid:=auth.uid();v_id uuid;v_proposal public.rt_v2_reconciliation_proposals%rowtype;v_group uuid;v_count integer;v_balance numeric;v_dates date[];v_approved integer:=0;v_rejected integer:=0;
begin
  if not exists(select 1 from public.profiles where id=v_actor and is_active and role::text in ('platform_owner','client_admin','analyst')) then raise exception 'Sessao sem permissao para confirmar reconciliacoes.'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Decisao invalida.'; end if;
  if coalesce(array_length(p_proposal_ids,1),0)=0 then raise exception 'Selecione pelo menos uma proposta.'; end if;
  foreach v_id in array p_proposal_ids loop
    select * into v_proposal from public.rt_v2_reconciliation_proposals where id=v_id for update;
    if v_proposal.id is null or v_proposal.status<>'pending' then continue; end if;
    if p_decision='reject' then
      update public.rt_v2_reconciliation_proposals set status='rejected',reviewed_by=v_actor,reviewed_at=now(),review_note=nullif(trim(p_note),''),updated_at=now() where id=v_id;
      v_rejected:=v_rejected+1;continue;
    end if;
    perform m.id from public.rt_v2_proposal_movements pm join public.rt_v2_movements m on m.id=pm.movement_id where pm.proposal_id=v_id and m.status='open' for update of m;
    select count(*),round(sum(m.amount)::numeric,2),array_agg(distinct m.accounting_date)
      into v_count,v_balance,v_dates
    from public.rt_v2_proposal_movements pm join public.rt_v2_movements m on m.id=pm.movement_id
    where pm.proposal_id=v_id and m.status='open';
    if v_count<>v_proposal.movement_count or v_count<2 or abs(coalesce(v_balance,1))>0.005 then
      update public.rt_v2_reconciliation_proposals set status='superseded',reviewed_by=v_actor,reviewed_at=now(),review_note='Proposta alterada antes da confirmacao.',updated_at=now() where id=v_id;
      continue;
    end if;
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay,reconciled_by,justification)
    values(v_proposal.series_id,v_proposal.method,v_proposal.reconciliation_key,v_proposal.rule_version,v_count,v_balance,v_proposal.first_accounting_date,v_proposal.last_accounting_date,v_proposal.operational_delay,v_actor,coalesce(nullif(trim(p_note),''),'Confirmacao tecnica')) returning id into v_group;
    insert into public.rt_v2_group_movements(group_id,movement_id) select v_group,movement_id from public.rt_v2_proposal_movements where proposal_id=v_id;
    update public.rt_v2_movements m set status='reconciled',reconciliation_method=v_proposal.method,reconciliation_rule_version=v_proposal.rule_version,reconciliation_group_id=v_group where id in(select movement_id from public.rt_v2_proposal_movements where proposal_id=v_id) and status='open';
    update public.rt_v2_reconciliation_proposals set status='approved',reviewed_by=v_actor,reviewed_at=now(),review_note=nullif(trim(p_note),''),updated_at=now() where id=v_id;
    update public.rt_v2_reconciliation_proposals p set status='superseded',updated_at=now() where p.status='pending' and p.id<>v_id and exists(select 1 from public.rt_v2_proposal_movements a join public.rt_v2_proposal_movements b on b.movement_id=a.movement_id where a.proposal_id=p.id and b.proposal_id=v_id);
    perform private.rt_v2_refresh_after_proposal_decision(v_proposal.series_id,v_dates);v_approved:=v_approved+1;
  end loop;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(v_actor,'v2_reconciliation_proposals_reviewed','rt_v2_reconciliation_proposal',null,jsonb_build_object('decision',p_decision,'approved',v_approved,'rejected',v_rejected,'proposalIds',p_proposal_ids));
  if v_approved>0 then perform private.refresh_rt_v2_reconciliation_proposals(v_proposal.series_id,null); end if;
  return jsonb_build_object('approved',v_approved,'rejected',v_rejected);
end;$$;
revoke all on function public.review_rt_v2_reconciliation_proposals(uuid[],text,text) from public;
grant execute on function public.review_rt_v2_reconciliation_proposals(uuid[],text,text) to authenticated;

create or replace function private.rt_v2_refresh_proposals_on_calculation()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.state='calculating' and old.state is distinct from new.state then perform private.refresh_rt_v2_reconciliation_proposals(new.series_id,new.id); end if;
  return new;
end;$$;
create trigger rt_v2_import_refresh_proposals before update of state on public.rt_v2_imports for each row execute function private.rt_v2_refresh_proposals_on_calculation();

do $$ declare v_series uuid;begin for v_series in select id from public.rt_v2_series loop perform private.refresh_rt_v2_reconciliation_proposals(v_series,null);end loop;end$$;

comment on table public.rt_v2_reconciliation_proposals is 'Propostas contabilisticas secundarias, sempre visiveis e sujeitas a confirmacao tecnica.';
