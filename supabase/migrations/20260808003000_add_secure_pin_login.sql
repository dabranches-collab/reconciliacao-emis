alter table public.profiles
  add column if not exists pin_enabled boolean not null default false;

create table if not exists public.pin_login_attempts (
  email text primary key,
  failed_count integer not null default 0 check (failed_count >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.pin_login_attempts enable row level security;
revoke all on public.pin_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.pin_login_attempts to service_role;

comment on table public.pin_login_attempts is
'Controlo técnico de tentativas de autenticação por PIN. Apenas service_role pode aceder.';
comment on column public.profiles.pin_enabled is
'Indica que a conta tem um PIN de quatro algarismos configurado; o PIN nunca é guardado.';
