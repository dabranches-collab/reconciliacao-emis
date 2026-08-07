create index if not exists rt_v2_groups_series_method_key_idx
  on public.rt_v2_reconciliation_groups(series_id,method,reconciliation_key);
