-- Guarded, service-only recovery for a terminal OCR job. The caller must
-- establish the current source hash from a controlled read before invoking
-- this function. The worker then verifies the same hash again immediately
-- after download and before DLP/Vision sees any document bytes.

create or replace function public.requeue_contract_document_job_for_recovery(
  p_job_id uuid,
  p_expected_error_code text,
  p_expected_original_sha256 text,
  p_priority integer default 1000
)
returns table(outcome text, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_job public.contract_document_jobs;
  locked_contract public.contracts;
  expected_hash text := lower(nullif(btrim(p_expected_original_sha256), ''));
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_job_id is null
    or nullif(btrim(p_expected_error_code), '') is null
    or expected_hash is null or expected_hash !~ '^[0-9a-f]{64}$'
    or p_priority is null or p_priority < 0 or p_priority > 10000 then
    raise exception 'invalid recovery request' using errcode = '22023';
  end if;

  -- Preserve the queue's lock order: document job before contract.
  select job.* into selected_job
  from public.contract_document_jobs as job
  where job.id = p_job_id
  for update of job;
  if selected_job.id is null then
    raise exception 'document job not found' using errcode = 'P0002';
  end if;
  if selected_job.status <> 'needs_review'
    or selected_job.error_code is distinct from p_expected_error_code
    or (
      selected_job.original_sha256 is not null
      and lower(selected_job.original_sha256) is distinct from expected_hash
    ) then
    raise exception 'document recovery precondition failed' using errcode = '55000';
  end if;

  -- An exact historical row may never overtake a newer document generation,
  -- including a newer terminal row. The active-row check also fails closed on
  -- an unexpected older competing queue row.
  if exists (
    select 1 from public.contract_document_jobs as newer
    where newer.contract_id = selected_job.contract_id
      and newer.id <> selected_job.id
      and (
        newer.created_at > selected_job.created_at
        or (
          newer.created_at = selected_job.created_at
          and newer.id::text > selected_job.id::text
        )
      )
  ) then
    raise exception 'newer document generation exists' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as active
    where active.contract_id = selected_job.contract_id
      and active.id <> selected_job.id
      and (
        active.status in ('queued', 'processing')
        or (active.status = 'failed' and active.attempts < 5)
      )
  ) then
    raise exception 'another document job is active' using errcode = '55000';
  end if;

  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = selected_job.contract_id
  for update of contract;
  if locked_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if selected_job.org_id <> locked_contract.org_id
    or selected_job.original_storage_path is distinct from locked_contract.pdf_url
    or locked_contract.status <> 'kladde'
    or locked_contract.document_processing_status <> 'needs_review'
    or locked_contract.document_processing_error_code is distinct from p_expected_error_code then
    raise exception 'document recovery generation mismatch' using errcode = '55000';
  end if;

  update public.contract_document_jobs as job
  set status = 'queued',
      priority = p_priority,
      attempts = 0,
      next_attempt_at = now(),
      lease_token = null,
      lease_expires_at = null,
      output_storage_path = selected_job.org_id::text || '/processed/'
        || selected_job.contract_id::text || '/normalised.pdf',
      spatial_data_path = null,
      orientation_corrections = '[]'::jsonb,
      ocr_applied = false,
      page_count = null,
      text_char_count = null,
      error_code = null,
      safe_error_message = null,
      completed_at = null,
      ocr_engine = null,
      document_classification = null,
      native_page_count = 0,
      ocr_page_count = 0,
      unreadable_page_count = 0,
      redaction_counts = '{}'::jsonb,
      spatial_accuracy_score = null,
      spatial_median_iou = null,
      spatial_center_inside_ratio = null,
      original_sha256 = expected_hash,
      processed_sha256 = null,
      redaction_profile = null,
      spatial_schema_version = null,
      spatial_sha256 = null,
      updated_at = now()
  where job.id = selected_job.id;

  update public.contracts as contract
  set document_processing_status = 'pending',
      document_processing_error_code = null
  where contract.id = selected_job.contract_id;

  return query select 'requeued'::text, selected_job.id;
end;
$$;

revoke all on function public.requeue_contract_document_job_for_recovery(
  uuid, text, text, integer
) from public, anon, authenticated;
grant execute on function public.requeue_contract_document_job_for_recovery(
  uuid, text, text, integer
) to service_role;

comment on function public.requeue_contract_document_job_for_recovery(
  uuid, text, text, integer
) is
  'Service-only, hash-fenced retry of the newest needs_review OCR job for a draft contract.';

