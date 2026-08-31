-- Immutable OCR recovery generations. A terminal document job is evidence and
-- must never be reset in place. Recovery creates a fresh queue generation that
-- points at the same immutable legal source, while every successful derivative
-- keeps its lease-scoped storage path on its own completed job row.

alter table public.contract_document_jobs
  add column if not exists recovery_of_job_id uuid
    references public.contract_document_jobs(id) on delete set null,
  add column if not exists superseded_by_job_id uuid
    references public.contract_document_jobs(id) on delete set null,
  add column if not exists superseded_at timestamptz,
  add column if not exists downstream_ai_policy text not null default 'reanalyze',
  add column if not exists recovery_reason_code text,
  add column if not exists review_disposition text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_recovery_not_self_check,
  add constraint contract_document_jobs_recovery_not_self_check check (
    (recovery_of_job_id is null or recovery_of_job_id <> id)
    and (superseded_by_job_id is null or superseded_by_job_id <> id)
  ),
  drop constraint if exists contract_document_jobs_superseded_state_check,
  add constraint contract_document_jobs_superseded_state_check check (
    superseded_by_job_id is null or superseded_at is not null
  ),
  drop constraint if exists contract_document_jobs_downstream_ai_policy_check,
  add constraint contract_document_jobs_downstream_ai_policy_check check (
    downstream_ai_policy in ('reanalyze', 'preserve')
  ),
  drop constraint if exists contract_document_jobs_recovery_reason_code_check,
  add constraint contract_document_jobs_recovery_reason_code_check check (
    recovery_reason_code is null
    or recovery_reason_code ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  ),
  drop constraint if exists contract_document_jobs_review_disposition_check,
  add constraint contract_document_jobs_review_disposition_check check (
    review_disposition is null
    or review_disposition in (
      'retry_after_pipeline_fix', 'rescan_requested', 'manual_overlay'
    )
  ),
  drop constraint if exists contract_document_jobs_review_state_check,
  add constraint contract_document_jobs_review_state_check check (
    (review_disposition is null and reviewed_at is null and reviewed_by is null)
    or (review_disposition is not null and reviewed_at is not null)
  );

create unique index if not exists contract_document_jobs_one_recovery_child
  on public.contract_document_jobs(recovery_of_job_id)
  where recovery_of_job_id is not null;

create unique index if not exists contract_document_jobs_one_superseding_generation
  on public.contract_document_jobs(superseded_by_job_id)
  where superseded_by_job_id is not null;

comment on column public.contract_document_jobs.recovery_of_job_id is
  'Terminal historical document job that this immutable generation recovers.';
comment on column public.contract_document_jobs.superseded_by_job_id is
  'Successful recovery generation that superseded this historical result.';
comment on column public.contract_document_jobs.downstream_ai_policy is
  'reanalyze for drafts; preserve prevents any AI-job mutation for validated contracts.';
comment on column public.contract_document_jobs.review_disposition is
  'Safe operational disposition only; contains no document text or personal data.';

