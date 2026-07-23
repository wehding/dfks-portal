-- Canonical production companies, legal entities and shared work relations.
-- Existing employer_id/cvr/text columns remain as compatibility mirrors while
-- application reads migrate to the relation tables below.

alter table public.employers
  add column if not exists status text not null default 'active',
  add column if not exists is_verified boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists merged_into_id uuid references public.employers(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.employer_aliases (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  alias text not null check (length(trim(alias)) between 1 and 200),
  alias_type text not null default 'spelling'
    check (alias_type in ('spelling', 'abbreviation', 'former_name', 'imported')),
  source text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists employer_aliases_normalized_unique
  on public.employer_aliases (employer_id, lower(trim(alias)));
create index if not exists employer_aliases_search_idx
  on public.employer_aliases (lower(trim(alias)));

create table if not exists public.employer_legal_entities (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete restrict,
  legal_name text not null check (length(trim(legal_name)) between 1 and 250),
  registration_country text not null default 'DK'
    check (registration_country ~ '^[A-Z]{2}$'),
  registration_type text not null default 'CVR'
    check (length(trim(registration_type)) between 1 and 30),
  registration_number text,
  entity_kind text not null default 'company'
    check (entity_kind in ('company', 'subsidiary', 'spv')),
  address text,
  registration_status text,
  is_primary boolean not null default false,
  valid_from date,
  valid_to date,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employer_legal_entities_dk_cvr_check check (
    registration_country <> 'DK'
    or upper(registration_type) <> 'CVR'
    or registration_number is null
    or registration_number ~ '^[0-9]{8}$'
  ),
  constraint employer_legal_entities_dates_check check (
    valid_to is null or valid_from is null or valid_to >= valid_from
  )
);

create unique index if not exists employer_legal_entities_registration_unique
  on public.employer_legal_entities (
    registration_country,
    upper(registration_type),
    registration_number
  ) where registration_number is not null;
create unique index if not exists employer_legal_entities_one_primary
  on public.employer_legal_entities (employer_id) where is_primary and archived_at is null;
create index if not exists employer_legal_entities_employer_idx
  on public.employer_legal_entities (employer_id, archived_at);
create index if not exists employer_legal_entities_name_idx
  on public.employer_legal_entities (lower(trim(legal_name)));

create table if not exists public.work_organisations (
  work_id uuid not null references public.works(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  relation_role text not null default 'catalogue',
  created_at timestamptz not null default now(),
  primary key (work_id, org_id)
);
create index if not exists work_organisations_org_idx
  on public.work_organisations (org_id, work_id);

create table if not exists public.work_employers (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  employer_id uuid not null references public.employers(id) on delete restrict,
  legal_entity_id uuid references public.employer_legal_entities(id) on delete restrict,
  relation_role text not null default 'producer',
  sort_order integer not null default 0,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint work_employers_legal_entity_owner_check check (legal_entity_id is null or employer_id is not null)
);
create unique index if not exists work_employers_unique_relation
  on public.work_employers (
    work_id,
    employer_id,
    coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    relation_role
  );
create index if not exists work_employers_employer_idx
  on public.work_employers (employer_id, work_id);

create table if not exists public.contract_employers (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  employer_id uuid not null references public.employers(id) on delete restrict,
  legal_entity_id uuid references public.employer_legal_entities(id) on delete restrict,
  relation_role text not null default 'counterparty',
  sort_order integer not null default 0,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create unique index if not exists contract_employers_unique_relation
  on public.contract_employers (
    contract_id,
    employer_id,
    coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    relation_role
  );
create index if not exists contract_employers_employer_idx
  on public.contract_employers (employer_id, contract_id);

create table if not exists public.employer_merge_audit (
  id uuid primary key default gen_random_uuid(),
  source_employer_id uuid not null references public.employers(id) on delete restrict,
  target_employer_id uuid not null references public.employers(id) on delete restrict,
  merged_by uuid references auth.users(id) on delete set null,
  merged_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

-- Backfill existing CVR values. Abort before the unique registration index can
-- hide a duplicate: the grouped query inserts only unambiguous CVRs.
do $$
begin
  if exists (
    select regexp_replace(cvr, '[^0-9]', '', 'g')
    from public.employers
    where cvr is not null and trim(cvr) <> ''
      and regexp_replace(cvr, '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
    group by regexp_replace(cvr, '[^0-9]', '', 'g')
    having count(*) > 1
  ) then
    raise exception 'Duplicate employer CVR values must be resolved before migration';
  end if;
end $$;

insert into public.employer_legal_entities (
  employer_id, legal_name, registration_country, registration_type,
  registration_number, is_primary, address, registration_status
)
select
  id, name, 'DK', 'CVR', regexp_replace(cvr, '[^0-9]', '', 'g'), true,
  address, 'legacy_import'
from public.employers
where cvr is not null
  and trim(cvr) <> ''
  and regexp_replace(cvr, '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
on conflict do nothing;

-- Existing work/company text becomes canonical referenced data. Exact
-- case-insensitive matches are reused; unmatched imported names get an
-- unverified canonical row so producer lists no longer lose those works.
insert into public.employers (name, status, is_verified)
select distinct trim(company_name), 'active', false
from public.works w
cross join lateral unnest(w.production_companies) company_name
where trim(company_name) <> ''
  and not exists (
    select 1 from public.employers e
    where lower(trim(e.name)) = lower(trim(company_name))
  )
on conflict (name) do nothing;

insert into public.work_organisations (work_id, org_id, relation_role)
select id, org_id, 'steward'
from public.works
on conflict (work_id, org_id) do nothing;

insert into public.work_employers (work_id, employer_id, relation_role, source, sort_order)
select w.id, w.employer_id, 'producer', 'legacy_employer_id', 0
from public.works w
where w.employer_id is not null
on conflict do nothing;

insert into public.work_employers (work_id, employer_id, relation_role, source, sort_order)
select w.id, e.id, 'producer', 'legacy_production_companies', company.ordinality::integer
from public.works w
cross join lateral unnest(w.production_companies) with ordinality company(name, ordinality)
join public.employers e on lower(trim(e.name)) = lower(trim(company.name))
where trim(company.name) <> ''
on conflict do nothing;

insert into public.contract_employers (contract_id, employer_id, relation_role, source, sort_order)
select id, employer_id, 'counterparty', 'legacy_employer_id', 0
from public.contracts
where employer_id is not null
on conflict do nothing;

-- Ensure a selected legal entity always belongs to the selected canonical employer.
create or replace function public.validate_employer_legal_entity_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.legal_entity_id is not null and not exists (
    select 1 from public.employer_legal_entities entity
    where entity.id = new.legal_entity_id
      and entity.employer_id = new.employer_id
      and entity.archived_at is null
  ) then
    raise exception 'Legal entity does not belong to canonical employer';
  end if;
  return new;
end;
$$;

drop trigger if exists work_employers_validate_legal_entity on public.work_employers;
create trigger work_employers_validate_legal_entity
before insert or update of employer_id, legal_entity_id on public.work_employers
for each row execute function public.validate_employer_legal_entity_owner();

drop trigger if exists contract_employers_validate_legal_entity on public.contract_employers;
create trigger contract_employers_validate_legal_entity
before insert or update of employer_id, legal_entity_id on public.contract_employers
for each row execute function public.validate_employer_legal_entity_owner();

revoke execute on function public.validate_employer_legal_entity_owner() from public, anon, authenticated;

-- Atomic canonical merge. It is deliberately service-role-only; the API checks
-- that the caller is superadmin before invoking it.
create or replace function public.merge_canonical_employers(
  source_id uuid,
  target_id uuid,
  actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if source_id = target_id then
    raise exception 'Source and target must differ';
  end if;
  if not exists (select 1 from public.employers where id = source_id and merged_into_id is null)
     or not exists (select 1 from public.employers where id = target_id and merged_into_id is null) then
    raise exception 'Canonical employer not found or already merged';
  end if;
  if exists (
    select 1
    from public.employer_legal_entities source_entity
    join public.employer_legal_entities target_entity
      on target_entity.employer_id = target_id
     and target_entity.registration_country = source_entity.registration_country
     and upper(target_entity.registration_type) = upper(source_entity.registration_type)
     and target_entity.registration_number = source_entity.registration_number
    where source_entity.employer_id = source_id
      and source_entity.registration_number is not null
  ) then
    raise exception 'The companies contain the same registration number';
  end if;

  update public.employer_legal_entities
    set employer_id = target_id, is_primary = false, updated_at = now()
    where employer_id = source_id;
  insert into public.employer_aliases (employer_id, alias, alias_type, source, created_by)
    select target_id, source.name, 'former_name', 'canonical_merge', actor_id
    from public.employers source where source.id = source_id
    on conflict do nothing;
  insert into public.employer_aliases (employer_id, alias, alias_type, source, created_by, created_at)
    select target_id, alias, alias_type, source, created_by, created_at
    from public.employer_aliases where employer_id = source_id
    on conflict do nothing;
  delete from public.employer_aliases where employer_id = source_id;
  insert into public.work_employers (work_id, employer_id, legal_entity_id, relation_role, sort_order, source, created_at)
    select work_id, target_id, legal_entity_id, relation_role, sort_order, source, created_at
    from public.work_employers where employer_id = source_id
    on conflict do nothing;
  delete from public.work_employers where employer_id = source_id;
  insert into public.contract_employers (contract_id, employer_id, legal_entity_id, relation_role, sort_order, source, created_at)
    select contract_id, target_id, legal_entity_id, relation_role, sort_order, source, created_at
    from public.contract_employers where employer_id = source_id
    on conflict do nothing;
  delete from public.contract_employers where employer_id = source_id;
  update public.works set employer_id = target_id where employer_id = source_id;
  update public.contracts set employer_id = target_id where employer_id = source_id;
  update public.employers
    set merged_into_id = target_id, archived_at = now(), status = 'merged', updated_at = now()
    where id = source_id;
  insert into public.employer_merge_audit (source_employer_id, target_employer_id, merged_by)
    values (source_id, target_id, actor_id);
end;
$$;

revoke execute on function public.merge_canonical_employers(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_canonical_employers(uuid, uuid, uuid) to service_role;

alter table public.employer_aliases enable row level security;
alter table public.employer_legal_entities enable row level security;
alter table public.work_organisations enable row level security;
alter table public.work_employers enable row level security;
alter table public.contract_employers enable row level security;
alter table public.employer_merge_audit enable row level security;

drop policy if exists "Authenticated users read employer aliases" on public.employer_aliases;
create policy "Authenticated users read employer aliases" on public.employer_aliases
  for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists "Authenticated users read legal entities" on public.employer_legal_entities;
create policy "Authenticated users read legal entities" on public.employer_legal_entities
  for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists "Admins manage employer aliases" on public.employer_aliases;
create policy "Admins manage employer aliases" on public.employer_aliases
  for all to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
  with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));
drop policy if exists "Admins manage legal entities" on public.employer_legal_entities;
create policy "Admins manage legal entities" on public.employer_legal_entities
  for all to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
  with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

drop policy if exists "Users read work organisations for own org" on public.work_organisations;
create policy "Users read work organisations for own org" on public.work_organisations
  for select to authenticated
  using (public.current_user_has_org_role(org_id, null));
drop policy if exists "Admins manage work organisations" on public.work_organisations;
create policy "Admins manage work organisations" on public.work_organisations
  for all to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
  with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

drop policy if exists "Authenticated users read work producers" on public.work_employers;
create policy "Authenticated users read work producers" on public.work_employers
  for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists "Admins manage work producers" on public.work_employers;
create policy "Admins manage work producers" on public.work_employers
  for all to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
  with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

drop policy if exists "Users read contract producers in own org" on public.contract_employers;
create policy "Users read contract producers in own org" on public.contract_employers
  for select to authenticated using (
    exists (
      select 1 from public.contracts contract_row
      where contract_row.id = contract_id
        and public.current_user_has_org_role(contract_row.org_id, null)
    )
  );
drop policy if exists "Admins manage contract producers in own org" on public.contract_employers;
create policy "Admins manage contract producers in own org" on public.contract_employers
  for all to authenticated
  using (
    exists (
      select 1 from public.contracts contract_row
      where contract_row.id = contract_id
        and public.current_user_has_org_role(contract_row.org_id, array['superadmin','admin','org-admin','jurist'])
    )
  )
  with check (
    exists (
      select 1 from public.contracts contract_row
      where contract_row.id = contract_id
        and public.current_user_has_org_role(contract_row.org_id, array['superadmin','admin','org-admin','jurist'])
    )
  );

drop policy if exists "Superadmins read employer merge audit" on public.employer_merge_audit;
create policy "Superadmins read employer merge audit" on public.employer_merge_audit
  for select to authenticated
  using (public.current_user_has_any_role(array['superadmin']));

revoke all on public.employer_aliases, public.employer_legal_entities,
  public.work_organisations, public.work_employers, public.contract_employers,
  public.employer_merge_audit from anon;
grant select on public.employer_aliases, public.employer_legal_entities,
  public.work_employers, public.employer_merge_audit to authenticated;
grant select, insert, update, delete on public.work_organisations,
  public.contract_employers to authenticated;
grant insert, update, delete on public.employer_aliases,
  public.employer_legal_entities, public.work_employers to authenticated;
grant all on public.employer_aliases, public.employer_legal_entities,
  public.work_organisations, public.work_employers, public.contract_employers,
  public.employer_merge_audit to service_role;

comment on table public.employer_legal_entities is
  'Legal registrations (including multiple CVRs) grouped below one canonical employer.';
comment on table public.employer_aliases is
  'Spelling variants only; registrations belong in employer_legal_entities.';
comment on table public.work_organisations is
  'Organisation access/use relation for the shared works catalogue.';
