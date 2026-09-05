-- Persistent, privacy-minimised operational telemetry for the superadmin
-- Insights page. These tables are intentionally unavailable to browser roles.

create table if not exists public.observability_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  source text not null check (source in ('vercel_analytics', 'vercel_speed_insights', 'vercel_runtime')),
  event_type text not null,
  metric_name text,
  route_template text,
  observed_at timestamptz not null,
  numeric_value double precision,
  device_class text check (device_class is null or device_class in ('desktop', 'mobile', 'tablet', 'unknown')),
  environment text not null default 'production',
  deployment_id text,
  status_code integer,
  error_fingerprint text,
  error_summary text,
  sample_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint observability_route_is_template check (
    route_template is null or (route_template like '/%' and route_template !~ '[?#]')
  ),
  constraint observability_error_summary_length check (
    error_summary is null or char_length(error_summary) <= 300
  )
);

create index if not exists observability_events_source_time_idx
  on public.observability_events (source, observed_at desc);
create index if not exists observability_events_route_time_idx
  on public.observability_events (route_template, observed_at desc)
  where route_template is not null;

create table if not exists public.performance_test_results (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  run_id text not null,
  run_url text,
  commit_sha text,
  branch_name text,
  row_count integer,
  project_name text not null,
  route_name text not null,
  route_template text not null,
  scenario text,
  first_row_ms integer,
  complete_ms integer,
  request_count integer,
  transferred_bytes bigint,
  passed boolean not null,
  thresholds jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  constraint performance_route_is_template check (route_template like '/%' and route_template !~ '[?#]')
);

create index if not exists performance_test_results_time_idx
  on public.performance_test_results (observed_at desc);
create index if not exists performance_test_results_route_idx
  on public.performance_test_results (route_name, observed_at desc);

create table if not exists public.observability_source_status (
  source text primary key check (source in ('vercel_analytics', 'vercel_speed_insights', 'vercel_runtime', 'github_performance')),
  state text not null check (state in ('pending', 'healthy', 'stale', 'degraded', 'disabled')),
  last_event_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  safe_details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.observability_source_status (source, state)
values
  ('vercel_analytics', 'pending'),
  ('vercel_speed_insights', 'pending'),
  ('vercel_runtime', 'pending'),
  ('github_performance', 'pending')
on conflict (source) do nothing;

alter table public.observability_events enable row level security;
alter table public.performance_test_results enable row level security;
alter table public.observability_source_status enable row level security;

revoke all on public.observability_events from public, anon, authenticated;
revoke all on public.performance_test_results from public, anon, authenticated;
revoke all on public.observability_source_status from public, anon, authenticated;
grant select, insert, update, delete on public.observability_events to service_role;
grant select, insert, update, delete on public.performance_test_results to service_role;
grant select, insert, update on public.observability_source_status to service_role;

create or replace function public.cleanup_observability_events(p_before timestamptz default now() - interval '90 days')
returns table(deleted_events bigint, deleted_performance_results bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_events bigint;
  v_results bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  delete from public.observability_events where observed_at < p_before;
  get diagnostics v_events = row_count;
  delete from public.performance_test_results where observed_at < p_before;
  get diagnostics v_results = row_count;
  return query select v_events, v_results;
end;
$$;

revoke all on function public.cleanup_observability_events(timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_observability_events(timestamptz) to service_role;

comment on table public.observability_events is
  'Privacy-minimised operational telemetry. Never store raw URLs, query strings, user identifiers, emails, names, prompts or document content.';
comment on table public.performance_test_results is
  'Sanitised synthetic performance measurements published from GitHub Actions.';
