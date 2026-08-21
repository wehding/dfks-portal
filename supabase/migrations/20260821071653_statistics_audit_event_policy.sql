-- Statistics query details are a projection of the append-only audit event,
-- not a second authoritative audit log. Legacy rows are allowed to stay null.
alter table analytics.statistics_query_audit
  add column if not exists audit_event_id uuid references public.audit_events(id) on delete set null;

create unique index if not exists statistics_query_audit_event_id_key
  on analytics.statistics_query_audit(audit_event_id)
  where audit_event_id is not null;

comment on table analytics.statistics_query_audit is
  'Statistik-specifikke auditdetaljer. public.audit_events er den autoritative append-only auditlog; denne tabel peger på audit_event_id for nye rækker.';

comment on column analytics.statistics_query_audit.audit_event_id is
  'Reference til det autoritative audit-event for statistikforespørgslen. Null betyder historisk legacy-række fra før samlet auditlog.';

-- The product rule is 80% by default. Organisations can choose another value
-- explicitly in settings, but the server still clamps it to 50-100%.
alter table public.organisations
  alter column statistics_dominance_limit set default 0.80;

update public.organisations
set statistics_dominance_limit = 0.80
where statistics_dominance_limit = 0.85;

comment on column public.organisations.statistics_dominance_limit is
  'Top-2 dominansgrænse for økonomiske statistikceller. Lavere værdi slører mere; højere værdi viser mere og kræver auditmæssig begrundelse.';

drop function if exists public.record_statistics_query_audit(uuid, uuid, text, text, integer, jsonb);

create or replace function public.record_statistics_query_audit(
  target_org_id uuid,
  target_actor_user_id uuid,
  target_query_fingerprint text,
  target_calculation_version text,
  target_suppression_count integer,
  target_result_shape jsonb,
  target_audit_event_id uuid
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
  if target_audit_event_id is null then
    raise exception 'statistics query audit requires an authoritative audit event id';
  end if;

  insert into analytics.statistics_query_audit (
    org_id, actor_user_id, query_fingerprint, calculation_version,
    suppression_count, result_shape, audit_event_id
  ) values (
    target_org_id, target_actor_user_id, target_query_fingerprint,
    target_calculation_version, greatest(0, target_suppression_count),
    coalesce(target_result_shape, '{}'::jsonb), target_audit_event_id
  ) returning id into audit_id;
  return audit_id;
end;
$$;

revoke all on function public.record_statistics_query_audit(uuid, uuid, text, text, integer, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_statistics_query_audit(uuid, uuid, text, text, integer, jsonb, uuid)
  to service_role;
