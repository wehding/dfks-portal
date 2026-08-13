-- Statistics privacy and participation are organisation-scoped. A rights holder
-- can belong to more than one organisation, so the legacy global opt-out cannot
-- be the source of truth for new writes.

alter table public.organisations
  add column if not exists statistics_minimum_group_size integer not null default 5;

alter table public.organisations
  drop constraint if exists organisations_statistics_minimum_group_size_check;

alter table public.organisations
  add constraint organisations_statistics_minimum_group_size_check
  check (statistics_minimum_group_size between 1 and 100);

alter table public.org_affiliations
  add column if not exists statistics_participation boolean,
  add column if not exists statistics_participation_source text,
  add column if not exists statistics_participation_updated_at timestamptz,
  add column if not exists statistics_participation_updated_by uuid;

alter table public.org_affiliations
  drop constraint if exists org_affiliations_statistics_participation_source_check;

alter table public.org_affiliations
  add constraint org_affiliations_statistics_participation_source_check
  check (
    statistics_participation_source is null
    or statistics_participation_source in (
      'member_default',
      'member_reenrollment',
      'onboarding_choice',
      'profile_choice',
      'admin_choice',
      'legacy_migration'
    )
  );

-- The requested one-time policy is that all existing active members are
-- enrolled again. A later opt-out from Min profil is preserved because this
-- migration only runs once. Non-members retain the best available legacy
-- choice when they do not already have an organisation-specific choice.
update public.org_affiliations affiliation
set
  statistics_participation = true,
  statistics_participation_source = 'member_reenrollment',
  statistics_participation_updated_at = now(),
  statistics_participation_updated_by = null
where affiliation.is_member;

update public.org_affiliations affiliation
set
  statistics_participation = not coalesce(holder.opt_out_statistics, false),
  statistics_participation_source = 'legacy_migration',
  statistics_participation_updated_at = now(),
  statistics_participation_updated_by = null
from public.rettighedshavere holder
where holder.id = affiliation.rights_holder_id
  and not affiliation.is_member
  and affiliation.statistics_participation is null;

create or replace function private.set_affiliation_statistics_default()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_member and new.statistics_participation is null then
      new.statistics_participation := true;
      new.statistics_participation_source := 'member_default';
      new.statistics_participation_updated_at := now();
      new.statistics_participation_updated_by := auth.uid();
    end if;
  elsif not old.is_member and new.is_member then
    -- Becoming a member enrolls the affiliation once. Later profile choices are
    -- preserved because ordinary member synchronisation does not repeat this
    -- false -> true transition.
    new.statistics_participation := true;
    new.statistics_participation_source := 'member_default';
    new.statistics_participation_updated_at := now();
    new.statistics_participation_updated_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function private.set_affiliation_statistics_default() from public, anon, authenticated;
grant execute on function private.set_affiliation_statistics_default() to service_role;

drop trigger if exists org_affiliations_statistics_default on public.org_affiliations;
create trigger org_affiliations_statistics_default
before insert or update of is_member on public.org_affiliations
for each row execute function private.set_affiliation_statistics_default();

-- Keep the private fact view live, but make the organisation affiliation the
-- authoritative participation record.
create or replace view analytics.contract_facts
with (security_invoker = true)
as
select
  contract.id as contract_id,
  contract.org_id,
  contract.rights_holder_id,
  contract.status as contract_status,
  contract.type as contract_type,
  coalesce(
    case when validation.extracted_data->>'startDate' ~ '^(19|20|21)[0-9]{2}'
      then left(validation.extracted_data->>'startDate', 4)::integer end,
    extract(year from contract.start_date)::integer,
    extract(year from contract.contract_date)::integer
  ) as period_year,
  lower(trim(coalesce(
    validation.extracted_data->>'professionType',
    validation.extracted_data->>'role',
    ''
  ))) as profession_type,
  nullif(validation.extracted_data->>'productionType','') as production_type,
  holder.gender,
  holder.primary_profession_type_id,
  holder.professional_start_year,
  holder.usual_work_mode,
  holder.primary_work_region_code,
  contract.employer_id as legacy_producer_id,
  contract.rights_holder_id is not null
    and affiliation.statistics_participation is true as statistics_allowed,
  validation.extracted_data,
  contract.start_date,
  contract.contract_date,
  contract.created_at as source_updated_at
