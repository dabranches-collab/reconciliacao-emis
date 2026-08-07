-- Índice de cobertura para somar pendências sem regressar à tabela principal.
create index if not exists rt_v2_movements_open_balance_idx
  on public.rt_v2_movements (series_id, accounting_date)
  include (amount)
  where status = 'open';
