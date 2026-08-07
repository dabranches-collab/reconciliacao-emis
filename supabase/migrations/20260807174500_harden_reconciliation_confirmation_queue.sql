revoke execute on function public.review_rt_v2_reconciliation_proposals(uuid[],text,text) from anon;
revoke execute on function public.review_rt_v2_reconciliation_proposals(uuid[],text,text) from public;
grant execute on function public.review_rt_v2_reconciliation_proposals(uuid[],text,text) to authenticated;

create index if not exists rt_v2_proposals_import_idx
  on public.rt_v2_reconciliation_proposals(generated_by_import_id)
  where generated_by_import_id is not null;
create index if not exists rt_v2_proposals_reviewer_idx
  on public.rt_v2_reconciliation_proposals(reviewed_by)
  where reviewed_by is not null;
