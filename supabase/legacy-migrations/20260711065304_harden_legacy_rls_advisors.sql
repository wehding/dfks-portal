-- Harden legacy RLS policies that relied on user-editable JWT metadata or
-- unconditional authenticated access. This migration intentionally keeps
-- shared reference data readable to signed-in users while moving every
-- authorization decision to database-owned role and ownership relations.

create or replace function public.current_user_has_any_role(allowed_roles text[])
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

create or replace function public.current_user_has_org_role(target_org_id uuid, allowed_roles text[] default null)
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

create or replace function public.current_user_belongs_to_org(target_org_id uuid)
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

create or replace function public.current_user_owns_rights_holder(target_rights_holder_id uuid)
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

create or replace function public.current_user_can_admin_rights_holder(target_rights_holder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.current_user_has_any_role(array['superadmin'])
    or exists (
      select 1
      from public.org_affiliations affiliation
      where affiliation.rights_holder_id = target_rights_holder_id
        and public.current_user_has_org_role(
          affiliation.org_id,
          array['superadmin','admin','org-admin']
        )
    );
$$;

create or replace function public.current_user_owns_contract(target_contract_id uuid)
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
      and public.current_user_owns_rights_holder(contract_row.rights_holder_id)
  );
$$;

revoke all on function public.current_user_has_any_role(text[]) from public;
revoke all on function public.current_user_has_org_role(uuid, text[]) from public;
revoke all on function public.current_user_belongs_to_org(uuid) from public;
revoke all on function public.current_user_owns_rights_holder(uuid) from public;
revoke all on function public.current_user_is_assigned_to_work(uuid) from public;
revoke all on function public.current_user_can_admin_rights_holder(uuid) from public;
revoke all on function public.current_user_owns_contract(uuid) from public;

grant execute on function public.current_user_has_any_role(text[]) to authenticated, service_role;
grant execute on function public.current_user_has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.current_user_belongs_to_org(uuid) to authenticated, service_role;
grant execute on function public.current_user_owns_rights_holder(uuid) to authenticated, service_role;
grant execute on function public.current_user_is_assigned_to_work(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_admin_rights_holder(uuid) to authenticated, service_role;
grant execute on function public.current_user_owns_contract(uuid) to authenticated, service_role;

-- Keep the two legacy helper signatures compatible, but make their lookup
-- deterministic and remove PUBLIC execution on the SECURITY DEFINER functions.
create or replace function public.auth_rights_holder_id()
returns uuid
language sql
stable
security definer
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
security definer
set search_path = ''
as $$
  select public.current_user_has_org_role(
    check_org_id,
    array['superadmin','admin','org-admin']
  );
$$;

revoke all on function public.auth_rights_holder_id() from public;
revoke all on function public.is_org_admin(uuid) from public;
grant execute on function public.auth_rights_holder_id() to authenticated, service_role;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;

-- Drop legacy and duplicate policies on the tables covered below. Recreating
-- each action explicitly avoids overlapping permissive ALL + SELECT policies.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'analysis_feedback',
        'case_learnings',
        'contract_reviews',
        'contract_validations',
        'contracts',
        'employer_registries',
        'employers',
        'knowledge_chunks',
        'legal_note_history',
        'legal_notes',
        'org_affiliations',
        'organisations',
        'overenskomst_satser',
        'reference_docs',
        'rettighedshavere',
        'screening_claims',
        'work_assignments',
        'works'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end $$;

-- Organisations are shared directory data, but only authenticated users may
-- read them. The explicit predicate replaces the old unconditional policy.
alter table public.organisations enable row level security;
create policy "Indloggede kan se organisationer"
on public.organisations for select to authenticated
using ((select auth.uid()) is not null);

-- Shared employer reference data is readable to members. Only an admin role
-- may mutate it; onboarding suggestions must go through server actions.
alter table public.employers enable row level security;
create policy "Indloggede kan se arbejdsgivere"
on public.employers for select to authenticated
using ((select auth.uid()) is not null);
create policy "Admins kan oprette arbejdsgivere"
on public.employers for insert to authenticated
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));
create policy "Admins kan opdatere arbejdsgivere"
on public.employers for update to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));
create policy "Admins kan slette arbejdsgivere"
on public.employers for delete to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

