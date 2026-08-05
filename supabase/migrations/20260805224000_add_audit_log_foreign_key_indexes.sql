create index audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index audit_logs_analysis_id_idx on public.audit_logs (analysis_id) where analysis_id is not null;
