create index if not exists rt_v2_movements_open_age_idx
  on public.rt_v2_movements (series_id, accounting_date, id)
  where status = 'open';

-- A função é criada na migração 051, que aplica a contagem operacional
-- definitiva e evita que uma instalação incremental reponha a versão antiga.
