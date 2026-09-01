-- Five baseline-bound mixed DLP sources can be classified as fully native by
-- the newer classifier. Requeue only those exact, still-active replacements;
-- the replacement-only worker then rebuilds every page through Vision.
create or replace function public.requeue_direct_vision_not_required_replacements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.contract_document_jobs as replacement
  set status = 'queued',
      priority = greatest(replacement.priority, 100),
      attempts = 0,
      next_attempt_at = now(),
      lease_token = null,
      lease_expires_at = null,
      output_storage_path = replacement.org_id::text || '/processed/'
        || replacement.contract_id::text || '/pending/' || replacement.id::text || '/normalised.pdf',
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
      processed_sha256 = null,
      redaction_profile = null,
      processing_profile = 'google-vision-direct-v1',
      spatial_schema_version = null,
      spatial_sha256 = null,
      updated_at = now()
  from public.contract_document_jobs as source, public.contracts as contract
  where replacement.replacement_of_job_id = source.id
    and replacement.status = 'not_required'
    and replacement.processing_profile = 'google-vision-direct-v1'
    and source.status = 'completed'
    and source.ocr_applied is true
    and source.document_classification = 'mixed'
    and source.redaction_profile = 'dfks-contract-redaction-v1'
    and source.spatial_schema_version = 'google-vision-spatial-v2'
    and source.superseded_by_job_id is null
    and source.original_sha256 = replacement.original_sha256
    and contract.id = source.contract_id
    and contract.org_id = source.org_id
    and contract.pdf_url = source.original_storage_path
    and contract.processed_pdf_url = source.output_storage_path
    and contract.document_spatial_data_path = source.spatial_data_path;
  get diagnostics affected = row_count;

  update public.contracts as contract
  set document_processing_status = 'pending', document_processing_error_code = null
  where exists (
    select 1 from public.contract_document_jobs as replacement
    where replacement.contract_id = contract.id
      and replacement.replacement_of_job_id is not null
      and replacement.status = 'queued'
      and replacement.processing_profile = 'google-vision-direct-v1'
  );
  return affected;
end;
$$;

revoke all on function public.requeue_direct_vision_not_required_replacements()
  from public, anon, authenticated;
grant execute on function public.requeue_direct_vision_not_required_replacements()
  to service_role;
