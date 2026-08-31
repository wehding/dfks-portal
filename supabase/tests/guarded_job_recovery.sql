begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  draft_contract_id uuid := gen_random_uuid();
  validated_contract_id uuid := gen_random_uuid();
  rescan_contract_id uuid := gen_random_uuid();
  changed_source_contract_id uuid := gen_random_uuid();
  draft_source_id uuid := gen_random_uuid();
  validated_source_id uuid := gen_random_uuid();
  rescan_source_id uuid := gen_random_uuid();
  changed_source_job_id uuid := gen_random_uuid();
  existing_ai_job_id uuid := gen_random_uuid();
  draft_recovery record;
  validated_recovery record;
  rescan_result record;
  draft_lease uuid := gen_random_uuid();
  validated_lease uuid := gen_random_uuid();
  changed_source_lease uuid := gen_random_uuid();
  original_hash text := repeat('a', 64);
  processed_hash text := repeat('b', 64);
  spatial_hash text := repeat('c', 64);
  rejected boolean;
begin
  if has_function_privilege(
      'public',
      'public.queue_contract_document_job_recovery_generation(uuid,text,text,numeric,numeric,numeric,text,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.queue_contract_document_job_recovery_generation(uuid,text,text,numeric,numeric,numeric,text,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.queue_contract_document_job_recovery_generation(uuid,text,text,numeric,numeric,numeric,text,integer)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.queue_contract_document_job_recovery_generation(uuid,text,text,numeric,numeric,numeric,text,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.mark_contract_document_job_for_rescan(uuid,text,text,numeric,numeric,numeric,uuid)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.mark_contract_document_job_for_rescan(uuid,text,text,numeric,numeric,numeric,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.requeue_contract_document_job_for_recovery(uuid,text,text,integer)',
      'EXECUTE'
    ) then
    raise exception 'Immutable recovery regression: function privileges are incorrect';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Immutable recovery ' || test_org::text);

  insert into public.contracts(
    id, org_id, type, status, pdf_url,
    document_processing_status, document_processing_error_code
  ) values
    (
      draft_contract_id, test_org, 'a-løn', 'kladde',
      test_org || '/' || draft_contract_id || '/original.pdf',
      'needs_review', 'ocr_spatial_quality'
    ),
    (
      validated_contract_id, test_org, 'a-løn', 'kladde',
      test_org || '/' || validated_contract_id || '/original.pdf',
      'needs_review', 'ocr_spatial_quality'
    ),
    (
      rescan_contract_id, test_org, 'a-løn', 'kladde',
      test_org || '/' || rescan_contract_id || '/original.pdf',
      'needs_review', 'ocr_spatial_quality'
    ),
    (
      changed_source_contract_id, test_org, 'a-løn', 'kladde',
      test_org || '/' || changed_source_contract_id || '/original.pdf',
      'processing', null
    );

  perform set_config('app.explicit_contract_validation', 'on', true);
  update public.contracts set status = 'valideret'
  where id = validated_contract_id;
  perform set_config('app.explicit_contract_validation', 'off', true);
  update public.contracts
  set layout_data = '{"preserved":true}'::jsonb
  where id = validated_contract_id;

  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    spatial_data_path, status, priority, attempts, completed_at,
    orientation_corrections, ocr_applied, page_count, text_char_count,
    error_code, safe_error_message, ocr_engine, document_classification,
    native_page_count, ocr_page_count, unreadable_page_count,
    redaction_counts, spatial_accuracy_score, spatial_median_iou,
    spatial_center_inside_ratio, original_sha256, processed_sha256,
    redaction_profile, spatial_schema_version, spatial_sha256
  ) values
    (
      draft_source_id, test_org, draft_contract_id,
      test_org || '/' || draft_contract_id || '/original.pdf',
      test_org || '/processed/' || draft_contract_id || '/historical.pdf',
      test_org || '/processed/' || draft_contract_id || '/historical.json.gz',
      'needs_review', 100, 1, now(), '[]'::jsonb, true, 1, 100,
      'ocr_spatial_quality', 'Sikker dokumentfejl', 'google-vision-eu-v1',
      'image_only', 0, 1, 0, '{}'::jsonb, 0.99, 0.90, 0.97,
      original_hash, processed_hash, 'dfks-contract-redaction-v1',
      'google-vision-spatial-v2', spatial_hash
    ),
    (
      validated_source_id, test_org, validated_contract_id,
      test_org || '/' || validated_contract_id || '/original.pdf',
      test_org || '/processed/' || validated_contract_id || '/historical.pdf',
      test_org || '/processed/' || validated_contract_id || '/historical.json.gz',
      'needs_review', 100, 1, now(), '[]'::jsonb, true, 1, 100,
      'ocr_spatial_quality', 'Sikker dokumentfejl', 'google-vision-eu-v1',
      'image_only', 0, 1, 0, '{}'::jsonb, 0.99, 0.90, 0.97,
      original_hash, processed_hash, 'dfks-contract-redaction-v1',
      'google-vision-spatial-v2', spatial_hash
    ),
    (
      rescan_source_id, test_org, rescan_contract_id,
      test_org || '/' || rescan_contract_id || '/original.pdf',
      test_org || '/processed/' || rescan_contract_id || '/historical.pdf',
      test_org || '/processed/' || rescan_contract_id || '/historical.json.gz',
      'needs_review', 100, 1, now(), '[]'::jsonb, true, 1, 100,
      'ocr_spatial_quality', 'Sikker dokumentfejl', 'google-vision-eu-v1',
      'image_only', 0, 1, 0, '{}'::jsonb, 0.99, 0.90, 0.97,
      original_hash, processed_hash, 'dfks-contract-redaction-v1',
      'google-vision-spatial-v2', spatial_hash
    );

  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, completed_at
  ) values (
    existing_ai_job_id, validated_contract_id, test_org, 'done', 'complete', now()
  );

  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, lease_token, lease_expires_at,
    original_sha256, downstream_ai_policy
  ) values (
    changed_source_job_id, test_org, changed_source_contract_id,
    test_org || '/' || changed_source_contract_id || '/original.pdf',
    test_org || '/processed/' || changed_source_contract_id || '/leases/'
      || changed_source_lease || '/normalised.pdf',
    'processing', 100, 1, changed_source_lease, now() + interval '10 minutes',
    original_hash, 'reanalyze'
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);

  update public.contracts
  set pdf_url = test_org || '/' || changed_source_contract_id || '/replacement.pdf'
  where id = changed_source_contract_id;
  rejected := false;
  begin
    perform public.finish_contract_document_job_v5(
      p_job_id => changed_source_job_id,
      p_lease_token => changed_source_lease,
      p_status => 'not_required',
      p_document_classification => 'native_text',
      p_ocr_engine => null,
      p_ocr_applied => false,
      p_page_count => 1,
      p_text_char_count => 200,
      p_native_page_count => 1,
      p_ocr_page_count => 0,
      p_unreadable_page_count => 0,
      p_original_sha256 => original_hash
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected
    or not exists (
      select 1 from public.contract_document_jobs
      where id = changed_source_job_id and status = 'processing'
        and original_storage_path = test_org || '/' || changed_source_contract_id || '/original.pdf'
    )
    or not exists (
      select 1 from public.contracts
      where id = changed_source_contract_id
        and pdf_url = test_org || '/' || changed_source_contract_id || '/replacement.pdf'
        and document_processing_status = 'processing'
    ) then
    raise exception 'Immutable recovery regression: changed native source was promoted';
  end if;

  rejected := false;
  begin
    perform public.queue_contract_document_job_recovery_generation(
      draft_source_id, 'ocr_spatial_quality', original_hash,
      0.99, 0.90, 0.98, 'center_matching_fix', 1000
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected or not exists (
    select 1 from public.contract_document_jobs
    where id = draft_source_id and status = 'needs_review'
      and spatial_center_inside_ratio = 0.97
      and recovery_of_job_id is null and superseded_by_job_id is null
  ) then
    raise exception 'Immutable recovery regression: metric fence was bypassed';
  end if;

  select * into draft_recovery
  from public.queue_contract_document_job_recovery_generation(
    draft_source_id, 'ocr_spatial_quality', original_hash,
    0.99, 0.90, 0.97, 'center_matching_fix', 1000
  );
  if draft_recovery.outcome <> 'queued'
    or draft_recovery.source_job_id <> draft_source_id
    or draft_recovery.recovery_job_id = draft_source_id
    or draft_recovery.downstream_ai_policy <> 'reanalyze'
    or not exists (
      select 1 from public.contract_document_jobs
      where id = draft_source_id and status = 'needs_review'
        and error_code = 'ocr_spatial_quality'
        and original_sha256 = original_hash
        and spatial_center_inside_ratio = 0.97
        and review_disposition = 'retry_after_pipeline_fix'
        and superseded_by_job_id is null
    )
    or not exists (
      select 1 from public.contract_document_jobs
      where id = draft_recovery.recovery_job_id and status = 'queued'
        and recovery_of_job_id = draft_source_id
        and downstream_ai_policy = 'reanalyze'
        and original_sha256 = original_hash
        and output_storage_path <> (select pdf_url from public.contracts where id = draft_contract_id)
    ) then
    raise exception 'Immutable recovery regression: draft generation was not queued immutably';
  end if;

  rejected := false;
  begin
    perform public.queue_contract_document_job_recovery_generation(
      draft_source_id, 'ocr_spatial_quality', original_hash,
      0.99, 0.90, 0.97, 'center_matching_fix', 1000
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected or (
    select count(*) from public.contract_document_jobs
    where recovery_of_job_id = draft_source_id
  ) <> 1 then
    raise exception 'Immutable recovery regression: duplicate generation was accepted';
  end if;

  update public.contract_document_jobs
  set status = 'processing', attempts = 1, lease_token = draft_lease,
      lease_expires_at = now() + interval '10 minutes',
      output_storage_path = test_org || '/processed/' || draft_contract_id
        || '/leases/' || draft_lease || '/normalised.pdf',
      spatial_data_path = test_org || '/processed/' || draft_contract_id
        || '/leases/' || draft_lease || '/vision-layout.json.gz'
  where id = draft_recovery.recovery_job_id;

  perform public.finish_contract_document_job_v5(
    p_job_id => draft_recovery.recovery_job_id,
    p_lease_token => draft_lease,
    p_status => 'completed',
    p_document_classification => 'image_only',
    p_ocr_engine => 'google-vision-eu-v1',
    p_ocr_applied => true,
    p_page_count => 1,
    p_text_char_count => 100,
    p_native_page_count => 0,
    p_ocr_page_count => 1,
    p_unreadable_page_count => 0,
    p_spatial_accuracy_score => 0.99,
    p_spatial_median_iou => 0.90,
    p_spatial_center_inside_ratio => 0.99,
    p_original_sha256 => original_hash,
    p_processed_sha256 => processed_hash,
    p_redaction_profile => 'dfks-contract-redaction-v1',
    p_spatial_schema_version => 'google-vision-spatial-v2',
    p_spatial_sha256 => spatial_hash
  );
  if not exists (
    select 1 from public.contract_document_jobs
    where id = draft_source_id
      and superseded_by_job_id = draft_recovery.recovery_job_id
      and superseded_at is not null and status = 'needs_review'
  ) or not exists (
    select 1 from public.contracts
    where id = draft_contract_id and status = 'kladde'
      and pdf_url = test_org || '/' || draft_contract_id || '/original.pdf'
      and document_processing_status = 'ready'
      and processed_pdf_url = test_org || '/processed/' || draft_contract_id
        || '/leases/' || draft_lease || '/normalised.pdf'
  ) or (
    select count(*) from public.contract_ai_jobs
    where contract_id = draft_contract_id and status = 'queued'
  ) <> 1 then
    raise exception 'Immutable recovery regression: draft completion did not promote one derivative and one AI job';
  end if;

  select * into validated_recovery
  from public.queue_contract_document_job_recovery_generation(
    validated_source_id, 'ocr_spatial_quality', original_hash,
    0.99, 0.90, 0.97, 'center_matching_fix', 1000
  );
  if validated_recovery.outcome <> 'queued'
    or validated_recovery.downstream_ai_policy <> 'preserve' then
    raise exception 'Immutable recovery regression: validated contract did not select preserve policy';
  end if;

  update public.contract_document_jobs
  set status = 'processing', attempts = 1, lease_token = validated_lease,
      lease_expires_at = now() + interval '10 minutes',
      output_storage_path = test_org || '/processed/' || validated_contract_id
        || '/leases/' || validated_lease || '/normalised.pdf',
      spatial_data_path = test_org || '/processed/' || validated_contract_id
        || '/leases/' || validated_lease || '/vision-layout.json.gz'
  where id = validated_recovery.recovery_job_id;

  perform public.finish_contract_document_job_v5(
    p_job_id => validated_recovery.recovery_job_id,
    p_lease_token => validated_lease,
    p_status => 'completed',
    p_document_classification => 'image_only',
    p_ocr_engine => 'google-vision-eu-v1',
    p_ocr_applied => true,
    p_page_count => 1,
    p_text_char_count => 100,
    p_native_page_count => 0,
    p_ocr_page_count => 1,
    p_unreadable_page_count => 0,
    p_spatial_accuracy_score => 0.99,
    p_spatial_median_iou => 0.90,
    p_spatial_center_inside_ratio => 0.99,
    p_original_sha256 => original_hash,
    p_processed_sha256 => processed_hash,
    p_redaction_profile => 'dfks-contract-redaction-v1',
    p_spatial_schema_version => 'google-vision-spatial-v2',
    p_spatial_sha256 => spatial_hash
  );
  if not exists (
    select 1 from public.contracts
    where id = validated_contract_id and status = 'valideret'
      and pdf_url = test_org || '/' || validated_contract_id || '/original.pdf'
      and layout_data = '{"preserved":true}'::jsonb
      and document_processing_status = 'ready'
      and processed_pdf_url = test_org || '/processed/' || validated_contract_id
        || '/leases/' || validated_lease || '/normalised.pdf'
  ) or not exists (
    select 1 from public.contract_document_jobs
    where id = validated_source_id
      and superseded_by_job_id = validated_recovery.recovery_job_id
      and superseded_at is not null
  ) or (
    select count(*) from public.contract_ai_jobs
    where contract_id = validated_contract_id
  ) <> 1 or not exists (
    select 1 from public.contract_ai_jobs
    where id = existing_ai_job_id and status = 'done' and stage = 'complete'
  ) then
    raise exception 'Immutable recovery regression: preserve policy changed legal or AI state';
  end if;

  select * into rescan_result
  from public.mark_contract_document_job_for_rescan(
    rescan_source_id, 'ocr_spatial_quality', original_hash,
    0.99, 0.90, 0.97, null
  );
  if rescan_result.outcome <> 'marked'
    or rescan_result.job_id <> rescan_source_id
    or not exists (
      select 1 from public.contract_document_jobs
      where id = rescan_source_id and status = 'needs_review'
        and review_disposition = 'rescan_requested'
        and recovery_reason_code = 'source_scan_quality'
        and superseded_by_job_id is null
    ) or not exists (
      select 1 from public.contracts
      where id = rescan_contract_id
        and document_processing_status = 'needs_review'
        and document_processing_error_code = 'ocr_rescan_required'
    ) then
    raise exception 'Immutable recovery regression: rescan disposition was not stored safely';
  end if;

  rejected := false;
  begin
    perform public.queue_contract_document_job_recovery_generation(
      rescan_source_id, 'ocr_spatial_quality', original_hash,
      0.99, 0.90, 0.97, 'center_matching_fix', 1000
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected or exists (
    select 1 from public.contract_document_jobs
    where recovery_of_job_id = rescan_source_id
  ) then
    raise exception 'Immutable recovery regression: rescan case entered automatic recovery';
  end if;

  -- Contract retention may delete a complete generation chain. Self-FKs must
  -- not turn immutable operational history into a blocker for legal deletion.
  delete from public.contracts where id = draft_contract_id;
  if exists (
    select 1 from public.contract_document_jobs
    where contract_id = draft_contract_id
  ) then
    raise exception 'Immutable recovery regression: contract retention left document generations behind';
  end if;
end $$;

select pass('OCR recovery creates immutable generations, preserves validated AI state and isolates rescans');
select * from finish();

rollback;
