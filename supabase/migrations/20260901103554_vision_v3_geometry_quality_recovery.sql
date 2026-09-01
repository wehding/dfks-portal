-- Audited, immutable recovery generations for the bounded Vision-v3 backfill.
--
-- SECURITY INVARIANTS
-- - a recovery is only created while the exact run is quality_pending;
-- - the baseline source, original hash/path and live contract business state
--   are rechecked under locks before any child is inserted;
-- - terminal job rows are never reset or overwritten;
-- - only the job referenced by the target pointer can be claimed/completed;
-- - the semantic audit event and every affected member subject are committed
--   in the same transaction as all recovery generations;
-- - contract status, original source and downstream AI jobs are never changed.

alter table public.contract_document_backfill_targets
  add column if not exists recovery_generation smallint not null default 0;

alter table public.contract_document_backfill_targets
  drop constraint if exists contract_document_backfill_targets_recovery_generation_check,
  add constraint contract_document_backfill_targets_recovery_generation_check check (
    recovery_generation between 0 and 20
  );

alter table public.contract_document_jobs
  add column if not exists backfill_recovery_audit_event_id uuid
    references public.audit_events(id) on delete restrict;

comment on column public.contract_document_backfill_targets.recovery_generation is
  'Zero-based immutable recovery-chain depth for the job currently referenced by queued_job_id.';
comment on column public.contract_document_jobs.backfill_recovery_audit_event_id is
  'Semantic cohort audit event that atomically authorised this backfill recovery generation.';

create index if not exists contract_document_jobs_backfill_recovery_audit_event_idx
  on public.contract_document_jobs(backfill_recovery_audit_event_id)
  where backfill_recovery_audit_event_id is not null;

-- The initial one-row-per-run indexes prevented immutable recovery children.
-- Replace them with runnable-generation uniqueness. Retryable failed jobs are
-- included because the claim RPC can still reclaim them.
drop index if exists public.contract_document_jobs_one_geometry_backfill_source_idx;
drop index if exists public.contract_document_jobs_one_geometry_backfill_contract_idx;

create unique index contract_document_jobs_one_active_geometry_source_idx
  on public.contract_document_jobs(backfill_run_id, backfill_source_job_id)
  where backfill_run_id is not null
    and (
      status in ('queued', 'processing')
      or (status = 'failed' and attempts < 5)
    );

create unique index contract_document_jobs_one_active_geometry_contract_idx
  on public.contract_document_jobs(backfill_run_id, contract_id)
  where backfill_run_id is not null
    and (
      status in ('queued', 'processing')
      or (status = 'failed' and attempts < 5)
    );

create index if not exists contract_document_jobs_geometry_recovery_lineage_idx
  on public.contract_document_jobs(backfill_run_id, contract_id, created_at, id)
  where backfill_run_id is not null;

