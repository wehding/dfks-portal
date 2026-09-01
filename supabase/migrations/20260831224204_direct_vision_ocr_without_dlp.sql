-- Direct Google Vision OCR replacement generations.
-- This migration is intentionally deployment-only: it does not queue or run
-- the historical production backfill.

-- Extend master's typed review allowlist with the direct Vision transport
-- diagnostic. Historical DLP codes remain readable as immutable job history.
create or replace function private.contract_document_review_error_code_valid(
  p_error_code text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p_error_code), '') = any (array[
    'processing_deadline_exceeded', 'invalid_download_origin', 'file_too_large',
    'invalid_pdf', 'original_sha256_mismatch', 'ocr_no_readable_text',
    'ocr_unreadable_page', 'ocr_spatial_quality', 'orientation_uncertain',
    'page_geometry_unavailable', 'document_page_limit_exceeded',
    'document_raster_budget_exceeded', 'document_text_limit_exceeded',
    'processed_file_too_large', 'spatial_artifact_too_large',
    'dlp_request_too_large', 'dlp_too_many_locations', 'dlp_response_too_large',
    'dlp_location_invalid', 'dlp_location_out_of_bounds', 'dlp_location_missing',
    'dlp_redacted_image_missing', 'dlp_redacted_image_invalid',
    'dlp_redaction_not_applied', 'dlp_image_dimensions_changed',
    'dlp_canonical_image_invalid', 'vision_page_too_large',
    'vision_page_invalid', 'vision_request_too_large',
    'vision_response_too_large', 'vision_word_limit_exceeded', 'low_text_quality'
  ]::text[]);
$$;

revoke all on function private.contract_document_review_error_code_valid(text)
  from public, anon, authenticated, service_role;

alter table public.contracts
  add column if not exists document_processing_profile text;

alter table public.contract_document_jobs
  add column if not exists processing_profile text,
  add column if not exists replacement_of_job_id uuid
    references public.contract_document_jobs(id) on delete restrict;

alter table public.contracts
  drop constraint if exists contracts_document_processing_profile_check,
  add constraint contracts_document_processing_profile_check check (
    document_processing_profile is null
    or document_processing_profile ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  );

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_processing_profile_check,
  add constraint contract_document_jobs_processing_profile_check check (
    processing_profile is null
    or processing_profile ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  ),
  drop constraint if exists contract_document_jobs_replacement_source_check,
  add constraint contract_document_jobs_replacement_source_check check (
    replacement_of_job_id is null or replacement_of_job_id <> id
  );

create unique index if not exists contract_document_jobs_one_replacement_generation_idx
  on public.contract_document_jobs(replacement_of_job_id)
  where replacement_of_job_id is not null;

comment on column public.contract_document_jobs.processing_profile is
  'Versionsnavn for OCR-behandlingen. google-vision-direct-v1 sender rå sider direkte til Vision EU.';
comment on column public.contract_document_jobs.replacement_of_job_id is
  'Historisk DLP-generation som denne immutable generation erstatter.';

-- The production replacement run must be unable to consume ordinary upload or
-- recovery work. This separate service-only claim is a database-level cohort
-- fence, independent of worker task counts and Cloud Run environment values.
create or replace function public.claim_next_direct_vision_replacement_job(
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
    where replacement_of_job_id is not null
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
    select id
    from public.contract_document_jobs
    where replacement_of_job_id is not null
      and (
        (status = 'queued' and next_attempt_at <= now())
        or (status = 'failed' and next_attempt_at <= now())
        or (status = 'processing' and lease_expires_at < now())
      )
      and attempts < 5
    order by priority desc, created_at
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
    set document_processing_status = 'processing', document_processing_error_code = null
    where id = claimed.contract_id;
  end if;
  return claimed;
end;
$$;

revoke all on function public.claim_next_direct_vision_replacement_job(integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_direct_vision_replacement_job(integer)
  to service_role;

create table if not exists public.contract_document_artifact_deletions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  source_job_id uuid not null references public.contract_document_jobs(id) on delete restrict,
  replacement_job_id uuid not null references public.contract_document_jobs(id) on delete restrict,
  artifact_kind text not null check (artifact_kind in ('masked_pdf', 'masked_spatial')),
  storage_path text not null unique check (
    storage_path <> ''
    and storage_path !~ '[\r\n]'
    and storage_path !~ '(^|/)\.\.(/|$)'
  ),
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'deleted')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz not null default now(),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9._-]{2,80}$'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_job_id, artifact_kind),
  check ((status = 'deleted') = (deleted_at is not null))
);

