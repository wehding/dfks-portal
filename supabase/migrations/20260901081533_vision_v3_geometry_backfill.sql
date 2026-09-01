-- One-off, baseline-bound Google Vision v3 geometry backfill.
--
-- SECURITY INVARIANTS
-- - contracts.pdf_url and the original storage object are immutable legal sources.
-- - only lease-scoped derivative PDF/geometry objects may be promoted.
-- - ordinary uploads, DLP replacements and this backfill are disjoint queues.
-- - preparing the cohort, creating all jobs and writing the semantic audit event
--   is one transaction. A drift or audit failure queues nothing.
-- - this migration only installs the mechanism. It never queues production data.

alter table public.contract_document_jobs
  add column if not exists backfill_run_id uuid,
  add column if not exists backfill_source_job_id uuid
    references public.contract_document_jobs(id) on delete restrict,
  add column if not exists processing_intent text;

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_processing_intent_check,
  add constraint contract_document_jobs_processing_intent_check check (
    processing_intent is null
    or processing_intent in (
      'direct_vision_replacement_v1',
      'direct_vision_geometry_backfill_v1'
    )
  ),
  drop constraint if exists contract_document_jobs_backfill_lineage_check,
  add constraint contract_document_jobs_backfill_lineage_check check (
    (
      backfill_run_id is null
      and backfill_source_job_id is null
      and processing_intent is distinct from 'direct_vision_geometry_backfill_v1'
    )
    or (
      backfill_run_id is not null
      and backfill_source_job_id is not null
      and backfill_source_job_id <> id
      and processing_intent = 'direct_vision_geometry_backfill_v1'
      and replacement_of_job_id is null
    )
  );

create table public.contract_document_backfill_runs (
  id uuid primary key,
  kind text not null check (kind = 'direct_vision_geometry_v3'),
  processing_profile text not null check (processing_profile = 'google-vision-direct-v1'),
  spatial_schema_version text not null check (spatial_schema_version = 'google-vision-spatial-v3'),
  state text not null default 'queued' check (
    state in ('queued', 'running', 'quality_pending', 'completed', 'aborted')
  ),
  expected_count integer not null check (expected_count between 1 and 1000),
  cohort_digest text not null check (cohort_digest ~ '^[0-9a-f]{64}$'),
  quality_report_digest text check (
    quality_report_digest is null or quality_report_digest ~ '^[0-9a-f]{64}$'
  ),
  audit_event_id uuid references public.audit_events(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  quality_checked_at timestamptz,
  completed_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9._-]{2,80}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'completed') = (completed_at is not null)),
  check (state <> 'completed' or quality_report_digest is not null)
);

alter table public.contract_document_jobs
  add constraint contract_document_jobs_backfill_run_id_fkey
  foreign key (backfill_run_id)
  references public.contract_document_backfill_runs(id)
  on delete restrict;

