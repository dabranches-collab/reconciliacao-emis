create or replace function private.initialize_rt_v2_finalization(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_import public.rt_v2_imports%rowtype;v_rule constant text:='rt-v2.0.0';
begin
  select * into v_import from public.rt_v2_imports where id=p_import_id for update;
  if v_import.id is null then raise exception 'Importação V2 não encontrada.'; end if;
  if v_import.state='completed' then return jsonb_build_object('status','completed'); end if;
  update public.rt_v2_imports set state='reconciling',stage='A preparar reconciliação central',progress=81,heartbeat_at=now(),error_message=null where id=p_import_id;
  insert into public.rt_v2_calculations(series_id,metric,rule_version,state,started_at)
  values(v_import.series_id,'dashboard',v_rule,'processing',now())
  on conflict(series_id,metric) do update set rule_version=excluded.rule_version,state='processing',error_message=null,started_at=now(),calculated_at=null;
  insert into private.rt_v2_affected_dates(import_id,metric_date)
  select p_import_id,accounting_date from public.rt_v2_movements where import_id=p_import_id group by accounting_date on conflict do nothing;
  insert into public.rt_v2_reconciliation_alerts(series_id,import_id,alert_type,reconciliation_key,new_movement_count)
  select v_import.series_id,p_import_id,'idtr_reappeared_after_reconciliation',m.native_idtr,count(*)
  from public.rt_v2_movements m where m.import_id=p_import_id and m.native_idtr is not null and exists(
    select 1 from public.rt_v2_reconciliation_groups g where g.series_id=v_import.series_id and g.method='idtr' and g.reconciliation_key=m.native_idtr)
  group by m.native_idtr on conflict(import_id,alert_type,reconciliation_key) do update set new_movement_count=excluded.new_movement_count;
  return jsonb_build_object('status','initialized');
end;$$;
alter function private.initialize_rt_v2_finalization(uuid) set statement_timeout='0';

create or replace function private.finalize_rt_v2_primary_bucket(p_import_id uuid,p_bucket integer,p_bucket_count integer)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_import public.rt_v2_imports%rowtype;v_rule constant text:='rt-v2.0.0';v_count bigint:=0;
begin
  if p_bucket<0 or p_bucket>=p_bucket_count or p_bucket_count<1 then raise exception 'Bloco inválido.'; end if;
  select * into v_import from public.rt_v2_imports where id=p_import_id for update;
  if v_import.id is null then raise exception 'Importação V2 não encontrada.'; end if;
  if v_import.state='completed' then return jsonb_build_object('status','completed'); end if;
  update public.rt_v2_imports set stage=format('A reconciliar IDTR — bloco %s de %s',p_bucket+1,p_bucket_count),progress=82+(p_bucket*6.0/p_bucket_count),heartbeat_at=now() where id=p_import_id;
  create temporary table rt_v2_bucket_idtrs(idtr text primary key) on commit drop;
  create temporary table rt_v2_bucket_groups(group_id uuid,idtr text) on commit drop;
  insert into rt_v2_bucket_idtrs select distinct native_idtr from public.rt_v2_movements
  where import_id=p_import_id and status='open' and native_idtr is not null and ((hashtextextended(native_idtr,0)%p_bucket_count)+p_bucket_count)%p_bucket_count=p_bucket;
  with candidates as(
    select m.native_idtr,count(*) movement_count,round(sum(m.amount)::numeric,2) balance,min(m.accounting_date) first_date,max(m.accounting_date) last_date
    from public.rt_v2_movements m join rt_v2_bucket_idtrs a on a.idtr=m.native_idtr where m.series_id=v_import.series_id and m.status='open'
    group by m.native_idtr having count(*)>=2 and abs(round(sum(m.amount)::numeric,2))<=0.005),
  inserted as(
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay)
    select v_import.series_id,'idtr',native_idtr,v_rule,movement_count,balance,first_date,last_date,private.rt_v2_working_days(first_date,last_date) from candidates returning id,reconciliation_key)
  insert into rt_v2_bucket_groups select id,reconciliation_key from inserted;
  insert into public.rt_v2_group_movements(group_id,movement_id)
  select g.group_id,m.id from rt_v2_bucket_groups g join public.rt_v2_movements m on m.series_id=v_import.series_id and m.native_idtr=g.idtr and m.status='open';
  insert into private.rt_v2_affected_dates(import_id,metric_date)
  select p_import_id,m.accounting_date from public.rt_v2_group_movements gm join rt_v2_bucket_groups g on g.group_id=gm.group_id join public.rt_v2_movements m on m.id=gm.movement_id on conflict do nothing;
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='idtr',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm join rt_v2_bucket_groups g on g.group_id=gm.group_id where gm.movement_id=m.id and m.series_id=v_import.series_id and m.status='open';
  get diagnostics v_count=row_count;
  return jsonb_build_object('status','primary_bucket_completed','bucket',p_bucket,'movements',v_count);
end;$$;
alter function private.finalize_rt_v2_primary_bucket(uuid,integer,integer) set statement_timeout='0';