-- Validate the whole current chain, not merely its newest row. The target
-- pointer is authoritative; every other generation for the same run/contract
-- must be an ancestor in exactly one linear recovery chain.
create or replace function private.contract_document_geometry_recovery_chain_valid(
  p_run_id uuid,
  p_contract_id uuid,
  p_current_job_id uuid,
  p_generation integer
)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive lineage as (
    select job.id, job.recovery_of_job_id, job.created_at, array[job.id]::uuid[] as path
    from public.contract_document_jobs as job
    where job.id = p_current_job_id
      and job.backfill_run_id = p_run_id
      and job.contract_id = p_contract_id
    union all
    select parent.id, parent.recovery_of_job_id, parent.created_at,
      lineage.path || parent.id
    from public.contract_document_jobs as parent
    join lineage on parent.id = lineage.recovery_of_job_id
    where cardinality(lineage.path) <= 21
      and not parent.id = any(lineage.path)
  ),
  current_target as (
    select target.*
    from public.contract_document_backfill_targets as target
    where target.run_id = p_run_id
      and target.contract_id = p_contract_id
  ),
  current_job as (
    select job.*
    from public.contract_document_jobs as job
    where job.id = p_current_job_id
  )
  select coalesce((
    select
      target.queued_job_id = p_current_job_id
      and target.recovery_generation = p_generation
      and p_generation between 0 and 20
      and (select count(*) from lineage) = p_generation + 1
      and (select count(*) from lineage where recovery_of_job_id is null) = 1
      and not exists (
        select 1
        from public.contract_document_jobs as extra
        where extra.backfill_run_id = p_run_id
          and extra.contract_id = p_contract_id
          and extra.id not in (select id from lineage)
      )
      and not exists (
        select 1
        from lineage
        join public.contract_document_jobs as generation on generation.id = lineage.id
        where generation.backfill_run_id is distinct from target.run_id
          or generation.contract_id is distinct from target.contract_id
          or generation.org_id is distinct from target.org_id
          or generation.backfill_source_job_id is distinct from target.source_job_id
          or generation.original_sha256 is distinct from target.original_sha256
          or generation.original_storage_path is distinct from current.original_storage_path
          or generation.processing_intent is distinct from 'direct_vision_geometry_backfill_v1'
          or generation.downstream_ai_policy is distinct from current.downstream_ai_policy
          or generation.processing_profile is distinct from current.processing_profile
          or generation.replacement_of_job_id is not null
          or (
            generation.id <> p_current_job_id
            and (
              generation.status not in ('needs_review', 'failed')
              or (generation.status = 'failed' and generation.attempts < 5)
            )
          )
          or (
            generation.recovery_of_job_id is null
            and generation.backfill_recovery_audit_event_id is not null
          )
          or (
            generation.recovery_of_job_id is not null
            and (
              generation.recovery_reason_code
                is distinct from 'geometry_quality_recovery_v1'
              or
              generation.backfill_recovery_audit_event_id is null
              or not exists (
                select 1
                from public.audit_events as recovery_event
                where recovery_event.id = generation.backfill_recovery_audit_event_id
                  and recovery_event.action = 'create'
                  and recovery_event.entity_type = 'contract_document_backfill_recovery'
                  and recovery_event.entity_id = p_run_id::text
                  and recovery_event.correlation_id = p_run_id
                  and recovery_event.source = 'database'
                  and recovery_event.system_component
                    = 'vision_v3_geometry_backfill_recovery'
                  and recovery_event.metadata ->> 'event_code'
                    = 'vision_v3_geometry_backfill_recovery_queued'
                  and public.verify_audit_event_subjects(recovery_event.id)
                  and (
                    not exists (
                      select 1
                      from public.contracts as member_contract
                      where member_contract.id = p_contract_id
                        and member_contract.rights_holder_id is not null
                    )
                    or exists (
                      select 1
                      from public.audit_event_subjects as recovery_subject
                      join public.contracts as member_contract
                        on member_contract.id = p_contract_id
                      where recovery_subject.event_id = recovery_event.id
                        and recovery_subject.target_member_uuid
                          = member_contract.rights_holder_id
                    )
                  )
              )
            )
          )
      )
    from current_target as target
    cross join current_job as current
  ), false);
$$;