create table public.contract_document_backfill_targets (
  run_id uuid not null references public.contract_document_backfill_runs(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  org_id uuid not null references public.organisations(id) on delete restrict,
  source_job_id uuid not null references public.contract_document_jobs(id) on delete restrict,
  queued_job_id uuid unique references public.contract_document_jobs(id) on delete restrict,
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  original_page_count integer not null check (original_page_count between 1 and 200),
  original_path_digest text not null check (original_path_digest ~ '^[0-9a-f]{64}$'),
  contract_status text not null check (contract_status in ('kladde', 'afventer', 'valideret')),
  prior_processing_status text not null check (
    prior_processing_status in ('not_required', 'needs_review', 'failed')
  ),
  prior_processing_error_code text check (
    prior_processing_error_code is null
    or prior_processing_error_code ~ '^[a-z0-9._-]{2,80}$'
  ),
  prior_processing_profile text check (
    prior_processing_profile is null
    or prior_processing_profile ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  ),
  prior_spatial_schema_version text check (
    prior_spatial_schema_version is null
    or prior_spatial_schema_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  ),
  prior_spatial_accuracy numeric check (
    prior_spatial_accuracy is null or prior_spatial_accuracy between 0 and 1
  ),
  prior_processed_path_digest text check (
    prior_processed_path_digest is null
    or prior_processed_path_digest ~ '^[0-9a-f]{64}$'
  ),
  prior_spatial_path_digest text check (
    prior_spatial_path_digest is null
    or prior_spatial_path_digest ~ '^[0-9a-f]{64}$'
  ),
  outcome text not null default 'queued' check (
    outcome in ('queued', 'processing', 'completed', 'needs_review', 'failed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, contract_id)
);

create unique index contract_document_jobs_one_geometry_backfill_source_idx
  on public.contract_document_jobs(backfill_source_job_id)
  where backfill_source_job_id is not null;
create unique index contract_document_jobs_one_geometry_backfill_contract_idx
  on public.contract_document_jobs(backfill_run_id, contract_id)
  where backfill_run_id is not null;
create index contract_document_jobs_geometry_backfill_claim_idx
  on public.contract_document_jobs(
    backfill_run_id, status, next_attempt_at, priority desc, created_at, id
  )
  where backfill_run_id is not null;

-- Failed generations are immutable evidence, not an active singleton. A newer
-- generation can coexist with them; the claim function below prevents an older
-- failed row from being retried after a newer generation exists.
drop index if exists public.contract_document_jobs_one_active_contract_idx;
create unique index contract_document_jobs_one_active_contract_idx
  on public.contract_document_jobs(contract_id)
  where status in ('queued', 'processing');

alter table public.contract_document_backfill_runs enable row level security;
alter table public.contract_document_backfill_targets enable row level security;
revoke all on table public.contract_document_backfill_runs
  from public, anon, authenticated, service_role;
revoke all on table public.contract_document_backfill_targets
  from public, anon, authenticated, service_role;
-- Mutations are only possible through the audited SECURITY DEFINER API below.
-- The service role needs read access for aggregate monitoring and quality audit.
grant select on table public.contract_document_backfill_runs to service_role;
grant select on table public.contract_document_backfill_targets to service_role;

comment on table public.contract_document_backfill_runs is
  'Service-only immutable run identity and aggregate quality state for bounded document backfills.';
comment on table public.contract_document_backfill_targets is
  'Service-only baseline fences. Contains hashes/statuses only, never contract text.';
comment on column public.contract_document_jobs.backfill_run_id is
  'Exact one-off run whose immutable cohort owns this job generation.';
comment on column public.contract_document_jobs.backfill_source_job_id is
  'Latest terminal source generation captured by the run. No source artefact is deleted.';

create or replace function private.contract_document_path_digest(p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_path is null then null
    else encode(extensions.digest(p_path, 'sha256'), 'hex')
  end;
$$;

revoke all on function private.contract_document_path_digest(text)
  from public, anon, authenticated, service_role;

-- Ordinary Scheduler claims must never steal a direct-Vision replacement or a
-- geometry backfill. The reverse claims are already separately fenced.
create or replace function public.claim_next_contract_document_job(
  p_lease_minutes integer default 30
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.contract_document_jobs;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with exhausted as (
    update public.contract_document_jobs
    set status = 'failed',
        lease_token = null,
        lease_expires_at = null,
        error_code = 'max_attempts_exceeded',
        safe_error_message = 'Dokumentet kunne ikke færdigbehandles efter det maksimale antal forsøg.',
        updated_at = now()
    where replacement_of_job_id is null
      and backfill_run_id is null
      and processing_intent is null
      and superseded_by_job_id is null
      and status = 'processing'
      and lease_expires_at < now()
      and attempts >= 5
    returning contract_id
  )
  update public.contracts as contract
  set document_processing_status = 'failed',
      document_processing_error_code = 'max_attempts_exceeded'
  where contract.id in (select contract_id from exhausted);

  with candidate as (
    select job.id
    from public.contract_document_jobs as job
    where job.replacement_of_job_id is null
      and job.backfill_run_id is null
      and job.processing_intent is null
      and job.superseded_by_job_id is null
      and (
        (job.status = 'queued' and job.next_attempt_at <= now())
        or (job.status = 'failed' and job.next_attempt_at <= now())
        or (job.status = 'processing' and job.lease_expires_at < now())
      )
      and job.attempts < 5
      and not exists (
        select 1
        from public.contract_document_jobs as newer
        where newer.contract_id = job.contract_id
          and newer.id <> job.id
          and newer.superseded_by_job_id is null
          and (
            newer.created_at > job.created_at
            or (newer.created_at = job.created_at and newer.id::text > job.id::text)
          )
      )
    order by job.priority desc, job.created_at, job.id
    for update skip locked
    limit 1
  )
  update public.contract_document_jobs as job
  set status = 'processing',
      attempts = attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 60))),
      error_code = null,
      safe_error_message = null,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.* into claimed;

  if claimed.id is not null then
    update public.contracts
    set document_processing_status = 'processing',
        document_processing_error_code = null
    where id = claimed.contract_id;
  end if;
  return claimed;
end;
$$;

revoke all on function public.claim_next_contract_document_job(integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_contract_document_job(integer)
  to service_role;

create or replace function public.prepare_contract_document_geometry_backfill_run(
  p_run_id uuid,
  p_expected_count integer,
  p_cohort_digest text,
  p_targets jsonb,
  p_priority integer default 1200,
  p_created_by uuid default null
)
returns table(outcome text, run_id uuid, queued_count integer, cohort_digest text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested record;
  locked_contract public.contracts;
  source_job public.contract_document_jobs;
  new_job_id uuid;
  actual_count integer;
  distinct_count integer;
  distinct_source_count integer;
  existing_target_count integer;
  existing_job_count integer;
  actual_digest text;
  member_uuids uuid[];
  org_uuids uuid[];
  created_audit_event_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_run_id is null
    or p_expected_count is null or p_expected_count < 1 or p_expected_count > 1000
    or p_priority is null or p_priority < 1 or p_priority > 5000
    or p_cohort_digest is null or lower(p_cohort_digest) !~ '^[0-9a-f]{64}$'
    or p_targets is null or jsonb_typeof(p_targets) <> 'array' then
    raise exception 'invalid geometry backfill input' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.contract_document_backfill_runs as run where run.id = p_run_id
  ) then
    select run.state, run.id, run.expected_count, run.cohort_digest
      into outcome, run_id, queued_count, cohort_digest
    from public.contract_document_backfill_runs as run
    where run.id = p_run_id;
    select count(*)::integer into existing_target_count
    from public.contract_document_backfill_targets as backfill_target
    where backfill_target.run_id = p_run_id;
    select count(*)::integer into existing_job_count
    from public.contract_document_jobs as job
    where job.backfill_run_id = p_run_id;
    if queued_count <> p_expected_count
      or cohort_digest <> lower(p_cohort_digest)
      or existing_target_count <> p_expected_count
      or existing_job_count <> p_expected_count
      or not exists (
        select 1
        from public.contract_document_backfill_runs as existing_run
        where existing_run.id = p_run_id and existing_run.audit_event_id is not null
      ) then
      raise exception 'backfill run id already belongs to another cohort' using errcode = '23505';
    end if;
    outcome := 'already_prepared';
    return next;
    return;
  end if;

  select count(*)::integer,
         count(distinct lower(target ->> 'contractId'))::integer,
         count(distinct lower(target ->> 'sourceJobId'))::integer
    into actual_count, distinct_count, distinct_source_count
  from jsonb_array_elements(p_targets) as targets(target);
  if actual_count <> p_expected_count
    or distinct_count <> p_expected_count
    or distinct_source_count <> p_expected_count then
    raise exception 'geometry backfill count drift' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_targets) as targets(target)
    where target ->> 'contractId' is null
      or target ->> 'contractId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or target ->> 'sourceJobId' is null
      or target ->> 'sourceJobId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or target ->> 'originalSha256' is null
      or target ->> 'originalSha256' !~ '^[0-9a-f]{64}$'
      or target ->> 'originalPageCount' is null
      or target ->> 'originalPageCount' !~ '^[0-9]{1,3}$'
      or (target ->> 'originalPageCount')::integer not between 1 and 200
      or target ->> 'originalPathDigest' is null
      or target ->> 'originalPathDigest' !~ '^[0-9a-f]{64}$'
      or target ->> 'contractStatus' is null
      or target ->> 'contractStatus' not in ('kladde', 'afventer', 'valideret')
      or target ->> 'priorProcessingStatus' is null
      or target ->> 'priorProcessingStatus' not in ('not_required', 'needs_review', 'failed')
  ) then
    raise exception 'invalid geometry backfill target' using errcode = '22023';
  end if;

  select encode(
    extensions.digest(
      string_agg(
        lower(target ->> 'contractId') || '|' ||
        lower(target ->> 'sourceJobId') || '|' ||
        lower(target ->> 'originalSha256') || '|' ||
        ((target ->> 'originalPageCount')::integer)::text || '|' ||
        lower(target ->> 'originalPathDigest') || '|' ||
        (target ->> 'contractStatus') || '|' ||
        (target ->> 'priorProcessingStatus'),
        E'\n' order by lower(target ->> 'contractId')
      ),
      'sha256'
    ),
    'hex'
  ) into actual_digest
  from jsonb_array_elements(p_targets) as targets(target);
  if actual_digest is distinct from lower(p_cohort_digest) then
    raise exception 'geometry backfill digest drift' using errcode = '22023';
  end if;

  insert into public.contract_document_backfill_runs(
    id, kind, processing_profile, spatial_schema_version, state,
    expected_count, cohort_digest, created_by
  ) values (
    p_run_id, 'direct_vision_geometry_v3', 'google-vision-direct-v1',
    'google-vision-spatial-v3', 'queued', p_expected_count,
    lower(p_cohort_digest), p_created_by
  );

  for requested in
    select
      lower(target ->> 'contractId')::uuid as contract_id,
      lower(target ->> 'sourceJobId')::uuid as source_job_id,
      lower(target ->> 'originalSha256') as original_sha256,
      (target ->> 'originalPageCount')::integer as original_page_count,
      lower(target ->> 'originalPathDigest') as original_path_digest,
      target ->> 'contractStatus' as contract_status,
      target ->> 'priorProcessingStatus' as prior_processing_status
    from jsonb_array_elements(p_targets) as targets(target)
    order by lower(target ->> 'contractId')
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(requested.contract_id::text, 438221948)
    );
    select contract.* into locked_contract
    from public.contracts as contract
    where contract.id = requested.contract_id
    for update of contract;
    if locked_contract.id is null
      or locked_contract.pdf_url is null
      or lower(locked_contract.pdf_url) !~ '[.]pdf$'
      or locked_contract.status is distinct from requested.contract_status
      or locked_contract.document_processing_status is distinct from requested.prior_processing_status
      or private.contract_document_path_digest(locked_contract.pdf_url)
        is distinct from requested.original_path_digest then
      raise exception 'geometry backfill contract state drift' using errcode = '55000';
    end if;

    select job.* into source_job
    from public.contract_document_jobs as job
    where job.id = requested.source_job_id
      and job.contract_id = locked_contract.id
      and job.org_id = locked_contract.org_id
    for update of job;
    if source_job.id is null
      or source_job.status is distinct from requested.prior_processing_status
      or source_job.original_storage_path is distinct from locked_contract.pdf_url
      or source_job.superseded_by_job_id is not null
      or source_job.backfill_run_id is not null
      or (source_job.original_sha256 is not null
        and lower(source_job.original_sha256) <> requested.original_sha256)
      or (source_job.page_count is not null
        and source_job.page_count <> requested.original_page_count)
      or source_job.processing_profile = 'google-vision-direct-v1'
      or source_job.spatial_schema_version = 'google-vision-spatial-v3' then
      raise exception 'geometry backfill source drift' using errcode = '55000';
    end if;
    if exists (
      select 1
      from public.contract_document_jobs as newer
      where newer.contract_id = locked_contract.id
        and newer.id <> source_job.id
        and (
          newer.created_at > source_job.created_at
          or (newer.created_at = source_job.created_at and newer.id::text > source_job.id::text)
        )
    ) then
      raise exception 'geometry backfill newer generation exists' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.contract_document_jobs as active
      where active.contract_id = locked_contract.id
        and active.id <> source_job.id
        and (
          active.status in ('queued', 'processing')
          or (active.status = 'failed' and active.attempts < 5
            and active.created_at > source_job.created_at)
        )
    ) then
      raise exception 'geometry backfill active generation exists' using errcode = '55000';
    end if;
    if exists (
      select 1
      from public.contract_document_jobs as qualified
      where qualified.contract_id = locked_contract.id
        and qualified.org_id = locked_contract.org_id
        and qualified.status = 'completed'
        and qualified.output_storage_path = locked_contract.processed_pdf_url
        and qualified.spatial_data_path = locked_contract.document_spatial_data_path
        and qualified.ocr_applied is true
        and qualified.ocr_engine = 'google-vision-eu-v1'
        and qualified.processing_profile = 'google-vision-direct-v1'
        and qualified.spatial_schema_version = 'google-vision-spatial-v3'
        and qualified.spatial_accuracy_score >= 0.95
        and qualified.spatial_median_iou >= 0.85
        and qualified.spatial_center_inside_ratio >= 0.98
    ) then
      raise exception 'geometry backfill target already qualified' using errcode = '55000';
    end if;

    insert into public.contract_document_backfill_targets(
      run_id, contract_id, org_id, source_job_id,
      original_sha256, original_page_count, original_path_digest,
      contract_status, prior_processing_status, prior_processing_error_code,
      prior_processing_profile, prior_spatial_schema_version,
      prior_spatial_accuracy, prior_processed_path_digest,
      prior_spatial_path_digest
    ) values (
      p_run_id, locked_contract.id, locked_contract.org_id, source_job.id,
      requested.original_sha256, requested.original_page_count,
      requested.original_path_digest,
      locked_contract.status, locked_contract.document_processing_status,
      locked_contract.document_processing_error_code,
      locked_contract.document_processing_profile,
      locked_contract.document_spatial_schema_version,
      locked_contract.document_spatial_accuracy,
      private.contract_document_path_digest(locked_contract.processed_pdf_url),
      private.contract_document_path_digest(locked_contract.document_spatial_data_path)
    );

    new_job_id := gen_random_uuid();
    insert into public.contract_document_jobs(
      id, org_id, contract_id, original_storage_path, output_storage_path,
      status, priority, attempts, next_attempt_at, created_by,
      original_sha256, downstream_ai_policy, processing_profile,
      backfill_run_id, backfill_source_job_id, processing_intent
    ) values (
      new_job_id, locked_contract.org_id, locked_contract.id,
      locked_contract.pdf_url,
      locked_contract.org_id::text || '/processed/' || locked_contract.id::text
        || '/pending/' || new_job_id::text || '/normalised.pdf',
      'queued', p_priority, 0, now(), source_job.created_by,
      requested.original_sha256, 'preserve', 'google-vision-direct-v1',
      p_run_id, source_job.id, 'direct_vision_geometry_backfill_v1'
    );
    update public.contract_document_backfill_targets as backfill_target
    set queued_job_id = new_job_id, updated_at = now()
    where backfill_target.run_id = p_run_id
      and backfill_target.contract_id = locked_contract.id;
  end loop;

  select coalesce(array_agg(distinct contract.rights_holder_id)
      filter (where contract.rights_holder_id is not null), '{}'::uuid[]),
    coalesce(array_agg(distinct target.org_id), '{}'::uuid[])
    into member_uuids, org_uuids
  from public.contract_document_backfill_targets as target
  join public.contracts as contract on contract.id = target.contract_id
  where target.run_id = p_run_id;

  created_audit_event_id := public.append_audit_event_v2(
    p_action => 'create',
    p_entity_type => 'contract_document_backfill_run',
    p_entity_id => p_run_id::text,
    p_actor_user_id => p_created_by,
    p_actor_type => case when p_created_by is null then 'system' else 'user' end,
    p_source => 'database',
    p_correlation_id => p_run_id,
    p_metadata => jsonb_build_object(
      'event_code', 'vision_v3_geometry_backfill_queued',
      'expected_count', p_expected_count,
      'cohort_digest', lower(p_cohort_digest),
      'processing_profile', 'google-vision-direct-v1',
      'spatial_schema_version', 'google-vision-spatial-v3'
    ),
    p_target_member_uuids => member_uuids,
    p_purpose_code => 'document_ocr_geometry_backfill',
    p_legal_basis => 'GDPR Art. 6(1)(b)/(f) og 9(2)(d)',
    p_data_categories => array['contract_data', 'document_data', 'ai_analysis']::text[],
    p_system_component => 'vision_v3_geometry_backfill',
    p_org_ids => org_uuids
  );
  update public.contract_document_backfill_runs
  set audit_event_id = created_audit_event_id, updated_at = now()
  where id = p_run_id;

  return query select 'queued'::text, p_run_id, p_expected_count, lower(p_cohort_digest);
