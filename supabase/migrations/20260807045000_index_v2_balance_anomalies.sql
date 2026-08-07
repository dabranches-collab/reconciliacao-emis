-- As anomalias são raras; um índice parcial evita percorrer milhões de
-- movimentos para contar ou abrir o respetivo detalhe.
create index if not exists rt_v2_movements_balance_anomalies_idx
  on public.rt_v2_movements(import_id,accounting_date,id)
  where balance_sequence_valid=false;
