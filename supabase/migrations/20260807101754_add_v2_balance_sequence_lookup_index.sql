create index if not exists rt_v2_movements_balance_sequence_lookup_idx
  on public.rt_v2_movements(series_id,import_id,account,currency,source_row);
