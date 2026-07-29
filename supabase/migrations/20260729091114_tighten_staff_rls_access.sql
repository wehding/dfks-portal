-- Split ordinary organisation membership from staff authorization.
-- Members intentionally keep access to their own rows, but an ordinary
-- `member` role must never unlock all sensitive rows in an organisation.

create or replace function private.current_user_is_global_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.user_org_roles role_row
    where role_row.user_id = (select auth.uid())
      and role_row.role = 'superadmin'
  );
$$;

create or replace function private.current_user_can_admin_org(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    private.current_user_is_global_staff()
    or exists (
      select 1 from public.user_org_roles role_row
      where role_row.user_id = (select auth.uid())
        and role_row.org_id = target_org_id
        and role_row.role in ('admin', 'org-admin')
    )
  );
$$;

create or replace function private.current_user_can_review_org(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    private.current_user_is_global_staff()
    or exists (
      select 1 from public.user_org_roles role_row
      where role_row.user_id = (select auth.uid())
        and role_row.org_id = target_org_id
        and role_row.role in ('admin', 'org-admin', 'jurist')
    )
  );
$$;

create or replace function private.current_user_is_member_owner(target_rights_holder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.rettighedshavere holder
    where holder.id = target_rights_holder_id
      and holder.user_id = (select auth.uid())
  );
$$;

revoke all on function private.current_user_is_global_staff() from public, anon;
revoke all on function private.current_user_can_admin_org(uuid) from public, anon;
revoke all on function private.current_user_can_review_org(uuid) from public, anon;
revoke all on function private.current_user_is_member_owner(uuid) from public, anon;
grant execute on function private.current_user_is_global_staff() to authenticated, service_role;
grant execute on function private.current_user_can_admin_org(uuid) to authenticated, service_role;
grant execute on function private.current_user_can_review_org(uuid) to authenticated, service_role;
grant execute on function private.current_user_is_member_owner(uuid) to authenticated, service_role;

create or replace function public.current_user_is_global_staff()
returns boolean language sql stable set search_path = ''
as $$ select private.current_user_is_global_staff(); $$;
create or replace function public.current_user_can_admin_org(target_org_id uuid)
returns boolean language sql stable set search_path = ''
as $$ select private.current_user_can_admin_org(target_org_id); $$;
create or replace function public.current_user_can_review_org(target_org_id uuid)
returns boolean language sql stable set search_path = ''
as $$ select private.current_user_can_review_org(target_org_id); $$;
create or replace function public.current_user_is_member_owner(target_rights_holder_id uuid)
returns boolean language sql stable set search_path = ''
as $$ select private.current_user_is_member_owner(target_rights_holder_id); $$;

