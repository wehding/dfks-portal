-- Close the gap between the short member intent and Supabase's two-hour
-- signed-upload token. An unlinked intent remains as a server-only tombstone
-- until the upload token has expired, so a late upload can still be removed.
alter table public.contract_upload_intents
  add column if not exists purge_after timestamptz,
  add column if not exists expired_object_cleanup_at timestamptz,
  add column if not exists cleanup_status text not null default 'pending',
  add column if not exists cleanup_claimed_at timestamptz,
  add column if not exists cleanup_claim_token uuid,
  add column if not exists cleanup_claim_kind text,
  add column if not exists finalization_status text not null default 'pending',
  add column if not exists finalization_claimed_at timestamptz,
  add column if not exists finalization_token uuid,
  add column if not exists finalization_request_hash text,
  add column if not exists finalized_at timestamptz;

-- Intents consumed before this migration represent uploads which already ran
-- through the legacy post-processing path. Treat them as finalized, but keep
-- the request hash null because the old code did not calculate one.
update public.contract_upload_intents
set finalization_status = 'finalized',
    finalized_at = coalesce(finalized_at, consumed_at)
where contract_id is not null
  and consumed_at is not null
  and finalization_status = 'pending';

update public.contract_upload_intents
set purge_after = greatest(
  coalesce(purge_after, '-infinity'::timestamptz),
  created_at + interval '2 hours 15 minutes',
  expires_at
)
where purge_after is null
   or purge_after < created_at + interval '2 hours 15 minutes'
   or purge_after < expires_at;

alter table public.contract_upload_intents
  alter column purge_after set default (now() + interval '2 hours 15 minutes'),
  alter column purge_after set not null,
  drop constraint if exists contract_upload_intents_purge_after_check,
  add constraint contract_upload_intents_purge_after_check check (
    purge_after >= created_at + interval '2 hours 15 minutes'
    and purge_after >= expires_at
  ),
  drop constraint if exists contract_upload_intents_cleanup_status_check,
  add constraint contract_upload_intents_cleanup_status_check check (
    cleanup_status in ('pending', 'claimed', 'completed')
  ),
  drop constraint if exists contract_upload_intents_cleanup_claim_check,
  add constraint contract_upload_intents_cleanup_claim_check check (
    (
      cleanup_status = 'pending'
      and cleanup_claim_token is null
      and cleanup_claim_kind is null
    )
    or (
      cleanup_status = 'claimed'
      and cleanup_claimed_at is not null
      and cleanup_claim_token is not null
      and cleanup_claim_kind in ('expired', 'purge')
    )
    or (
      cleanup_status = 'completed'
      and cleanup_claimed_at is not null
      and cleanup_claim_token is not null
      and cleanup_claim_kind = 'expired'
      and expired_object_cleanup_at is not null
    )
  ),
  drop constraint if exists contract_upload_intents_finalization_status_check,
  add constraint contract_upload_intents_finalization_status_check check (
    finalization_status in ('pending', 'processing', 'finalized', 'rolled_back')
  ),
  drop constraint if exists contract_upload_intents_finalization_hash_check,
  add constraint contract_upload_intents_finalization_hash_check check (
    finalization_request_hash is null
    or finalization_request_hash ~ '^[0-9a-f]{64}$'
  ),
  drop constraint if exists contract_upload_intents_finalization_state_check,
  add constraint contract_upload_intents_finalization_state_check check (
    (
      finalization_status = 'pending'
      and finalization_claimed_at is null
      and finalization_token is null
      and finalization_request_hash is null
      and finalized_at is null
    )
    or (
      finalization_status = 'processing'
      and finalization_claimed_at is not null
      and finalization_token is not null
      and finalization_request_hash is not null
      and finalized_at is null
    )
    or (
      finalization_status = 'finalized'
      and finalization_token is null
      and finalized_at is not null
    )
    or (
      finalization_status = 'rolled_back'
      and finalization_token is null
      and finalized_at is null
    )
  );

create index if not exists contract_upload_intents_purge_idx
  on public.contract_upload_intents(purge_after, id);
create index if not exists contract_upload_intents_expired_cleanup_idx
  on public.contract_upload_intents(expires_at, id)
  where contract_id is null and expired_object_cleanup_at is null;
