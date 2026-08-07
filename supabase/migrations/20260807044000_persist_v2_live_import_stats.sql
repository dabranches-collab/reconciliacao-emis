alter table public.rt_v2_imports
  add column if not exists live_stats jsonb not null default '{}'::jsonb;

comment on column public.rt_v2_imports.live_stats is
  'Contadores provisórios da leitura, usados para recuperar o ecrã após navegação ou atualização.';
