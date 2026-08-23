create table public.work_credit_source_syncs (
  org_id uuid not null references public.organisations(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  source text not null check (source in ('dfi', 'tmdb')),
  status text not null default 'idle' check (status in ('idle', 'refreshing', 'ready', 'error')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now(),
  primary key (org_id, work_id, source)
);

comment on table public.work_credit_source_syncs is
  'Serverbeskyttet synkstatus for DFI- og TMDb-krediteringer. Indeholder ingen eksterne raasvar eller kontaktdata.';

create index work_credit_source_syncs_stale_idx
  on public.work_credit_source_syncs (org_id, last_success_at, next_retry_at)
  where status <> 'refreshing';

alter table public.work_credit_source_syncs enable row level security;
revoke all on public.work_credit_source_syncs from public, anon, authenticated;
grant select, insert, update, delete on public.work_credit_source_syncs to service_role;

create or replace function public.claim_work_credit_source_refresh(
  p_org_id uuid,
  p_work_id uuid,
  p_source text,
  p_force boolean default false
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  if p_source not in ('dfi', 'tmdb') then
    raise exception 'Ukendt krediteringskilde';
  end if;

  insert into public.work_credit_source_syncs (
    org_id, work_id, source, status, last_attempt_at, lease_expires_at, updated_at
  ) values (
    p_org_id, p_work_id, p_source, 'refreshing', now(), now() + interval '2 minutes', now()
  )
  on conflict (org_id, work_id, source) do update
  set status = 'refreshing',
      last_attempt_at = now(),
      lease_expires_at = now() + interval '2 minutes',
      last_error_code = null,
      updated_at = now()
  where (
      public.work_credit_source_syncs.status <> 'refreshing'
      or public.work_credit_source_syncs.lease_expires_at is null
      or public.work_credit_source_syncs.lease_expires_at <= now()
    )
    and (
      p_force
      or (
        (public.work_credit_source_syncs.last_success_at is null
          or public.work_credit_source_syncs.last_success_at <= now() - interval '7 days')
        and (public.work_credit_source_syncs.next_retry_at is null
          or public.work_credit_source_syncs.next_retry_at <= now())
      )
    )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_work_credit_source_refresh(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_work_credit_source_refresh(uuid, uuid, text, boolean)
  to service_role;

create or replace function public.replace_work_credit_evidence(
  p_org_id uuid,
  p_work_id uuid,
  p_source text,
  p_rows jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_source not in ('dfi', 'tmdb') then
    raise exception 'Ukendt krediteringskilde';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Krediteringsrækker skal være et array';
  end if;

  delete from public.work_credit_evidence
  where org_id = p_org_id and work_id = p_work_id and source = p_source;

  insert into public.work_credit_evidence (
    org_id, work_id, source, source_work_id, external_person_id,
    credited_name, normalized_name, credited_role, fetched_at
  )
  select
    p_org_id, p_work_id, p_source, row.source_work_id,
    coalesce(row.external_person_id, ''), row.credited_name,
    row.normalized_name, row.credited_role, now()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row(
    source_work_id text,
    external_person_id text,
    credited_name text,
    normalized_name text,
    credited_role text
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_work_credit_evidence(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_work_credit_evidence(uuid, uuid, text, jsonb)
  to service_role;

-- Reparer kun entydige, aktive navneregistreringer i samme organisation.
-- Invitation og mailafsendelse forbliver altid en manuel adminhandling.
with unique_claims as (
  select
    affiliation.org_id,
    claim.normalized_name,
    min(claim.rights_holder_id::text)::uuid as rights_holder_id
  from public.rights_holder_name_claims claim
  join public.org_affiliations affiliation
    on affiliation.rights_holder_id = claim.rights_holder_id
  group by affiliation.org_id, claim.normalized_name
  having count(distinct claim.rights_holder_id) = 1
)
update public.work_share_participants participant
set rights_holder_id = claim.rights_holder_id,
    relationship_status = 'pending',
    updated_at = now()
from unique_claims claim
where participant.rights_holder_id is null
  and participant.relationship_status = 'pending_match'
  and participant.excluded_at is null
  and participant.proposed_name is not null
  and claim.normalized_name = public.normalize_rights_holder_name(participant.proposed_name)
  and claim.org_id = participant.org_id
  and not exists (
    select 1
    from public.work_share_participants existing
    where existing.case_id = participant.case_id
      and existing.rights_holder_id = claim.rights_holder_id
      and existing.id <> participant.id
      and existing.excluded_at is null
  );
