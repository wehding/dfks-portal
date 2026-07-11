-- Keep RLS helper functions outside the Data API schema. Public wrappers are
-- SECURITY INVOKER so existing policy references remain compatible without
-- exposing SECURITY DEFINER functions as RPC endpoints.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.current_user_has_any_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = (select auth.uid())
      and role_row.role = any(allowed_roles)
  );
$$;

create or replace function private.current_user_has_org_role(target_org_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = (select auth.uid())
      and (allowed_roles is null or role_row.role = any(allowed_roles))
      and (
        role_row.org_id = target_org_id
        or (role_row.role = 'superadmin' and allowed_roles is not null and 'superadmin' = any(allowed_roles))
      )
  );
$$;

create or replace function private.current_user_belongs_to_org(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = (select auth.uid())
      and (role_row.org_id = target_org_id or role_row.role = 'superadmin')
  );
$$;

create or replace function private.current_user_owns_rights_holder(target_rights_holder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rettighedshavere holder
    where holder.id = target_rights_holder_id
      and holder.user_id = (select auth.uid())
  );
$$;

create or replace function private.current_user_is_assigned_to_work(target_work_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.work_assignments assignment
    join public.rettighedshavere holder on holder.id = assignment.rights_holder_id
    where assignment.work_id = target_work_id
      and holder.user_id = (select auth.uid())
  );
$$;

create or replace function private.current_user_can_admin_rights_holder(target_rights_holder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.current_user_has_any_role(array['superadmin'])
    or exists (
      select 1
      from public.org_affiliations affiliation
      where affiliation.rights_holder_id = target_rights_holder_id
        and private.current_user_has_org_role(
          affiliation.org_id,
          array['superadmin','admin','org-admin']
        )
    );
$$;

create or replace function private.current_user_owns_contract(target_contract_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contracts contract_row
    where contract_row.id = target_contract_id
      and private.current_user_owns_rights_holder(contract_row.rights_holder_id)
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

create or replace function public.current_user_has_any_role(allowed_roles text[])
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_user_has_any_role(allowed_roles); $$;

create or replace function public.current_user_has_org_role(target_org_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_user_has_org_role(target_org_id, allowed_roles); $$;

create or replace function public.current_user_belongs_to_org(target_org_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_user_belongs_to_org(target_org_id); $$;

create or replace function public.current_user_owns_rights_holder(target_rights_holder_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_user_owns_rights_holder(target_rights_holder_id); $$;

create or replace function public.current_user_is_assigned_to_work(target_work_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_user_is_assigned_to_work(target_work_id); $$;

create or replace function public.current_user_can_admin_rights_holder(target_rights_holder_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_user_can_admin_rights_holder(target_rights_holder_id); $$;

create or replace function public.current_user_owns_contract(target_contract_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_user_owns_contract(target_contract_id); $$;

create or replace function public.auth_rights_holder_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select holder.id
  from public.rettighedshavere holder
  where holder.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_org_admin(check_org_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.current_user_has_org_role(
    check_org_id,
    array['superadmin','admin','org-admin']
  );
$$;

-- These functions are trigger/internal endpoints, not public RPC methods.
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;
revoke all on function public.upsert_work_for_member(uuid, text, text, integer, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_work_for_member(uuid, text, text, integer, text, integer, text, text)
  to service_role;

-- Complete RLS coverage for the three exposed tables Advisor found without a
-- policy. Member and admin access follows the parent contract/role relation.
alter table public.contract_episodes enable row level security;
create policy "Brugere og orgroller kan se kontraktafnsit"
on public.contract_episodes for select to authenticated
using (
  public.current_user_owns_contract(contract_id)
  or exists (
    select 1
    from public.contracts contract_row
    where contract_row.id = contract_episodes.contract_id
      and public.current_user_belongs_to_org(contract_row.org_id)
  )
);
create policy "Admins kan oprette kontraktafnsit"
on public.contract_episodes for insert to authenticated
with check (
  exists (
    select 1
    from public.contracts contract_row
    where contract_row.id = contract_episodes.contract_id
      and public.current_user_has_org_role(
        contract_row.org_id,
        array['superadmin','admin','org-admin','jurist']
      )
  )
);
create policy "Admins kan slette kontraktafnsit"
on public.contract_episodes for delete to authenticated
using (
  exists (
    select 1
    from public.contracts contract_row
    where contract_row.id = contract_episodes.contract_id
      and public.current_user_has_org_role(
        contract_row.org_id,
        array['superadmin','admin','org-admin','jurist']
      )
  )
);

alter table public.learned_patterns enable row level security;
create policy "Indloggede kan se aktive læringsmønstre"
on public.learned_patterns for select to authenticated
using ((select auth.uid()) is not null);
create policy "Admins kan oprette læringsmønstre"
on public.learned_patterns for insert to authenticated
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan opdatere læringsmønstre"
on public.learned_patterns for update to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan slette læringsmønstre"
on public.learned_patterns for delete to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));

alter table public.overenskomst_uploads enable row level security;
create policy "Admins kan se overenskomstuploads"
on public.overenskomst_uploads for select to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan oprette overenskomstuploads"
on public.overenskomst_uploads for insert to authenticated
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan opdatere overenskomstuploads"
on public.overenskomst_uploads for update to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan slette overenskomstuploads"
on public.overenskomst_uploads for delete to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));

notify pgrst, 'reload schema';
