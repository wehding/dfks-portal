begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  test_contract_id uuid := gen_random_uuid();
  ordinary_contract_id uuid := gen_random_uuid();
  source_job_id uuid := gen_random_uuid();
  replacement record;
  replacement_job public.contract_document_jobs;
  ordinary_job_id uuid := gen_random_uuid();
  claimed_ordinary public.contract_document_jobs;
  test_lease_token uuid := gen_random_uuid();
  deletion_finished boolean;
  original_hash text := repeat('a', 64);
  processed_hash text := repeat('b', 64);
  spatial_hash text := repeat('c', 64);
  claimed_deletion public.contract_document_artifact_deletions;
  requeued_count integer;
begin
  if has_table_privilege('anon', 'public.contract_document_artifact_deletions', 'SELECT')
    or has_table_privilege('authenticated', 'public.contract_document_artifact_deletions', 'SELECT')
    or has_function_privilege('authenticated', 'public.queue_direct_vision_replacement_generation(uuid,text,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_next_direct_vision_replacement_job(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.requeue_direct_vision_not_required_replacements()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v8(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_contract_document_artifact_deletions(integer,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.queue_direct_vision_replacement_generation(uuid,text,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.claim_next_direct_vision_replacement_job(integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.requeue_direct_vision_not_required_replacements()', 'EXECUTE')
    or has_function_privilege('service_role', 'public.finish_contract_document_job_v7(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.finish_contract_document_job_v8(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'Direct Vision replacement regression: privileged API exposure';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Direct Vision OCR ' || test_org::text);
  insert into public.contracts(
    id, org_id, type, status, pdf_url, processed_pdf_url,
    document_spatial_data_path, document_processing_status,
    document_redaction_profile, document_spatial_schema_version
  ) values (
    test_contract_id, test_org, 'a-løn', 'afventer',
    test_org || '/' || test_contract_id || '/original.pdf',
    test_org || '/processed/' || test_contract_id || '/leases/00000000-0000-4000-8000-000000000001/normalised.pdf',
    test_org || '/processed/' || test_contract_id || '/leases/00000000-0000-4000-8000-000000000001/vision-layout.json.gz',
    'ready', 'dfks-contract-redaction-v1', 'google-vision-spatial-v2'
  );
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    spatial_data_path, status, priority, attempts, completed_at,
    ocr_applied, page_count, text_char_count, ocr_engine,
    document_classification, native_page_count, ocr_page_count,
    unreadable_page_count, redaction_counts, spatial_accuracy_score,
    spatial_median_iou, spatial_center_inside_ratio, original_sha256,
    processed_sha256, redaction_profile, spatial_schema_version, spatial_sha256
  ) values (
    source_job_id, test_org, test_contract_id,
    test_org || '/' || test_contract_id || '/original.pdf',
    test_org || '/processed/' || test_contract_id || '/leases/00000000-0000-4000-8000-000000000001/normalised.pdf',
    test_org || '/processed/' || test_contract_id || '/leases/00000000-0000-4000-8000-000000000001/vision-layout.json.gz',
    'completed', 100, 1, now(), true, 1, 500, 'google-vision-eu-v1',
    'mixed', 0, 1, 0, '{"DENMARK_CPR_NUMBER":1}'::jsonb,
    0.99, 0.90, 1.0, original_hash, processed_hash,
    'dfks-contract-redaction-v1', 'google-vision-spatial-v2', spatial_hash
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into replacement
  from public.queue_direct_vision_replacement_generation(source_job_id, original_hash, 100);
  if replacement.outcome <> 'queued' or replacement.downstream_ai_policy <> 'reanalyze' then
    raise exception 'Direct Vision replacement regression: unvalidated contract was not queued for reanalysis';
  end if;

  update public.contract_document_jobs
  set status = 'not_required', processing_profile = 'google-vision-direct-v1'
  where id = replacement.replacement_job_id;
  requeued_count := public.requeue_direct_vision_not_required_replacements();
  if requeued_count <> 1 or (select status from public.contract_document_jobs
    where id = replacement.replacement_job_id) <> 'queued' then
    raise exception 'Direct Vision replacement regression: native replacement was not safely requeued';
  end if;

  insert into public.contracts(
    id, org_id, type, status, pdf_url, document_processing_status
  ) values (
    ordinary_contract_id, test_org, 'a-løn', 'kladde',
    test_org || '/' || ordinary_contract_id || '/original.pdf', 'pending'
  );

  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, next_attempt_at, original_sha256
  ) values (
    ordinary_job_id, test_org, ordinary_contract_id,
    test_org || '/' || ordinary_contract_id || '/original.pdf',
    test_org || '/processed/' || ordinary_contract_id || '/ordinary-output.pdf',
    'queued', 1000, 0, now(), original_hash
  );

  select * into claimed_ordinary
  from public.claim_next_contract_document_job(30);
  if claimed_ordinary.id <> ordinary_job_id
    or (select status from public.contract_document_jobs
      where id = replacement.replacement_job_id) <> 'queued' then
    raise exception 'Direct Vision replacement regression: ordinary claim crossed into replacement cohort';
  end if;

  select * into replacement_job
  from public.claim_next_direct_vision_replacement_job(30);
  if replacement_job.id <> replacement.replacement_job_id
    or replacement_job.replacement_of_job_id <> source_job_id
    or replacement_job.lease_token is null
    or (select status from public.contract_document_jobs where id = ordinary_job_id) <> 'processing' then
    raise exception 'Direct Vision replacement regression: replacement-only claim crossed its cohort fence';
  end if;
  test_lease_token := replacement_job.lease_token;

  update public.contract_document_jobs
  set output_storage_path = test_org || '/processed/' || test_contract_id || '/leases/' || test_lease_token || '/normalised.pdf',
      spatial_data_path = test_org || '/processed/' || test_contract_id || '/leases/' || test_lease_token || '/vision-layout.json.gz'
  where id = replacement.replacement_job_id;

  select * into replacement_job
  from public.finish_contract_document_job_v8(
    replacement.replacement_job_id, test_lease_token, 'completed', 'image_only',
    'google-vision-eu-v1', '[]'::jsonb, true, 1, 500, 0, 1, 0,
    0.99, 0.90, 1.0, original_hash, repeat('d', 64),
    'google-vision-direct-v1', 'google-vision-spatial-v3', repeat('e', 64), null, null,
    '{"schemaVersion":1,"reasons":[]}'::jsonb
  );
  if replacement_job.status <> 'completed'
    or replacement_job.processing_profile <> 'google-vision-direct-v1'
    or replacement_job.redaction_profile is not null
    or not exists (
      select 1 from public.contract_document_jobs
      where id = source_job_id and superseded_by_job_id = replacement_job.id
    )
    or (select processed_pdf_url from public.contracts where id = test_contract_id) <> replacement_job.output_storage_path
    or (select document_processing_profile from public.contracts where id = test_contract_id) <> 'google-vision-direct-v1'
    or (select document_redaction_profile from public.contracts where id = test_contract_id) is not null
    or (select count(*) from public.contract_document_artifact_deletions where replacement_job_id = replacement_job.id) <> 2
    or exists (
      select 1 from public.contract_document_artifact_deletions
      where storage_path = replacement_job.original_storage_path
    )
    or not exists (
      select 1 from public.contract_ai_jobs as ai_job
      where ai_job.contract_id = replacement_job.contract_id
        and ai_job.attachment_id is null and ai_job.status = 'queued'
    ) then
    raise exception 'Direct Vision replacement regression: promotion or cleanup outbox is incomplete';
  end if;

  select * into claimed_deletion
  from public.claim_contract_document_artifact_deletions(1, replacement_job.id)
  limit 1;
  if claimed_deletion.id is null then
    raise exception 'Direct Vision replacement regression: deletion was not claimed';
  end if;
  deletion_finished := public.finish_contract_document_artifact_deletion(
    claimed_deletion.id, true, null
  );
  if not deletion_finished or not exists (
      select 1 from public.contract_document_artifact_deletions
      where id = claimed_deletion.id and status = 'deleted' and deleted_at is not null
    ) then
    raise exception 'Direct Vision replacement regression: deletion lifecycle failed';
  end if;
end;
$$;

select pass('direct Vision OCR replacement preserves originals and queues exact masked artifacts');
select * from finish();

rollback;
