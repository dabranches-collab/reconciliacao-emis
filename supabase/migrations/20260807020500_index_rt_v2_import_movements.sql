create index if not exists rt_v2_movements_import_status_idx
on public.rt_v2_movements(import_id,status,native_idtr,accounting_date);
