-- Permanent, global AI model settings and privacy-safe usage metering.

create table public.ai_runtime_settings (
  use_case text primary key check (use_case in ('contract_extraction', 'contract_advice')),
  provider text not null check (provider in ('anthropic', 'google')),
  model text not null,
  prompt_caching_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.ai_model_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('anthropic', 'google')),
  model text not null,
  pricing_mode text not null default 'standard' check (pricing_mode in ('standard', 'batch')),
  effective_from date not null,
  effective_to date,
  input_usd_per_million numeric(12,6) not null default 0,
  output_usd_per_million numeric(12,6) not null default 0,
  cache_write_usd_per_million numeric(12,6) not null default 0,
  cache_read_usd_per_million numeric(12,6) not null default 0,
  unique (provider, model, pricing_mode, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.ai_exchange_rates (
  rate_date date primary key,
  usd_dkk numeric(12,6) not null check (usd_dkk > 0),
  source text not null default 'ECB',
  fetched_at timestamptz not null default now()
);

create table public.ai_usage_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  operation_type text not null check (operation_type in ('contract_extraction', 'contract_advice')),
  entity_type text,
  entity_id text,
  actor_user_id uuid,
  source text not null default 'api' check (source in ('portal', 'admin', 'api', 'cron', 'import')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text
);

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_usage_runs(id) on delete cascade,
  org_id uuid,
  use_case text not null,
  stage text not null,
  provider text not null,
  model text not null,
  pricing_mode text not null default 'standard' check (pricing_mode in ('standard', 'batch')),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  thinking_tokens bigint not null default 0 check (thinking_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  input_chars bigint not null default 0 check (input_chars >= 0),
  output_chars bigint not null default 0 check (output_chars >= 0),
  input_usd_per_million numeric(12,6) not null default 0,
  output_usd_per_million numeric(12,6) not null default 0,
  cache_write_usd_per_million numeric(12,6) not null default 0,
  cache_read_usd_per_million numeric(12,6) not null default 0,
  usd_dkk_rate numeric(12,6),
  cost_usd numeric(16,8) not null default 0,
  cost_dkk numeric(16,8),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  provider_request_id text,
  status text not null check (status in ('succeeded', 'failed')),
  error_code text,
  created_at timestamptz not null default now()
);

create index ai_usage_runs_org_started_idx on public.ai_usage_runs (org_id, started_at desc, id desc);
create index ai_usage_runs_operation_started_idx on public.ai_usage_runs (operation_type, started_at desc);
create index ai_usage_events_run_idx on public.ai_usage_events (run_id, created_at);
create index ai_usage_events_org_created_idx on public.ai_usage_events (org_id, created_at desc, id desc);
create index ai_usage_events_model_created_idx on public.ai_usage_events (provider, model, created_at desc);
create index ai_model_prices_lookup_idx on public.ai_model_prices (provider, model, pricing_mode, effective_from desc);

alter table public.ai_runtime_settings enable row level security;
alter table public.ai_model_prices enable row level security;
alter table public.ai_exchange_rates enable row level security;
alter table public.ai_usage_runs enable row level security;
alter table public.ai_usage_events enable row level security;

revoke all on public.ai_runtime_settings, public.ai_model_prices, public.ai_exchange_rates,
  public.ai_usage_runs, public.ai_usage_events from public, anon, authenticated;
grant select on public.ai_runtime_settings, public.ai_model_prices, public.ai_exchange_rates,
  public.ai_usage_runs, public.ai_usage_events to authenticated;
grant all on public.ai_runtime_settings, public.ai_model_prices, public.ai_exchange_rates,
  public.ai_usage_runs, public.ai_usage_events to service_role;

create policy "AI settings are visible to administrators"
on public.ai_runtime_settings for select to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

create policy "AI prices are visible to administrators"
on public.ai_model_prices for select to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

create policy "AI exchange rates are visible to administrators"
on public.ai_exchange_rates for select to authenticated
using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

create policy "AI usage runs are organisation scoped"
on public.ai_usage_runs for select to authenticated
using (
  public.current_user_has_any_role(array['superadmin'])
  or (org_id is not null and public.current_user_has_org_role(org_id, array['admin','org-admin']))
);

create policy "AI usage events are organisation scoped"
on public.ai_usage_events for select to authenticated
using (
  public.current_user_has_any_role(array['superadmin'])
  or (org_id is not null and public.current_user_has_org_role(org_id, array['admin','org-admin']))
);

insert into public.ai_runtime_settings (use_case, provider, model)
values
  ('contract_extraction', 'anthropic', 'claude-sonnet-4-6'),
  ('contract_advice', 'anthropic', 'claude-sonnet-4-6')
on conflict (use_case) do nothing;

insert into public.ai_model_prices (
  provider, model, pricing_mode, effective_from,
  input_usd_per_million, output_usd_per_million,
  cache_write_usd_per_million, cache_read_usd_per_million
)
values
  ('anthropic', 'claude-sonnet-4-6', 'standard', '2026-01-01', 3.00, 15.00, 3.75, 0.30),
  ('anthropic', 'claude-sonnet-4-6', 'batch',    '2026-01-01', 1.50,  7.50, 0.00, 0.00),
  ('google', 'gemini-3.5-flash-lite', 'standard', '2026-07-21', 0.30, 2.50, 0.00, 0.03),
  ('google', 'gemini-3.5-flash-lite', 'batch',    '2026-07-21', 0.15, 1.25, 0.00, 0.00),
  ('google', 'gemini-3.6-flash', 'standard', '2026-07-21', 1.50, 7.50, 0.00, 0.15),
  ('google', 'gemini-3.6-flash', 'batch',    '2026-07-21', 0.75, 3.75, 0.00, 0.00),
  ('google', 'gemini-embedding-001', 'standard', '2025-06-01', 0.15, 0.00, 0.00, 0.00)
on conflict (provider, model, pricing_mode, effective_from) do nothing;

-- Initial display rate. Runtime refreshes this from ECB and stores the applied rate on each event.
insert into public.ai_exchange_rates (rate_date, usd_dkk, source)
values ('2026-07-28', 6.57, 'ECB baseline')
on conflict (rate_date) do nothing;

comment on table public.ai_usage_events is
  'Privacy-safe AI billing metadata only. Prompts, contract text and model responses must never be stored here.';
