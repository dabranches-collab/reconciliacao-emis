insert into public.daily_metrics
  (analysis_id, metric_date, movements, automatic, unreconciled, missing_idtr, amount)
select
  a.id,
  metric.key::date,
  coalesce((metric.value ->> 'movements')::bigint, 0),
  coalesce((metric.value ->> 'automatic')::bigint, 0),
  coalesce((metric.value ->> 'unreconciled')::bigint, 0),
  coalesce((metric.value ->> 'missingIdtr')::bigint, 0),
  coalesce((metric.value ->> 'amount')::numeric, 0)
from public.analyses a
cross join lateral jsonb_each(coalesce(a.result_summary -> 'dailyMetrics', '{}'::jsonb)) metric
on conflict (analysis_id, metric_date) do update set
  movements = excluded.movements,
  automatic = excluded.automatic,
  unreconciled = excluded.unreconciled,
  missing_idtr = excluded.missing_idtr,
  amount = excluded.amount;

insert into public.audit_logs (actor_id, action, entity_type, entity_id, analysis_id, details)
select b.uploaded_by, 'import_completed', 'import_batch', b.id::text, b.analysis_id,
       jsonb_build_object('filename', b.original_filename, 'movements', b.movement_count, 'recovered', true)
from public.import_batches b
where b.movement_count > 0
  and not exists (
    select 1 from public.audit_logs l
    where l.action = 'import_completed' and l.entity_type = 'import_batch' and l.entity_id = b.id::text
  );