revoke all on function private.contract_document_geometry_recovery_chain_valid(
  uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;

-- Queue a bounded set of exact terminal targets in one transaction and write
-- one semantic audit event for the operator action. The RPC is idempotent for
-- an exact retry after a lost response, but only a quality_pending run can be
-- changed.
create or replace function public.queue_contract_document_geometry_backfill_recovery(
  p_run_id uuid,
  p_cohort_digest text,
  p_recoveries jsonb,
  p_priority integer default 1250,
  p_created_by uuid default null
)
returns table(
  outcome text,
  run_id uuid,
  queued_count integer,
  minimum_generation integer,
  maximum_generation integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_run public.contract_document_backfill_runs;
  requested record;
  target public.contract_document_backfill_targets;
  terminal_job public.contract_document_jobs;
  source_job public.contract_document_jobs;
  locked_contract public.contracts;
  target_source_job_id uuid;
  recovery_job_id uuid;
  recovery_job_ids uuid[] := '{}'::uuid[];
  requested_contract_ids uuid[] := '{}'::uuid[];
  member_uuids uuid[];
  org_uuids uuid[];
  recovery_audit_event_id uuid;
  requested_count integer;
  distinct_contract_count integer;
  distinct_job_count integer;
  idempotent_count integer;
  audit_bound_count integer;
  generation_min integer;
  generation_max integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_run_id is null
    or p_cohort_digest is null or lower(p_cohort_digest) !~ '^[0-9a-f]{64}$'
    or p_recoveries is null or jsonb_typeof(p_recoveries) <> 'array'
    or jsonb_array_length(p_recoveries) not between 1 and 500
    or p_priority is null or p_priority not between 1 and 5000
    or (p_created_by is not null and not exists (
      select 1 from auth.users as actor where actor.id = p_created_by
    )) then
    raise exception 'invalid geometry recovery input' using errcode = '22023';
  end if;

  select count(*)::integer,
    count(distinct lower(item ->> 'contractId'))::integer,
    count(distinct lower(item ->> 'currentJobId'))::integer
    into requested_count, distinct_contract_count, distinct_job_count
  from jsonb_array_elements(p_recoveries) as rows(item);
  if requested_count <> distinct_contract_count
    or requested_count <> distinct_job_count
    or exists (
      select 1
      from jsonb_array_elements(p_recoveries) as rows(item)
      where item ->> 'contractId' is null
        or item ->> 'contractId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or item ->> 'currentJobId' is null
        or item ->> 'currentJobId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or item ->> 'currentGeneration' is null
        or item ->> 'currentGeneration' !~ '^[0-9]{1,2}$'
        or (item ->> 'currentGeneration')::integer not between 0 and 19
        or item ->> 'status' not in ('needs_review', 'failed')
        or item ->> 'originalSha256' is null
        or item ->> 'originalSha256' !~ '^[0-9a-f]{64}$'
        or (
          item ->> 'errorCode' is not null
          and item ->> 'errorCode' !~ '^[a-z0-9._-]{2,80}$'
        )
    ) then
    raise exception 'invalid geometry recovery target' using errcode = '22023';
  end if;

  select run.* into selected_run
  from public.contract_document_backfill_runs as run
  where run.id = p_run_id
  for update of run;
  if selected_run.id is null
    or selected_run.cohort_digest is distinct from lower(p_cohort_digest)
    or selected_run.expected_count < requested_count
    or selected_run.audit_event_id is null then
    raise exception 'geometry recovery run mismatch' using errcode = '55000';
  end if;

  -- Exact retry after a committed transaction but lost response.
  if selected_run.state in ('queued', 'running') then
    select count(*)::integer,
      min((item ->> 'currentGeneration')::integer + 1),
      max((item ->> 'currentGeneration')::integer + 1)
      into idempotent_count, generation_min, generation_max
    from jsonb_array_elements(p_recoveries) as rows(item)
    join public.contract_document_backfill_targets as current_target
      on current_target.run_id = p_run_id
     and current_target.contract_id = lower(item ->> 'contractId')::uuid
     and current_target.recovery_generation = (item ->> 'currentGeneration')::integer + 1
    join public.contract_document_jobs as child
      on child.id = current_target.queued_job_id
     and child.recovery_of_job_id = lower(item ->> 'currentJobId')::uuid
     and child.original_sha256 = lower(item ->> 'originalSha256')
     and child.backfill_recovery_audit_event_id is not null
     and child.recovery_reason_code = 'geometry_quality_recovery_v1'
    join public.audit_events as recovery_event
      on recovery_event.id = child.backfill_recovery_audit_event_id
     and recovery_event.entity_type = 'contract_document_backfill_recovery'
     and recovery_event.entity_id = p_run_id::text
     and recovery_event.metadata ->> 'event_code'
       = 'vision_v3_geometry_backfill_recovery_queued'
     and (recovery_event.metadata ->> 'queued_count')::integer = requested_count
    join public.contract_document_jobs as parent
      on parent.id = child.recovery_of_job_id
     and parent.status = item ->> 'status'
     and parent.error_code is not distinct from item ->> 'errorCode'
     and parent.original_sha256 = lower(item ->> 'originalSha256');
    if idempotent_count = requested_count then
      return query select 'already_queued'::text, p_run_id, requested_count,
        generation_min, generation_max;
      return;
    end if;
    raise exception 'geometry recovery run is not quality pending' using errcode = '55000';
  end if;
  if selected_run.state <> 'quality_pending' then
    raise exception 'geometry recovery run is not quality pending' using errcode = '55000';
  end if;

  for requested in
    select
      lower(item ->> 'contractId')::uuid as contract_id,
      lower(item ->> 'currentJobId')::uuid as current_job_id,
      (item ->> 'currentGeneration')::integer as current_generation,
      item ->> 'status' as status,
      item ->> 'errorCode' as error_code,
      lower(item ->> 'originalSha256') as original_sha256
    from jsonb_array_elements(p_recoveries) as rows(item)
    order by lower(item ->> 'contractId')
  loop
    -- Every operation that can touch the same contract uses the same
    -- transaction-scoped advisory lock before row locks. After that lock, the
    -- canonical row order is contract -> source -> target -> active job.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(requested.contract_id::text, 438221948)
    );
    select backfill_target.source_job_id into target_source_job_id
    from public.contract_document_backfill_targets as backfill_target
    where backfill_target.run_id = p_run_id
      and backfill_target.contract_id = requested.contract_id;
    select contract.* into locked_contract
    from public.contracts as contract
    where contract.id = requested.contract_id
    for update of contract;
    select source.* into source_job
    from public.contract_document_jobs as source
    where source.id = target_source_job_id
    for update of source;
    select backfill_target.* into target
    from public.contract_document_backfill_targets as backfill_target
    where backfill_target.run_id = p_run_id
      and backfill_target.contract_id = requested.contract_id
    for update of backfill_target;
    select job.* into terminal_job
    from public.contract_document_jobs as job
    where job.id = requested.current_job_id
    for update of job;

    if target.contract_id is null
      or terminal_job.id is null
      or source_job.id is null
      or locked_contract.id is null
      or target.queued_job_id is distinct from terminal_job.id
      or target.recovery_generation is distinct from requested.current_generation
      or target.outcome is distinct from requested.status
      or terminal_job.status is distinct from requested.status
      or terminal_job.error_code is distinct from requested.error_code
      or terminal_job.original_sha256 is distinct from requested.original_sha256
      or target.original_sha256 is distinct from requested.original_sha256
      or (terminal_job.status = 'failed' and terminal_job.attempts < 5)
      or terminal_job.superseded_by_job_id is not null
      or terminal_job.processing_intent is distinct from 'direct_vision_geometry_backfill_v1'
      or terminal_job.downstream_ai_policy is distinct from 'preserve'
      or terminal_job.backfill_run_id is distinct from p_run_id
      or terminal_job.backfill_source_job_id is distinct from target.source_job_id
      or terminal_job.replacement_of_job_id is not null
      or terminal_job.original_storage_path is distinct from locked_contract.pdf_url
      or source_job.contract_id is distinct from target.contract_id
      or source_job.org_id is distinct from target.org_id
      or source_job.status is distinct from target.prior_processing_status
      or source_job.original_storage_path is distinct from locked_contract.pdf_url
      or (source_job.original_sha256 is not null
        and lower(source_job.original_sha256) is distinct from target.original_sha256)
      or (source_job.page_count is not null
        and source_job.page_count is distinct from target.original_page_count)
      or source_job.superseded_by_job_id is not null
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
      or exists (
        select 1
        from public.contract_document_jobs as newer
        where newer.contract_id = target.contract_id
          and newer.id <> source_job.id
          and newer.backfill_run_id is distinct from p_run_id
          and (
            newer.created_at > source_job.created_at
            or (
              newer.created_at = source_job.created_at
              and newer.id::text > source_job.id::text
            )
          )
      )
      or not private.contract_document_geometry_recovery_chain_valid(
        p_run_id, target.contract_id, terminal_job.id, target.recovery_generation
      )
      or exists (
        select 1
        from public.contract_document_jobs as child
        where child.recovery_of_job_id = terminal_job.id
      ) then
      raise exception 'geometry recovery target drift' using errcode = '55000';
    end if;

    recovery_job_id := gen_random_uuid();
    insert into public.contract_document_jobs(
      id, org_id, contract_id, original_storage_path, output_storage_path,
      status, priority, attempts, next_attempt_at, created_by,
      original_sha256, recovery_of_job_id, downstream_ai_policy,
      recovery_reason_code, processing_profile, backfill_run_id,
      backfill_source_job_id, processing_intent, created_at
    ) values (
      recovery_job_id, terminal_job.org_id, terminal_job.contract_id,
      terminal_job.original_storage_path,
      terminal_job.org_id::text || '/processed/' || terminal_job.contract_id::text
        || '/pending/' || recovery_job_id::text || '/normalised.pdf',
      'queued', p_priority, 0, now(), terminal_job.created_by,
      requested.original_sha256, terminal_job.id,
      terminal_job.downstream_ai_policy, 'geometry_quality_recovery_v1',
      terminal_job.processing_profile, p_run_id,
      terminal_job.backfill_source_job_id,
      terminal_job.processing_intent, clock_timestamp()
    );

    update public.contract_document_backfill_targets as backfill_target
    set queued_job_id = recovery_job_id,
        recovery_generation = requested.current_generation + 1,
        outcome = 'queued', updated_at = now()
    where backfill_target.run_id = p_run_id
      and backfill_target.contract_id = requested.contract_id
      and backfill_target.queued_job_id = terminal_job.id;
    if not found then
      raise exception 'geometry recovery pointer update failed' using errcode = '55000';
    end if;

    recovery_job_ids := array_append(recovery_job_ids, recovery_job_id);
    requested_contract_ids := array_append(requested_contract_ids, requested.contract_id);
  end loop;

  select coalesce(array_agg(distinct contract.rights_holder_id)
      filter (where contract.rights_holder_id is not null), '{}'::uuid[]),
    coalesce(array_agg(distinct target_row.org_id), '{}'::uuid[]),
    min(target_row.recovery_generation), max(target_row.recovery_generation)
    into member_uuids, org_uuids, generation_min, generation_max
  from public.contract_document_backfill_targets as target_row
  join public.contracts as contract on contract.id = target_row.contract_id
  where target_row.run_id = p_run_id
    and target_row.contract_id = any(requested_contract_ids);

  recovery_audit_event_id := public.append_audit_event_v2(
    p_action => 'create',
    p_entity_type => 'contract_document_backfill_recovery',
    p_entity_id => p_run_id::text,
    p_actor_user_id => p_created_by,
    p_actor_type => case when p_created_by is null then 'system' else 'user' end,
    p_source => 'database',
    p_correlation_id => p_run_id,
    p_metadata => jsonb_build_object(
      'event_code', 'vision_v3_geometry_backfill_recovery_queued',
      'queued_count', requested_count,
      'minimum_generation', generation_min,
      'maximum_generation', generation_max,
      'cohort_digest', selected_run.cohort_digest,
      'needs_review_count', (
        select count(*) from jsonb_array_elements(p_recoveries) as rows(item)
        where item ->> 'status' = 'needs_review'
      ),
      'failed_count', (
        select count(*) from jsonb_array_elements(p_recoveries) as rows(item)
        where item ->> 'status' = 'failed'
      )
    ),
    p_target_member_uuids => member_uuids,
    p_purpose_code => 'document_ocr_geometry_backfill',
    p_legal_basis => 'GDPR Art. 6(1)(b)/(f) og 9(2)(d)',
    p_data_categories => array['contract_data', 'document_data', 'ai_analysis']::text[],
    p_system_component => 'vision_v3_geometry_backfill_recovery',
    p_org_ids => org_uuids
  );

  update public.contract_document_jobs
  set backfill_recovery_audit_event_id = recovery_audit_event_id,
      updated_at = now()
  where id = any(recovery_job_ids);
  get diagnostics audit_bound_count = row_count;
  if audit_bound_count <> requested_count then
    raise exception 'geometry recovery audit binding failed' using errcode = '55000';
  end if;

  update public.contract_document_backfill_runs
  set state = 'queued', quality_report_digest = null,
      quality_checked_at = null, completed_at = null,
      last_error_code = null, updated_at = now()
  where id = p_run_id and state = 'quality_pending';
  if not found then
    raise exception 'geometry recovery run transition failed' using errcode = '55000';
  end if;

  return query select 'queued'::text, p_run_id, requested_count,
    generation_min, generation_max;
end;
$$;

revoke all on function public.queue_contract_document_geometry_backfill_recovery(
  uuid, text, jsonb, integer, uuid
) from public, anon, authenticated;
grant execute on function public.queue_contract_document_geometry_backfill_recovery(
  uuid, text, jsonb, integer, uuid
) to service_role;

-- Claims only operate on the generation referenced by each target. Historical
-- terminal rows can therefore never be reclaimed after the pointer moves.
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
  select backfill_run.* into selected_run
  from public.contract_document_backfill_runs as backfill_run
  where backfill_run.id = p_run_id
  for update of backfill_run;
  if selected_run.id is null then
    raise exception 'geometry backfill run is unavailable' using errcode = '55000';
  end if;
  if selected_run.state in ('quality_pending', 'completed') then return null; end if;
  if selected_run.state not in ('queued', 'running') then
    raise exception 'geometry backfill run is unavailable' using errcode = '55000';
  end if;

  update public.contract_document_jobs as job
  set status = 'failed', lease_token = null, lease_expires_at = null,
      error_code = 'max_attempts_exceeded',
      safe_error_message = 'Dokumentet kunne ikke færdigbehandles efter det maksimale antal forsøg.',
      updated_at = now()
  from public.contract_document_backfill_targets as current_target
  where current_target.run_id = p_run_id
    and current_target.queued_job_id = job.id
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
    from public.contract_document_backfill_targets as current_target
    join public.contract_document_jobs as pending
      on pending.id = current_target.queued_job_id
    where current_target.run_id = p_run_id
      and (
        pending.status in ('queued', 'processing')
        or (pending.status = 'failed' and pending.attempts < 5)
      )
  ) then
    update public.contract_document_backfill_runs
    set state = 'quality_pending', quality_checked_at = null, updated_at = now()
    where id = p_run_id and state in ('queued', 'running');
    return null;
  end if;

  select job.* into claimed
  from public.contract_document_backfill_targets as current_target
  join public.contract_document_jobs as job on job.id = current_target.queued_job_id
  where current_target.run_id = p_run_id
    and job.backfill_run_id = p_run_id
    and job.processing_intent = 'direct_vision_geometry_backfill_v1'
    and current_target.outcome = job.status
    and (
      (job.status = 'queued' and job.next_attempt_at <= now())
      or (job.status = 'failed' and job.next_attempt_at <= now())
      or (job.status = 'processing' and job.lease_expires_at < now())
    )
    and job.attempts < 5
  order by job.priority desc, job.created_at, job.id
  limit 1;
  if claimed.id is null then return null; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(claimed.contract_id::text, 438221948)
  );
  -- The run row serializes candidate choice. Once the per-contract advisory
  -- lock is held, use the same contract -> source -> target -> active job row
  -- order as recovery and completion.
  select backfill_target.* into target
  from public.contract_document_backfill_targets as backfill_target
  where backfill_target.run_id = p_run_id
    and backfill_target.queued_job_id = claimed.id;
  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = claimed.contract_id
  for update of contract;
  select source.* into source_job
  from public.contract_document_jobs as source
  where source.id = target.source_job_id
  for update of source;
  select backfill_target.* into target
  from public.contract_document_backfill_targets as backfill_target
  where backfill_target.run_id = p_run_id
    and backfill_target.queued_job_id = claimed.id
  for update of backfill_target;
  select job.* into claimed
  from public.contract_document_jobs as job
  where job.id = claimed.id
  for update of job;

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
        and newer.id <> source_job.id
        and newer.backfill_run_id is distinct from p_run_id
        and (
          newer.created_at > source_job.created_at
          or (
            newer.created_at = source_job.created_at
            and newer.id::text > source_job.id::text
          )
        )
    )
    or not private.contract_document_geometry_recovery_chain_valid(
      p_run_id, target.contract_id, claimed.id, target.recovery_generation
    ) then
    raise exception 'geometry backfill baseline drift' using errcode = '55000';
  end if;

  update public.contract_document_jobs
  set status = 'processing', attempts = attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 60))),
      error_code = null, safe_error_message = null, updated_at = now()
  where id = claimed.id
  returning * into claimed;
  update public.contract_document_backfill_targets
  set outcome = 'processing', updated_at = now()
  where run_id = p_run_id and queued_job_id = claimed.id;
  update public.contract_document_backfill_runs
  set state = 'running', started_at = coalesce(started_at, now()), updated_at = now()
  where id = p_run_id and state = 'queued';
  return claimed;
