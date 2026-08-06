create or replace function public.get_unreconciled_age_counts(p_analysis_id uuid,p_cutoff date,p_exclude_opening boolean default true)
returns table(all_count bigint,d0_count bigint,up_to_1_count bigint,up_to_2_count bigint,at_least_1_count bigint,at_least_2_count bigint,at_least_3_count bigint)
language sql stable security invoker set search_path=public as $$
 select count(*)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)=p_cutoff)::bigint,count(*) filter(where coalesce(accounting_date,movement_date) between p_cutoff-1 and p_cutoff)::bigint,count(*) filter(where coalesce(accounting_date,movement_date) between p_cutoff-2 and p_cutoff)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)<=p_cutoff-1)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)<=p_cutoff-2)::bigint,count(*) filter(where coalesce(accounting_date,movement_date)<=p_cutoff-3)::bigint
 from public.movements where analysis_id=p_analysis_id and status='unreconciled' and (not p_exclude_opening or not opening_boundary);
$$;
