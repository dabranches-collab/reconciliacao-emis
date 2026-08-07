-- Um movimento aberto no primeiro dia disponível pode ser uma pendência real
-- transportada. Não existe evidência contabilística suficiente para o excluir
-- automaticamente como fronteira inicial.

create or replace function private.rt_v2_remove_assumed_boundary()
returns trigger
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_balance jsonb;
begin
  if new.metric <> 'dashboard' or new.result is null then
    return new;
  end if;

  v_balance := coalesce(new.result->'balanceSummary','{}'::jsonb);
  if v_balance = '{}'::jsonb then
    return new;
  end if;

  v_balance := v_balance || jsonb_build_object(
    'openingBoundaryBalance',0,
    'openingBoundaryMovements',0,
    'adjustedOpenBalance',coalesce((v_balance->>'grossOpenBalance')::numeric,0),
    'adjustedOpenMovements',coalesce((v_balance->>'grossOpenMovements')::bigint,0)
  );
  new.result := jsonb_set(new.result,'{balanceSummary}',v_balance,true);
  return new;
end;
$$;
revoke all on function private.rt_v2_remove_assumed_boundary() from public,anon,authenticated;

drop trigger if exists rt_v2_remove_assumed_boundary on public.rt_v2_calculations;
create trigger rt_v2_remove_assumed_boundary
before insert or update of result on public.rt_v2_calculations
for each row execute function private.rt_v2_remove_assumed_boundary();

-- Reclassifica imediatamente os resultados existentes sem reler os XLSX.
update public.rt_v2_calculations
set result=result,
    calculated_at=now()
where metric='dashboard' and result ? 'balanceSummary';

insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
values(null,'v2_boundary_assumption_removed','rt_v2_calculation',null,
  jsonb_build_object(
    'reason','Os ficheiros BK confirmam que o primeiro período contém pendências antigas transportadas.',
    'effect','Nenhum movimento é excluído automaticamente apenas por pertencer ao início da série.'
  ));

comment on function private.rt_v2_remove_assumed_boundary() is
'Impede que movimentos abertos do primeiro período sejam excluídos sem evidência contabilística.';
