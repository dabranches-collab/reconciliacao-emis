create or replace function public.review_rt_v2_reconciliation_selection(
  p_proposal_id uuid,
  p_movement_ids bigint[],
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_proposal public.rt_v2_reconciliation_proposals%rowtype;
  v_group uuid;
  v_selected_count integer;
  v_distinct_count integer;
  v_open_count integer;
  v_balance numeric;
  v_first_date date;
  v_last_date date;
  v_dates date[];
  v_status text;
begin
  if not exists (
    select 1
    from public.profiles
    where id = v_actor
      and is_active
      and role::text in ('platform_owner', 'client_admin', 'analyst')
  ) then
    raise exception 'Sessao sem permissao para confirmar reconciliacoes.';
  end if;

  v_selected_count := coalesce(cardinality(p_movement_ids), 0);
  select count(*) into v_distinct_count
  from (select distinct unnest(p_movement_ids) as movement_id) selected;

  if v_selected_count < 2 or v_selected_count <> v_distinct_count then
    raise exception 'Selecione pelo menos dois movimentos diferentes.';
  end if;

  select * into v_proposal
  from public.rt_v2_reconciliation_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null or v_proposal.status <> 'pending' then
    raise exception 'A proposta ja nao esta pendente.';
  end if;

  perform m.id
  from public.rt_v2_movements m
  where m.id = any(p_movement_ids)
  for update;

  select
    count(*),
    count(*) filter (where m.status = 'open'),
    round(sum(m.amount)::numeric, 2),
    min(m.accounting_date),
    max(m.accounting_date),
    array_agg(distinct m.accounting_date)
  into v_selected_count, v_open_count, v_balance, v_first_date, v_last_date, v_dates
  from public.rt_v2_proposal_movements pm
  join public.rt_v2_movements m on m.id = pm.movement_id
  where pm.proposal_id = p_proposal_id
    and pm.movement_id = any(p_movement_ids);

  if v_selected_count <> v_distinct_count then
    raise exception 'Existem movimentos selecionados que nao pertencem a esta proposta.';
  end if;
  if v_open_count <> v_selected_count then
    raise exception 'Um ou mais movimentos selecionados ja nao estao em aberto.';
  end if;
  if abs(coalesce(v_balance, 1)) > 0.005 then
    raise exception 'Os movimentos selecionados nao fecham com saldo zero.';
  end if;

  insert into public.rt_v2_reconciliation_groups(
    series_id, method, reconciliation_key, rule_version, movement_count, balance,
    first_accounting_date, last_accounting_date, operational_delay,
    reconciled_by, justification
  )
  values (
    v_proposal.series_id, v_proposal.method, v_proposal.reconciliation_key,
    v_proposal.rule_version, v_selected_count, v_balance, v_first_date, v_last_date,
    private.rt_v2_working_days(v_first_date, v_last_date), v_actor,
    coalesce(nullif(trim(p_note), ''), 'Confirmacao tecnica de movimentos selecionados')
  )
  returning id into v_group;

  insert into public.rt_v2_group_movements(group_id, movement_id)
  select v_group, movement_id
  from unnest(p_movement_ids) as movement_id;

  update public.rt_v2_movements
  set status = 'reconciled',
      reconciliation_method = v_proposal.method,
      reconciliation_rule_version = v_proposal.rule_version,
      reconciliation_group_id = v_group
  where id = any(p_movement_ids)
    and status = 'open';

  v_status := case when v_selected_count = v_proposal.movement_count then 'approved' else 'superseded' end;
  update public.rt_v2_reconciliation_proposals
  set status = v_status,
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_note = coalesce(
        nullif(trim(p_note), ''),
        case when v_status = 'approved'
          then 'Confirmacao tecnica de todas as linhas.'
          else format('Confirmacao parcial: %s de %s movimentos; restantes mantidos em aberto.', v_selected_count, v_proposal.movement_count)
        end
      ),
      updated_at = now()
  where id = p_proposal_id;

  update public.rt_v2_reconciliation_proposals p
  set status = 'superseded', updated_at = now()
  where p.status = 'pending'
    and p.id <> p_proposal_id
    and exists (
      select 1
      from public.rt_v2_proposal_movements pm
      where pm.proposal_id = p.id
        and pm.movement_id = any(p_movement_ids)
    );

  perform private.rt_v2_refresh_after_proposal_decision(v_proposal.series_id, v_dates);
  perform private.refresh_rt_v2_reconciliation_proposals(v_proposal.series_id, null);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    v_actor,
    'v2_reconciliation_selection_reviewed',
    'rt_v2_reconciliation_proposal',
    p_proposal_id::text,
    jsonb_build_object(
      'movementIds', p_movement_ids,
      'selectedMovements', v_selected_count,
      'proposalMovements', v_proposal.movement_count,
      'balance', v_balance,
      'remainingOpen', v_proposal.movement_count - v_selected_count
    )
  );

  return jsonb_build_object(
    'status', 'approved',
    'groupId', v_group,
    'selectedMovements', v_selected_count,
    'remainingOpen', v_proposal.movement_count - v_selected_count,
    'balance', v_balance
  );
end;
$$;

revoke all on function public.review_rt_v2_reconciliation_selection(uuid, bigint[], text) from public;
revoke all on function public.review_rt_v2_reconciliation_selection(uuid, bigint[], text) from anon;
grant execute on function public.review_rt_v2_reconciliation_selection(uuid, bigint[], text) to authenticated;

comment on function public.review_rt_v2_reconciliation_selection(uuid, bigint[], text)
is 'Confirma apenas um subconjunto auditavel de movimentos pendentes quando continuam abertos e somam exatamente zero.';