-- Preserve the established source hash across every completion status. If a
-- worker supplies a hash, it must equal the source hash recorded at recovery.
-- This is a second database-side fence in addition to the worker comparison.
create or replace function public.finish_contract_document_job_v5(
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
  p_redaction_counts jsonb default '{}'::jsonb,
  p_spatial_accuracy_score numeric default null,
  p_spatial_median_iou numeric default null,
  p_spatial_center_inside_ratio numeric default null,
  p_original_sha256 text default null,
  p_processed_sha256 text default null,
  p_redaction_profile text default null,
  p_spatial_schema_version text default null,
  p_spatial_sha256 text default null,
  p_error_code text default null,
  p_safe_error_message text default null
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  fenced_contract_id uuid;
  active_job public.contract_document_jobs;
  finished public.contract_document_jobs;
  submitted_hash text := lower(nullif(btrim(p_original_sha256), ''));
  effective_hash text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select contract_id into fenced_contract_id
  from public.contract_document_jobs
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > now();
  if not found then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fenced_contract_id::text, 438221948)
  );
  select job.* into active_job
  from public.contract_document_jobs as job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > now()
  for update of job;
  if active_job.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  if submitted_hash is not null and submitted_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid original hash' using errcode = '22023';
  end if;
  if active_job.original_sha256 is not null
    and p_status in ('completed', 'not_required')
    and submitted_hash is null then
    raise exception 'successful completion requires the current original hash'
      using errcode = '22023';
  end if;
  if active_job.original_sha256 is not null
    and submitted_hash is not null
    and lower(active_job.original_sha256) is distinct from submitted_hash then
    raise exception 'original document hash changed' using errcode = '22023';
  end if;
  effective_hash := coalesce(submitted_hash, lower(active_job.original_sha256));

  select * into finished
  from public.finish_contract_document_job_v4(
    p_job_id, p_lease_token, p_status, p_document_classification, p_ocr_engine,
    p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
    p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
    p_redaction_counts, p_spatial_accuracy_score, p_spatial_median_iou,
    p_spatial_center_inside_ratio, effective_hash, p_processed_sha256,
    p_redaction_profile, p_spatial_schema_version, p_spatial_sha256,
    p_error_code, p_safe_error_message
  );
  return finished;
end;
$$;

