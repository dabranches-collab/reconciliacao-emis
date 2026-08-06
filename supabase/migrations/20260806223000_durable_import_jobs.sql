alter table public.import_batches
  add column if not exists job_id text,
  add column if not exists upload_id text,
  add column if not exists upload_parts_total integer not null default 0,
  add column if not exists upload_parts_completed integer not null default 0,
  add column if not exists expected_file_size bigint,
  add column if not exists stored_file_size bigint,
  add column if not exists rejected_count integer not null default 0,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists retry_at timestamptz,
  add column if not exists validation_summary jsonb not null default '{}'::jsonb;

create table if not exists public.import_job_checkpoints (
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  stage text not null,
  unit integer not null,
  unit_count integer not null,
  status text not null default 'completed' check (status in ('processing','completed','failed')),
  attempt integer not null default 1,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (batch_id,stage,unit)
);

create index if not exists import_job_checkpoints_batch_stage_idx
  on public.import_job_checkpoints(batch_id,stage,status);

alter table public.import_job_checkpoints enable row level security;

drop policy if exists import_job_checkpoints_read on public.import_job_checkpoints;
create policy import_job_checkpoints_read on public.import_job_checkpoints
for select to authenticated using (
  exists (
    select 1 from public.import_batches b
    where b.id=batch_id
      and (b.uploaded_by=(select auth.uid()) or (select private.is_admin()))
  )
);

revoke insert,update,delete on public.import_job_checkpoints from anon,authenticated;
grant select on public.import_job_checkpoints to authenticated;

create or replace function public.get_import_job_progress(p_batch_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when b.id is null then null else jsonb_build_object(
    'batchId',b.id,
    'status',b.status,
    'stage',b.processing_stage,
    'percent',b.progress_percent,
    'movementCount',b.movement_count,
    'insertedCount',b.inserted_count,
    'duplicateCount',b.duplicate_count,
    'rejectedCount',b.rejected_count,
    'uploadPartsCompleted',b.upload_parts_completed,
    'uploadPartsTotal',b.upload_parts_total,
    'heartbeatAt',b.heartbeat_at,
    'retryAt',b.retry_at,
    'attempt',b.attempt_count,
    'failureMessage',b.failure_message,
    'validation',b.validation_summary,
    'completedUnits',coalesce(c.completed_units,0),
    'totalUnits',coalesce(c.total_units,0)
  ) end
  from public.import_batches b
  left join lateral (
    select count(*) filter(where status='completed') completed_units,
      greatest(max(unit_count),0) total_units
    from public.import_job_checkpoints where batch_id=b.id and stage=b.processing_stage
  ) c on true
  where b.id=p_batch_id
    and (b.uploaded_by=(select auth.uid()) or (select private.is_admin()));
$$;

revoke execute on function public.get_import_job_progress(uuid) from public,anon;
grant execute on function public.get_import_job_progress(uuid) to authenticated;

comment on table public.import_job_checkpoints is
  'Checkpoints idempotentes escritos exclusivamente pelo executor servidor da importação.';
