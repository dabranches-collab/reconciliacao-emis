create or replace function private.auto_close_rt_v2_unique_comparable_pairs(p_series_id uuid,p_bucket integer default 0,p_bucket_count integer default 1,p_import_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_rule constant text:='rt-v2.1.0';v_count bigint:=0;v_dates date[];
begin
  if p_bucket<0 or p_bucket>=p_bucket_count or p_bucket_count<1 then raise exception 'Bloco invalido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rt-v2-unique-pairs:'||p_series_id::text,0));
  create temporary table rt_v2_unique_pairs(pair_key text,positive_id bigint,negative_id bigint,first_date date,last_date date) on commit drop;
  create temporary table rt_v2_unique_pair_groups(group_id uuid,pair_key text) on commit drop;
  insert into rt_v2_unique_pairs
  with comparable as (
    select id,operation_number,trim(regexp_replace(coalesce(description_normalized,''),'^anl[- ]*','','i')) comparison_description,
      abs(amount) absolute_amount,amount,accounting_date
    from public.rt_v2_movements where series_id=p_series_id and status='open' and amount<>0
      and coalesce(operation_number,'')<>'' and coalesce(description_normalized,'')<>''
      and ((hashtextextended(concat_ws(chr(31),operation_number,trim(regexp_replace(coalesce(description_normalized,''),'^anl[- ]*','','i')),abs(amount)),0)%p_bucket_count)+p_bucket_count)%p_bucket_count=p_bucket
  ), candidates as (
    select operation_number,comparison_description,absolute_amount,
      max(id) filter(where amount>0) positive_id,max(id) filter(where amount<0) negative_id,
      min(accounting_date) first_date,max(accounting_date) last_date
    from comparable group by operation_number,comparison_description,absolute_amount
    having comparison_description<>'' and count(*)=2 and count(*) filter(where amount>0)=1 and count(*) filter(where amount<0)=1
  ) select concat_ws(chr(31),operation_number,comparison_description,absolute_amount),positive_id,negative_id,first_date,last_date from candidates;
  with inserted as (
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay,justification)
    select p_series_id,'operation_description',pair_key,v_rule,2,0,first_date,last_date,private.rt_v2_working_days(first_date,last_date),'Par contabilístico único e simétrico' from rt_v2_unique_pairs returning id,reconciliation_key
  ) insert into rt_v2_unique_pair_groups select id,reconciliation_key from inserted;
  insert into public.rt_v2_group_movements(group_id,movement_id)
  select g.group_id,p.positive_id from rt_v2_unique_pair_groups g join rt_v2_unique_pairs p using(pair_key)
  union all select g.group_id,p.negative_id from rt_v2_unique_pair_groups g join rt_v2_unique_pairs p using(pair_key);
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='operation_description',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm join rt_v2_unique_pair_groups g on g.group_id=gm.group_id where gm.movement_id=m.id and m.status='open';
  get diagnostics v_count=row_count;
  select array_agg(distinct d) into v_dates from (select first_date d from rt_v2_unique_pairs union select last_date from rt_v2_unique_pairs) q;
  if p_import_id is not null and v_count>0 then
    insert into private.rt_v2_affected_dates(import_id,metric_date) select p_import_id,unnest(v_dates) on conflict do nothing;
  end if;
  return jsonb_build_object('status','completed','movements',v_count,'pairs',v_count/2);
end;$$;
alter function private.auto_close_rt_v2_unique_comparable_pairs(uuid,integer,integer,uuid) set statement_timeout='0';

create or replace function private.rt_v2_refresh_proposals_on_calculation()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare i integer;
begin
  if new.state='calculating' and old.state is distinct from new.state then
    for i in 0..15 loop perform private.auto_close_rt_v2_unique_comparable_pairs(new.series_id,i,16,new.id); end loop;
    perform private.refresh_rt_v2_reconciliation_proposals(new.series_id,new.id);
  end if;
  return new;
end;$$;
drop function if exists private.auto_close_rt_v2_unique_comparable_pairs(uuid,integer,integer);
