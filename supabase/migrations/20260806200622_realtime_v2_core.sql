create table public.rt_v2_series (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Reconciliação Real Time',
  account text,
  currency text not null default 'AOA',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rt_v2_imports (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.rt_v2_series(id) on delete cascade,
  original_filename text not null,
  file_sha256 text not null,
  storage_path text,
  file_size bigint not null check (file_size >= 0),
  state text not null default 'created' check (state in ('created','uploading','validating','ingesting','reconciling','calculating','completed','failed')),
  stage text not null default 'A preparar importação',
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  source_rows bigint not null default 0,
  inserted_rows bigint not null default 0,
  duplicate_rows bigint not null default 0,
  rejected_rows bigint not null default 0,
  period_start date,
  period_end date,
  header_map jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  error_message text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (series_id,file_sha256)
);

create table public.rt_v2_movements (
  id bigint generated always as identity primary key,
  series_id uuid not null references public.rt_v2_series(id) on delete cascade,
  import_id uuid not null references public.rt_v2_imports(id) on delete restrict,
  source_row integer not null,
  fingerprint text not null,
  raw_system_date text,
  raw_system_time text,
  raw_accounting_period text,
  raw_account text,
  raw_amount text not null,
  raw_currency text,
  raw_operation_number text,
  raw_description text,
  raw_observations text,
  raw_complementary_info text,
  raw_balance text,
  system_date date,
  system_time time,
  accounting_date date not null,
  account text,
  amount numeric(20,2) not null,
  currency text not null default 'AOA',
  operation_number text,
  description_normalized text,
  balance numeric(20,2),
  balance_sequence_valid boolean,
  expected_balance numeric(20,2),
  native_idtr text,
  reference_26 text,
  status text not null default 'open' check (status in ('open','reconciled','manual','rejected')),
  reconciliation_method text check (reconciliation_method in ('idtr','operation_description','reference_26','manual')),
  reconciliation_rule_version text,
  reconciliation_group_id uuid,
  created_at timestamptz not null default now(),
  unique (series_id,fingerprint)
);

create table public.rt_v2_reconciliation_groups (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.rt_v2_series(id) on delete cascade,
  method text not null check (method in ('idtr','operation_description','reference_26','manual')),
  reconciliation_key text not null,
  rule_version text not null,
  movement_count integer not null check (movement_count >= 2),
  balance numeric(20,2) not null,
  first_accounting_date date not null,
  last_accounting_date date not null,
  operational_delay integer not null default 0 check (operational_delay >= 0),
  reconciled_by uuid references public.profiles(id),
  justification text,
  created_at timestamptz not null default now(),
  check (abs(balance) <= 0.005 or method='manual')
);

alter table public.rt_v2_movements
  add constraint rt_v2_movements_group_fk
  foreign key (reconciliation_group_id)
  references public.rt_v2_reconciliation_groups(id) on delete set null;

create table public.rt_v2_group_movements (
  group_id uuid not null references public.rt_v2_reconciliation_groups(id) on delete cascade,
  movement_id bigint not null references public.rt_v2_movements(id) on delete restrict,
  primary key (group_id,movement_id),
  unique (movement_id)
);

create table public.rt_v2_calculations (
  series_id uuid not null references public.rt_v2_series(id) on delete cascade,
  metric text not null,
  rule_version text not null,
  state text not null default 'pending' check (state in ('pending','processing','completed','failed')),
  result jsonb,
  error_message text,
  started_at timestamptz,
  calculated_at timestamptz,
  primary key (series_id,metric)
);

create table public.rt_v2_daily_metrics (
  series_id uuid not null references public.rt_v2_series(id) on delete cascade,
  metric_date date not null,
  movements bigint not null default 0,
  reconciled bigint not null default 0,
  open bigint not null default 0,
  missing_native_idtr bigint not null default 0,
  amount numeric(20,2) not null default 0,
  rule_version text not null,
  calculated_at timestamptz not null default now(),
  primary key (series_id,metric_date)
);

create table public.rt_v2_operational_calendar (
  calendar_date date primary key,
  is_working_day boolean not null,
  label text,
  source text not null default 'platform',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index rt_v2_imports_series_created_idx on public.rt_v2_imports(series_id,created_at desc);
create index rt_v2_movements_series_date_idx on public.rt_v2_movements(series_id,accounting_date,id);
create index rt_v2_movements_open_idtr_idx on public.rt_v2_movements(series_id,native_idtr,amount,accounting_date,id) where status='open' and native_idtr is not null;
create index rt_v2_movements_open_secondary_idx on public.rt_v2_movements(series_id,operation_number,description_normalized,(abs(amount)),accounting_date,id) where status='open';
create index rt_v2_groups_series_delay_idx on public.rt_v2_reconciliation_groups(series_id,operational_delay,created_at);

alter table public.rt_v2_series enable row level security;
alter table public.rt_v2_imports enable row level security;
alter table public.rt_v2_movements enable row level security;
alter table public.rt_v2_reconciliation_groups enable row level security;
alter table public.rt_v2_group_movements enable row level security;
alter table public.rt_v2_calculations enable row level security;
alter table public.rt_v2_daily_metrics enable row level security;
alter table public.rt_v2_operational_calendar enable row level security;

create policy rt_v2_series_read on public.rt_v2_series for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_imports_read on public.rt_v2_imports for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_movements_read on public.rt_v2_movements for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_groups_read on public.rt_v2_reconciliation_groups for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_group_movements_read on public.rt_v2_group_movements for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_calculations_read on public.rt_v2_calculations for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_daily_metrics_read on public.rt_v2_daily_metrics for select to authenticated using ((select private.is_active_user()));
create policy rt_v2_calendar_read on public.rt_v2_operational_calendar for select to authenticated using ((select private.is_active_user()));

revoke all on public.rt_v2_series,public.rt_v2_imports,public.rt_v2_movements,public.rt_v2_reconciliation_groups,public.rt_v2_group_movements,public.rt_v2_calculations,public.rt_v2_daily_metrics,public.rt_v2_operational_calendar from anon;
grant select on public.rt_v2_series,public.rt_v2_imports,public.rt_v2_movements,public.rt_v2_reconciliation_groups,public.rt_v2_group_movements,public.rt_v2_calculations,public.rt_v2_daily_metrics,public.rt_v2_operational_calendar to authenticated;

comment on table public.rt_v2_movements is 'Movimentos Real Time V2: campos raw imutáveis e campos derivados separados.';
comment on table public.rt_v2_calculations is 'Estado explícito das métricas; ausência de resultado nunca equivale a zero.';

