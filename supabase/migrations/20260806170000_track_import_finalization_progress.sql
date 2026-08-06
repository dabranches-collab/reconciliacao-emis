alter table public.import_batches
  add column if not exists processing_stage text not null default 'receiving',
  add column if not exists progress_percent smallint not null default 0,
  add column if not exists processed_bucket smallint not null default -1,
  add column if not exists total_buckets smallint not null default 16;

alter table public.import_batches
  drop constraint if exists import_batches_progress_percent_check,
  add constraint import_batches_progress_percent_check
    check (progress_percent between 0 and 100),
  drop constraint if exists import_batches_processed_bucket_check,
  add constraint import_batches_processed_bucket_check
    check (processed_bucket between -1 and total_buckets - 1);

comment on column public.import_batches.processing_stage is
  'Última fase persistida da importação/finalização, usada para acompanhamento e retoma.';
comment on column public.import_batches.processed_bucket is
  'Último bloco IDTR concluído; -1 significa que nenhum bloco foi concluído.';