-- Queue a fresh recovery generation. Exact metric, source-hash, source-path,
-- generation and contract-state fences prevent a stale operator manifest from
-- selecting a different document after the dry-run.
create or replace function public.queue_contract_document_job_recovery_generation(
  p_source_job_id uuid,
  p_expected_error_code text,
  p_expected_original_sha256 text,
  p_expected_spatial_accuracy_score numeric,
  p_expected_spatial_median_iou numeric,
  p_expected_spatial_center_inside_ratio numeric,
  p_recovery_reason_code text default 'pipeline_fix',
  p_priority integer default 1000
)
returns table(
  outcome text,
  source_job_id uuid,
  recovery_job_id uuid,
  downstream_ai_policy text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_job public.contract_document_jobs;
  locked_contract public.contracts;
  recovery_id uuid := gen_random_uuid();
  expected_hash text := lower(nullif(btrim(p_expected_original_sha256), ''));
  reason_code text := nullif(btrim(p_recovery_reason_code), '');
  selected_policy text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_source_job_id is null
    or nullif(btrim(p_expected_error_code), '') is null
    or expected_hash is null or expected_hash !~ '^[0-9a-f]{64}$'
    or p_expected_spatial_accuracy_score is null
      or p_expected_spatial_accuracy_score not between 0 and 1
    or p_expected_spatial_median_iou is null
      or p_expected_spatial_median_iou not between 0 and 1
    or p_expected_spatial_center_inside_ratio is null
      or p_expected_spatial_center_inside_ratio not between 0 and 1
    or reason_code is null
      or reason_code !~ '^[a-z0-9][a-z0-9._-]{2,79}$'
    or p_priority is null or p_priority < 0 or p_priority > 10000 then
    raise exception 'invalid recovery request' using errcode = '22023';
  end if;

  -- Match the established queue lock order: source job before contract.
  select job.* into source_job
  from public.contract_document_jobs as job
  where job.id = p_source_job_id
  for update of job;
  if source_job.id is null then
    raise exception 'document job not found' using errcode = 'P0002';
  end if;
  if source_job.status <> 'needs_review'
    or source_job.error_code is distinct from p_expected_error_code
    or lower(source_job.original_sha256) is distinct from expected_hash
    or source_job.spatial_accuracy_score is distinct from p_expected_spatial_accuracy_score
    or source_job.spatial_median_iou is distinct from p_expected_spatial_median_iou
    or source_job.spatial_center_inside_ratio is distinct from p_expected_spatial_center_inside_ratio
    or source_job.review_disposition = 'rescan_requested' then
    raise exception 'document recovery precondition failed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as newer
    where newer.contract_id = source_job.contract_id
      and newer.id <> source_job.id
      and (
        newer.created_at > source_job.created_at
        or (newer.created_at = source_job.created_at and newer.id::text > source_job.id::text)
      )
  ) then
    raise exception 'newer document generation exists' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as active
    where active.contract_id = source_job.contract_id
      and active.id <> source_job.id
      and (
        active.status in ('queued', 'processing')
        or (active.status = 'failed' and active.attempts < 5)
      )
  ) then
    raise exception 'another document job is active' using errcode = '55000';
  end if;

  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = source_job.contract_id
  for update of contract;
  if locked_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if source_job.org_id <> locked_contract.org_id
    or source_job.original_storage_path is distinct from locked_contract.pdf_url
    or locked_contract.status not in ('kladde', 'valideret')
    or locked_contract.document_processing_status <> 'needs_review'
    or locked_contract.document_processing_error_code is distinct from p_expected_error_code then
    raise exception 'document recovery generation mismatch' using errcode = '55000';
  end if;

  selected_policy := case
    when locked_contract.status = 'valideret' then 'preserve'
    else 'reanalyze'
  end;

  insert into public.contract_document_jobs (
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, next_attempt_at, created_by,
    original_sha256, recovery_of_job_id, downstream_ai_policy,
    recovery_reason_code
  ) values (
    recovery_id, source_job.org_id, source_job.contract_id,
    source_job.original_storage_path,
    source_job.org_id::text || '/processed/' || source_job.contract_id::text
      || '/pending/' || recovery_id::text || '/normalised.pdf',
    'queued', p_priority, 0, now(), source_job.created_by,
    expected_hash, source_job.id, selected_policy, reason_code
  );

  update public.contract_document_jobs as historical
  set review_disposition = 'retry_after_pipeline_fix',
      reviewed_at = now(),
      reviewed_by = null,
      updated_at = now()
  where historical.id = source_job.id;

  update public.contracts as contract
  set document_processing_status = 'pending',
      document_processing_error_code = null
  where contract.id = source_job.contract_id;

  return query select 'queued'::text, source_job.id, recovery_id, selected_policy;
end;
$$;

revoke all on function public.queue_contract_document_job_recovery_generation(
  uuid, text, text, numeric, numeric, numeric, text, integer
) from public, anon, authenticated;
grant execute on function public.queue_contract_document_job_recovery_generation(
  uuid, text, text, numeric, numeric, numeric, text, integer
) to service_role;

