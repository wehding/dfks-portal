-- Statistics privacy is a hard server-side boundary. Organisations can choose
-- a stricter value, but never less than three independent persons.
update public.organisations
set statistics_minimum_group_size = 3
where statistics_minimum_group_size < 3;

alter table public.organisations
  drop constraint if exists organisations_statistics_minimum_group_size_check;

alter table public.organisations
  add constraint organisations_statistics_minimum_group_size_check
  check (statistics_minimum_group_size between 3 and 100);

alter table public.organisations
  add column if not exists statistics_dominance_limit numeric not null default 0.85,
  add column if not exists statistics_low_sample_threshold integer not null default 10;

alter table public.organisations
  drop constraint if exists organisations_statistics_dominance_limit_check,
  drop constraint if exists organisations_statistics_low_sample_threshold_check;

alter table public.organisations
  add constraint organisations_statistics_dominance_limit_check
    check (statistics_dominance_limit between 0.50 and 1.00),
  add constraint organisations_statistics_low_sample_threshold_check
    check (statistics_low_sample_threshold between 5 and 100);

create table if not exists analytics.member_statistics_profiles (
  org_id uuid not null references public.organisations(id) on delete cascade,
  pseudonym_key text not null,
  education_level text,
  education_direction text,
  graduation_year integer check (graduation_year between 1900 and 2200),
  disco_08 text,
  job_level text,
  management_responsibility boolean,
  home_municipality_code text,
  work_municipality_code text,
  validated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (org_id, pseudonym_key)
);

create table if not exists analytics.standardized_compensation_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  pseudonym_key text not null,
  source_record_key text not null,
  period_year integer not null check (period_year between 1900 and 2200),
  base_monthly_salary numeric check (base_monthly_salary >= 0),
  employer_pension_monthly numeric check (employer_pension_monthly >= 0),
  employee_pension_monthly numeric check (employee_pension_monthly >= 0),
  recurring_supplements_monthly numeric check (recurring_supplements_monthly >= 0),
  annual_bonus numeric check (annual_bonus >= 0),
  annual_commission numeric check (annual_commission >= 0),
  annual_overtime numeric check (annual_overtime >= 0),
  annual_benefits numeric check (annual_benefits >= 0),
  annual_sh_savings numeric check (annual_sh_savings >= 0),
  agreed_monthly_hours numeric check (agreed_monthly_hours > 0),
  paid_personal_leave_hours numeric check (paid_personal_leave_hours >= 0),
  paid_public_holiday_hours numeric check (paid_public_holiday_hours >= 0),
  fixed_gross_monthly numeric check (fixed_gross_monthly >= 0),
  total_monthly_earnings numeric check (total_monthly_earnings >= 0),
  standard_hourly_rate numeric,
  effective_hourly_rate numeric,
  sector text,
  employer_size integer check (employer_size >= 0),
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'validated', 'rejected')),
  calculation_version text not null,
  source_updated_at timestamptz,
  calculated_at timestamptz not null default now(),
  unique (org_id, source_record_key, calculation_version)
);

create index if not exists standardized_compensation_org_year_idx
  on analytics.standardized_compensation_facts (org_id, period_year)
  where validation_status = 'validated';

create table if not exists analytics.statistics_reference_series (
  series_key text not null,
  period_date date not null,
  value numeric not null,
  source_name text not null,
  source_url text,
  source_version text not null,
  synced_at timestamptz not null default now(),
  primary key (series_key, period_date, source_version)
);

create table if not exists analytics.statistics_geography (
  municipality_code text primary key,
  municipality_name text not null,
  nuts_3_code text not null,
  nuts_2_code text not null,
  centroid_latitude numeric,
  centroid_longitude numeric,
  source_version text not null,
  updated_at timestamptz not null default now()
);

create table if not exists analytics.statistics_query_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  actor_user_id uuid,
  query_fingerprint text not null,
  calculation_version text not null,
  suppression_count integer not null default 0,
  result_shape jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table analytics.member_statistics_profiles enable row level security;
alter table analytics.standardized_compensation_facts enable row level security;
alter table analytics.statistics_reference_series enable row level security;
alter table analytics.statistics_geography enable row level security;
alter table analytics.statistics_query_audit enable row level security;

revoke all on analytics.member_statistics_profiles from public, anon, authenticated;
revoke all on analytics.standardized_compensation_facts from public, anon, authenticated;
revoke all on analytics.statistics_reference_series from public, anon, authenticated;
revoke all on analytics.statistics_geography from public, anon, authenticated;
revoke all on analytics.statistics_query_audit from public, anon, authenticated;

grant all on analytics.member_statistics_profiles to service_role;
grant all on analytics.standardized_compensation_facts to service_role;
grant all on analytics.statistics_reference_series to service_role;
grant all on analytics.statistics_geography to service_role;
grant all on analytics.statistics_query_audit to service_role;

create or replace function public.record_statistics_query_audit(
  target_org_id uuid,
  target_actor_user_id uuid,
  target_query_fingerprint text,
  target_calculation_version text,
  target_suppression_count integer,
  target_result_shape jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  audit_id uuid;
begin
  if length(target_query_fingerprint) <> 64 then
    raise exception 'invalid statistics query fingerprint';
  end if;
  insert into analytics.statistics_query_audit (
    org_id, actor_user_id, query_fingerprint, calculation_version,
    suppression_count, result_shape
  ) values (
    target_org_id, target_actor_user_id, target_query_fingerprint,
    target_calculation_version, greatest(0, target_suppression_count),
    coalesce(target_result_shape, '{}'::jsonb)
  ) returning id into audit_id;
  return audit_id;
end;
$$;

revoke all on function public.record_statistics_query_audit(uuid, uuid, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_statistics_query_audit(uuid, uuid, text, text, integer, jsonb)
  to service_role;

comment on table analytics.member_statistics_profiles is
  'Private statistics-only profile keyed by an organisation-scoped pseudonym. Names, CPR and addresses are prohibited.';
comment on table analytics.standardized_compensation_facts is
  'Validated, versioned compensation facts. Browser roles have no access.';