end;
$$;

revoke all on function public.prepare_contract_document_geometry_backfill_run(
  uuid, integer, text, jsonb, integer, uuid
) from public, anon, authenticated;
grant execute on function public.prepare_contract_document_geometry_backfill_run(
  uuid, integer, text, jsonb, integer, uuid
) to service_role;

create or replace function public.claim_next_contract_document_geometry_backfill_job(
  p_run_id uuid,
  p_lease_minutes integer default 30
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_run public.contract_document_backfill_runs;
  claimed public.contract_document_jobs;
  target public.contract_document_backfill_targets;
  source_job public.contract_document_jobs;
  locked_contract public.contracts;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_run_id is null then
    raise exception 'geometry backfill run is unavailable' using errcode = '55000';
  end if;
  -- Serialize claims and terminal accounting for a run. Without this lock,
  -- concurrent last-task completions/claims can each observe the other task as
  -- still processing and leave the run permanently in `running`.
  select backfill_run.* into selected_run
  from public.contract_document_backfill_runs as backfill_run
  where backfill_run.id = p_run_id
  for update of backfill_run;
  if selected_run.id is null then
    raise exception 'geometry backfill run is unavailable' using errcode = '55000';
  end if;
  -- A parallel task may perform one final empty claim after another task has
  -- closed the queue. Terminal states therefore mean an empty queue rather
  -- than an operational failure.
  if selected_run.state in ('quality_pending', 'completed') then
    return null;
  end if;
  if selected_run.state not in ('queued', 'running') then
    raise exception 'geometry backfill run is unavailable' using errcode = '55000';
  end if;

  update public.contract_document_jobs as job
  set status = 'failed', lease_token = null, lease_expires_at = null,
      error_code = 'max_attempts_exceeded',
      safe_error_message = 'Dokumentet kunne ikke færdigbehandles efter det maksimale antal forsøg.',
      updated_at = now()
  where job.backfill_run_id = p_run_id
    and job.processing_intent = 'direct_vision_geometry_backfill_v1'
    and job.status = 'processing' and job.lease_expires_at < now()
    and job.attempts >= 5;
  update public.contract_document_backfill_targets as backfill_target
  set outcome = 'failed', updated_at = now()
  from public.contract_document_jobs as job
  where backfill_target.run_id = p_run_id
    and job.id = backfill_target.queued_job_id
    and job.status = 'failed' and job.attempts >= 5;
  if not exists (
    select 1
    from public.contract_document_jobs as pending
    where pending.backfill_run_id = p_run_id
      and (
        pending.status in ('queued', 'processing')
        or (pending.status = 'failed' and pending.attempts < 5)
      )
  ) then
    update public.contract_document_backfill_runs as backfill_run
    set state = 'quality_pending', quality_checked_at = null, updated_at = now()
    where backfill_run.id = p_run_id and backfill_run.state in ('queued', 'running');
    return null;
  end if;

  select job.* into claimed
  from public.contract_document_jobs as job
  where job.backfill_run_id = p_run_id
    and job.processing_intent = 'direct_vision_geometry_backfill_v1'
    and (
      (job.status = 'queued' and job.next_attempt_at <= now())
      or (job.status = 'failed' and job.next_attempt_at <= now())
      or (job.status = 'processing' and job.lease_expires_at < now())
    )
    and job.attempts < 5
  order by job.priority desc, job.created_at, job.id
  for update skip locked
  limit 1;
  if claimed.id is null then return null; end if;

  select backfill_target.* into target
  from public.contract_document_backfill_targets as backfill_target
  where backfill_target.run_id = p_run_id
    and backfill_target.queued_job_id = claimed.id
  for update of backfill_target;
  select source.* into source_job
  from public.contract_document_jobs as source
  where source.id = target.source_job_id
  for update of source;
  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = target.contract_id
  for update of contract;

  if target.contract_id is distinct from claimed.contract_id
    or target.org_id is distinct from claimed.org_id
    or target.source_job_id is distinct from claimed.backfill_source_job_id
    or target.outcome is distinct from claimed.status
    or target.original_sha256 is distinct from claimed.original_sha256
    or claimed.processing_intent is distinct from 'direct_vision_geometry_backfill_v1'
    or claimed.downstream_ai_policy is distinct from 'preserve'
    or source_job.id is null or source_job.superseded_by_job_id is not null
    or source_job.contract_id is distinct from claimed.contract_id
    or source_job.org_id is distinct from claimed.org_id
    or source_job.status is distinct from target.prior_processing_status
    or source_job.original_storage_path is distinct from claimed.original_storage_path
    or (source_job.original_sha256 is not null
      and lower(source_job.original_sha256) is distinct from target.original_sha256)
    or (source_job.page_count is not null
      and source_job.page_count is distinct from target.original_page_count)
    or locked_contract.id is null
    or locked_contract.org_id is distinct from target.org_id
    or locked_contract.status is distinct from target.contract_status
    or locked_contract.document_processing_status is distinct from target.prior_processing_status
    or locked_contract.document_processing_error_code is distinct from target.prior_processing_error_code
    or locked_contract.document_processing_profile is distinct from target.prior_processing_profile
    or locked_contract.document_spatial_schema_version is distinct from target.prior_spatial_schema_version
    or locked_contract.document_spatial_accuracy is distinct from target.prior_spatial_accuracy
    or private.contract_document_path_digest(locked_contract.pdf_url)
      is distinct from target.original_path_digest
    or private.contract_document_path_digest(locked_contract.processed_pdf_url)
      is distinct from target.prior_processed_path_digest
    or private.contract_document_path_digest(locked_contract.document_spatial_data_path)
      is distinct from target.prior_spatial_path_digest
    or locked_contract.pdf_url is distinct from claimed.original_storage_path
    or exists (
      select 1
      from public.contract_document_jobs as newer
      where newer.contract_id = claimed.contract_id
        and newer.id not in (source_job.id, claimed.id)
        and (
          newer.created_at > source_job.created_at
          or (newer.created_at = source_job.created_at and newer.id::text > source_job.id::text)
        )
    ) then
    raise exception 'geometry backfill baseline drift' using errcode = '55000';
  end if;

  update public.contract_document_jobs as job
  set status = 'processing', attempts = attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 60))),
      error_code = null, safe_error_message = null, updated_at = now()
  where job.id = claimed.id
  returning job.* into claimed;
  update public.contract_document_backfill_targets as backfill_target
  set outcome = 'processing', updated_at = now()
  where backfill_target.run_id = p_run_id
    and backfill_target.queued_job_id = claimed.id;
  update public.contract_document_backfill_runs as backfill_run
  set state = 'running', started_at = coalesce(started_at, now()), updated_at = now()
  where backfill_run.id = p_run_id and backfill_run.state = 'queued';
  return claimed;