end;
$$;

revoke all on function public.claim_next_contract_document_geometry_backfill_job(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_contract_document_geometry_backfill_job(uuid, integer)
  to service_role;

-- V8 keeps its public signature because the existing completion route already
-- calls it. Geometry completions use a dedicated preserve-only branch so a
-- recovery child cannot trigger generic recovery AI/status side effects.
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
  if jsonb_typeof(coalesce(p_orientation_corrections, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_orientation_corrections, '[]'::jsonb)) > 200 then
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
  if (p_spatial_accuracy_score is not null
      and p_spatial_accuracy_score not between 0 and 1)
    or (p_spatial_median_iou is not null
      and p_spatial_median_iou not between 0 and 1)
    or (p_spatial_center_inside_ratio is not null
      and p_spatial_center_inside_ratio not between 0 and 1)
    or (p_status = 'needs_review'
      and (
        p_spatial_accuracy_score is not null
        or p_spatial_median_iou is not null
        or p_spatial_center_inside_ratio is not null
      )
      and p_spatial_schema_version is distinct from 'google-vision-spatial-v3') then
    raise exception 'invalid spatial review diagnostics' using errcode = '22023';
  end if;

  if active_job.backfill_run_id is not null then
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
  -- Canonical row-lock order for a contract generation is contract -> source
  -- -> target -> active job. The advisory lock above serializes this order
  -- with preparation and recovery transactions for the same contract.
  select contract.* into active_contract
  from public.contracts as contract
  where contract.id = active_job.contract_id
  for update of contract;
  if active_job.backfill_run_id is not null then
    select job.* into source_job
    from public.contract_document_jobs as job
    where job.id = active_job.backfill_source_job_id
    for update of job;
    select backfill_target.* into target
    from public.contract_document_backfill_targets as backfill_target
    where backfill_target.run_id = active_job.backfill_run_id
      and backfill_target.contract_id = active_job.contract_id
      and backfill_target.queued_job_id = active_job.id
    for update of backfill_target;
  else
    select job.* into source_job
    from public.contract_document_jobs as job
    where job.id = active_job.replacement_of_job_id
    for update of job;
  end if;
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
  if active_contract.id is null
    or active_contract.org_id <> active_job.org_id
    or active_contract.pdf_url is distinct from active_job.original_storage_path then
    raise exception 'document source changed during processing' using errcode = '55000';
  end if;

  if active_job.backfill_run_id is not null then
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
          and newer.id <> source_job.id
          and newer.backfill_run_id is distinct from active_job.backfill_run_id
          and (
            newer.created_at > source_job.created_at
            or (
              newer.created_at = source_job.created_at
              and newer.id::text > source_job.id::text
            )
          )
      )
      or not private.contract_document_geometry_recovery_chain_valid(
        active_job.backfill_run_id, active_job.contract_id,
        active_job.id, target.recovery_generation
      ) then
      raise exception 'geometry backfill completion drift' using errcode = '55000';
    end if;
  else
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
        spatial_accuracy_score = case when p_status = 'needs_review'
          then p_spatial_accuracy_score else null end,
        spatial_median_iou = case when p_status = 'needs_review'
          then p_spatial_median_iou else null end,
        spatial_center_inside_ratio = case when p_status = 'needs_review'
          then p_spatial_center_inside_ratio else null end,
        spatial_schema_version = case when p_status = 'needs_review'
          then left(p_spatial_schema_version, 80) else null end,
        spatial_sha256 = null,
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
      update public.contract_document_backfill_targets
      set outcome = case when p_status = 'needs_review' then 'needs_review' else 'failed' end,
          updated_at = now()
      where run_id = active_job.backfill_run_id
        and queued_job_id = active_job.id;
      if not exists (
        select 1
        from public.contract_document_backfill_targets as current_target
        join public.contract_document_jobs as pending
          on pending.id = current_target.queued_job_id
        where current_target.run_id = active_job.backfill_run_id
          and (
            pending.status in ('queued', 'processing')
            or (pending.status = 'failed' and pending.attempts < 5)
          )
      ) then
        update public.contract_document_backfill_runs
        set state = 'quality_pending', quality_checked_at = null, updated_at = now()
        where id = active_job.backfill_run_id and state in ('queued', 'running');
      end if;
    else
      update public.contracts
      set document_processing_status = 'ready', document_processing_error_code = null
      where id = active_job.contract_id;
    end if;
    return finished;
  end if;

  if active_job.backfill_run_id is not null then
    -- Preserve-only completion: no AI jobs, no contract business status and no
    -- original source fields are touched.
    update public.contract_document_jobs
    set status = 'completed',
        document_classification = p_document_classification,
        ocr_engine = left(p_ocr_engine, 80),
        orientation_corrections = coalesce(p_orientation_corrections, '[]'::jsonb),
        ocr_applied = true,
        page_count = p_page_count,
        text_char_count = p_text_char_count,
        native_page_count = greatest(0, coalesce(p_native_page_count, 0)),
        ocr_page_count = greatest(0, coalesce(p_ocr_page_count, 0)),
        unreadable_page_count = 0,
        redaction_counts = '{}'::jsonb,
        spatial_accuracy_score = p_spatial_accuracy_score,
        spatial_median_iou = p_spatial_median_iou,
        spatial_center_inside_ratio = p_spatial_center_inside_ratio,
        original_sha256 = effective_original_sha256,
        processed_sha256 = lower(p_processed_sha256),
        processing_profile = left(p_processing_profile, 80),
        redaction_profile = null,
        spatial_schema_version = left(p_spatial_schema_version, 80),
        spatial_sha256 = lower(p_spatial_sha256),
        review_details = canonical_details,
        error_code = null,
        safe_error_message = null,
        lease_token = null,
        lease_expires_at = null,
        completed_at = now(),
        updated_at = now()
    where id = active_job.id and status = 'processing'
    returning * into finished;
    if finished.id is null then
      raise exception 'job not found or lease inactive' using errcode = 'P0002';
    end if;

    update public.contracts
    set processed_pdf_url = finished.output_storage_path,
        document_processing_status = 'ready',
        document_processing_error_code = null,
        document_processed_at = now(),
        document_text_classification = p_document_classification,
        document_ocr_engine = left(p_ocr_engine, 80),
        document_spatial_accuracy = p_spatial_accuracy_score,
        document_spatial_data_path = finished.spatial_data_path,
        document_processing_profile = left(p_processing_profile, 80),
        document_redaction_profile = null,
        document_spatial_schema_version = left(p_spatial_schema_version, 80)
    where id = finished.contract_id
      and org_id = finished.org_id
      and pdf_url is not distinct from finished.original_storage_path
      and status is not distinct from target.contract_status;
    if not found then
      raise exception 'geometry backfill contract promotion failed' using errcode = '55000';
    end if;

    update public.contract_document_jobs
    set superseded_by_job_id = finished.id,
        superseded_at = now(), updated_at = now()
    where id = source_job.id and superseded_by_job_id is null;
    if not found then
      raise exception 'geometry backfill source promotion failed' using errcode = '55000';
    end if;

    update public.contract_document_backfill_targets
    set outcome = 'completed', updated_at = now()
    where run_id = active_job.backfill_run_id
      and queued_job_id = active_job.id;
    if not found then
      raise exception 'geometry backfill target promotion failed' using errcode = '55000';
    end if;
  else
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
    from public.contract_document_backfill_targets as current_target
    join public.contract_document_jobs as pending
      on pending.id = current_target.queued_job_id
    where current_target.run_id = active_job.backfill_run_id
      and (
        pending.status in ('queued', 'processing')
        or (pending.status = 'failed' and pending.attempts < 5)
      )
  ) then
    update public.contract_document_backfill_runs
    set state = 'quality_pending', quality_checked_at = null, updated_at = now()
    where id = active_job.backfill_run_id and state in ('queued', 'running');
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