from public.contracts contract
join public.rettighedshavere holder on holder.id = contract.rights_holder_id
join public.org_affiliations affiliation
  on affiliation.org_id = contract.org_id
 and affiliation.rights_holder_id = contract.rights_holder_id
left join lateral (
  select cv.extracted_data
  from public.contract_validations cv
  where cv.contract_id = contract.id and cv.org_id = contract.org_id
  order by cv.validated_at desc nulls last, cv.created_at desc
  limit 1
) validation on true
where contract.status in ('valideret','kladde');

revoke all on analytics.contract_facts from public, anon, authenticated;
grant select on analytics.contract_facts to service_role;

create index if not exists org_affiliations_statistics_participation_idx
  on public.org_affiliations (org_id, statistics_participation, rights_holder_id);

-- Preserve the safe RPC boundary while exposing every normalised field used by
-- the server-side calculations. Raw contract text and identifying profile data
-- remain outside the result.
create or replace function public.get_statistics_facts(
  target_org_id uuid,
  include_drafts boolean default false
)
returns table (
  contract_id uuid,
  rights_holder_id uuid,
  contract_status text,
  contract_type text,
  period_year integer,
  profession_type text,
  production_type text,
  gender text,
  primary_profession_type_id uuid,
  professional_start_year integer,
  usual_work_mode text,
  primary_work_region_code text,
  producer_ids uuid[],
  producer_type_codes text[],
  membership_types text[],
  statistics_data jsonb,
  start_date date,
  contract_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    fact.contract_id,
    fact.rights_holder_id,
    fact.contract_status,
    fact.contract_type,
    fact.period_year,
    fact.profession_type,
    fact.production_type,
    fact.gender,
    fact.primary_profession_type_id,
    fact.professional_start_year,
    fact.usual_work_mode,
    fact.primary_work_region_code,
    coalesce(producers.ids, '{}'::uuid[]),
    coalesce(types.codes, '{}'::text[]),
    coalesce(types.memberships, '{}'::text[]),
    jsonb_strip_nulls(jsonb_build_object(
      'salary', fact.extracted_data->'salary',
      'salaryUnit', fact.extracted_data->'salaryUnit',
      'personalSupplement', fact.extracted_data->'personalSupplement',
      'postProductionSupplement', fact.extracted_data->'postProductionSupplement',
      'loentillaeg', fact.extracted_data->'loentillaeg',
      'pensionPercent', fact.extracted_data->'pensionPercent',
      'pensionEmployerPercent', fact.extracted_data->'pensionEmployerPercent',
      'pensionEmployeePercent', fact.extracted_data->'pensionEmployeePercent',
      'pensionStatus', fact.extracted_data->'pensionStatus',
      'pensionSource', fact.extracted_data->'pensionSource',
      'workingWeeks', fact.extracted_data->'workingWeeks',
      'startDate', fact.extracted_data->'startDate',
      'endDate', fact.extracted_data->'endDate',
      'svod', fact.extracted_data->'svod',
      'streamingReservation', fact.extracted_data->'streamingReservation',
      'streaming', fact.extracted_data->'streaming',
      'copydan', fact.extracted_data->'copydan',
      'copydanReservation', fact.extracted_data->'copydanReservation',
      'royalty', fact.extracted_data->'royalty',
      'royaltyClause', fact.extracted_data->'royaltyClause',
      'rightsOverview', fact.extracted_data->'rightsOverview',
      'collectiveAgreement', fact.extracted_data->'collectiveAgreement',
      'collectiveAgreementByReference', fact.extracted_data->'collectiveAgreementByReference',
      'agreementReferenceStatus', fact.extracted_data->'agreementReferenceStatus',
      'overenskomst', fact.extracted_data->'overenskomst',
      'overenskomstIdentified', fact.extracted_data->'overenskomstIdentified',
      'aiDataMiningClause', fact.extracted_data->'aiDataMiningClause',
      'holidayPayRate', fact.extracted_data->'holidayPayRate',
      'betaRate', fact.extracted_data->'betaRate',
      'isFreelanceContract', fact.extracted_data->'isFreelanceContract',
      'contractType', fact.extracted_data->'contractType'
    )),
    fact.start_date,
    fact.contract_date
  from analytics.contract_facts fact
  join public.org_affiliations affiliation
    on affiliation.org_id = fact.org_id
   and affiliation.rights_holder_id = fact.rights_holder_id
   and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
   and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
  left join lateral (
    select array_agg(distinct relation.employer_id)
      filter (where relation.employer_id is not null) ids
    from (
      select contract_employer.employer_id
      from public.contract_employers contract_employer
      where contract_employer.contract_id = fact.contract_id
      union
      select fact.legacy_producer_id
    ) relation
  ) producers on true
  left join lateral (
    select
      array_agg(distinct producer_type.code)
        filter (where producer_type.code is not null) codes,
      array_agg(distinct relation.membership_type)
        filter (
          where relation.source = 'producentforeningen'
            and relation.membership_type is not null
        ) memberships
    from public.employer_producer_types relation
    join public.producer_types producer_type on producer_type.id = relation.producer_type_id
    where relation.is_active
      and relation.employer_id = any(coalesce(producers.ids, '{}'::uuid[]))
  ) types on true
  where fact.org_id = target_org_id
    and fact.statistics_allowed
    and fact.period_year is not null
    and (fact.contract_status = 'valideret' or include_drafts)
$$;

revoke all on function public.get_statistics_facts(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.get_statistics_facts(uuid, boolean)
  to service_role;

-- Profile fields, participation and secondary professions must be committed as
-- one unit; otherwise a transient failure can leave the profile and consent
-- record disagreeing.
create or replace function private.update_member_statistics_profile(
  target_rights_holder_id uuid,
  target_org_id uuid,
  actor_user_id uuid,
  participates boolean,
  start_year integer,
  primary_profession_id uuid,
  secondary_profession_ids uuid[],
  work_mode text,
  work_region_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.org_affiliations
    where org_id = target_org_id and rights_holder_id = target_rights_holder_id
  ) then
    return false;
  end if;

  if primary_profession_id is not null and not exists (
    select 1 from public.organisation_profession_types
    where org_id = target_org_id and profession_type_id = primary_profession_id
  ) then
    return false;
  end if;

  if exists (
    select 1
    from unnest(coalesce(secondary_profession_ids, '{}'::uuid[])) profession_id
    where not exists (
      select 1 from public.organisation_profession_types
      where org_id = target_org_id and profession_type_id = profession_id
    )
  ) then
    return false;
  end if;

  if work_region_code is not null and not exists (
    select 1 from public.organisation_work_regions
    where org_id = target_org_id and code = work_region_code and active
  ) then
    return false;
  end if;

  update public.rettighedshavere
  set opt_out_statistics = not participates,
      professional_start_year = start_year,
      primary_profession_type_id = primary_profession_id,
      usual_work_mode = work_mode,
      primary_work_region_code = work_region_code,
      updated_at = now()
  where id = target_rights_holder_id;
  if not found then return false; end if;

  update public.org_affiliations
  set statistics_participation = participates,
      statistics_participation_source = 'profile_choice',
      statistics_participation_updated_at = now(),
      statistics_participation_updated_by = actor_user_id
  where org_id = target_org_id and rights_holder_id = target_rights_holder_id;

  delete from public.rights_holder_profession_types
  where rights_holder_id = target_rights_holder_id;

  insert into public.rights_holder_profession_types(rights_holder_id, profession_type_id)
  select target_rights_holder_id, profession_id
  from (
    select distinct unnest(coalesce(secondary_profession_ids, '{}'::uuid[])) profession_id
  ) selected
  where profession_id is distinct from primary_profession_id;

  return true;
end;
$$;

revoke all on function private.update_member_statistics_profile(uuid, uuid, uuid, boolean, integer, uuid, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function private.update_member_statistics_profile(uuid, uuid, uuid, boolean, integer, uuid, uuid[], text, text)
  to service_role;

create or replace function public.update_member_statistics_profile(
  target_rights_holder_id uuid,
  target_org_id uuid,
  actor_user_id uuid,
  participates boolean,
  start_year integer,
  primary_profession_id uuid,
  secondary_profession_ids uuid[],
  work_mode text,
  work_region_code text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.update_member_statistics_profile(
    target_rights_holder_id,
    target_org_id,
    actor_user_id,
    participates,
    start_year,
    primary_profession_id,
    secondary_profession_ids,
    work_mode,
    work_region_code
  );
$$;

revoke all on function public.update_member_statistics_profile(uuid, uuid, uuid, boolean, integer, uuid, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.update_member_statistics_profile(uuid, uuid, uuid, boolean, integer, uuid, uuid[], text, text)
  to service_role;
