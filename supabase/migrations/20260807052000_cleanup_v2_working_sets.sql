-- As tabelas de candidatos são apenas conjuntos de trabalho. Mantê-las após
-- a conclusão aumenta o índice e o custo de I/O das importações seguintes.
create or replace function private.cleanup_rt_v2_working_sets()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.state='completed' and old.state is distinct from 'completed' then
    delete from private.rt_v2_primary_candidates where import_id=new.id;
    delete from private.rt_v2_secondary_candidates where import_id=new.id;
    delete from private.rt_v2_affected_dates where import_id=new.id;
  end if;
  return new;
end;$$;

drop trigger if exists rt_v2_import_cleanup_working_sets on public.rt_v2_imports;
create trigger rt_v2_import_cleanup_working_sets
after update of state on public.rt_v2_imports
for each row execute function private.cleanup_rt_v2_working_sets();

revoke all on function private.cleanup_rt_v2_working_sets() from public,anon,authenticated;

-- Limpa apenas conjuntos de trabalho de importações já concluídas.
delete from private.rt_v2_primary_candidates c
using public.rt_v2_imports i where i.id=c.import_id and i.state='completed';
delete from private.rt_v2_secondary_candidates c
using public.rt_v2_imports i where i.id=c.import_id and i.state='completed';
