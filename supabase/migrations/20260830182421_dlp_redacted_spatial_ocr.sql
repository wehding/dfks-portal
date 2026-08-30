-- Version the Google DLP redaction profile and private geometry artifact.
-- No finding quotes, OCR text or document bytes are stored in these columns.

alter table public.contracts
  add column if not exists document_redaction_profile text,
  add column if not exists document_spatial_schema_version text;

alter table public.contract_document_jobs
  add column if not exists redaction_profile text,
  add column if not exists spatial_schema_version text;

alter table public.contracts
  drop constraint if exists contracts_document_redaction_profile_check,
  add constraint contracts_document_redaction_profile_check check (
    document_redaction_profile is null
    or document_redaction_profile ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  ),
  drop constraint if exists contracts_document_spatial_schema_check,
  add constraint contracts_document_spatial_schema_check check (
    document_spatial_schema_version is null
    or document_spatial_schema_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  );

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_redaction_profile_check,
  add constraint contract_document_jobs_redaction_profile_check check (
    redaction_profile is null
    or redaction_profile ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  ),
  drop constraint if exists contract_document_jobs_spatial_schema_check,
  add constraint contract_document_jobs_spatial_schema_check check (
    spatial_schema_version is null
    or spatial_schema_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  );

comment on column public.contract_document_jobs.redaction_profile is
  'Versionsnavn for Google Sensitive Data Protection image:redact-profilen. Ingen fundne værdier.';
comment on column public.contract_document_jobs.spatial_schema_version is
  'Skemaversion for det private geometriske OCR-artefakt.';

create or replace function public.finish_contract_document_job_v3(
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
  p_redaction_profile text default null,
  p_spatial_schema_version text default null,
  p_error_code text default null,
  p_safe_error_message text default null
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished public.contract_document_jobs;
begin
  if p_status = 'completed' and (
    p_redaction_profile is distinct from 'dfks-contract-redaction-v1'
    or p_spatial_schema_version is distinct from 'google-vision-spatial-v2'
  ) then
    raise exception 'completed OCR requires an approved redaction and geometry profile'
      using errcode = '22023';
  end if;

  select * into finished
  from public.finish_contract_document_job_v2(
    p_job_id, p_status, p_document_classification, p_ocr_engine,
    p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
    p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
    p_redaction_counts, p_spatial_accuracy_score, p_spatial_median_iou,
    p_spatial_center_inside_ratio, p_original_sha256, p_processed_sha256,
    p_error_code, p_safe_error_message
  );

  update public.contract_document_jobs
  set redaction_profile = left(p_redaction_profile, 80),
      spatial_schema_version = left(p_spatial_schema_version, 80),
      updated_at = now()
  where id = finished.id;

  update public.contracts
  set document_redaction_profile = case
        when p_status = 'completed' then left(p_redaction_profile, 80)
        else document_redaction_profile
      end,
      document_spatial_schema_version = case
        when p_status = 'completed' then left(p_spatial_schema_version, 80)
        else document_spatial_schema_version
      end
  where id = finished.contract_id;

  select j.* into finished
  from public.contract_document_jobs as j
  where j.id = finished.id;
  return finished;
end;
$$;

revoke all on function public.finish_contract_document_job_v3(
  uuid, text, text, text, jsonb, boolean, integer, integer, integer, integer,
  integer, jsonb, numeric, numeric, numeric, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v3(
  uuid, text, text, text, jsonb, boolean, integer, integer, integer, integer,
  integer, jsonb, numeric, numeric, numeric, text, text, text, text, text, text
) to service_role;
