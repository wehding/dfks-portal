-- Embedding APIs do not expose authoritative token usage. Keep those estimates
-- explicit so administrators can distinguish them from provider-reported usage.
alter table public.ai_usage_events
  add column usage_estimated boolean not null default false;

comment on column public.ai_usage_events.usage_estimated is
  'True only when token usage is a documented estimate rather than provider-reported usage.';