revoke all on function public.finish_contract_document_job_v5(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v5(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) to service_role;

-- A blocked AI job is terminal and its failure evidence is retained. Explicit
-- lineage connects the fresh generation and the superseded historical row.
alter table public.contract_ai_jobs
  add column if not exists recovery_of_job_id uuid
    references public.contract_ai_jobs(id) on delete set null,
  add column if not exists superseded_by_job_id uuid
    references public.contract_ai_jobs(id) on delete set null,
  add column if not exists superseded_at timestamptz;

alter table public.contract_ai_jobs
  drop constraint if exists contract_ai_jobs_recovery_not_self_check,
  add constraint contract_ai_jobs_recovery_not_self_check check (
    (recovery_of_job_id is null or recovery_of_job_id <> id)
    and (superseded_by_job_id is null or superseded_by_job_id <> id)
  );

create unique index if not exists contract_ai_jobs_one_recovery_generation
  on public.contract_ai_jobs (recovery_of_job_id)
  where recovery_of_job_id is not null;

comment on column public.contract_ai_jobs.recovery_of_job_id is
  'Blocked historical base job that this supervised generation recovers.';
comment on column public.contract_ai_jobs.superseded_by_job_id is
  'Successful recovery generation that superseded this blocked historical row.';
comment on column public.contract_ai_jobs.superseded_at is
  'Time at which a successful linked recovery superseded this blocked row.';

-- Fail with an explicit preflight instead of attempting to choose between
-- pre-existing duplicate runnable generations.
do $$
begin
  if exists (
    select job.contract_id
    from public.contract_ai_jobs as job
    where job.attachment_id is null
      and (
        job.status in ('queued', 'processing', 'retry_wait')
        or (job.status = 'error' and job.attempts < 5)
      )
    group by job.contract_id
    having count(*) > 1
  ) then
    raise exception 'duplicate runnable base AI jobs require manual reconciliation'
      using errcode = '55000';
  end if;
end;
$$;

-- Only actually claimable/runnable base jobs are unique per contract, so a
-- supervised recovery can create exactly one fresh generation while blocked
-- and exhausted rows remain available as history.
create unique index if not exists contract_ai_jobs_one_runnable_contract
  on public.contract_ai_jobs (contract_id)
  where attachment_id is null
    and (
      status in ('queued', 'processing', 'retry_wait')
      or (status = 'error' and attempts < 5)
    );

comment on index public.contract_ai_jobs_one_runnable_contract is
  'Prevents concurrent runnable base analyses for one contract; blocked/dead/done rows remain historical.';

create or replace function public.queue_blocked_contract_ai_job_for_recovery(
  p_job_id uuid,
  p_expected_failure_class text,
  p_expected_error_code text,
  p_expected_provider text,
  p_expected_model text
)
returns table(outcome text, blocked_job_id uuid, recovery_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisional_contract_id uuid;
  selected_job public.contract_ai_jobs;
  locked_contract public.contracts;
  current_input text;
  created_job_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_job_id is null
    or nullif(btrim(p_expected_failure_class), '') is null
    or nullif(btrim(p_expected_error_code), '') is null
    or nullif(btrim(p_expected_provider), '') is null
    or nullif(btrim(p_expected_model), '') is null then
    raise exception 'invalid recovery request' using errcode = '22023';
  end if;

  select job.contract_id into provisional_contract_id
  from public.contract_ai_jobs as job
  where job.id = p_job_id;
  if provisional_contract_id is null then
    raise exception 'AI job not found' using errcode = 'P0002';
  end if;

  -- Worker mutations and OCR completion use this same per-contract lock
  -- before touching AI rows. The unique runnable index also fences callers
  -- that do not participate in the advisory-lock protocol.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(provisional_contract_id::text, 438221948)
  );
  select job.* into selected_job
  from public.contract_ai_jobs as job
  where job.id = p_job_id
  for update of job;
  if selected_job.id is null then
    raise exception 'AI job not found' using errcode = 'P0002';
  end if;
  if selected_job.contract_id <> provisional_contract_id then
    raise exception 'AI recovery lock domain changed' using errcode = '55000';
  end if;
  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = selected_job.contract_id
  for update of contract;
  if locked_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  current_input := coalesce(locked_contract.processed_pdf_url, locked_contract.pdf_url);

  if selected_job.status <> 'blocked'
    or selected_job.stage <> 'extraction'
    or selected_job.failure_class is distinct from p_expected_failure_class
    or selected_job.error_code is distinct from p_expected_error_code
    or selected_job.provider is distinct from p_expected_provider
    or selected_job.model is distinct from p_expected_model
    or selected_job.attachment_id is not null
    or selected_job.org_id <> locked_contract.org_id
    or locked_contract.status <> 'kladde'
    or locked_contract.document_processing_status <> 'ready'
    or current_input is null
    or selected_job.input_storage_path is distinct from current_input then
    raise exception 'AI recovery precondition failed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_import_items as item
    where item.ai_job_id = selected_job.id
  ) then
    raise exception 'import jobs require batch recovery' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_ai_jobs as newer
    where newer.contract_id = selected_job.contract_id
      and newer.attachment_id is null
      and newer.id <> selected_job.id
      and (
        newer.created_at > selected_job.created_at
        or (
          newer.created_at = selected_job.created_at
          and newer.id::text > selected_job.id::text
        )
      )
  ) then
    raise exception 'newer AI generation exists' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_ai_jobs as active
    where active.contract_id = selected_job.contract_id
      and active.attachment_id is null
      and active.id <> selected_job.id
      and (
        active.status in ('queued', 'processing', 'retry_wait')
        or (active.status = 'error' and active.attempts < 5)
      )
  ) then
    raise exception 'another AI generation is runnable' using errcode = '55000';
  end if;

  insert into public.contract_ai_jobs (
    contract_id, org_id, created_by, status, stage, priority, attempts,
    next_attempt_at, provider, model, prompt_version, schema_version,
    recovery_of_job_id
  ) values (
    selected_job.contract_id, selected_job.org_id, selected_job.created_by,
    'queued', 'extraction', selected_job.priority, 0, now(),
    selected_job.provider, selected_job.model,
    selected_job.prompt_version, selected_job.schema_version, selected_job.id
  ) returning id into created_job_id;

  return query select 'queued'::text, selected_job.id, created_job_id;
end;
$$;