end;
$$;

revoke all on function public.claim_next_contract_document_geometry_backfill_job(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_contract_document_geometry_backfill_job(uuid, integer)
  to service_role;

-- V8 owns every forced-Vision completion. Ordinary upload completions retain
-- V7 behavior; forced replacement/backfill paths additionally require the
-- source-generation and immutable baseline fences below.
create or replace function public.finish_contract_document_job_v8(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_document_classification text default null,
  p_ocr_engine text default null,
  p_orientation_corrections jsonb default '[]'::jsonb,
  p_ocr_applied boolean default false,
  p_page_count integer default null,
  p_text_char_count integer default null,
  p_native_page_count integer default 0,
  p_ocr_page_count integer default 0,
  p_unreadable_page_count integer default 0,
  p_spatial_accuracy_score numeric default null,
  p_spatial_median_iou numeric default null,
  p_spatial_center_inside_ratio numeric default null,
  p_original_sha256 text default null,
  p_processed_sha256 text default null,
  p_processing_profile text default null,
  p_spatial_schema_version text default null,
  p_spatial_sha256 text default null,
  p_error_code text default null,
  p_safe_error_message text default null,
  p_review_details jsonb default '{"schemaVersion":1,"reasons":[]}'::jsonb
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_job public.contract_document_jobs;
  source_job public.contract_document_jobs;
  active_contract public.contracts;
  target public.contract_document_backfill_targets;
  finished public.contract_document_jobs;
  canonical_details jsonb;
  effective_original_sha256 text;
  forced_vision boolean;
  selected_run public.contract_document_backfill_runs;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select job.* into active_job
  from public.contract_document_jobs as job
  where job.id = p_job_id;
  if active_job.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  forced_vision := active_job.replacement_of_job_id is not null
    or active_job.backfill_run_id is not null;
  if not forced_vision then
    select * into finished
    from public.finish_contract_document_job_v7(
      p_job_id, p_lease_token, p_status, p_document_classification, p_ocr_engine,
      p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
      p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
      p_spatial_accuracy_score, p_spatial_median_iou,
      p_spatial_center_inside_ratio, p_original_sha256, p_processed_sha256,
      p_processing_profile, p_spatial_schema_version, p_spatial_sha256,
      p_error_code, p_safe_error_message, p_review_details
    );
    return finished;
  end if;

  if p_status is null or p_status not in ('completed', 'failed', 'needs_review') then
    raise exception 'invalid forced Vision status' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_orientation_corrections, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid orientation corrections' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_orientation_corrections, '[]'::jsonb)) > 200 then
    raise exception 'invalid orientation corrections' using errcode = '22023';
  end if;
  if not private.contract_document_review_details_valid(
    coalesce(p_review_details, '{"schemaVersion":1,"reasons":[]}'::jsonb)
  ) then
    raise exception 'invalid review details' using errcode = '22023';
  end if;
  if p_status = 'needs_review' and (
    p_error_code is null
    or not private.contract_document_review_error_code_valid(p_error_code)
  ) then
    raise exception 'needs_review requires a known safe error code' using errcode = '22023';
  end if;
  if p_page_count is not null and exists (
    select 1
    from jsonb_array_elements(p_review_details -> 'reasons') as reason_rows(reason)
    cross join lateral jsonb_array_elements(reason_rows.reason -> 'pageNumbers') as pages(page_number)
    where (pages.page_number::text)::integer > p_page_count
  ) then
    raise exception 'review page exceeds document page count' using errcode = '22023';
  end if;
  if p_status <> 'needs_review'
    and p_review_details <> '{"schemaVersion":1,"reasons":[]}'::jsonb then
    raise exception 'review details require needs_review status' using errcode = '22023';
  end if;
  if p_original_sha256 is null or p_original_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid original hash' using errcode = '22023';
  end if;

  if active_job.backfill_run_id is not null then
    -- Use the same run-first lock order as the claim and quality-gate RPCs.
    -- Besides avoiding deadlocks, this makes the final pending-job check see
    -- every earlier completion committed for this run.
    select backfill_run.* into selected_run
    from public.contract_document_backfill_runs as backfill_run
    where backfill_run.id = active_job.backfill_run_id
    for update of backfill_run;
    if selected_run.id is null or selected_run.state <> 'running' then
      raise exception 'geometry backfill completion drift' using errcode = '55000';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(active_job.contract_id::text, 438221948)
  );
  select job.* into active_job
  from public.contract_document_jobs as job
  where job.id = p_job_id and job.status = 'processing'
    and job.lease_token = p_lease_token and job.lease_expires_at > now()
  for update of job;
  if active_job.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  effective_original_sha256 := lower(p_original_sha256);
  if active_job.original_sha256 is distinct from effective_original_sha256 then
    raise exception 'original hash changed during processing' using errcode = '55000';
  end if;
  select contract.* into active_contract
  from public.contracts as contract
  where contract.id = active_job.contract_id
  for update of contract;
  if active_contract.id is null
    or active_contract.org_id <> active_job.org_id
    or active_contract.pdf_url is distinct from active_job.original_storage_path then
    raise exception 'document source changed during processing' using errcode = '55000';
  end if;

  if active_job.backfill_run_id is not null then
    select backfill_target.* into target
    from public.contract_document_backfill_targets as backfill_target
    where backfill_target.run_id = active_job.backfill_run_id
      and backfill_target.contract_id = active_job.contract_id
      and backfill_target.queued_job_id = active_job.id
    for update of backfill_target;
    select job.* into source_job
    from public.contract_document_jobs as job
    where job.id = active_job.backfill_source_job_id
    for update of job;
    if target.contract_id is null
      or source_job.id is null or source_job.superseded_by_job_id is not null
      or target.outcome is distinct from 'processing'
      or active_job.processing_intent is distinct from 'direct_vision_geometry_backfill_v1'
      or active_job.downstream_ai_policy is distinct from 'preserve'
      or source_job.contract_id <> active_job.contract_id
      or source_job.org_id <> active_job.org_id
      or source_job.status is distinct from target.prior_processing_status
      or source_job.original_storage_path is distinct from active_job.original_storage_path
      or (source_job.original_sha256 is not null
        and lower(source_job.original_sha256) is distinct from target.original_sha256)
      or (source_job.page_count is not null
        and source_job.page_count is distinct from target.original_page_count)
      or target.original_sha256 is distinct from effective_original_sha256
      or target.contract_status is distinct from active_contract.status
      or target.prior_processing_status is distinct from active_contract.document_processing_status
      or target.prior_processing_error_code is distinct from active_contract.document_processing_error_code
      or target.prior_processing_profile is distinct from active_contract.document_processing_profile
      or target.prior_spatial_schema_version is distinct from active_contract.document_spatial_schema_version
      or target.prior_spatial_accuracy is distinct from active_contract.document_spatial_accuracy
      or target.original_path_digest is distinct from private.contract_document_path_digest(active_contract.pdf_url)
      or target.prior_processed_path_digest is distinct from private.contract_document_path_digest(active_contract.processed_pdf_url)
      or target.prior_spatial_path_digest is distinct from private.contract_document_path_digest(active_contract.document_spatial_data_path)
      or selected_run.id is distinct from active_job.backfill_run_id
      or selected_run.state is distinct from 'running'
      or exists (
        select 1
        from public.contract_document_jobs as newer
        where newer.contract_id = active_job.contract_id
          and newer.id not in (source_job.id, active_job.id)
          and (
            newer.created_at > source_job.created_at
            or (newer.created_at = source_job.created_at and newer.id::text > source_job.id::text)
          )
      ) then
      raise exception 'geometry backfill completion drift' using errcode = '55000';
    end if;
  else
    select job.* into source_job
    from public.contract_document_jobs as job
    where job.id = active_job.replacement_of_job_id
    for update of job;
    if source_job.id is null or source_job.contract_id <> active_job.contract_id
      or source_job.status <> 'completed'
      or source_job.redaction_profile is distinct from 'dfks-contract-redaction-v1'
      or source_job.superseded_by_job_id is not null
      or active_contract.processed_pdf_url is distinct from source_job.output_storage_path
      or active_contract.document_spatial_data_path is distinct from source_job.spatial_data_path
      or (active_job.downstream_ai_policy = 'reanalyze'
        and active_contract.status not in ('kladde', 'afventer'))
      or (active_job.downstream_ai_policy = 'preserve'
        and active_contract.status <> 'valideret') then
      raise exception 'replacement source generation mismatch' using errcode = '55000';
    end if;
  end if;

  canonical_details := case
    when p_status = 'needs_review' then
      private.canonical_contract_document_review_details(
        jsonb_build_object(
          'schemaVersion', 1,
          'reasons', coalesce(p_review_details -> 'reasons', '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object(
              'code', p_error_code, 'pageNumbers', '[]'::jsonb
            ))
        )
      )
    else '{"schemaVersion":1,"reasons":[]}'::jsonb
  end;

  if p_status = 'completed' and (
    p_document_classification is null
    or p_document_classification not in ('image_only', 'mixed', 'native_text')
    or (p_document_classification = 'native_text' and (
      p_native_page_count <> 0 or p_ocr_page_count <> p_page_count
    ))
    or p_ocr_engine is distinct from 'google-vision-eu-v1'
    or p_processing_profile is distinct from 'google-vision-direct-v1'
    or p_spatial_schema_version is distinct from 'google-vision-spatial-v3'
    or p_ocr_applied is distinct from true
    or p_page_count is null or p_page_count < 1 or p_page_count > 200
    or (active_job.backfill_run_id is not null
      and p_page_count is distinct from target.original_page_count)
    or p_text_char_count is null or p_text_char_count < 1
    or p_ocr_page_count is null or p_ocr_page_count < 1
    or p_unreadable_page_count is distinct from 0
    or coalesce(p_native_page_count, 0) + coalesce(p_ocr_page_count, 0) <> p_page_count
    or p_processed_sha256 is null or p_processed_sha256 !~ '^[0-9a-f]{64}$'
    or p_processed_sha256 = effective_original_sha256
    or active_job.output_storage_path is null
    or active_job.output_storage_path = active_job.original_storage_path
    or active_job.output_storage_path <> (
      active_job.org_id::text || '/processed/' || active_job.contract_id::text
      || '/leases/' || p_lease_token::text || '/normalised.pdf'
    )
    or active_job.spatial_data_path is null
    or active_job.spatial_data_path <> (
      active_job.org_id::text || '/processed/' || active_job.contract_id::text
      || '/leases/' || p_lease_token::text || '/vision-layout.json.gz'
    )
    or p_spatial_sha256 is null or p_spatial_sha256 !~ '^[0-9a-f]{64}$'
    or p_spatial_accuracy_score is null or p_spatial_accuracy_score < 0.95
    or p_spatial_median_iou is null or p_spatial_median_iou < 0.85
    or p_spatial_center_inside_ratio is null or p_spatial_center_inside_ratio < 0.98
  ) then
    raise exception 'completed forced Vision OCR lacks required integrity evidence'
      using errcode = '22023';
  end if;

  if p_status <> 'completed' then
    update public.contract_document_jobs
    set status = p_status, document_classification = p_document_classification,
        ocr_engine = left(p_ocr_engine, 80),
        orientation_corrections = coalesce(p_orientation_corrections, '[]'::jsonb),
        ocr_applied = false, page_count = p_page_count,
        text_char_count = p_text_char_count,
        native_page_count = greatest(0, coalesce(p_native_page_count, 0)),
        ocr_page_count = greatest(0, coalesce(p_ocr_page_count, 0)),
        unreadable_page_count = greatest(0, coalesce(p_unreadable_page_count, 0)),
        original_sha256 = effective_original_sha256,
        review_details = canonical_details,
        error_code = left(p_error_code, 80),
        safe_error_message = left(p_safe_error_message, 500),
        lease_token = null, lease_expires_at = null,
        next_attempt_at = case when p_status = 'failed' and attempts < 5
          then now() + make_interval(mins => attempts * 5) else next_attempt_at end,
        updated_at = now()
    where id = active_job.id
    returning * into finished;
    if active_job.backfill_run_id is not null then
      update public.contract_document_backfill_targets as backfill_target
      set outcome = case when p_status = 'needs_review' then 'needs_review' else 'failed' end,
          updated_at = now()
      where backfill_target.run_id = active_job.backfill_run_id
        and backfill_target.queued_job_id = active_job.id;
      if not exists (
        select 1
        from public.contract_document_jobs as pending
        where pending.backfill_run_id = active_job.backfill_run_id
          and (
            pending.status in ('queued', 'processing')
            or (pending.status = 'failed' and pending.attempts < 5)
          )
      ) then
        update public.contract_document_backfill_runs as backfill_run
        set state = 'quality_pending', quality_checked_at = null,
            updated_at = now()
        where backfill_run.id = active_job.backfill_run_id
          and backfill_run.state in ('queued', 'running');
      end if;
    else
      update public.contracts
      set document_processing_status = 'ready', document_processing_error_code = null
      where id = active_job.contract_id;
    end if;
    return finished;
  end if;

  select * into finished
  from public.finish_contract_document_job_v2(
    p_job_id, p_status, p_document_classification, p_ocr_engine,
    p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
    p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
    '{}'::jsonb, p_spatial_accuracy_score, p_spatial_median_iou,
    p_spatial_center_inside_ratio, effective_original_sha256, p_processed_sha256,
    p_error_code, p_safe_error_message
  );
  update public.contract_document_jobs
  set processing_profile = left(p_processing_profile, 80), redaction_profile = null,
      redaction_counts = '{}'::jsonb,
      spatial_schema_version = left(p_spatial_schema_version, 80),
      spatial_sha256 = p_spatial_sha256, review_details = canonical_details,
      lease_token = null, updated_at = now()
  where id = finished.id
  returning * into finished;
  update public.contracts
  set document_processing_profile = left(p_processing_profile, 80),
      document_redaction_profile = null,
      document_spatial_schema_version = left(p_spatial_schema_version, 80)
  where id = finished.contract_id;
  update public.contract_document_jobs
  set superseded_by_job_id = finished.id, superseded_at = now(), updated_at = now()
  where id = source_job.id;

  if active_job.backfill_run_id is not null then
    update public.contract_document_backfill_targets as backfill_target
    set outcome = 'completed', updated_at = now()
    where backfill_target.run_id = active_job.backfill_run_id
      and backfill_target.queued_job_id = active_job.id;
  else
    insert into public.contract_document_artifact_deletions(
      org_id, contract_id, source_job_id, replacement_job_id, artifact_kind, storage_path
    ) values
      (finished.org_id, finished.contract_id, source_job.id, finished.id,
        'masked_pdf', source_job.output_storage_path),
      (finished.org_id, finished.contract_id, source_job.id, finished.id,
        'masked_spatial', source_job.spatial_data_path)
    on conflict (source_job_id, artifact_kind) do nothing;
  end if;

  if active_job.backfill_run_id is not null and not exists (
    select 1
    from public.contract_document_jobs as pending
    where pending.backfill_run_id = active_job.backfill_run_id
      and (
        pending.status in ('queued', 'processing')
        or (pending.status = 'failed' and pending.attempts < 5)
      )
  ) then
    update public.contract_document_backfill_runs as backfill_run
    set state = 'quality_pending', quality_checked_at = null,
        updated_at = now()
    where backfill_run.id = active_job.backfill_run_id
      and backfill_run.state in ('queued', 'running');
  end if;
  return finished;
