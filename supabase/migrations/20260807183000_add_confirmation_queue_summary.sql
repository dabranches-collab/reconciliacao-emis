create or replace view public.rt_v2_reconciliation_proposal_summary
with (security_invoker=true) as
select series_id,status,method,operational_delay,count(*) proposals,sum(movement_count)::bigint movements
from public.rt_v2_reconciliation_proposals
group by series_id,status,method,operational_delay;

revoke all on public.rt_v2_reconciliation_proposal_summary from anon;
grant select on public.rt_v2_reconciliation_proposal_summary to authenticated;
