alter table public.rt_v2_reconciliation_groups
  add column if not exists closed_by_import_id uuid
  references public.rt_v2_imports(id) on delete set null;

create index if not exists rt_v2_groups_closed_by_import_idx
  on public.rt_v2_reconciliation_groups(closed_by_import_id,created_at,id);
create index if not exists rt_v2_movements_reconciliation_group_date_idx
  on public.rt_v2_movements(reconciliation_group_id,accounting_date desc,id desc)
  where reconciliation_group_id is not null;

create or replace function private.set_rt_v2_group_closing_import()
returns trigger language plpgsql set search_path=public,private as $$
begin
  if new.closed_by_import_id is null then
    select i.id into new.closed_by_import_id from public.rt_v2_imports i
    where i.series_id=new.series_id and i.state in ('reconciling','calculating')
    order by i.created_at desc limit 1;
  end if;
  return new;
end;$$;
revoke all on function private.set_rt_v2_group_closing_import() from public,anon,authenticated;

drop trigger if exists rt_v2_groups_set_closing_import on public.rt_v2_reconciliation_groups;
create trigger rt_v2_groups_set_closing_import before insert on public.rt_v2_reconciliation_groups
for each row execute function private.set_rt_v2_group_closing_import();

create or replace view public.rt_v2_movement_explorer with (security_invoker=true) as
select m.*,g.closed_by_import_id
from public.rt_v2_movements m
left join public.rt_v2_reconciliation_groups g on g.id=m.reconciliation_group_id;
revoke all on public.rt_v2_movement_explorer from public,anon;
grant select on public.rt_v2_movement_explorer to authenticated,service_role;