revoke all on function public.current_user_is_global_staff() from public, anon;
revoke all on function public.current_user_can_admin_org(uuid) from public, anon;
revoke all on function public.current_user_can_review_org(uuid) from public, anon;
revoke all on function public.current_user_is_member_owner(uuid) from public, anon;
grant execute on function public.current_user_is_global_staff() to authenticated, service_role;
grant execute on function public.current_user_can_admin_org(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_review_org(uuid) to authenticated, service_role;
grant execute on function public.current_user_is_member_owner(uuid) to authenticated, service_role;

drop policy if exists "Brugere og orgroller kan se kontrakter" on public.contracts;
create policy "Ejere og reviewstaff kan se kontrakter" on public.contracts
for select to authenticated using (
  public.current_user_is_member_owner(rights_holder_id)
  or public.current_user_can_review_org(org_id)
);

drop policy if exists "Brugere og orgroller kan se kontraktgennemgange" on public.contract_reviews;
create policy "Medlemmer og reviewstaff kan se kontraktgennemgange" on public.contract_reviews
for select to authenticated using (
  member_id = (select auth.uid())
  or public.current_user_can_review_org(org_id)
);

drop policy if exists "Brugere og orgroller kan se valideringer" on public.contract_validations;
create policy "Ejere og reviewstaff kan se valideringer" on public.contract_validations
for select to authenticated using (
  public.current_user_owns_contract(contract_id)
  or public.current_user_can_review_org(org_id)
);

drop policy if exists "Brugere og orgroller kan se kontraktafnsit" on public.contract_episodes;
create policy "Ejere og reviewstaff kan se kontraktafnsit" on public.contract_episodes
for select to authenticated using (
  public.current_user_owns_contract(contract_id)
  or exists (
    select 1 from public.contracts contract_row
    where contract_row.id = contract_episodes.contract_id
      and public.current_user_can_review_org(contract_row.org_id)
  )
);

drop policy if exists "Brugere kan se relevante værker" on public.works;
create policy "Tilknyttede medlemmer og staff kan se værker" on public.works
for select to authenticated using (
  public.current_user_is_assigned_to_work(id)
  or public.current_user_has_any_role(array['superadmin','admin','org-admin'])
  or public.current_user_can_review_org(org_id)
);

drop policy if exists "Brugere kan se relevante værktilknytninger" on public.work_assignments;
create policy "Ejere og staff kan se værktilknytninger" on public.work_assignments
for select to authenticated using (
  public.current_user_is_member_owner(rights_holder_id)
  or public.current_user_can_review_org(org_id)
);

drop policy if exists "Brugere kan se episoder for egne orgs værker" on public.episodes;
create policy "Tilknyttede medlemmer og staff kan se episoder" on public.episodes
for select to authenticated using (exists (
  select 1 from public.works work_row
  where work_row.id = episodes.work_id
    and (
      public.current_user_is_assigned_to_work(work_row.id)
      or public.current_user_has_any_role(array['superadmin','admin','org-admin'])
      or public.current_user_can_review_org(work_row.org_id)
    )
));

drop policy if exists "Brugere kan se produktionsnumre for egne orgs værker" on public.work_production_numbers;
create policy "Tilknyttede medlemmer og staff kan se produktionsnumre" on public.work_production_numbers
for select to authenticated using (exists (
  select 1 from public.works work_row
  where work_row.id = work_production_numbers.work_id
    and (
      public.current_user_is_assigned_to_work(work_row.id)
      or public.current_user_has_any_role(array['superadmin','admin','org-admin'])
      or public.current_user_can_review_org(work_row.org_id)
    )
));

drop policy if exists "Brugere kan se relevante juridiske noter" on public.legal_notes;
create policy "Staff kan se relevante juridiske noter" on public.legal_notes
for select to authenticated using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or (org_id is not null and public.current_user_can_review_org(org_id))
);

drop policy if exists "Brugere kan se relevante referencedokumenter" on public.reference_docs;
create policy "Staff kan se relevante referencedokumenter" on public.reference_docs
for select to authenticated using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or (org_id is not null and public.current_user_can_review_org(org_id))
);

drop policy if exists "Orgroller kan se analysefeedback" on public.analysis_feedback;
create policy "Staff kan se analysefeedback" on public.analysis_feedback
for select to authenticated using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or (org_id is not null and public.current_user_can_review_org(org_id))
);

drop policy if exists "Orgroller kan se sagserfaringer" on public.case_learnings;
create policy "Staff kan se sagserfaringer" on public.case_learnings
for select to authenticated using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or (org_id is not null and public.current_user_can_review_org(org_id))
);

drop policy if exists "Orgroller kan se videnbidder" on public.knowledge_chunks;
create policy "Staff kan se videnbidder" on public.knowledge_chunks
for select to authenticated using (
  (org_id is null and public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist']))
  or (org_id is not null and public.current_user_can_review_org(org_id))
);

-- Jurister må behandle og validere, men ikke udføre destruktive sletninger.
drop policy if exists "Orgadmins kan slette kontrakter" on public.contracts;
create policy "Orgadmins kan slette kontrakter" on public.contracts
for delete to authenticated using (public.current_user_can_admin_org(org_id));

drop policy if exists "Admins kan slette kontraktgennemgange" on public.contract_reviews;
create policy "Admins kan slette kontraktgennemgange" on public.contract_reviews
for delete to authenticated using (public.current_user_can_admin_org(org_id));

drop policy if exists "Admins kan slette valideringer" on public.contract_validations;
create policy "Admins kan slette valideringer" on public.contract_validations
for delete to authenticated using (public.current_user_can_admin_org(org_id));

drop policy if exists "Admins kan slette kontraktafnsit" on public.contract_episodes;
create policy "Admins kan slette kontraktafnsit" on public.contract_episodes
for delete to authenticated using (exists (
  select 1 from public.contracts contract_row
  where contract_row.id = contract_episodes.contract_id
    and public.current_user_can_admin_org(contract_row.org_id)
));

create index if not exists user_org_roles_user_role_org_idx
  on public.user_org_roles (user_id, role, org_id);
