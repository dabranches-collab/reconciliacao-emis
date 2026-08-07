alter table public.rt_v2_movements
  add column if not exists closed_by_import_id uuid
  references public.rt_v2_imports(id) on delete set null;

create index if not exists rt_v2_movements_closing_import_date_idx
  on public.rt_v2_movements(closed_by_import_id,accounting_date desc,id desc)
  where closed_by_import_id is not null;

create or replace function private.set_rt_v2_movement_closing_import()
returns trigger language plpgsql set search_path=public,private as $$
begin
  if new.reconciliation_group_id is distinct from old.reconciliation_group_id then
    if new.reconciliation_group_id is null then
      new.closed_by_import_id:=null;
    else
      select g.closed_by_import_id into new.closed_by_import_id
      from public.rt_v2_reconciliation_groups g where g.id=new.reconciliation_group_id;
    end if;
  end if;
  return new;
end;$$;

revoke all on function private.set_rt_v2_movement_closing_import() from public,anon,authenticated;
drop trigger if exists rt_v2_movements_set_closing_import on public.rt_v2_movements;
create trigger rt_v2_movements_set_closing_import
before update of reconciliation_group_id on public.rt_v2_movements
for each row execute function private.set_rt_v2_movement_closing_import();

create or replace view public.rt_v2_movement_explorer with (security_invoker=true) as
select m.* from public.rt_v2_movements m;
revoke all on public.rt_v2_movement_explorer from public,anon;
grant select on public.rt_v2_movement_explorer to authenticated,service_role;