create index if not exists contract_document_artifact_deletions_retry_idx
  on public.contract_document_artifact_deletions(next_attempt_at, created_at)
  where status in ('pending', 'retry');

alter table public.contract_document_artifact_deletions enable row level security;
revoke all on table public.contract_document_artifact_deletions from public, anon, authenticated;
grant select, insert, update on table public.contract_document_artifact_deletions to service_role;

create or replace function public.queue_direct_vision_replacement_generation(
  p_source_job_id uuid,
  p_expected_original_sha256 text,
  p_priority integer default 100
)
returns table(outcome text, source_job_id uuid, replacement_job_id uuid, downstream_ai_policy text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_job public.contract_document_jobs;
  source_contract public.contracts;
  fenced_contract_id uuid;
  replacement_id uuid := gen_random_uuid();
  selected_policy text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expected_original_sha256 is null
    or p_expected_original_sha256 !~ '^[0-9a-f]{64}$'
    or p_priority < 1 or p_priority > 1000 then
    raise exception 'invalid replacement input' using errcode = '22023';
  end if;

  select job.contract_id into fenced_contract_id
  from public.contract_document_jobs as job
  where job.id = p_source_job_id;
  if fenced_contract_id is null then
    return query select 'source_missing'::text, p_source_job_id, null::uuid, null::text;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fenced_contract_id::text, 438221948)
  );
  select job.* into source_job
  from public.contract_document_jobs as job
  where job.id = p_source_job_id and job.contract_id = fenced_contract_id
  for update of job;
  if source_job.id is null then
    return query select 'source_missing'::text, p_source_job_id, null::uuid, null::text;
    return;
  end if;
  select contract.* into source_contract
  from public.contracts as contract
  where contract.id = source_job.contract_id
  for update of contract;

  if source_contract.id is null
    or source_job.status <> 'completed'
    or source_job.ocr_applied is distinct from true
    or source_job.document_classification not in ('image_only', 'mixed')
    or source_job.redaction_profile is distinct from 'dfks-contract-redaction-v1'
    or source_job.spatial_schema_version is distinct from 'google-vision-spatial-v2'
    or source_job.original_sha256 is distinct from lower(p_expected_original_sha256)
    or source_job.superseded_by_job_id is not null
    or source_contract.org_id <> source_job.org_id
    or source_contract.pdf_url is distinct from source_job.original_storage_path
    or source_contract.processed_pdf_url is distinct from source_job.output_storage_path
    or source_contract.document_spatial_data_path is distinct from source_job.spatial_data_path
    or source_job.output_storage_path = source_job.original_storage_path
    or source_job.spatial_data_path is null
    or source_job.output_storage_path !~ (
      '^' || source_job.org_id::text || '/processed/' || source_job.contract_id::text
      || '/leases/[0-9a-f-]{36}/normalised[.]pdf$'
    )
    or source_job.spatial_data_path !~ (
      '^' || source_job.org_id::text || '/processed/' || source_job.contract_id::text
      || '/leases/[0-9a-f-]{36}/vision-layout[.]json[.]gz$'
    )
    or source_contract.status not in ('kladde', 'afventer', 'valideret') then
    return query select 'skipped_state_changed'::text, source_job.id, null::uuid, null::text;
    return;
  end if;
  if exists (
    select 1 from public.contract_document_jobs as newer
    where newer.contract_id = source_job.contract_id
      and newer.id <> source_job.id
      and (newer.created_at > source_job.created_at
        or (newer.created_at = source_job.created_at and newer.id::text > source_job.id::text))
  ) then
    return query select 'skipped_newer_generation'::text, source_job.id, null::uuid, null::text;
    return;
  end if;

  selected_policy := case when source_contract.status = 'valideret' then 'preserve' else 'reanalyze' end;
  insert into public.contract_document_jobs (
    id, org_id, contract_id, created_by, original_storage_path, output_storage_path,
    status, priority, attempts, next_attempt_at, original_sha256,
    downstream_ai_policy, replacement_of_job_id, processing_profile
  ) values (
    replacement_id, source_job.org_id, source_job.contract_id, source_job.created_by,
    source_job.original_storage_path,
    source_job.org_id::text || '/processed/' || source_job.contract_id::text
      || '/pending/' || replacement_id::text || '/normalised.pdf',
    'queued', p_priority, 0, now(), lower(p_expected_original_sha256),
    selected_policy, source_job.id, 'google-vision-direct-v1'
  );
  update public.contracts
  set document_processing_status = 'pending', document_processing_error_code = null
  where id = source_job.contract_id;

  return query select 'queued'::text, source_job.id, replacement_id, selected_policy;
end;
$$;

