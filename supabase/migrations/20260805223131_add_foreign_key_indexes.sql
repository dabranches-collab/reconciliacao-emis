create index analyses_created_by_idx on public.analyses (created_by);
create index import_batches_uploaded_by_idx on public.import_batches (uploaded_by);
create index movements_batch_id_idx on public.movements (batch_id);
create index movements_group_id_idx on public.movements (reconciliation_group_id) where reconciliation_group_id is not null;
create index group_movements_movement_id_idx on public.reconciliation_group_movements (movement_id);
create index reconciliation_groups_analysis_id_idx on public.reconciliation_groups (analysis_id);
create index reconciliation_groups_reconciled_by_idx on public.reconciliation_groups (reconciled_by) where reconciled_by is not null;
create index reconciliation_groups_reversed_by_idx on public.reconciliation_groups (reversed_by) where reversed_by is not null;
