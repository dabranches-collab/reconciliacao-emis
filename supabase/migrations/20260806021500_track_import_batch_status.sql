alter table public.import_batches
  add column if not exists status public.analysis_status not null default 'processing',
  add column if not exists failure_message text,
  add column if not exists completed_at timestamptz;
