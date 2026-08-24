-- Google Vision OCR metadata and a server-only completion function.
-- Original contract files remain immutable; only derivatives and private
-- geometry artifacts may be attached to a completed document job.

alter table public.contracts
  add column if not exists document_text_classification text,
  add column if not exists document_ocr_engine text,
  add column if not exists document_spatial_accuracy numeric(6,5),
  add column if not exists document_spatial_data_path text;

alter table public.contracts
  drop constraint if exists contracts_document_text_classification_check,
  add constraint contracts_document_text_classification_check check (
    document_text_classification is null
    or document_text_classification in ('native_text', 'image_only', 'mixed', 'unreadable')
  ),
  drop constraint if exists contracts_document_spatial_accuracy_check,
  add constraint contracts_document_spatial_accuracy_check check (
    document_spatial_accuracy is null
    or document_spatial_accuracy between 0 and 1
  );

alter table public.contract_document_jobs
  add column if not exists ocr_engine text,
  add column if not exists document_classification text,
  add column if not exists native_page_count integer not null default 0,
  add column if not exists ocr_page_count integer not null default 0,
  add column if not exists unreadable_page_count integer not null default 0,
  add column if not exists redaction_counts jsonb not null default '{}'::jsonb,
  add column if not exists spatial_data_path text,
  add column if not exists spatial_accuracy_score numeric(6,5),
  add column if not exists spatial_median_iou numeric(6,5),
  add column if not exists spatial_center_inside_ratio numeric(6,5),
  add column if not exists original_sha256 text,
  add column if not exists processed_sha256 text;

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_status_check,
  add constraint contract_document_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed', 'needs_review', 'not_required')),
  add constraint contract_document_jobs_classification_check check (
    document_classification is null
    or document_classification in ('native_text', 'image_only', 'mixed', 'unreadable')
  ),
  add constraint contract_document_jobs_page_classification_counts_check check (
    native_page_count >= 0 and ocr_page_count >= 0 and unreadable_page_count >= 0
  ),
  add constraint contract_document_jobs_spatial_accuracy_check check (
    (spatial_accuracy_score is null or spatial_accuracy_score between 0 and 1)
    and (spatial_median_iou is null or spatial_median_iou between 0 and 1)
    and (spatial_center_inside_ratio is null or spatial_center_inside_ratio between 0 and 1)
  ),
  add constraint contract_document_jobs_hash_format_check check (
    (original_sha256 is null or original_sha256 ~ '^[0-9a-f]{64}$')
    and (processed_sha256 is null or processed_sha256 ~ '^[0-9a-f]{64}$')
  ),
  add constraint contract_document_jobs_spatial_path_check check (
    spatial_data_path is null or spatial_data_path !~ '(^|/)\.\.(/|$)'
  );

comment on column public.contract_document_jobs.redaction_counts is
  'Kun antal DLP-fund pr. infoType. Må aldrig indeholde fundet tekst eller billeddata.';
comment on column public.contract_document_jobs.spatial_data_path is
  'Privat, komprimeret Google Vision-geometri. Browserroller har ingen adgang til jobtabellen.';

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
set search_path = public, pg_temp
as $$
declare
  finished public.contract_document_jobs;
  new_ai_job_id uuid;
  should_queue_ai boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed', 'needs_review', 'not_required') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_status = 'completed' and coalesce(p_ocr_applied, false) = false then
    raise exception 'completed document must contain OCR' using errcode = '22023';
  end if;
  if p_status = 'not_required' and p_document_classification <> 'native_text' then
    raise exception 'not_required requires native_text classification' using errcode = '22023';
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
  set processed_pdf_url = case when p_status = 'completed' then finished.output_storage_path else processed_pdf_url end,
      document_processing_status = case p_status
        when 'completed' then 'ready'
        when 'not_required' then 'not_required'
        when 'needs_review' then 'needs_review'
        else 'failed'
      end,
      document_processing_error_code = p_error_code,
      document_processed_at = case when p_status in ('completed', 'not_required') then now() else document_processed_at end,
      document_text_classification = p_document_classification,
      document_ocr_engine = left(p_ocr_engine, 80),
      document_spatial_accuracy = p_spatial_accuracy_score,
      document_spatial_data_path = case when p_status = 'completed' then finished.spatial_data_path else document_spatial_data_path end,
      layout_data = case when p_status = 'completed' then null else layout_data end
  where id = finished.contract_id;

  if p_status = 'completed' then
    update public.contract_ai_jobs
    set status = 'dead', failure_class = 'input', error_code = 'superseded_by_document_processing',
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
        and item.status in ('queued', 'analysing', 'matching', 'retryable_error', 'blocked', 'needs_ocr', 'dead')
      order by item.created_at desc limit 1
    );
  end if;

  return finished;
end;
$$;

revoke all on function public.finish_contract_document_job_v2(
  uuid, text, text, text, jsonb, boolean, integer, integer, integer, integer,
  integer, jsonb, numeric, numeric, numeric, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v2(
  uuid, text, text, text, jsonb, boolean, integer, integer, integer, integer,
  integer, jsonb, numeric, numeric, numeric, text, text, text, text
) to service_role;