-- Persist the five source-quality decisions before any automated recovery
-- selection. Exact metrics and source hash make this safe for a one-off
-- operator script without logging document identifiers.
create or replace function public.mark_contract_document_job_for_rescan(
  p_job_id uuid,
  p_expected_error_code text,
  p_expected_original_sha256 text,
  p_expected_spatial_accuracy_score numeric,
  p_expected_spatial_median_iou numeric,
  p_expected_spatial_center_inside_ratio numeric,
  p_actor_user_id uuid default null
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
    or p_expected_spatial_accuracy_score is null
      or p_expected_spatial_accuracy_score not between 0 and 1
    or p_expected_spatial_median_iou is null
      or p_expected_spatial_median_iou not between 0 and 1
    or p_expected_spatial_center_inside_ratio is null
      or p_expected_spatial_center_inside_ratio not between 0 and 1
    or (p_actor_user_id is not null and not exists (
      select 1 from auth.users as actor where actor.id = p_actor_user_id
    )) then
    raise exception 'invalid rescan request' using errcode = '22023';
  end if;

  select job.* into selected_job
  from public.contract_document_jobs as job
  where job.id = p_job_id
  for update of job;
  if selected_job.id is null then
    raise exception 'document job not found' using errcode = 'P0002';
  end if;
  if selected_job.status <> 'needs_review'
    or selected_job.error_code is distinct from p_expected_error_code
    or lower(selected_job.original_sha256) is distinct from expected_hash
    or selected_job.spatial_accuracy_score is distinct from p_expected_spatial_accuracy_score
    or selected_job.spatial_median_iou is distinct from p_expected_spatial_median_iou
    or selected_job.spatial_center_inside_ratio is distinct from p_expected_spatial_center_inside_ratio then
    raise exception 'rescan precondition failed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as newer
    where newer.contract_id = selected_job.contract_id
      and newer.id <> selected_job.id
      and (
        newer.created_at > selected_job.created_at
        or (newer.created_at = selected_job.created_at and newer.id::text > selected_job.id::text)
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
    raise exception 'rescan generation mismatch' using errcode = '55000';
  end if;

  update public.contract_document_jobs as job
  set review_disposition = 'rescan_requested',
      reviewed_at = now(),
      reviewed_by = p_actor_user_id,
      recovery_reason_code = 'source_scan_quality',
      updated_at = now()
  where job.id = selected_job.id;

  update public.contracts as contract
  set document_processing_status = 'needs_review',
      document_processing_error_code = 'ocr_rescan_required'
  where contract.id = selected_job.contract_id;

  return query select 'marked'::text, selected_job.id;
end;
$$;

revoke all on function public.mark_contract_document_job_for_rescan(
  uuid, text, text, numeric, numeric, numeric, uuid
) from public, anon, authenticated;
grant execute on function public.mark_contract_document_job_for_rescan(
  uuid, text, text, numeric, numeric, numeric, uuid
) to service_role;

-- The old in-place reset erases terminal diagnostics. Leave its historical
-- definition available to migration history, but remove all runtime access.
revoke execute on function public.requeue_contract_document_job_for_recovery(
  uuid, text, text, integer
) from service_role;

-- Completion keeps the existing integrity gates in V3/V4/V5, but downstream
-- AI behavior is now controlled by the immutable generation. A validated
-- contract may receive a new derivative without any extraction job mutation.
create or replace function public.finish_contract_document_job_v2(
  p_job_id uuid,
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
  p_error_code text default null,
  p_safe_error_message text default null
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.contract_document_jobs;
  finished public.contract_document_jobs;
  source_job public.contract_document_jobs;
  current_contract public.contracts;
  new_ai_job_id uuid;
  should_queue_ai boolean := false;
begin
  if p_status not in ('completed', 'failed', 'needs_review', 'not_required') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_status = 'completed' and coalesce(p_ocr_applied, false) = false then
    raise exception 'completed document must contain OCR' using errcode = '22023';
  end if;
  if p_status = 'not_required' and p_document_classification <> 'native_text' then
    raise exception 'not_required requires native_text classification' using errcode = '22023';
  end if;

  select job.* into current_job
  from public.contract_document_jobs as job
  where job.id = p_job_id and job.status = 'processing'
  for update of job;
  if current_job.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  select contract.* into current_contract
  from public.contracts as contract
  where contract.id = current_job.contract_id
  for update of contract;
  if current_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  -- The claimed generation is tied to one immutable legal source. A contract
  -- version may be replaced while a worker is running, so every terminal
  -- outcome (including native-text/not_required) must recheck the source
  -- relation before it can update the current contract row.
  if current_job.org_id <> current_contract.org_id
    or current_job.original_storage_path is distinct from current_contract.pdf_url then
    raise exception 'document source changed during processing' using errcode = '55000';
  end if;
  if current_job.downstream_ai_policy = 'preserve'
    and current_contract.status <> 'valideret' then
    raise exception 'preserve policy requires a validated contract' using errcode = '55000';
  end if;
  if current_job.downstream_ai_policy = 'reanalyze'
    and current_contract.status = 'valideret' then
    raise exception 'validated contract requires preserve policy' using errcode = '55000';
  end if;

  update public.contract_document_jobs
  set status = p_status,
      document_classification = p_document_classification,
      ocr_engine = left(p_ocr_engine, 80),
      orientation_corrections = coalesce(p_orientation_corrections, '[]'::jsonb),
      ocr_applied = coalesce(p_ocr_applied, false),
      page_count = p_page_count,
      text_char_count = p_text_char_count,
      native_page_count = greatest(0, coalesce(p_native_page_count, 0)),
      ocr_page_count = greatest(0, coalesce(p_ocr_page_count, 0)),
      unreadable_page_count = greatest(0, coalesce(p_unreadable_page_count, 0)),
      redaction_counts = coalesce(p_redaction_counts, '{}'::jsonb),
      spatial_accuracy_score = p_spatial_accuracy_score,
      spatial_median_iou = p_spatial_median_iou,
      spatial_center_inside_ratio = p_spatial_center_inside_ratio,
      original_sha256 = lower(p_original_sha256),
      processed_sha256 = lower(p_processed_sha256),
      error_code = left(p_error_code, 80),
      safe_error_message = left(p_safe_error_message, 500),
      lease_expires_at = null,
      completed_at = case when p_status in ('completed', 'not_required') then now() else null end,
      next_attempt_at = case
        when p_status = 'failed' and attempts < 5 then now() + make_interval(mins => attempts * 5)
        else next_attempt_at
      end,
      updated_at = now()
  where id = p_job_id and status = 'processing'
  returning * into finished;

  if finished.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;

  update public.contracts
  set processed_pdf_url = case
        when p_status = 'completed' then finished.output_storage_path
        else processed_pdf_url
      end,
      document_processing_status = case p_status
        when 'completed' then 'ready'
        when 'not_required' then 'not_required'
        when 'needs_review' then 'needs_review'
        else 'failed'
      end,
      document_processing_error_code = p_error_code,
      document_processed_at = case
        when p_status in ('completed', 'not_required') then now()
        else document_processed_at
      end,
      document_text_classification = p_document_classification,
      document_ocr_engine = left(p_ocr_engine, 80),
      document_spatial_accuracy = p_spatial_accuracy_score,
      document_spatial_data_path = case
        when p_status = 'completed' then finished.spatial_data_path
        else document_spatial_data_path
      end,
      layout_data = case
        when p_status = 'completed'
          and finished.downstream_ai_policy = 'reanalyze' then null
        else layout_data
      end
  where id = finished.contract_id;

  if finished.downstream_ai_policy = 'reanalyze' then
    if p_status = 'completed' then
      update public.contract_ai_jobs
      set status = 'dead', failure_class = 'input',
          error_code = 'superseded_by_document_processing',
          error_message = 'Jobbet blev erstattet af analyse af den OCR-behandlede PDF.',
          lease_expires_at = null, completed_at = now(), updated_at = now()
      where contract_id = finished.contract_id and attachment_id is null
        and status in ('queued', 'processing', 'retry_wait', 'blocked', 'error');
      should_queue_ai := true;
    elsif p_status = 'not_required' then
      should_queue_ai := not exists (
        select 1 from public.contract_ai_jobs
        where contract_id = finished.contract_id and attachment_id is null
          and status in ('queued', 'processing', 'retry_wait', 'blocked', 'error', 'done')
      );
    end if;
  end if;

  if should_queue_ai then
    insert into public.contract_ai_jobs (
      contract_id, org_id, created_by, status, stage, priority, next_attempt_at
    ) values (
      finished.contract_id, finished.org_id, finished.created_by,
      'queued', 'extraction', 100, now()
    ) returning id into new_ai_job_id;

    update public.contract_import_items
    set ai_job_id = new_ai_job_id, status = 'queued', error_code = null,
        error_message = null, next_attempt_at = now(), updated_at = now()
    where id = (
      select item.id from public.contract_import_items item
      where item.contract_id = finished.contract_id
        and item.status in (
          'queued', 'analysing', 'matching', 'retryable_error',
          'blocked', 'needs_ocr', 'dead'
        )
      order by item.created_at desc limit 1
    );
  end if;

  -- A failed recovery remains an independent historical generation. Only a
  -- successful result supersedes the source evidence.
  if finished.recovery_of_job_id is not null
    and p_status in ('completed', 'not_required') then
    select job.* into source_job
    from public.contract_document_jobs as job
    where job.id = finished.recovery_of_job_id
    for update of job;
    if source_job.id is null
      or source_job.contract_id <> finished.contract_id
      or source_job.status not in ('needs_review', 'failed')
      or source_job.superseded_by_job_id is not null then
      raise exception 'recovery source generation mismatch' using errcode = '55000';
    end if;
    update public.contract_document_jobs
    set superseded_by_job_id = finished.id,
        superseded_at = now(),
        updated_at = now()
    where id = source_job.id;
  end if;

  return finished;
end;
$$;

revoke all on function public.finish_contract_document_job_v2(
  uuid, text, text, text, jsonb, boolean, integer, integer, integer, integer,
  integer, jsonb, numeric, numeric, numeric, text, text, text, text
) from public, anon, authenticated, service_role;

-- Member-triggered retries must obey the same immutable history invariant.
-- The public server action still receives the established outcome strings,
-- but `requeued` now returns the new generation id instead of mutating the
-- terminal source row.
create or replace function public.queue_or_retry_member_contract_document_job(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_contract_id uuid
)
returns table(outcome text, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisional_contract public.contracts;
  locked_contract public.contracts;
  selected_job public.contract_document_jobs;
  created_job_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_contract_id is null then
    raise exception 'invalid document retry identity' using errcode = '22023';
  end if;

  select contract.* into provisional_contract
  from public.contracts as contract
  where contract.id = p_contract_id;
  if provisional_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if provisional_contract.org_id <> p_org_id
    or provisional_contract.rights_holder_id is distinct from p_rights_holder_id
    or provisional_contract.status <> 'kladde'
    or nullif(provisional_contract.pdf_url, '') is null
    or lower(provisional_contract.pdf_url) !~ '[.]pdf$'
    or not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = p_org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = p_rights_holder_id and holder.user_id = p_owner_id
    ) then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;

  select job.* into selected_job
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id
  order by
    case
      when job.status in ('queued', 'processing')
        or (job.status = 'failed' and job.attempts < 5) then 0
      else 1
    end,
    job.created_at desc,
    job.id desc
  limit 1
  for update of job;

  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update of contract;
  if locked_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if locked_contract.org_id <> p_org_id
    or locked_contract.rights_holder_id is distinct from p_rights_holder_id
    or locked_contract.status <> 'kladde'
    or nullif(locked_contract.pdf_url, '') is null
    or lower(locked_contract.pdf_url) !~ '[.]pdf$'
    or not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = p_org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = p_rights_holder_id and holder.user_id = p_owner_id
    ) then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;

  if selected_job.id is null then
    created_job_id := gen_random_uuid();
    insert into public.contract_document_jobs (
      id, contract_id, org_id, created_by, original_storage_path,
      output_storage_path, status, priority, attempts, next_attempt_at,
      downstream_ai_policy
    ) values (
      created_job_id, p_contract_id, p_org_id, p_owner_id,
      locked_contract.pdf_url,
      p_org_id::text || '/processed/' || p_contract_id::text
        || '/pending/' || created_job_id::text || '/normalised.pdf',
      'queued', 100, 0, now(), 'reanalyze'
    )
    on conflict do nothing;
    if not found then
      select job.* into selected_job
      from public.contract_document_jobs as job
      where job.contract_id = p_contract_id
        and (
          job.status in ('queued', 'processing')
          or (job.status = 'failed' and job.attempts < 5)
        )
      order by job.created_at desc, job.id desc
      limit 1;
      if selected_job.id is null then
        raise exception 'document retry race could not be resolved' using errcode = '55000';
      end if;
      return query select 'already_queued'::text, selected_job.id;
      return;
    end if;
    update public.contracts
    set document_processing_status = 'pending', document_processing_error_code = null
    where id = p_contract_id;
    return query select 'queued'::text, created_job_id;
    return;
  end if;

  if selected_job.org_id <> p_org_id
    or selected_job.original_storage_path is distinct from locked_contract.pdf_url then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;
  if selected_job.status in ('queued', 'processing')
    or (selected_job.status = 'failed' and selected_job.attempts < 5) then
    return query select 'already_queued'::text, selected_job.id;
    return;
  end if;
  if selected_job.status in ('completed', 'not_required') then
    return query select 'already_processed'::text, selected_job.id;
    return;
  end if;
  if selected_job.status not in ('needs_review', 'failed')
    or (selected_job.status = 'failed' and selected_job.attempts < 5) then
    raise exception 'document job cannot be retried' using errcode = '55000';
  end if;
  if selected_job.review_disposition = 'rescan_requested' then
    raise exception 'document requires a better source scan' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as newer
    where newer.contract_id = selected_job.contract_id
      and newer.id <> selected_job.id
      and (
        newer.created_at > selected_job.created_at
        or (newer.created_at = selected_job.created_at and newer.id::text > selected_job.id::text)
      )
  ) then
    raise exception 'newer document generation exists' using errcode = '55000';
  end if;

  created_job_id := gen_random_uuid();
  insert into public.contract_document_jobs (
    id, contract_id, org_id, created_by, original_storage_path,
    output_storage_path, status, priority, attempts, next_attempt_at,
    original_sha256, recovery_of_job_id, downstream_ai_policy,
    recovery_reason_code
  ) values (
    created_job_id, selected_job.contract_id, selected_job.org_id, p_owner_id,
    selected_job.original_storage_path,
    p_org_id::text || '/processed/' || p_contract_id::text
      || '/pending/' || created_job_id::text || '/normalised.pdf',
    'queued', greatest(selected_job.priority, 100), 0, now(),
    selected_job.original_sha256, selected_job.id, 'reanalyze', 'member_retry'
  );

  update public.contract_document_jobs
  set review_disposition = 'retry_after_pipeline_fix',
      reviewed_at = now(), reviewed_by = p_owner_id, updated_at = now()
  where id = selected_job.id;
  update public.contracts
  set document_processing_status = 'pending', document_processing_error_code = null
  where id = p_contract_id;

  return query select 'requeued'::text, created_job_id;
end;
$$;

revoke all on function public.queue_or_retry_member_contract_document_job(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.queue_or_retry_member_contract_document_job(
  uuid, uuid, uuid, uuid
) to service_role;