revoke all on function public.queue_direct_vision_replacement_generation(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.queue_direct_vision_replacement_generation(uuid, text, integer)
  to service_role;

create or replace function public.finish_contract_document_job_v7(
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
  finished public.contract_document_jobs;
  canonical_details jsonb;
  effective_original_sha256 text;
  fenced_contract_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed', 'needs_review', 'not_required') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if not private.contract_document_review_details_valid(
    coalesce(p_review_details, '{"schemaVersion":1,"reasons":[]}'::jsonb)
  ) then
    raise exception 'invalid review details' using errcode = '22023';
  end if;
  if p_status = 'needs_review'
    and (p_error_code is null
      or not private.contract_document_review_error_code_valid(p_error_code)) then
    raise exception 'needs_review requires a known safe error code'
      using errcode = '22023';
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
  if p_original_sha256 is not null and p_original_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'invalid original hash' using errcode = '22023';
  end if;
  select job.contract_id into fenced_contract_id
  from public.contract_document_jobs as job
  where job.id = p_job_id;
  if fenced_contract_id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fenced_contract_id::text, 438221948)
  );
  select job.* into active_job
  from public.contract_document_jobs as job
  where job.id = p_job_id and job.contract_id = fenced_contract_id
    and job.status = 'processing' and job.lease_token = p_lease_token
    and job.lease_expires_at > now()
  for update of job;
  if active_job.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  if active_job.original_sha256 is not null
    and p_original_sha256 is not null
    and lower(active_job.original_sha256) <> lower(p_original_sha256) then
    raise exception 'original hash changed during processing' using errcode = '55000';
  end if;
  effective_original_sha256 := coalesce(
    lower(p_original_sha256), lower(active_job.original_sha256)
  );
  canonical_details := case
    when p_status = 'needs_review' then
      private.canonical_contract_document_review_details(
        jsonb_build_object(
          'schemaVersion', 1,
          'reasons', coalesce(p_review_details -> 'reasons', '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object(
              'code', p_error_code,
              'pageNumbers', '[]'::jsonb
            ))
        )
      )
    else '{"schemaVersion":1,"reasons":[]}'::jsonb
  end;
  select contract.* into active_contract
  from public.contracts as contract where contract.id = active_job.contract_id
  for update of contract;
  if active_contract.id is null
    or active_contract.org_id <> active_job.org_id
    or active_contract.pdf_url is distinct from active_job.original_storage_path then
    raise exception 'document source changed during processing' using errcode = '55000';
  end if;

  if p_status = 'completed' and (
    p_document_classification not in ('image_only', 'mixed')
    or p_ocr_engine is distinct from 'google-vision-eu-v1'
    or p_processing_profile is distinct from 'google-vision-direct-v1'
    or p_spatial_schema_version is distinct from 'google-vision-spatial-v3'
    or p_ocr_applied is distinct from true
    or p_page_count is null or p_page_count < 1 or p_page_count > 200
    or p_text_char_count is null or p_text_char_count < 1
    or p_ocr_page_count is null or p_ocr_page_count < 1
    or p_unreadable_page_count is distinct from 0
    or coalesce(p_native_page_count, 0) + coalesce(p_ocr_page_count, 0) <> p_page_count
    or p_original_sha256 is null or p_original_sha256 !~ '^[0-9a-f]{64}$'
    or p_processed_sha256 is null or p_processed_sha256 !~ '^[0-9a-f]{64}$'
    or p_original_sha256 = p_processed_sha256
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
    raise exception 'completed OCR lacks required direct Vision integrity evidence'
      using errcode = '22023';
  end if;

  if active_job.replacement_of_job_id is not null then
    select job.* into source_job
    from public.contract_document_jobs as job
    where job.id = active_job.replacement_of_job_id
    for update of job;
    if source_job.id is null or source_job.contract_id <> active_job.contract_id
      or source_job.status <> 'completed'
      or source_job.redaction_profile is distinct from 'dfks-contract-redaction-v1'
      or source_job.superseded_by_job_id is not null
      or active_contract.processed_pdf_url is distinct from source_job.output_storage_path
      or active_contract.document_spatial_data_path is distinct from source_job.spatial_data_path then
      raise exception 'replacement source generation mismatch' using errcode = '55000';
    end if;
    if (active_job.downstream_ai_policy = 'reanalyze'
        and active_contract.status not in ('kladde', 'afventer'))
      or (active_job.downstream_ai_policy = 'preserve' and active_contract.status <> 'valideret') then
      raise exception 'replacement downstream policy changed' using errcode = '55000';
    end if;

    if p_status <> 'completed' then
      update public.contract_document_jobs
      set status = p_status,
          document_classification = p_document_classification,
          ocr_engine = left(p_ocr_engine, 80),
          orientation_corrections = coalesce(p_orientation_corrections, '[]'::jsonb),
          ocr_applied = false,
          page_count = p_page_count,
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
      update public.contracts
      set document_processing_status = 'ready', document_processing_error_code = null
      where id = active_job.contract_id;
      return finished;
    end if;
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
  set processing_profile = left(p_processing_profile, 80),
      redaction_profile = null,
      redaction_counts = '{}'::jsonb,
      spatial_schema_version = left(p_spatial_schema_version, 80),
      spatial_sha256 = case when p_status = 'completed' then p_spatial_sha256 else null end,
      review_details = canonical_details,
      lease_token = null,
      updated_at = now()
  where id = finished.id
  returning * into finished;
  update public.contracts
  set document_processing_profile = case when p_status = 'completed' then left(p_processing_profile, 80)
        else document_processing_profile end,
      document_redaction_profile = case when p_status = 'completed' then null
        else document_redaction_profile end,
      document_spatial_schema_version = case when p_status = 'completed' then left(p_spatial_schema_version, 80)
        else document_spatial_schema_version end
  where id = finished.contract_id;

  if source_job.id is not null and p_status = 'completed' then
    update public.contract_document_jobs
    set superseded_by_job_id = finished.id, superseded_at = now(), updated_at = now()
    where id = source_job.id;
    insert into public.contract_document_artifact_deletions (
      org_id, contract_id, source_job_id, replacement_job_id, artifact_kind, storage_path
    ) values
      (finished.org_id, finished.contract_id, source_job.id, finished.id, 'masked_pdf', source_job.output_storage_path),
      (finished.org_id, finished.contract_id, source_job.id, finished.id, 'masked_spatial', source_job.spatial_data_path);
  elsif finished.recovery_origin = 'automatic'
    and p_status in ('completed', 'not_required') then
    with recursive lineage(id, recovery_of_job_id) as (
      select job.id, job.recovery_of_job_id
      from public.contract_document_jobs as job
      where job.id = finished.id
      union all
      select parent.id, parent.recovery_of_job_id
      from public.contract_document_jobs as parent
      join lineage on parent.id = lineage.recovery_of_job_id
    )
    update public.contract_document_jobs as ancestor
    set automatic_recovery_state = 'completed', updated_at = now()
    where ancestor.id in (select lineage.id from lineage);
  elsif p_status = 'needs_review' then
    perform 1
    from private.queue_contract_document_job_automatic_recovery_core(finished.id, null);
  end if;
  return finished;
end;
$$;

revoke all on function public.finish_contract_document_job_v7(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, numeric, numeric, numeric, text, text, text, text, text,
  text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v7(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, numeric, numeric, numeric, text, text, text, text, text,
  text, text, jsonb
) to service_role;

create or replace function public.claim_contract_document_artifact_deletions(
  p_limit integer default 25,
  p_replacement_job_id uuid default null
)
returns setof public.contract_document_artifact_deletions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'invalid deletion limit' using errcode = '22023';
  end if;
  return query
  with selected as (
    select deletion.id
    from public.contract_document_artifact_deletions as deletion
    where (
        (deletion.status in ('pending', 'retry') and deletion.next_attempt_at <= now())
        or (deletion.status = 'processing' and deletion.updated_at < now() - interval '15 minutes')
      )
      and (p_replacement_job_id is null or deletion.replacement_job_id = p_replacement_job_id)
    order by deletion.created_at, deletion.id
    for update skip locked
    limit p_limit
  )
  update public.contract_document_artifact_deletions as deletion
  set status = 'processing', attempts = deletion.attempts + 1, updated_at = now()
  from selected where deletion.id = selected.id
  returning deletion.*;
end;
$$;

revoke all on function public.claim_contract_document_artifact_deletions(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_contract_document_artifact_deletions(integer, uuid)
  to service_role;

create or replace function public.finish_contract_document_artifact_deletion(
  p_deletion_id uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.contract_document_artifact_deletions
  set status = case when p_succeeded then 'deleted' else 'retry' end,
      deleted_at = case when p_succeeded then now() else null end,
      last_error_code = case when p_succeeded then null else left(coalesce(p_error_code, 'storage_delete_failed'), 80) end,
      next_attempt_at = case when p_succeeded then next_attempt_at
        else now() + make_interval(mins => least(60, greatest(1, attempts * 5))) end,
      updated_at = now()
  where id = p_deletion_id and status = 'processing';
  return found;
end;
$$;

revoke all on function public.finish_contract_document_artifact_deletion(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.finish_contract_document_artifact_deletion(uuid, boolean, text)
  to service_role;