-- The existing quality-gate RPC remains the only transition to completed.
-- This trigger adds a recovery-chain fence to that transition without
-- introducing another privileged completion API.
create or replace function private.guard_geometry_backfill_recovery_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'completed' and old.state is distinct from 'completed' then
    -- A partial quality report is never an approval. Keeping the run in
    -- quality_pending preserves the recovery path until every exact cohort
    -- member has a qualified derivative.
    if (
      select count(*)
      from public.contract_document_backfill_targets as target
      where target.run_id = new.id
    ) <> new.expected_count
      or (
        select count(*)
        from public.contract_document_backfill_targets as target
        join public.contract_document_jobs as job
          on job.id = target.queued_job_id
        where target.run_id = new.id
          and target.outcome = 'completed'
          and job.status = 'completed'
      ) <> new.expected_count
      or exists (
        select 1
        from public.contract_document_backfill_targets as target
        where target.run_id = new.id
          and (
            target.outcome <> 'completed'
            or not private.contract_document_geometry_recovery_chain_valid(
              target.run_id, target.contract_id,
              target.queued_job_id, target.recovery_generation
            )
          )
      ) then
      raise exception 'geometry backfill exact completion required' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_geometry_backfill_recovery_completion()
  from public, anon, authenticated, service_role;

drop trigger if exists contract_document_backfill_runs_recovery_completion_guard
  on public.contract_document_backfill_runs;
create trigger contract_document_backfill_runs_recovery_completion_guard
before update of state on public.contract_document_backfill_runs
for each row execute function private.guard_geometry_backfill_recovery_completion();