create or replace function private.finalize_rt_v2_secondary_bucket(p_import_id uuid,p_bucket integer,p_bucket_count integer)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_import public.rt_v2_imports%rowtype;v_rule constant text:='rt-v2.0.0';v_count bigint:=0;
begin
  if p_bucket<0 or p_bucket>=p_bucket_count or p_bucket_count<1 then raise exception 'Bloco inválido.'; end if;
  select * into v_import from public.rt_v2_imports where id=p_import_id for update;
  if v_import.id is null then raise exception 'Importação V2 não encontrada.'; end if;
  if v_import.state='completed' then return jsonb_build_object('status','completed'); end if;
  update public.rt_v2_imports set stage=format('A emparelhar movimentos — bloco %s de %s',p_bucket+1,p_bucket_count),progress=88+(p_bucket*6.0/p_bucket_count),heartbeat_at=now() where id=p_import_id;
  create temporary table rt_v2_bucket_secondary(operation_number text,description_normalized text,absolute_amount numeric(20,2),primary key(operation_number,description_normalized,absolute_amount)) on commit drop;
  create temporary table rt_v2_bucket_pairs(pair_key text,positive_id bigint,negative_id bigint,first_date date,last_date date) on commit drop;
  create temporary table rt_v2_bucket_pair_groups(group_id uuid,pair_key text) on commit drop;
  insert into rt_v2_bucket_secondary select distinct operation_number,description_normalized,abs(amount) from public.rt_v2_movements
  where import_id=p_import_id and status='open' and amount<>0 and coalesce(operation_number,'')<>'' and coalesce(description_normalized,'')<>''
    and ((hashtextextended(concat_ws(chr(31),operation_number,description_normalized,abs(amount)),0)%p_bucket_count)+p_bucket_count)%p_bucket_count=p_bucket;
  insert into rt_v2_bucket_pairs
  with ranked as(
    select m.id,m.operation_number,m.description_normalized,abs(m.amount) absolute_amount,m.accounting_date,case when m.amount>0 then 1 else -1 end direction,
      row_number() over(partition by m.operation_number,m.description_normalized,abs(m.amount),case when m.amount>0 then 1 else -1 end order by m.accounting_date,m.id) pair_number
    from public.rt_v2_movements m join rt_v2_bucket_secondary a on a.operation_number=m.operation_number and a.description_normalized=m.description_normalized and a.absolute_amount=abs(m.amount)
    where m.series_id=v_import.series_id and m.status='open' and m.amount<>0)
  select concat_ws(chr(31),p.operation_number,p.description_normalized,p.absolute_amount,p.pair_number),p.id,n.id,least(p.accounting_date,n.accounting_date),greatest(p.accounting_date,n.accounting_date)
  from ranked p join ranked n on n.operation_number=p.operation_number and n.description_normalized=p.description_normalized and n.absolute_amount=p.absolute_amount and n.pair_number=p.pair_number and n.direction=-1 where p.direction=1;
  with inserted as(
    insert into public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key,rule_version,movement_count,balance,first_accounting_date,last_accounting_date,operational_delay)
    select v_import.series_id,'operation_description',pair_key,v_rule,2,0,first_date,last_date,private.rt_v2_working_days(first_date,last_date) from rt_v2_bucket_pairs returning id,reconciliation_key)
  insert into rt_v2_bucket_pair_groups select id,reconciliation_key from inserted;
  insert into public.rt_v2_group_movements(group_id,movement_id)
  select g.group_id,p.positive_id from rt_v2_bucket_pair_groups g join rt_v2_bucket_pairs p using(pair_key)
  union all select g.group_id,p.negative_id from rt_v2_bucket_pair_groups g join rt_v2_bucket_pairs p using(pair_key);
  insert into private.rt_v2_affected_dates(import_id,metric_date)
  select p_import_id,first_date from rt_v2_bucket_pairs union select p_import_id,last_date from rt_v2_bucket_pairs on conflict do nothing;
  update public.rt_v2_movements m set status='reconciled',reconciliation_method='operation_description',reconciliation_rule_version=v_rule,reconciliation_group_id=gm.group_id
  from public.rt_v2_group_movements gm join rt_v2_bucket_pair_groups g on g.group_id=gm.group_id where gm.movement_id=m.id and m.series_id=v_import.series_id and m.status='open';
  get diagnostics v_count=row_count;
  return jsonb_build_object('status','secondary_bucket_completed','bucket',p_bucket,'movements',v_count);
end;$$;
alter function private.finalize_rt_v2_secondary_bucket(uuid,integer,integer) set statement_timeout='0';

create or replace function public.finalize_rt_v2_import_phase_as_owner(p_import_id uuid,p_actor_id uuid,p_phase text,p_bucket integer default null,p_bucket_count integer default null)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_owner uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Função exclusiva do serviço.'; end if;
  select uploaded_by into v_owner from public.rt_v2_imports where id=p_import_id;
  if v_owner is null or v_owner<>p_actor_id then raise exception 'Importação inexistente ou utilizador incompatível.'; end if;
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  case p_phase when 'initialize' then return private.initialize_rt_v2_finalization(p_import_id);when 'primary' then return private.finalize_rt_v2_primary_bucket(p_import_id,p_bucket,p_bucket_count);when 'secondary' then return private.finalize_rt_v2_secondary_bucket(p_import_id,p_bucket,p_bucket_count);when 'metrics' then return private.finalize_rt_v2_metrics(p_import_id);else raise exception 'Fase inválida.';end case;
end;$$;
alter function public.finalize_rt_v2_import_phase_as_owner(uuid,uuid,text,integer,integer) set statement_timeout='0';
revoke all on function public.finalize_rt_v2_import_phase_as_owner(uuid,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.finalize_rt_v2_import_phase_as_owner(uuid,uuid,text,integer,integer) to service_role;
