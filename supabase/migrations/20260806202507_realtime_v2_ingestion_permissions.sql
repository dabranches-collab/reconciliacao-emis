create policy rt_v2_series_insert on public.rt_v2_series
for insert to authenticated with check (
  created_by=(select auth.uid()) and (select private.is_active_user())
);

create policy rt_v2_imports_insert on public.rt_v2_imports
for insert to authenticated with check (
  uploaded_by=(select auth.uid()) and (select private.is_active_user())
);

create policy rt_v2_imports_update on public.rt_v2_imports
for update to authenticated
using (uploaded_by=(select auth.uid()) and state <> 'completed')
with check (uploaded_by=(select auth.uid()));

create policy rt_v2_movements_insert on public.rt_v2_movements
for insert to authenticated with check (
  exists (
    select 1 from public.rt_v2_imports i
    where i.id=import_id and i.series_id=series_id
      and i.uploaded_by=(select auth.uid())
      and i.state in ('validating','ingesting')
  )
);

grant insert on public.rt_v2_series,public.rt_v2_imports,public.rt_v2_movements to authenticated;
grant update (state,stage,progress,source_rows,inserted_rows,duplicate_rows,rejected_rows,period_start,period_end,header_map,validation,error_message,heartbeat_at,completed_at)
on public.rt_v2_imports to authenticated;
grant usage,select on sequence public.rt_v2_movements_id_seq to authenticated;