revoke all on function public.queue_blocked_contract_ai_job_for_recovery(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.queue_blocked_contract_ai_job_for_recovery(
  uuid, text, text, text, text
) to service_role;

comment on function public.queue_blocked_contract_ai_job_for_recovery(
  uuid, text, text, text, text
) is
  'Creates one fresh AI generation for an exact current blocked base job while preserving all failure evidence.';

create or replace function public.finish_blocked_contract_ai_job_recovery(
  p_blocked_job_id uuid,
  p_recovery_job_id uuid
)
returns table(outcome text, blocked_job_id uuid, recovery_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisional_contract_id uuid;
  provisional_recovery_contract_id uuid;
  blocked_job public.contract_ai_jobs;
  recovery_job public.contract_ai_jobs;
  locked_contract public.contracts;
  current_input text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_blocked_job_id is null or p_recovery_job_id is null
    or p_blocked_job_id = p_recovery_job_id then
    raise exception 'invalid recovery completion request' using errcode = '22023';
  end if;
  select job.contract_id into provisional_contract_id
  from public.contract_ai_jobs as job
  where job.id = p_blocked_job_id;
  if provisional_contract_id is null then
    raise exception 'blocked AI job not found' using errcode = 'P0002';
  end if;
  select job.contract_id into provisional_recovery_contract_id
  from public.contract_ai_jobs as job
  where job.id = p_recovery_job_id;
  if provisional_recovery_contract_id is null then
    raise exception 'recovery AI job not found' using errcode = 'P0002';
  end if;
  if provisional_recovery_contract_id <> provisional_contract_id then
    raise exception 'AI recovery jobs belong to different contracts'
      using errcode = '55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(provisional_contract_id::text, 438221948)
  );

  -- Lock both generations in deterministic order after the contract advisory
  -- lock. This matches the worker generation fence and avoids row-order races.
  perform job.id
  from public.contract_ai_jobs as job
  where job.id in (p_blocked_job_id, p_recovery_job_id)
  order by job.id
  for update of job;
  select job.* into blocked_job
  from public.contract_ai_jobs as job where job.id = p_blocked_job_id;
  select job.* into recovery_job
  from public.contract_ai_jobs as job where job.id = p_recovery_job_id;
  if blocked_job.contract_id <> provisional_contract_id
    or recovery_job.contract_id <> provisional_contract_id then
    raise exception 'AI recovery lock domain changed' using errcode = '55000';
  end if;
  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = blocked_job.contract_id
  for update of contract;
  current_input := coalesce(locked_contract.processed_pdf_url, locked_contract.pdf_url);

  if blocked_job.id is null or recovery_job.id is null or locked_contract.id is null
    or blocked_job.status <> 'blocked'
    or blocked_job.attachment_id is not null
    or recovery_job.status <> 'done'
    or recovery_job.stage <> 'complete'
    or recovery_job.attachment_id is not null
    or recovery_job.contract_id <> blocked_job.contract_id
    or recovery_job.org_id <> blocked_job.org_id
    or recovery_job.recovery_of_job_id is distinct from blocked_job.id
    or not (
      recovery_job.created_at > blocked_job.created_at
      or (
        recovery_job.created_at = blocked_job.created_at
        and recovery_job.id::text > blocked_job.id::text
      )
    )
    or recovery_job.created_by is distinct from blocked_job.created_by
    or recovery_job.provider is distinct from blocked_job.provider
    or recovery_job.model is distinct from blocked_job.model
    or recovery_job.prompt_version is distinct from blocked_job.prompt_version
    or recovery_job.schema_version is distinct from blocked_job.schema_version
    or locked_contract.org_id <> blocked_job.org_id
    or locked_contract.status <> 'kladde'
    or locked_contract.document_processing_status <> 'ready'
    or recovery_job.input_storage_path is distinct from current_input then
    raise exception 'AI recovery completion precondition failed' using errcode = '55000';
  end if;

  update public.contract_ai_jobs as job
  set status = 'dead',
      superseded_by_job_id = recovery_job.id,
      superseded_at = now(),
      completed_at = coalesce(job.completed_at, now()),
      updated_at = now()
  where job.id = blocked_job.id;

  return query select 'superseded'::text, blocked_job.id, recovery_job.id;
end;
$$;

revoke all on function public.finish_blocked_contract_ai_job_recovery(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.finish_blocked_contract_ai_job_recovery(
  uuid, uuid
) to service_role;

comment on function public.finish_blocked_contract_ai_job_recovery(uuid, uuid) is
  'Marks a preserved blocked generation dead only after an exact newer base generation completed successfully.';