end;
$$;

revoke all on function public.finish_contract_document_job_v8(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, numeric, numeric, numeric, text, text, text, text, text,
  text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v8(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, numeric, numeric, numeric, text, text, text, text, text,
  text, text, jsonb
) to service_role;
revoke execute on function public.finish_contract_document_job_v7(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, numeric, numeric, numeric, text, text, text, text, text,
  text, text, jsonb
) from service_role;

create or replace function public.complete_contract_document_geometry_backfill_run(
  p_run_id uuid,
  p_cohort_digest text,
  p_quality_report_digest text,
  p_completed integer,
  p_needs_review integer,
  p_failed integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_run public.contract_document_backfill_runs;
  actual_completed integer;
  actual_needs_review integer;
  actual_failed integer;
  member_uuids uuid[];
  org_uuids uuid[];
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select run.* into selected_run
  from public.contract_document_backfill_runs as run
  where run.id = p_run_id
  for update of run;
  if selected_run.id is null or selected_run.state <> 'quality_pending'
    or selected_run.cohort_digest is distinct from lower(p_cohort_digest)
    or selected_run.audit_event_id is null
    or p_quality_report_digest is null
    or lower(p_quality_report_digest) !~ '^[0-9a-f]{64}$'
    or p_completed is null or p_completed < 0
    or p_needs_review is null or p_needs_review < 0
    or p_failed is null or p_failed < 0 then
    raise exception 'geometry backfill quality gate unavailable' using errcode = '55000';
  end if;
  select
    count(*) filter (where target.outcome = 'completed')::integer,
    count(*) filter (where target.outcome = 'needs_review')::integer,
    count(*) filter (where target.outcome = 'failed')::integer
    into actual_completed, actual_needs_review, actual_failed
  from public.contract_document_backfill_targets as target
  where target.run_id = p_run_id;
  if actual_completed <> p_completed
    or actual_needs_review <> p_needs_review
    or actual_failed <> p_failed
    or actual_completed + actual_needs_review + actual_failed <> selected_run.expected_count
    or exists (
      select 1 from public.contract_document_jobs as job
      where job.backfill_run_id = p_run_id
        and (job.status in ('queued', 'processing')
          or (job.status = 'failed' and job.attempts < 5))
    )
    or exists (
      select 1
      from public.contract_document_backfill_targets as backfill_target
      left join public.contract_document_jobs as job
        on job.id = backfill_target.queued_job_id
      left join public.contract_document_jobs as source
        on source.id = backfill_target.source_job_id
      left join public.contracts as contract
        on contract.id = backfill_target.contract_id
      where backfill_target.run_id = p_run_id
        and (
          job.id is null
          or source.id is null
          or contract.id is null
          or job.backfill_run_id is distinct from p_run_id
          or job.backfill_source_job_id is distinct from source.id
          or job.processing_intent is distinct from 'direct_vision_geometry_backfill_v1'
          or job.downstream_ai_policy is distinct from 'preserve'
          or job.contract_id is distinct from backfill_target.contract_id
          or job.org_id is distinct from backfill_target.org_id
          or job.original_storage_path is distinct from contract.pdf_url
          or lower(job.original_sha256) is distinct from backfill_target.original_sha256
          or source.contract_id is distinct from backfill_target.contract_id
          or source.org_id is distinct from backfill_target.org_id
          or source.original_storage_path is distinct from contract.pdf_url
          or source.status is distinct from backfill_target.prior_processing_status
          or (source.original_sha256 is not null
            and lower(source.original_sha256) is distinct from backfill_target.original_sha256)
          or (source.page_count is not null
            and source.page_count is distinct from backfill_target.original_page_count)
          or contract.org_id is distinct from backfill_target.org_id
          or contract.status is distinct from backfill_target.contract_status
          or private.contract_document_path_digest(contract.pdf_url)
            is distinct from backfill_target.original_path_digest
          or exists (
            select 1
            from public.contract_document_artifact_deletions as deletion
            where deletion.replacement_job_id = job.id
          )
          or (
            backfill_target.outcome = 'completed'
            and (
              job.status <> 'completed'
              or job.ocr_applied is distinct from true
              or job.page_count is distinct from backfill_target.original_page_count
              or job.processing_profile is distinct from 'google-vision-direct-v1'
              or job.spatial_schema_version is distinct from 'google-vision-spatial-v3'
              or job.processed_sha256 is null
              or job.spatial_sha256 is null
              or source.superseded_by_job_id is distinct from job.id
              or contract.document_processing_status <> 'ready'
              or contract.processed_pdf_url is distinct from job.output_storage_path
              or contract.document_spatial_data_path is distinct from job.spatial_data_path
              or contract.document_processing_profile is distinct from 'google-vision-direct-v1'
              or contract.document_spatial_schema_version is distinct from 'google-vision-spatial-v3'
            )
          )
          or (
            backfill_target.outcome in ('needs_review', 'failed')
            and (
              job.status is distinct from backfill_target.outcome
              or (backfill_target.outcome = 'failed' and job.attempts < 5)
              or source.superseded_by_job_id is not null
              or contract.document_processing_status
                is distinct from backfill_target.prior_processing_status
              or contract.document_processing_error_code
                is distinct from backfill_target.prior_processing_error_code
              or contract.document_processing_profile
                is distinct from backfill_target.prior_processing_profile
              or contract.document_spatial_schema_version
                is distinct from backfill_target.prior_spatial_schema_version
              or contract.document_spatial_accuracy
                is distinct from backfill_target.prior_spatial_accuracy
              or private.contract_document_path_digest(contract.processed_pdf_url)
                is distinct from backfill_target.prior_processed_path_digest
              or private.contract_document_path_digest(contract.document_spatial_data_path)
                is distinct from backfill_target.prior_spatial_path_digest
            )
          )
        )
    ) then
    raise exception 'geometry backfill accounting mismatch' using errcode = '55000';
  end if;
  select coalesce(array_agg(distinct contract.rights_holder_id)
      filter (where contract.rights_holder_id is not null), '{}'::uuid[]),
    coalesce(array_agg(distinct target.org_id), '{}'::uuid[])
    into member_uuids, org_uuids
  from public.contract_document_backfill_targets as target
  join public.contracts as contract on contract.id = target.contract_id
  where target.run_id = p_run_id;
  perform public.append_audit_event_v2(
    p_action => 'update',
    p_entity_type => 'contract_document_backfill_run',
    p_entity_id => p_run_id::text,
    p_actor_type => 'system', p_source => 'database',
    p_correlation_id => p_run_id,
    p_metadata => jsonb_build_object(
      'event_code', 'vision_v3_geometry_backfill_quality_approved',
      'cohort_digest', selected_run.cohort_digest,
      'quality_report_digest', lower(p_quality_report_digest),
      'completed', actual_completed,
      'needs_review', actual_needs_review,
      'failed', actual_failed
    ),
    p_target_member_uuids => member_uuids,
    p_purpose_code => 'document_ocr_geometry_backfill',
    p_legal_basis => 'GDPR Art. 6(1)(b)/(f) og 9(2)(d)',
    p_data_categories => array['contract_data', 'document_data', 'ai_analysis']::text[],
    p_system_component => 'vision_v3_geometry_backfill',
    p_outcome => case when actual_needs_review + actual_failed > 0 then 'partial' else 'success' end,
    p_org_ids => org_uuids
  );
  update public.contract_document_backfill_runs
  set state = 'completed', quality_report_digest = lower(p_quality_report_digest),
      quality_checked_at = now(), completed_at = now(), updated_at = now()
  where id = p_run_id;
  return true;
end;
$$;

revoke all on function public.complete_contract_document_geometry_backfill_run(
  uuid, text, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.complete_contract_document_geometry_backfill_run(
  uuid, text, text, integer, integer, integer
) to service_role;
