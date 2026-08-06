create or replace function public.finalize_import_atomically(
  p_analysis_id uuid,
  p_batch_id uuid,
  p_completed_at timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.import_batches
  set status = 'completed',
      processing_stage = 'completed',
      progress_percent = 100,
      failure_message = null,
      completed_at = p_completed_at
  where id = p_batch_id
    and analysis_id = p_analysis_id;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Import batch not found or not accessible';
  end if;

  update public.analyses
  set status = 'completed',
      updated_at = p_completed_at
  where id = p_analysis_id;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Analysis not found or not accessible';
  end if;
end;
$$;

revoke all on function public.finalize_import_atomically(uuid,uuid,timestamptz) from public, anon;
grant execute on function public.finalize_import_atomically(uuid,uuid,timestamptz) to authenticated;
