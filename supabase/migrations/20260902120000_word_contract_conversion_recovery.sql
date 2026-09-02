-- Immutable, service-only recovery for historical Word contracts that were
-- incorrectly sent to the former PDF-only worker and ended as invalid_pdf.

create or replace function public.queue_word_contract_document_recovery(
  p_source_job_id uuid,
  p_expected_source_path text,
  p_expected_original_sha256 text,
  p_priority integer default 1000
)
returns table(outcome text, source_job_id uuid, recovery_job_id uuid, downstream_ai_policy text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_job public.contract_document_jobs;
  locked_contract public.contracts;
  recovery_id uuid := gen_random_uuid();
  expected_hash text := lower(nullif(btrim(p_expected_original_sha256), ''));
  selected_policy text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_source_job_id is null
    or nullif(btrim(p_expected_source_path), '') is null
    or p_expected_source_path !~* '[.](doc|docx)$'
    or p_expected_source_path ~ '(^|/)\.\.(/|$)'
    or expected_hash is null or expected_hash !~ '^[0-9a-f]{64}$'
    or p_priority is null or p_priority < 0 or p_priority > 10000 then
    raise exception 'invalid recovery request' using errcode = '22023';
  end if;

  select job.* into source_job
  from public.contract_document_jobs as job
  where job.id = p_source_job_id
  for update of job;
  if source_job.id is null then
    raise exception 'document job not found' using errcode = 'P0002';
  end if;
  if source_job.status <> 'needs_review'
    or source_job.error_code <> 'invalid_pdf'
    or source_job.original_storage_path is distinct from p_expected_source_path
    or (source_job.original_sha256 is not null
      and lower(source_job.original_sha256) is distinct from expected_hash)
    or source_job.review_disposition = 'rescan_requested' then
    raise exception 'document recovery precondition failed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as newer
    where newer.contract_id = source_job.contract_id
      and newer.id <> source_job.id
      and (newer.created_at > source_job.created_at
        or (newer.created_at = source_job.created_at and newer.id::text > source_job.id::text))
  ) then
    raise exception 'newer document generation exists' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contract_document_jobs as active
    where active.contract_id = source_job.contract_id
      and active.id <> source_job.id
      and (active.status in ('queued', 'processing')
        or (active.status = 'failed' and active.attempts < 5))
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
    or locked_contract.pdf_url is distinct from p_expected_source_path
    or locked_contract.status not in ('kladde', 'valideret')
    or locked_contract.document_processing_status <> 'needs_review'
    or locked_contract.document_processing_error_code <> 'invalid_pdf' then
    raise exception 'document recovery generation mismatch' using errcode = '55000';
  end if;

  selected_policy := case when locked_contract.status = 'valideret' then 'preserve' else 'reanalyze' end;
  insert into public.contract_document_jobs (
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, next_attempt_at, created_by,
    original_sha256, recovery_of_job_id, downstream_ai_policy, recovery_reason_code
  ) values (
    recovery_id, source_job.org_id, source_job.contract_id, source_job.original_storage_path,
    source_job.org_id::text || '/processed/' || source_job.contract_id::text
      || '/pending/' || recovery_id::text || '/normalised.pdf',
    'queued', p_priority, 0, now(), source_job.created_by,
    expected_hash, source_job.id, selected_policy, 'word_conversion_enabled'
  );

  update public.contract_document_jobs
  set review_disposition = 'retry_after_pipeline_fix', reviewed_at = now(),
      reviewed_by = null, updated_at = now()
  where id = source_job.id;

  update public.contracts
  set document_processing_status = 'pending', document_processing_error_code = null
  where id = source_job.contract_id;

  return query select 'queued'::text, source_job.id, recovery_id, selected_policy;
end;
$$;

revoke all on function public.queue_word_contract_document_recovery(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.queue_word_contract_document_recovery(uuid, text, text, integer)
  to service_role;

comment on function public.queue_word_contract_document_recovery(uuid, text, text, integer) is
  'Creates an immutable, hash-fenced recovery generation for a Word contract rejected by the former PDF-only worker.';