create index if not exists contract_upload_intents_cleanup_claim_idx
  on public.contract_upload_intents(cleanup_status, cleanup_claimed_at, id);
create index if not exists contract_upload_intents_finalization_idx
  on public.contract_upload_intents(finalization_status, finalization_claimed_at, id);

comment on column public.contract_upload_intents.purge_after is
  'Server-only tombstone deadline. At least 15 minutes beyond the fixed two-hour signed upload token.';
comment on column public.contract_upload_intents.expired_object_cleanup_at is
  'Første storage-oprydning efter det korte intent udløber. Tombstonen bevares til purge_after.';
comment on column public.contract_upload_intents.cleanup_claim_token is
  'Service-only lease-token. Storage må kun slettes for et intent, som er claimet med dette token.';
comment on column public.contract_upload_intents.finalization_token is
  'Service-only lease-token. Kun den request, der ejer en ikke-udløbet finaliseringslease, må færdiggøre eller rulle kontrakten tilbage.';
comment on column public.contract_upload_intents.finalization_request_hash is
  'SHA-256 af den normaliserede uploadrequest. Samme request kan genoptages idempotent; en anden request afvises.';

-- Claiming and deleting storage cannot be one PostgreSQL transaction. The
-- database therefore leases each candidate under a row lock before the route
-- is allowed to touch Storage. Contract creation locks the same row and must
-- reject an active cleanup claim, closing the create-vs-delete race.
create or replace function public.claim_contract_upload_intent_cleanup(
  p_cleanup_kind text,
  p_limit integer default 100,
  p_claim_ttl_seconds integer default 300
)
returns table (
  intent_id uuid,
  storage_path text,
  contract_id uuid,
  cleanup_claim_token uuid,
  cleanup_kind text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_cleanup_kind not in ('expired', 'purge')
    or p_limit < 1 or p_limit > 100
    or p_claim_ttl_seconds < 30 or p_claim_ttl_seconds > 3600 then
    raise exception 'invalid cleanup claim' using errcode = '22023';
  end if;

  return query
  with candidates as materialized (
    select intent.id
    from public.contract_upload_intents as intent
    where (
        intent.cleanup_status <> 'claimed'
        or intent.cleanup_claimed_at <= now() - make_interval(secs => p_claim_ttl_seconds)
      )
      and (
        (
          p_cleanup_kind = 'expired'
          and intent.contract_id is null
          and intent.expired_object_cleanup_at is null
          and intent.expires_at <= now()
          and intent.purge_after > now()
        )
        or (
          p_cleanup_kind = 'purge'
          and intent.finalization_status <> 'processing'
          and intent.purge_after <= now()
        )
      )
    order by
      case when p_cleanup_kind = 'expired' then intent.expires_at else intent.purge_after end,
      intent.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.contract_upload_intents as intent
    set cleanup_status = 'claimed',
        cleanup_claimed_at = now(),
        cleanup_claim_token = gen_random_uuid(),
        cleanup_claim_kind = p_cleanup_kind
    from candidates
    where intent.id = candidates.id
    returning intent.id, intent.storage_path, intent.contract_id,
      intent.cleanup_claim_token, intent.cleanup_claim_kind
  )
  select claimed.id, claimed.storage_path, claimed.contract_id,
    claimed.cleanup_claim_token, claimed.cleanup_claim_kind
  from claimed;
end;
$$;

create or replace function public.finish_contract_upload_intent_cleanup(
  p_intent_id uuid,
  p_cleanup_claim_token uuid,
  p_cleanup_kind text,
  p_success boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_intent public.contract_upload_intents;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_cleanup_kind not in ('expired', 'purge') then
    raise exception 'invalid cleanup completion' using errcode = '22023';
  end if;

  select * into claimed_intent
  from public.contract_upload_intents as intent
  where intent.id = p_intent_id
    and intent.cleanup_status = 'claimed'
    and intent.cleanup_claim_token = p_cleanup_claim_token
    and intent.cleanup_claim_kind = p_cleanup_kind
  for update;

  if claimed_intent.id is null then
    return false;
  end if;

  if not p_success then
    update public.contract_upload_intents
    set cleanup_status = 'pending',
        cleanup_claim_token = null,
        cleanup_claim_kind = null
    where id = claimed_intent.id;
    return true;
  end if;

  if p_cleanup_kind = 'expired' then
    update public.contract_upload_intents
    set cleanup_status = 'completed',
        expired_object_cleanup_at = coalesce(expired_object_cleanup_at, now())
    where id = claimed_intent.id;
  else
    delete from public.contract_upload_intents
    where id = claimed_intent.id;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_contract_upload_intent_cleanup(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.finish_contract_upload_intent_cleanup(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_contract_upload_intent_cleanup(text, integer, integer)
  to service_role;
grant execute on function public.finish_contract_upload_intent_cleanup(uuid, uuid, text, boolean)
  to service_role;

-- The contract row and first processing job are committed before optional
-- metadata is attached. A per-intent finalization claim serialises that second
-- phase: one caller owns the token, concurrent retries can only observe the
-- in-progress state, and an identical completed request is idempotent.
create or replace function public.claim_member_uploaded_contract_finalization(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_upload_intent_id uuid,
  p_contract_id uuid,
  p_storage_path text,
  p_request_hash text,
  p_finalization_token uuid
)
returns table (
  outcome text,
  finalization_token uuid,
  contract_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_intent public.contract_upload_intents;
  uploaded_contract public.contracts;
  document_job_count integer;
  ai_job_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_upload_intent_id is null or p_contract_id is null
    or nullif(p_storage_path, '') is null or p_storage_path ~ '[\r\n]'
    or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_finalization_token is null then
    raise exception 'invalid upload finalization claim' using errcode = '22023';
  end if;

  select * into upload_intent
  from public.contract_upload_intents as intent
  where intent.id = p_upload_intent_id
  for update;

  if upload_intent.id is null
    or upload_intent.owner_id is distinct from p_owner_id
    or upload_intent.org_id is distinct from p_org_id
    or upload_intent.rights_holder_id is distinct from p_rights_holder_id
    or upload_intent.storage_path is distinct from p_storage_path
    or upload_intent.contract_id is distinct from p_contract_id
    or upload_intent.consumed_at is null then
    raise exception 'upload finalization identity mismatch' using errcode = '42501';
  end if;
  if upload_intent.cleanup_status = 'claimed' then
    raise exception 'upload intent cleanup in progress' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.contracts as contract
    where contract.id = p_contract_id
      and contract.org_id = p_org_id
      and contract.rights_holder_id = p_rights_holder_id
      and contract.created_by = p_owner_id
      and contract.pdf_url = p_storage_path
  ) then
    raise exception 'uploaded contract mismatch' using errcode = '42501';
  end if;

  if upload_intent.finalization_status = 'finalized' then
    if upload_intent.finalization_request_hash is distinct from p_request_hash then
      raise exception 'upload request differs from finalized request' using errcode = 'P0002';
    end if;
    return query select 'already_finalized'::text, null::uuid, p_contract_id;
    return;
  end if;
  if upload_intent.finalization_status = 'processing' then
    if upload_intent.finalization_request_hash is distinct from p_request_hash then
      raise exception 'upload finalization already claimed by another request' using errcode = 'P0002';
    end if;
    if upload_intent.finalization_claimed_at > now() - interval '10 minutes' then
      if upload_intent.finalization_token = p_finalization_token then
        return query select 'claimed'::text, p_finalization_token, p_contract_id;
        return;
      end if;
      return query select 'in_progress'::text, null::uuid, p_contract_id;
      return;
    end if;
  end if;
  if upload_intent.finalization_status not in ('pending', 'processing') then
    raise exception 'upload finalization is not available' using errcode = 'P0002';
  end if;

  -- Both a first claim and a stale-lease reclaim must prove that the parked
  -- worker generation is still pristine. Lock in worker order (document, AI,
  -- contract) so claim cannot race a worker or token-bound rollback.
  perform job.id
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  perform job.id
  from public.contract_ai_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  select * into uploaded_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;

  select count(*) into document_job_count
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id;
  select count(*) into ai_job_count
  from public.contract_ai_jobs as job
  where job.contract_id = p_contract_id;

  if uploaded_contract.id is null
    or uploaded_contract.org_id is distinct from p_org_id
    or uploaded_contract.rights_holder_id is distinct from p_rights_holder_id
    or uploaded_contract.created_by is distinct from p_owner_id
    or uploaded_contract.pdf_url is distinct from p_storage_path
    or uploaded_contract.status is distinct from 'kladde'
    or (
      lower(p_storage_path) ~ '[.]pdf$'
      and (
        document_job_count <> 1
        or ai_job_count <> 0
        or exists (
          select 1 from public.contract_document_jobs as job
          where job.contract_id = p_contract_id
            and (
              job.status <> 'queued'
              or job.attempts <> 0
              or job.lease_token is not null
              or job.lease_expires_at is not null
              or job.last_upload_authorised_at is not null
            )
        )
      )
    )
    or (
      lower(p_storage_path) !~ '[.]pdf$'
      and (
        document_job_count <> 0
        or ai_job_count > 1
        or exists (
          select 1 from public.contract_ai_jobs as job
          where job.contract_id = p_contract_id
            and (
              job.status <> 'queued'
              or job.attempts <> 0
              or job.started_at is not null
              or job.lease_expires_at is not null
            )
        )
      )
    ) then
    return query select 'recovery_required'::text, null::uuid, p_contract_id;
    return;
  end if;

  -- Keep the pristine rows unclaimable for exactly the same period as the
  -- finalization lease. Finish releases them; an expired token cannot finish
  -- or roll back once workers are again allowed to claim them.
  update public.contract_document_jobs as job
  set next_attempt_at = greatest(job.next_attempt_at, now() + interval '10 minutes'),
      updated_at = now()
  where job.contract_id = p_contract_id;
  update public.contract_ai_jobs as job
  set next_attempt_at = greatest(job.next_attempt_at, now() + interval '10 minutes'),
      updated_at = now()
  where job.contract_id = p_contract_id;

  if upload_intent.finalization_status = 'processing' then
    update public.contract_upload_intents as intent
    set finalization_claimed_at = now(),
        finalization_token = p_finalization_token
    where intent.id = upload_intent.id
      and intent.finalization_status = 'processing'
      and intent.finalization_token = upload_intent.finalization_token;
  else
    update public.contract_upload_intents as intent
    set finalization_status = 'processing',
        finalization_claimed_at = now(),
        finalization_token = p_finalization_token,
        finalization_request_hash = p_request_hash
    where intent.id = upload_intent.id
      and intent.finalization_status = 'pending';
  end if;
  if not found then
    raise exception 'upload finalization lease lost' using errcode = 'P0002';
  end if;

  return query select 'claimed'::text, p_finalization_token, p_contract_id;
end;
$$;

-- The final database phase is deliberately one transaction. Validation is
-- idempotently upserted before any shared episode scope is touched. The
-- contract is linked to that scope and the intent is marked final only if all
-- writes succeed; a later retry therefore cannot partially change a scope.
create or replace function public.finish_member_uploaded_contract_finalization(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_upload_intent_id uuid,
  p_contract_id uuid,
  p_storage_path text,
  p_finalization_token uuid,
  p_request_hash text,
  p_validation_notes jsonb default null,
  p_contract_metadata jsonb default '{}'::jsonb,
  p_series_work_id uuid default null,
  p_scope_season_number integer default null,
  p_scope_status text default null,
  p_scope_episode_numbers integer[] default null,
  p_scope_covers_whole_season boolean default false
)
returns public.contracts
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_intent public.contract_upload_intents;
  uploaded_contract public.contracts;
  scope_record public.member_series_episode_scopes;
  existing_scope public.member_series_episode_scopes;
  expected_series_work_id uuid;
  normalized_episode_numbers integer[] := '{}'::integer[];
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_upload_intent_id is null or p_contract_id is null
    or nullif(p_storage_path, '') is null or p_storage_path ~ '[\r\n]'
    or p_finalization_token is null
    or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_contract_metadata, '{}'::jsonb)) <> 'object'
    or (p_validation_notes is not null and jsonb_typeof(p_validation_notes) <> 'object') then
    raise exception 'invalid upload finalization' using errcode = '22023';
  end if;

  select * into upload_intent
  from public.contract_upload_intents as intent
  where intent.id = p_upload_intent_id
  for update;

  if upload_intent.id is null
    or upload_intent.owner_id is distinct from p_owner_id
    or upload_intent.org_id is distinct from p_org_id
    or upload_intent.rights_holder_id is distinct from p_rights_holder_id
    or upload_intent.storage_path is distinct from p_storage_path
    or upload_intent.contract_id is distinct from p_contract_id
    or upload_intent.consumed_at is null then
    raise exception 'upload finalization identity mismatch' using errcode = '42501';
  end if;

  -- A lost HTTP response may repeat completion with its old token. Returning
  -- the same contract is safe only for the exact same normalized request.
  if upload_intent.finalization_status = 'finalized' then
    if upload_intent.finalization_request_hash is distinct from p_request_hash then
      raise exception 'upload request differs from finalized request' using errcode = 'P0002';
    end if;
    select * into uploaded_contract from public.contracts where id = p_contract_id;
    return uploaded_contract;
  end if;

  if upload_intent.finalization_status <> 'processing'
    or upload_intent.finalization_token is distinct from p_finalization_token
    or upload_intent.finalization_request_hash is distinct from p_request_hash
    or upload_intent.finalization_claimed_at <= now() - interval '10 minutes' then
    raise exception 'upload finalization lease lost' using errcode = 'P0002';
  end if;

  select * into uploaded_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;
  if uploaded_contract.id is null
    or uploaded_contract.org_id is distinct from p_org_id
    or uploaded_contract.rights_holder_id is distinct from p_rights_holder_id
    or uploaded_contract.created_by is distinct from p_owner_id
    or uploaded_contract.pdf_url is distinct from p_storage_path
    or uploaded_contract.status is distinct from 'kladde' then
    raise exception 'uploaded contract mismatch' using errcode = '42501';
  end if;

  if p_validation_notes is not null then
    insert into public.contract_validations (contract_id, org_id, notes)
    values (p_contract_id, p_org_id, p_validation_notes::text)
    on conflict (contract_id) do update
      set org_id = excluded.org_id,
          notes = excluded.notes;
  end if;

  if p_series_work_id is not null or p_scope_season_number is not null or p_scope_status is not null then
    if p_series_work_id is null or p_scope_season_number is null or p_scope_season_number < 1
      or p_scope_status is null or p_scope_status not in ('pending', 'confirmed') then
      raise exception 'invalid series scope' using errcode = '22023';
    end if;
    select coalesce(work.parent_work_id, work.id)
    into expected_series_work_id
    from public.works as work
    where work.id = uploaded_contract.work_id
      and (work.parent_work_id is not null or lower(coalesce(work.type, '')) like '%serie%');
    if expected_series_work_id is null or expected_series_work_id is distinct from p_series_work_id then
      raise exception 'series scope does not match contract work' using errcode = '22023';
    end if;

    select coalesce(array_agg(distinct episode_number order by episode_number), '{}'::integer[])
    into normalized_episode_numbers
    from unnest(coalesce(p_scope_episode_numbers, '{}'::integer[])) as episode_number
    where episode_number > 0;
    if cardinality(normalized_episode_numbers) <> cardinality(coalesce(p_scope_episode_numbers, '{}'::integer[])) then
      raise exception 'invalid episode selection' using errcode = '22023';
    end if;
    if p_scope_status = 'pending' then
      normalized_episode_numbers := '{}'::integer[];
      if coalesce(p_scope_covers_whole_season, false) then
        raise exception 'pending scope cannot cover a whole season' using errcode = '22023';
      end if;
    elsif coalesce(p_scope_covers_whole_season, false) then
      normalized_episode_numbers := '{}'::integer[];
    elsif cardinality(normalized_episode_numbers) = 0 then
      raise exception 'confirmed scope requires episodes or whole season' using errcode = '22023';
    end if;

    select * into existing_scope
    from public.member_series_episode_scopes as scope
    where scope.org_id = p_org_id
      and scope.rights_holder_id = p_rights_holder_id
      and scope.series_work_id = p_series_work_id
      and scope.season_number = p_scope_season_number
    for update;

    if existing_scope.id is not null
      and existing_scope.status = 'confirmed'
      and p_scope_status = 'pending' then
      scope_record := existing_scope;
    else
      insert into public.member_series_episode_scopes (
        org_id, rights_holder_id, series_work_id, season_number, status,
        episode_numbers, covers_whole_season, source, confirmed_at, updated_at
      ) values (
        p_org_id, p_rights_holder_id, p_series_work_id, p_scope_season_number,
        p_scope_status,
        case when p_scope_status = 'confirmed' and not coalesce(p_scope_covers_whole_season, false)
          then normalized_episode_numbers else '{}'::integer[] end,
        p_scope_status = 'confirmed' and coalesce(p_scope_covers_whole_season, false),
        'contract_upload',
        case when p_scope_status = 'confirmed' then now() else null end,
        now()
      )
      on conflict (org_id, rights_holder_id, series_work_id, season_number) do update
        set status = excluded.status,
            episode_numbers = excluded.episode_numbers,
            covers_whole_season = excluded.covers_whole_season,
            source = excluded.source,
            confirmed_at = excluded.confirmed_at,
            updated_at = excluded.updated_at
      returning * into scope_record;
    end if;
  end if;

  update public.contracts
  set type = case when p_contract_metadata ? 'type'
        then coalesce(nullif(btrim(p_contract_metadata ->> 'type'), ''), type) else type end,
      overenskomst = case when p_contract_metadata ? 'overenskomst'
        then nullif(btrim(p_contract_metadata ->> 'overenskomst'), '') else overenskomst end,
      contract_date = case when p_contract_metadata ? 'contract_date'
        then nullif(p_contract_metadata ->> 'contract_date', '')::date else contract_date end,
      start_date = case when p_contract_metadata ? 'start_date'
        then nullif(p_contract_metadata ->> 'start_date', '')::date else start_date end,
      end_date = case when p_contract_metadata ? 'end_date'
        then nullif(p_contract_metadata ->> 'end_date', '')::date else end_date end,
      episode_scope_id = coalesce(scope_record.id, episode_scope_id),
      season_number = case when scope_record.id is not null then scope_record.season_number else season_number end,
      episode_numbers = case
        when scope_record.id is null then episode_numbers
        when scope_record.status <> 'confirmed' then null
        when scope_record.covers_whole_season then '{}'::integer[]
        else scope_record.episode_numbers
      end
  where id = p_contract_id
  returning * into uploaded_contract;

  update public.contract_upload_intents
  set finalization_status = 'finalized',
      finalization_token = null,
      finalized_at = now()
  where id = upload_intent.id
    and finalization_status = 'processing'
    and finalization_token = p_finalization_token;
  if not found then
    raise exception 'upload finalization lease lost' using errcode = 'P0002';
  end if;

  -- New processing jobs are deliberately parked by the create transaction.
  -- Release them only after every member-supplied relation is committed, so a
  -- worker cannot race a token-bound rollback of an unfinished upload.
  update public.contract_document_jobs
  set next_attempt_at = now(), updated_at = now()
  where contract_id = p_contract_id
    and status = 'queued'
    and attempts = 0;
  update public.contract_ai_jobs
  set next_attempt_at = now(), updated_at = now()
  where contract_id = p_contract_id
    and attachment_id is null
    and status = 'queued'
    and attempts = 0;

  return uploaded_contract;
end;
$$;

revoke all on function public.claim_member_uploaded_contract_finalization(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.finish_member_uploaded_contract_finalization(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb,
  uuid, integer, text, integer[], boolean
) from public, anon, authenticated;
grant execute on function public.claim_member_uploaded_contract_finalization(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid
) to service_role;
grant execute on function public.finish_member_uploaded_contract_finalization(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb,
  uuid, integer, text, integer[], boolean
) to service_role;

-- Contract creation and its first processing job are one PostgreSQL
-- transaction. The function is service-only because the route has already
-- verified the authenticated member, uploaded object size and organisation.
create or replace function public.create_member_uploaded_contract(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_upload_intent_id uuid,
  p_storage_path text,
  p_uploaded_size bigint,
  p_working_title text default null,
  p_work_id uuid default null,
  p_season_number integer default null,
  p_episode_numbers integer[] default null,
  p_defer_ai_job boolean default false
)
returns public.contracts
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_intent public.contract_upload_intents;
  created_contract public.contracts;
  new_contract_id uuid := gen_random_uuid();
  is_pdf boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_uploaded_size < 1 or p_uploaded_size > 26214400
    or nullif(p_storage_path, '') is null
    or p_storage_path ~ '[\r\n]'
    or (p_season_number is not null and p_season_number < 1)
    or exists (
      select 1 from unnest(coalesce(p_episode_numbers, '{}'::integer[])) as episode_number
      where episode_number < 1
    ) then
    raise exception 'invalid uploaded contract' using errcode = '22023';
  end if;

  is_pdf := lower(p_storage_path) ~ '[.]pdf$';

  select * into upload_intent
  from public.contract_upload_intents
  where id = p_upload_intent_id
  for update;

  if upload_intent.id is null
    or upload_intent.owner_id <> p_owner_id
    or upload_intent.org_id <> p_org_id
    or upload_intent.rights_holder_id <> p_rights_holder_id
    or upload_intent.storage_path <> p_storage_path
    or upload_intent.expected_size <> p_uploaded_size then
    raise exception 'upload intent mismatch' using errcode = '42501';
  end if;

  if upload_intent.cleanup_status = 'claimed' then
    raise exception 'upload intent cleanup in progress' using errcode = 'P0002';
  end if;

  -- A retry after a lost HTTP response returns the already committed contract,
  -- but only if its authoritative processing job still exists.
  if upload_intent.contract_id is not null then
    select * into created_contract
    from public.contracts
    where id = upload_intent.contract_id
      and org_id = p_org_id
      and rights_holder_id = p_rights_holder_id
      and pdf_url = p_storage_path;
    if created_contract.id is null
      or (is_pdf and not exists (
          select 1 from public.contract_document_jobs
          where contract_id = created_contract.id
        ))
      or (not is_pdf and not coalesce(p_defer_ai_job, false) and not exists (
          select 1 from public.contract_ai_jobs
          where contract_id = created_contract.id and attachment_id is null
        )) then
      raise exception 'inconsistent uploaded contract' using errcode = 'P0002';
    end if;
    return created_contract;
  end if;

  if upload_intent.consumed_at is not null or upload_intent.expires_at <= now() then
    raise exception 'upload intent expired or consumed' using errcode = 'P0002';
  end if;

  insert into public.contracts (
    id, org_id, rights_holder_id, type, status, pdf_url, working_title,
    work_id, season_number, episode_numbers, created_by
  ) values (
    new_contract_id, p_org_id, p_rights_holder_id, 'a-løn', 'kladde',
    p_storage_path, nullif(btrim(p_working_title), ''), p_work_id,
    p_season_number, p_episode_numbers, p_owner_id
  ) returning * into created_contract;

  if is_pdf then
    insert into public.contract_document_jobs (
      contract_id, org_id, created_by, original_storage_path,
      output_storage_path, status, priority
    ) values (
      created_contract.id, p_org_id, p_owner_id, p_storage_path,
      p_org_id::text || '/processed/' || created_contract.id::text || '/normalised.pdf',
      'queued', 100
    );
    update public.contract_document_jobs
    set next_attempt_at = now() + interval '2 hours'
    where contract_id = created_contract.id;
  elsif not coalesce(p_defer_ai_job, false) then
    insert into public.contract_ai_jobs (
      contract_id, org_id, created_by, status, stage, priority, next_attempt_at
    ) values (
      created_contract.id, p_org_id, p_owner_id,
      'queued', 'extraction', 0, now() + interval '2 hours'
    );
  end if;

  update public.contract_upload_intents
  set consumed_at = now(), contract_id = created_contract.id
  where id = upload_intent.id;

  return created_contract;
end;
$$;

revoke all on function public.create_member_uploaded_contract(
  uuid, uuid, uuid, uuid, text, bigint, text, uuid, integer, integer[], boolean
) from public, anon, authenticated;
grant execute on function public.create_member_uploaded_contract(
  uuid, uuid, uuid, uuid, text, bigint, text, uuid, integer, integer[], boolean
) to service_role;

-- Downstream member-upload steps (series scope, validation metadata and
-- producer relations) happen after the atomic contract commit. If one fails,
-- rollback must lock and verify both authoritative rows before deleting the
-- draft and its cascaded jobs. Storage is deliberately untouched: the
-- token-safe intent cleanup removes the now-orphaned object after expiry.
create or replace function public.rollback_member_uploaded_contract(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_upload_intent_id uuid,
  p_contract_id uuid,
  p_storage_path text,
  p_finalization_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_intent public.contract_upload_intents;
  uploaded_contract public.contracts;
  document_job_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_upload_intent_id is null or p_contract_id is null
    or nullif(p_storage_path, '') is null or p_storage_path ~ '[\r\n]'
    or p_finalization_token is null then
    raise exception 'invalid upload rollback' using errcode = '22023';
  end if;

  select * into upload_intent
  from public.contract_upload_intents as intent
  where intent.id = p_upload_intent_id
  for update;

  if upload_intent.id is null
    or upload_intent.owner_id is distinct from p_owner_id
    or upload_intent.org_id is distinct from p_org_id
    or upload_intent.rights_holder_id is distinct from p_rights_holder_id
    or upload_intent.storage_path is distinct from p_storage_path
    or upload_intent.contract_id is distinct from p_contract_id
    or upload_intent.consumed_at is null
    or upload_intent.cleanup_status = 'claimed'
    or upload_intent.finalization_status <> 'processing'
    or upload_intent.finalization_token is distinct from p_finalization_token
    or upload_intent.finalization_claimed_at <= now() - interval '10 minutes' then
    return false;
  end if;

  -- Cloud Run claims the document job before updating the contract. Lock in
  -- that same order so rollback can never deadlock with a worker claim. A
  -- worker that already started wins; the draft and original are preserved.
  perform job.id
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  select count(*) into document_job_count
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id;
  if (lower(p_storage_path) ~ '[.]pdf$' and document_job_count <> 1)
    or exists (
      select 1
      from public.contract_document_jobs as job
      where job.contract_id = p_contract_id
        and (
          job.status <> 'queued'
          or job.attempts <> 0
          or job.lease_token is not null
          or job.last_upload_authorised_at is not null
        )
    ) then
    return false;
  end if;

  -- Non-PDF uploads can enqueue an AI extraction job immediately. Lock those
  -- rows before the contract as well; once processing started, rollback is no
  -- longer allowed to cascade-delete work owned by another worker.
  perform job.id
  from public.contract_ai_jobs as job
  where job.contract_id = p_contract_id
  order by job.id
  for update;
  if exists (
    select 1
    from public.contract_ai_jobs as job
    where job.contract_id = p_contract_id
      and (
        job.status <> 'queued'
        or job.attempts <> 0
        or job.started_at is not null
        or job.lease_expires_at is not null
      )
  ) then
    return false;
  end if;

  select * into uploaded_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;

  if uploaded_contract.id is null
    or uploaded_contract.org_id is distinct from p_org_id
    or uploaded_contract.rights_holder_id is distinct from p_rights_holder_id
    or uploaded_contract.created_by is distinct from p_owner_id
    or uploaded_contract.pdf_url is distinct from p_storage_path
    or uploaded_contract.status is distinct from 'kladde' then
    return false;
  end if;

  delete from public.contracts
  where id = uploaded_contract.id;
  if not found then
    return false;
  end if;

  update public.contract_upload_intents
  set contract_id = null,
      expires_at = least(expires_at, now()),
      expired_object_cleanup_at = null,
      cleanup_status = 'pending',
      cleanup_claimed_at = null,
      cleanup_claim_token = null,
      cleanup_claim_kind = null,
      finalization_status = 'rolled_back',
      finalization_token = null,
      finalized_at = null
  where id = upload_intent.id
    and contract_id is null
    and finalization_status = 'processing'
    and finalization_token = p_finalization_token;

  if not found then
    raise exception 'upload rollback lease lost' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.rollback_member_uploaded_contract(
  uuid, uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.rollback_member_uploaded_contract(
  uuid, uuid, uuid, uuid, uuid, text, uuid
) to service_role;