alter table public.employer_registries enable row level security;
create policy "Indloggede kan se arbejdsgiverforeninger"
on public.employer_registries for select to authenticated
using ((select auth.uid()) is not null);
create policy "Admins kan oprette arbejdsgiverforeninger"
on public.employer_registries for insert to authenticated
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));
create policy "Admins kan opdatere arbejdsgiverforeninger"
on public.employer_registries for update to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));
create policy "Admins kan slette arbejdsgiverforeninger"
on public.employer_registries for delete to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

alter table public.works enable row level security;
create policy "Brugere kan se relevante værker"
on public.works for select to authenticated
using (
  public.current_user_is_assigned_to_work(id)
  or public.current_user_belongs_to_org(org_id)
);
create policy "Orgadmins kan oprette værker"
on public.works for insert to authenticated
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));
create policy "Orgadmins kan opdatere værker"
on public.works for update to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));
create policy "Orgadmins kan slette værker"
on public.works for delete to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

alter table public.work_assignments enable row level security;
create policy "Brugere kan se relevante værktilknytninger"
on public.work_assignments for select to authenticated
using (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_belongs_to_org(org_id)
);
create policy "Orgadmins kan oprette værktilknytninger"
on public.work_assignments for insert to authenticated
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));
create policy "Orgadmins kan opdatere værktilknytninger"
on public.work_assignments for update to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));
create policy "Orgadmins kan slette værktilknytninger"
on public.work_assignments for delete to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

alter table public.rettighedshavere enable row level security;
create policy "Brugere og orgadmins kan se rettighedshavere"
on public.rettighedshavere for select to authenticated
using (
  user_id = (select auth.uid())
  or public.current_user_can_admin_rights_holder(id)
);
create policy "Orgadmins kan oprette rettighedshavere"
on public.rettighedshavere for insert to authenticated
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));
create policy "Brugere og orgadmins kan opdatere rettighedshavere"
on public.rettighedshavere for update to authenticated
using (
  user_id = (select auth.uid())
  or public.current_user_can_admin_rights_holder(id)
)
with check (
  user_id = (select auth.uid())
  or public.current_user_can_admin_rights_holder(id)
);
create policy "Orgadmins kan slette rettighedshavere"
on public.rettighedshavere for delete to authenticated
using (public.current_user_can_admin_rights_holder(id));

alter table public.org_affiliations enable row level security;
create policy "Brugere og orgadmins kan se organisationstilknytninger"
on public.org_affiliations for select to authenticated
using (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin'])
);
create policy "Orgadmins kan oprette organisationstilknytninger"
on public.org_affiliations for insert to authenticated
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));
create policy "Orgadmins kan opdatere organisationstilknytninger"
on public.org_affiliations for update to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));
create policy "Orgadmins kan slette organisationstilknytninger"
on public.org_affiliations for delete to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

alter table public.contracts enable row level security;
create policy "Brugere og orgroller kan se kontrakter"
on public.contracts for select to authenticated
using (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_belongs_to_org(org_id)
);
create policy "Brugere og orgadmins kan oprette kontrakter"
on public.contracts for insert to authenticated
with check (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Brugere og orgadmins kan opdatere kontrakter"
on public.contracts for update to authenticated
using (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
)
with check (
  public.current_user_owns_rights_holder(rights_holder_id)
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Orgadmins kan slette kontrakter"
on public.contracts for delete to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));

-- Legal, learning, validation and AI data are readable within their org. Only
-- admins and legal staff can mutate shared or organisation-specific records.
alter table public.reference_docs enable row level security;
create policy "Brugere kan se relevante referencedokumenter"
on public.reference_docs for select to authenticated
using (org_id is null or public.current_user_belongs_to_org(org_id));
create policy "Admins kan oprette referencedokumenter"
on public.reference_docs for insert to authenticated
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan opdatere referencedokumenter"
on public.reference_docs for update to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
)
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan slette referencedokumenter"
on public.reference_docs for delete to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);

alter table public.legal_notes enable row level security;
create policy "Brugere kan se relevante juridiske noter"
on public.legal_notes for select to authenticated
using (org_id is null or public.current_user_belongs_to_org(org_id));
create policy "Admins kan oprette juridiske noter"
on public.legal_notes for insert to authenticated
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan opdatere juridiske noter"
on public.legal_notes for update to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
)
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan slette juridiske noter"
on public.legal_notes for delete to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);

