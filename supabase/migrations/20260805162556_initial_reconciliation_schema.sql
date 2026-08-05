create extension if not exists pgcrypto;
create schema if not exists private;

create type public.user_role as enum ('administrator', 'analyst', 'auditor');
create type public.analysis_status as enum ('processing', 'completed', 'failed');
create type public.reconciliation_status as enum ('automatic', 'manual', 'unreconciled', 'missing_idtr', 'data_error');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role public.user_role not null default 'analyst',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account text,
  currency text not null default 'AOA',
  current_report_date date,
  accounting_balance numeric(20,2),
  period_start date,
  result_summary jsonb not null default '{}'::jsonb,
  status public.analysis_status not null default 'processing',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  report_date date not null,
  original_filename text not null,
  storage_path text not null unique,
  file_sha256 text not null,
  movement_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  unique (analysis_id, file_sha256)
);

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  batch_id uuid not null references public.import_batches(id) on delete restrict,
  source_row integer not null,
  movement_date date,
  movement_time time,
  accounting_date date,
  account text,
  amount numeric(20,2) not null,
  currency text not null default 'AOA',
  operation_number text,
  description text,
  complementary_info text,
  balance numeric(20,2),
  idtr text,
  fingerprint text not null,
  status public.reconciliation_status not null default 'unreconciled',
  reconciliation_group_id uuid,
  created_at timestamptz not null default now(),
  unique (analysis_id, fingerprint)
);

create table public.daily_metrics (
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  metric_date date not null,
  movements integer not null default 0,
  automatic integer not null default 0,
  unreconciled integer not null default 0,
  missing_idtr integer not null default 0,
  amount numeric(20,2) not null default 0,
  primary key (analysis_id, metric_date)
);

create table public.reconciliation_groups (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  idtr text,
  status public.reconciliation_status not null,
  balance numeric(20,2) not null,
  justification text,
  rule_version text,
  reconciled_by uuid references public.profiles(id),
  reconciled_at timestamptz,
  reversed_by uuid references public.profiles(id),
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now()
);

alter table public.movements add constraint movements_group_fk foreign key (reconciliation_group_id) references public.reconciliation_groups(id);

create table public.reconciliation_group_movements (
  group_id uuid not null references public.reconciliation_groups(id) on delete cascade,
  movement_id uuid not null references public.movements(id) on delete restrict,
  primary key (group_id, movement_id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  analysis_id uuid references public.analyses(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index movements_analysis_status_idx on public.movements (analysis_id, status);
create index movements_analysis_idtr_idx on public.movements (analysis_id, idtr);
create index audit_logs_filter_idx on public.audit_logs (created_at desc, actor_id, action);
create index batches_analysis_date_idx on public.import_batches (analysis_id, report_date desc);
create index movements_analysis_date_idx on public.movements (analysis_id, accounting_date desc, movement_time);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'administrator' and is_active); $$;
revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and is_active); $$;
revoke all on function private.is_active_user() from public;
grant execute on function private.is_active_user() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when lower(new.email) = 'dabranches@gmail.com' then 'administrator'::public.user_role else 'analyst'::public.user_role end)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.analyses enable row level security;
alter table public.import_batches enable row level security;
alter table public.movements enable row level security;
alter table public.reconciliation_groups enable row level security;
alter table public.reconciliation_group_movements enable row level security;
alter table public.audit_logs enable row level security;
alter table public.daily_metrics enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_admin_update on public.profiles for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy analyses_read on public.analyses for select to authenticated using ((select private.is_active_user()));
create policy analyses_write on public.analyses for insert to authenticated with check ((select private.is_active_user()) and created_by = (select auth.uid()));
create policy analyses_update on public.analyses for update to authenticated using (created_by = (select auth.uid()) or (select private.is_admin())) with check (created_by = (select auth.uid()) or (select private.is_admin()));
create policy batches_read on public.import_batches for select to authenticated using ((select private.is_active_user()));
create policy batches_write on public.import_batches for insert to authenticated with check (uploaded_by = (select auth.uid()));
create policy batches_update on public.import_batches for update to authenticated using (uploaded_by = (select auth.uid()) or (select private.is_admin())) with check (uploaded_by = (select auth.uid()) or (select private.is_admin()));
create policy movements_read on public.movements for select to authenticated using ((select private.is_active_user()));
create policy movements_insert on public.movements for insert to authenticated with check (exists (select 1 from public.import_batches b where b.id = batch_id and b.uploaded_by = (select auth.uid())));
create policy groups_read on public.reconciliation_groups for select to authenticated using ((select private.is_active_user()));
create policy groups_write on public.reconciliation_groups for insert to authenticated with check ((reconciled_by is null or reconciled_by = (select auth.uid())) and exists (select 1 from public.analyses a where a.id = analysis_id and (a.created_by = (select auth.uid()) or (select private.is_admin()))));
create policy groups_update on public.reconciliation_groups for update to authenticated using (reconciled_by = (select auth.uid()) or (select private.is_admin())) with check (reconciled_by = (select auth.uid()) or (select private.is_admin()));
create policy group_movements_read on public.reconciliation_group_movements for select to authenticated using ((select private.is_active_user()));
create policy group_movements_write on public.reconciliation_group_movements for insert to authenticated with check (exists (select 1 from public.reconciliation_groups g join public.analyses a on a.id = g.analysis_id where g.id = group_id and (a.created_by = (select auth.uid()) or (select private.is_admin()))));
create policy audit_read on public.audit_logs for select to authenticated using ((select private.is_admin()) or actor_id = (select auth.uid()));
create policy audit_insert on public.audit_logs for insert to authenticated with check (actor_id = (select auth.uid()));
create policy daily_metrics_read on public.daily_metrics for select to authenticated using ((select private.is_active_user()));
create policy daily_metrics_write on public.daily_metrics for insert to authenticated with check (exists (select 1 from public.analyses a where a.id = analysis_id and (a.created_by = (select auth.uid()) or (select private.is_admin()))));
create policy daily_metrics_update on public.daily_metrics for update to authenticated using (exists (select 1 from public.analyses a where a.id = analysis_id and (a.created_by = (select auth.uid()) or (select private.is_admin())))) with check (exists (select 1 from public.analyses a where a.id = analysis_id and (a.created_by = (select auth.uid()) or (select private.is_admin()))));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reconciliation-files', 'reconciliation-files', false, 262144000, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'])
on conflict (id) do nothing;

create policy reconciliation_files_read on storage.objects for select to authenticated using (bucket_id = 'reconciliation-files');
create policy reconciliation_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'reconciliation-files' and (storage.foldername(name))[1] = (select auth.uid()::text));

grant select, insert, update on public.profiles, public.analyses, public.import_batches, public.reconciliation_groups to authenticated;
grant select, insert on public.movements, public.reconciliation_group_movements to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant select, insert, update on public.daily_metrics to authenticated;
