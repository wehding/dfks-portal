-- A member may explicitly retry a terminal OCR result without creating a
-- second active queue row. The service-only function owns both authorization
-- and the state transition so a stale browser request cannot bypass active
-- organisation membership or mutate another member's contract.
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
  created_job boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_owner_id is null or p_org_id is null or p_rights_holder_id is null
    or p_contract_id is null then
    raise exception 'invalid document retry identity' using errcode = '22023';
  end if;

  -- This first read is only a fail-fast check. Authorization is repeated while
  -- holding the authoritative contract lock below.
  select contract.* into provisional_contract
  from public.contracts as contract
  where contract.id = p_contract_id;
  if provisional_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if provisional_contract.org_id <> p_org_id
    or provisional_contract.rights_holder_id is distinct from p_rights_holder_id
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
      where holder.id = p_rights_holder_id
        and holder.user_id = p_owner_id
    ) then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;

  -- Always acquire a queue-row lock before the contract lock. Claim and finish
  -- use the same order, which prevents retry/worker deadlocks. Prefer an active
  -- or retryable row if historical terminal rows exist.
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

  if selected_job.id is null then
    -- ON CONFLICT handles two simultaneous manual retries. If another request
    -- wins, lock its row before proceeding to the contract lock.
    insert into public.contract_document_jobs (
      contract_id, org_id, created_by, original_storage_path,
      output_storage_path, status, priority, attempts, next_attempt_at
    ) values (
      p_contract_id, p_org_id, p_owner_id, provisional_contract.pdf_url,
      p_org_id::text || '/processed/' || p_contract_id::text || '/normalised.pdf',
      'queued', 100, 0, now()
    )
    on conflict do nothing
    returning * into selected_job;
    created_job := selected_job.id is not null;

    if selected_job.id is null then
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
    end if;
  end if;

  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update of contract;

  if locked_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if locked_contract.org_id <> p_org_id
    or locked_contract.rights_holder_id is distinct from p_rights_holder_id
    or nullif(locked_contract.pdf_url, '') is null
    or lower(locked_contract.pdf_url) !~ '[.]pdf$'
    or selected_job.id is null
    or selected_job.org_id <> p_org_id
    or selected_job.original_storage_path <> locked_contract.pdf_url
    or not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = p_org_id
       and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = p_rights_holder_id
        and holder.user_id = p_owner_id
    ) then
    raise exception 'document retry ownership mismatch' using errcode = '42501';
  end if;

  if created_job then
    update public.contracts as contract
    set document_processing_status = 'pending',
        document_processing_error_code = null
    where contract.id = p_contract_id;
    return query select 'queued'::text, selected_job.id;
    return;
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

  update public.contract_document_jobs as job
  set status = 'queued',
      priority = greatest(job.priority, 100),
      attempts = 0,
      next_attempt_at = now(),
      lease_token = null,
      lease_expires_at = null,
      output_storage_path = p_org_id::text || '/processed/' || p_contract_id::text || '/normalised.pdf',
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
      original_sha256 = null,
      processed_sha256 = null,
      redaction_profile = null,
      spatial_schema_version = null,
      spatial_sha256 = null,
      updated_at = now()
  where job.id = selected_job.id
  returning job.* into selected_job;

  -- Deliberately do not touch contracts.status: OCR retry can never validate a
  -- legal contract. The worker may only advance document_processing_status.
  update public.contracts as contract
  set document_processing_status = 'pending',
      document_processing_error_code = null
  where contract.id = p_contract_id;

  return query select 'requeued'::text, selected_job.id;
end;
$$;

revoke all on function public.queue_or_retry_member_contract_document_job(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.queue_or_retry_member_contract_document_job(
  uuid, uuid, uuid, uuid
) to service_role;

comment on function public.queue_or_retry_member_contract_document_job(uuid, uuid, uuid, uuid) is
  'Service-only atomisk oprettelse eller manuel genkø af medlemmets eget PDF-dokumentjob; ændrer aldrig kontraktens valideringsstatus.';
