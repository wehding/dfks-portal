-- Expose structured salary supplements through the existing service-role-only
-- statistics boundary. Browser clients still cannot read analytics facts.
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
      'otherSupplements', fact.extracted_data->'otherSupplements',
      'hasCreditClause', fact.extracted_data->'hasCreditClause',
      'creditClauseStatus', fact.extracted_data->'creditClauseStatus',
      'contractCredits', fact.extracted_data->'contractCredits',
      'creditedRoles', fact.extracted_data->'creditedRoles',
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


