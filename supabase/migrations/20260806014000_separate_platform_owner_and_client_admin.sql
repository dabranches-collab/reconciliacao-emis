alter type public.user_role rename value 'administrator' to 'platform_owner';
alter type public.user_role add value if not exists 'client_admin' after 'platform_owner';

create or replace function private.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role::text = 'platform_owner' and is_active); $$;
revoke all on function private.is_platform_owner() from public;
grant execute on function private.is_platform_owner() to authenticated;

create or replace function private.is_user_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role::text in ('platform_owner','client_admin') and is_active); $$;
revoke all on function private.is_user_manager() from public;
grant execute on function private.is_user_manager() to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select (select private.is_platform_owner()); $$;

drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_management_update on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (select private.is_platform_owner())
  or ((select private.is_user_manager()) and role::text <> 'platform_owner')
);
create policy profiles_management_update on public.profiles for update to authenticated
using (
  (select private.is_platform_owner())
  or ((select private.is_user_manager()) and role::text <> 'platform_owner')
)
with check (
  (select private.is_platform_owner())
  or ((select private.is_user_manager()) and role::text <> 'platform_owner')
);

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated
using ((select private.is_platform_owner()));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when lower(new.email) = 'dabranches@gmail.com'
      then 'platform_owner'::public.user_role
      else 'analyst'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

update public.profiles
set role = 'platform_owner'::public.user_role, updated_at = now()
where lower(email) = 'dabranches@gmail.com';