alter table public.legal_note_history enable row level security;
create policy "Admins kan se juridisk notehistorik"
on public.legal_note_history for select to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan oprette juridisk notehistorik"
on public.legal_note_history for insert to authenticated
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan opdatere juridisk notehistorik"
on public.legal_note_history for update to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
)
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan slette juridisk notehistorik"
on public.legal_note_history for delete to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);

alter table public.case_learnings enable row level security;
create policy "Orgroller kan se sagserfaringer"
on public.case_learnings for select to authenticated
using (org_id is null or public.current_user_belongs_to_org(org_id));
create policy "Admins kan oprette sagserfaringer"
on public.case_learnings for insert to authenticated
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan opdatere sagserfaringer"
on public.case_learnings for update to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
)
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan slette sagserfaringer"
on public.case_learnings for delete to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);

alter table public.analysis_feedback enable row level security;
create policy "Orgroller kan se analysefeedback"
on public.analysis_feedback for select to authenticated
using (org_id is null or public.current_user_belongs_to_org(org_id));
create policy "Admins kan oprette analysefeedback"
on public.analysis_feedback for insert to authenticated
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan opdatere analysefeedback"
on public.analysis_feedback for update to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
)
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan slette analysefeedback"
on public.analysis_feedback for delete to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);

alter table public.contract_validations enable row level security;
create policy "Brugere og orgroller kan se valideringer"
on public.contract_validations for select to authenticated
using (
  public.current_user_owns_contract(contract_id)
  or public.current_user_belongs_to_org(org_id)
);
create policy "Admins kan oprette valideringer"
on public.contract_validations for insert to authenticated
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan opdatere valideringer"
on public.contract_validations for update to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan slette valideringer"
on public.contract_validations for delete to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));

alter table public.knowledge_chunks enable row level security;
create policy "Orgroller kan se videnbidder"
on public.knowledge_chunks for select to authenticated
using (org_id is null or public.current_user_belongs_to_org(org_id));
create policy "Admins kan oprette videnbidder"
on public.knowledge_chunks for insert to authenticated
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan opdatere videnbidder"
on public.knowledge_chunks for update to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
)
with check (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Admins kan slette videnbidder"
on public.knowledge_chunks for delete to authenticated
using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);

-- Rates are no longer publicly writable. Reading is limited to authenticated
-- portal users; admin/legal roles retain maintenance access.
alter table public.overenskomst_satser enable row level security;
create policy "Indloggede kan læse satser"
on public.overenskomst_satser for select to authenticated
using ((select auth.uid()) is not null);
create policy "Admins kan oprette satser"
on public.overenskomst_satser for insert to authenticated
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan opdatere satser"
on public.overenskomst_satser for update to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan slette satser"
on public.overenskomst_satser for delete to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']));

-- Combine member and admin visibility to avoid duplicate permissive SELECT
-- policies while preserving existing access semantics.
alter table public.contract_reviews enable row level security;
create policy "Brugere og orgroller kan se kontraktgennemgange"
on public.contract_reviews for select to authenticated
using (member_id = (select auth.uid()) or public.current_user_belongs_to_org(org_id));
create policy "Admins kan oprette kontraktgennemgange"
on public.contract_reviews for insert to authenticated
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan opdatere kontraktgennemgange"
on public.contract_reviews for update to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));
create policy "Admins kan slette kontraktgennemgange"
on public.contract_reviews for delete to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));

alter table public.screening_claims enable row level security;
create policy "Brugere og orgadmins kan se visningskrav"
on public.screening_claims for select to authenticated
using (
  profile_id = (select auth.uid())
  or public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist'])
);
create policy "Brugere kan oprette egne visningskrav"
on public.screening_claims for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and public.current_user_belongs_to_org(org_id)
);

-- Pin search paths for all project functions flagged by Advisor. Vector
-- operators remain in public, so vector search functions retain public in a
-- fixed path until the extension can be migrated independently.
alter function public.match_knowledge_chunks(vector, double precision, integer)
  set search_path = pg_catalog, public, pg_temp;
alter function public.match_knowledge_chunks(vector, double precision, integer, uuid)
  set search_path = pg_catalog, public, pg_temp;
alter function public.match_learned_patterns(vector, double precision, integer)
  set search_path = pg_catalog, public, pg_temp;
alter function public.update_contract_reviews_updated_at()
  set search_path = pg_catalog, public, pg_temp;

notify pgrst, 'reload schema';
