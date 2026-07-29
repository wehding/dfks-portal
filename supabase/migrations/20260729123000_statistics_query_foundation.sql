-- Lukket statistikfundament. analytics-schemaet eksponeres ikke gennem
-- browser-API'et; kun serverkode med service_role må læse rå faktaposter.
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to service_role;

create table if not exists analytics.contract_facts (
  contract_id uuid primary key,
  org_id uuid not null,
  rights_holder_id uuid not null,
  period_year integer not null,
  profession_type text,
  producer_id uuid,
  production_type text,
  monthly_salary numeric,
  pension_percent numeric,
  working_weeks numeric,
  source_updated_at timestamptz,
  refreshed_at timestamptz not null default now()
);
create index if not exists contract_facts_org_year_idx
  on analytics.contract_facts(org_id, period_year);
revoke all on analytics.contract_facts from public, anon, authenticated;
grant all on analytics.contract_facts to service_role;

create table if not exists analytics.cpi_monthly (
  period_month date primary key,
  index_value numeric not null,
  source text not null default 'Danmarks Statistik PRIS111',
  source_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
revoke all on analytics.cpi_monthly from public, anon, authenticated;
grant all on analytics.cpi_monthly to service_role;

alter table public.ai_runtime_settings
  drop constraint if exists ai_runtime_settings_use_case_check;
alter table public.ai_runtime_settings
  add constraint ai_runtime_settings_use_case_check
  check (use_case in ('contract_extraction', 'contract_advice', 'statistics_query'));

alter table public.ai_usage_runs
  drop constraint if exists ai_usage_runs_operation_type_check;
alter table public.ai_usage_runs
  add constraint ai_usage_runs_operation_type_check
  check (operation_type in ('contract_extraction', 'contract_advice', 'statistics_query'));

insert into public.ai_runtime_settings (use_case, provider, model)
values ('statistics_query', 'anthropic', 'claude-sonnet-4-6')
on conflict (use_case) do nothing;
