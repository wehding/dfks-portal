-- A Word original remains immutable in contracts.pdf_url. LibreOffice's
-- neutral PDF rendering is stored as a separate, lease-scoped derivative so
-- admins can inspect the layout without confusing it with the OCR working PDF.

alter table public.contracts
  add column if not exists original_view_pdf_url text;

alter table public.contract_document_jobs
  add column if not exists original_view_storage_path text,
  add column if not exists original_view_sha256 text;

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_safe_paths,
  add constraint contract_document_jobs_safe_paths check (
    original_storage_path !~ '(^|/)\.\.(/|$)'
    and output_storage_path !~ '(^|/)\.\.(/|$)'
    and coalesce(original_view_storage_path, '') !~ '(^|/)\.\.(/|$)'
  ),
  add constraint contract_document_jobs_original_view_sha256_check check (
    original_view_sha256 is null or original_view_sha256 ~ '^[0-9a-f]{64}$'
  );

comment on column public.contracts.original_view_pdf_url is
  'Neutral PDF-visning af en uforanderlig Word-original. Må ikke bruges som juridisk original eller OCR-bevis.';
comment on column public.contract_document_jobs.original_view_storage_path is
  'Lease-beskyttet LibreOffice-PDF til visning af Word-originalens layout.';

create or replace function public.finish_contract_document_job_v6(
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
  p_original_view_sha256 text default null,
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
  active_job public.contract_document_jobs;
  finished public.contract_document_jobs;
  view_hash text := lower(nullif(btrim(p_original_view_sha256), ''));
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select job.* into active_job
  from public.contract_document_jobs as job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > now()
  for update;
  if active_job.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  if view_hash is not null and view_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid original view hash' using errcode = '22023';
  end if;
  if active_job.original_view_storage_path is not null
    and p_status = 'completed'
    and view_hash is null then
    raise exception 'Word completion requires an original-view hash' using errcode = '22023';
  end if;

  select * into finished
  from public.finish_contract_document_job_v5(
    p_job_id, p_lease_token, p_status, p_document_classification, p_ocr_engine,
    p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
    p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
    p_redaction_counts, p_spatial_accuracy_score, p_spatial_median_iou,
    p_spatial_center_inside_ratio, p_original_sha256, p_processed_sha256,
    p_redaction_profile, p_spatial_schema_version, p_spatial_sha256,
    p_error_code, p_safe_error_message
  );

  if p_status = 'completed' and active_job.original_view_storage_path is not null then
    update public.contract_document_jobs
    set original_view_sha256 = view_hash
    where id = p_job_id;
    update public.contracts
    set original_view_pdf_url = active_job.original_view_storage_path
    where id = active_job.contract_id;
  end if;

  select job.* into finished from public.contract_document_jobs as job where job.id = p_job_id;
  return finished;
end;
$$;

revoke all on function public.finish_contract_document_job_v6(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v6(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text, text
) to service_role;

create or replace function public.list_abandoned_contract_document_lease_artifacts(
  p_limit integer default 25
)
returns table(storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'invalid cleanup limit' using errcode = '22023';
  end if;

  return query
  select object.name
  from storage.objects as object
  where object.bucket_id = 'kontrakter'
    and object.created_at < now() - interval '3 hours'
    and object.name ~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '/processed/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '/leases/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '/(normalised[.]pdf|original-view[.]pdf|vision-layout[.]json[.]gz)$'
    )
    and not exists (
      select 1 from public.contracts as contract
      where object.name in (
        contract.pdf_url,
        contract.original_view_pdf_url,
        contract.processed_pdf_url,
        contract.document_spatial_data_path
      )
    )
    and not exists (
      select 1 from public.contract_document_jobs as job
      where object.name = job.original_storage_path
         or (
           object.name in (job.output_storage_path, job.original_view_storage_path, job.spatial_data_path)
           and (
             job.status in ('queued', 'processing', 'completed', 'not_required')
             or (job.status = 'failed' and job.attempts < 5)
           )
         )
    )
    and not exists (
      select 1 from public.contract_attachments as attachment where attachment.pdf_url = object.name
    )
    and exists (
      select 1 from public.contract_document_jobs as terminal_job
      where terminal_job.org_id::text = split_part(object.name, '/', 1)
        and terminal_job.contract_id::text = split_part(object.name, '/', 3)
        and (
          terminal_job.status in ('completed', 'needs_review', 'not_required')
          or (terminal_job.status = 'failed' and terminal_job.attempts >= 5)
        )
    )
    and not exists (
      select 1 from public.contract_document_jobs as nonterminal_job
      where nonterminal_job.org_id::text = split_part(object.name, '/', 1)
        and nonterminal_job.contract_id::text = split_part(object.name, '/', 3)
        and (
          nonterminal_job.status in ('queued', 'processing')
          or (nonterminal_job.status = 'failed' and nonterminal_job.attempts < 5)
        )
    )
    and not exists (
      select 1 from public.contract_document_jobs as recently_authorised_job
      where recently_authorised_job.org_id::text = split_part(object.name, '/', 1)
        and recently_authorised_job.contract_id::text = split_part(object.name, '/', 3)
        and recently_authorised_job.last_upload_authorised_at >= now() - interval '3 hours'
    )
  order by object.created_at, object.name
  limit p_limit;
end;
$$;

revoke all on function public.list_abandoned_contract_document_lease_artifacts(integer)
  from public, anon, authenticated;
grant execute on function public.list_abandoned_contract_document_lease_artifacts(integer)
  to service_role;

notify pgrst, 'reload schema';
