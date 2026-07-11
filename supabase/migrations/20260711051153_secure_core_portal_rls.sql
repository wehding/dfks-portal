-- Faste autorisationsfunktioner undgår både redigerbar user_metadata og rekursive RLS-opslag.
create or replace function public.current_user_has_org_role(target_org_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_org_roles role
    where role.user_id = (select auth.uid())
      and role.org_id = target_org_id
      and (allowed_roles is null or role.role = any(allowed_roles))
  );
$$;

create or replace function public.current_user_owns_rights_holder(target_rights_holder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rettighedshavere holder
    where holder.id = target_rights_holder_id
      and holder.user_id = (select auth.uid())
  );
$$;

create or replace function public.current_user_is_assigned_to_work(target_work_id uuid)
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

revoke all on function public.current_user_has_org_role(uuid, text[]) from public;
revoke all on function public.current_user_owns_rights_holder(uuid) from public;
revoke all on function public.current_user_is_assigned_to_work(uuid) from public;
grant execute on function public.current_user_has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.current_user_owns_rights_holder(uuid) to authenticated, service_role;
grant execute on function public.current_user_is_assigned_to_work(uuid) to authenticated, service_role;

do $$
declare item record;
begin
  for item in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array['works','work_assignments','contracts','rettighedshavere','org_affiliations'])
  loop
    execute format('drop policy if exists %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;
end $$;

alter table public.works enable row level security;
create policy "Brugere kan se relevante værker" on public.works for select to authenticated
using (
  public.current_user_is_assigned_to_work(id)
  or public.current_user_has_org_role(org_id, null)
);
create policy "Orgadmins kan administrere værker" on public.works for all to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

alter table public.rettighedshavere enable row level security;
create policy "Brugere kan se egen rettighedshaver" on public.rettighedshavere for select to authenticated
using (user_id = (select auth.uid()));
create policy "Brugere kan opdatere egen rettighedshaver" on public.rettighedshavere for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy "Orgadmins kan se rettighedshavere" on public.rettighedshavere for select to authenticated
using (exists (
  select 1 from public.org_affiliations affiliation
  where affiliation.rights_holder_id = rettighedshavere.id
    and public.current_user_has_org_role(affiliation.org_id, array['superadmin','admin','org-admin'])
));
create policy "Orgadmins kan opdatere rettighedshavere" on public.rettighedshavere for update to authenticated
using (exists (
  select 1 from public.org_affiliations affiliation
  where affiliation.rights_holder_id = rettighedshavere.id
    and public.current_user_has_org_role(affiliation.org_id, array['superadmin','admin','org-admin'])
))
with check (exists (
  select 1 from public.org_affiliations affiliation
  where affiliation.rights_holder_id = rettighedshavere.id
    and public.current_user_has_org_role(affiliation.org_id, array['superadmin','admin','org-admin'])
));

alter table public.work_assignments enable row level security;
create policy "Brugere kan se egne værktilknytninger" on public.work_assignments for select to authenticated
using (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin'])
);
create policy "Orgadmins kan administrere værktilknytninger" on public.work_assignments for all to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

alter table public.contracts enable row level security;
create policy "Brugere kan se egne kontrakter" on public.contracts for select to authenticated
using (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Orgadmins kan administrere kontrakter" on public.contracts for all to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));

alter table public.org_affiliations enable row level security;
create policy "Brugere kan se egne organisationstilknytninger" on public.org_affiliations for select to authenticated
using (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin'])
);
create policy "Orgadmins kan administrere organisationstilknytninger" on public.org_affiliations for all to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

notify pgrst, 'reload schema';
