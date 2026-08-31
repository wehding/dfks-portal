begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  document_contract_id uuid := gen_random_uuid();
  document_job_id uuid := gen_random_uuid();
  original_path text;
  original_hash text := repeat('a', 64);
  test_lease uuid := gen_random_uuid();
  recovery record;
  rejected boolean;
  caught_message text;
begin
  if has_function_privilege(
      'public',
      'public.requeue_contract_document_job_for_recovery(uuid,text,text,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.requeue_contract_document_job_for_recovery(uuid,text,text,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.requeue_contract_document_job_for_recovery(uuid,text,text,integer)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.requeue_contract_document_job_for_recovery(uuid,text,text,integer)',
      'EXECUTE'
    ) then
    raise exception 'Recovery regression: service-only privileges are incorrect';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Guarded recovery ' || test_org::text);

  original_path := test_org || '/' || document_contract_id || '/original.pdf';
  insert into public.contracts(
    id, org_id, type, status, pdf_url,
    document_processing_status, document_processing_error_code
  ) values (
    document_contract_id, test_org, 'a-løn', 'kladde', original_path,
    'needs_review', 'dlp_location_invalid'
  );
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    spatial_data_path, status, priority, attempts,
    orientation_corrections, ocr_applied, page_count,
    text_char_count, error_code, safe_error_message,
    ocr_engine, document_classification, native_page_count, ocr_page_count,
    unreadable_page_count, redaction_counts, spatial_accuracy_score,
    spatial_median_iou, spatial_center_inside_ratio, original_sha256,
    processed_sha256, redaction_profile, spatial_schema_version, spatial_sha256
  ) values (
    document_job_id, test_org, document_contract_id, original_path,
    test_org || '/processed/' || document_contract_id || '/old.pdf',
    test_org || '/processed/' || document_contract_id || '/old.json.gz',
    'needs_review', 10, 3,
    '[{"page":1,"degrees":90}]'::jsonb, true, 2, 500,
    'dlp_location_invalid', 'Sikker dokumentfejl', 'google-vision-eu-v1',
    'image_only', 0, 2, 0, '{"PERSON_NAME":1}'::jsonb,
    0.98, 0.99, 0.97, null, repeat('b', 64),
    'dfks-contract-redaction-v1', 'google-vision-spatial-v2', repeat('c', 64)
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);

  rejected := false;
  begin
    perform public.requeue_contract_document_job_for_recovery(
      document_job_id, 'dlp_location_invalid', repeat('d', 64), -1
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Recovery regression: invalid priority was accepted';
  end if;

  rejected := false;
  begin
    perform public.requeue_contract_document_job_for_recovery(
      document_job_id, 'wrong_error', original_hash, 1000
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected or not exists (
    select 1 from public.contract_document_jobs
    where id = document_job_id and status = 'needs_review'
      and error_code = 'dlp_location_invalid' and original_sha256 is null
  ) then
    raise exception 'Recovery regression: error precondition was bypassed';
  end if;

  select * into recovery
  from public.requeue_contract_document_job_for_recovery(
    document_job_id, 'dlp_location_invalid', original_hash, 1000
  );
  if recovery.outcome <> 'requeued' or recovery.job_id <> document_job_id
    or not exists (
      select 1 from public.contract_document_jobs
      where id = document_job_id and status = 'queued' and priority = 1000
        and attempts = 0 and lease_token is null and lease_expires_at is null
        and output_storage_path = test_org || '/processed/' || document_contract_id || '/normalised.pdf'
        and spatial_data_path is null and orientation_corrections = '[]'::jsonb
        and not ocr_applied and page_count is null and text_char_count is null
        and error_code is null and safe_error_message is null and completed_at is null
        and ocr_engine is null and document_classification is null
        and native_page_count = 0 and ocr_page_count = 0 and unreadable_page_count = 0
        and redaction_counts = '{}'::jsonb and spatial_accuracy_score is null
        and spatial_median_iou is null and spatial_center_inside_ratio is null
        and original_sha256 = original_hash and processed_sha256 is null
        and redaction_profile is null and spatial_schema_version is null
        and spatial_sha256 is null
    )
    or not exists (
      select 1 from public.contracts
      where id = document_contract_id and status = 'kladde'
        and pdf_url = original_path and document_processing_status = 'pending'
        and document_processing_error_code is null
    ) then
    raise exception 'Recovery regression: retry was not reset atomically';
  end if;

  -- A terminal callback without a new hash keeps the source hash established
  -- at recovery instead of erasing the integrity baseline.
  update public.contract_document_jobs
  set status = 'processing', lease_token = test_lease,
      lease_expires_at = now() + interval '10 minutes'
  where id = document_job_id;
  rejected := false;
  begin
    perform public.finish_contract_document_job_v5(
      p_job_id => document_job_id,
      p_lease_token => test_lease,
      p_status => 'completed',
      p_processed_sha256 => repeat('b', 64)
    );
  exception when sqlstate '22023' then
    get stacked diagnostics caught_message = message_text;
    rejected := caught_message = 'successful completion requires the current original hash';
  end;
  if not rejected or not exists (
    select 1 from public.contract_document_jobs
    where id = document_job_id and status = 'processing'
      and original_sha256 = original_hash
  ) then
    raise exception 'Recovery regression: successful completion omitted the source hash';
  end if;

  -- A terminal needs_review callback may omit the source hash because it does
  -- not promote a processed document. The established recovery baseline must
  -- nevertheless remain unchanged.
  perform public.finish_contract_document_job_v5(
    p_job_id => document_job_id,
    p_lease_token => test_lease,
    p_status => 'needs_review',
    p_error_code => 'dlp_location_invalid',
    p_safe_error_message => 'Sikker dokumentfejl'
  );
  if not exists (
    select 1 from public.contract_document_jobs
    where id = document_job_id and status = 'needs_review'
      and original_sha256 = original_hash
  ) then
    raise exception 'Recovery regression: completion erased the source hash';
  end if;

  -- A repeated recovery with a different expected source hash must fail and
  -- leave both the hash and legal contract status untouched.
  update public.contract_document_jobs
  set status = 'needs_review', error_code = 'dlp_location_invalid'
  where id = document_job_id;
  update public.contracts
  set document_processing_status = 'needs_review',
      document_processing_error_code = 'dlp_location_invalid'
  where id = document_contract_id;
  rejected := false;
  begin
    perform public.requeue_contract_document_job_for_recovery(
      document_job_id, 'dlp_location_invalid', repeat('f', 64), 1000
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected or not exists (
    select 1 from public.contract_document_jobs
    where id = document_job_id and status = 'needs_review'
      and original_sha256 = original_hash
  ) or not exists (
    select 1 from public.contracts
    where id = document_contract_id and status = 'kladde'
      and document_processing_status = 'needs_review'
  ) then
    raise exception 'Recovery regression: hash mismatch was not atomic';
  end if;

  -- The completion callback cannot replace the stored baseline with a
  -- different downloaded object hash.
  select * into recovery
  from public.requeue_contract_document_job_for_recovery(
    document_job_id, 'dlp_location_invalid', original_hash, 1000
  );
  test_lease := gen_random_uuid();
  update public.contract_document_jobs
  set status = 'processing', lease_token = test_lease,
      lease_expires_at = now() + interval '10 minutes'
  where id = document_job_id;
  rejected := false;
  begin
    perform public.finish_contract_document_job_v5(
      p_job_id => document_job_id,
      p_lease_token => test_lease,
      p_status => 'needs_review',
      p_original_sha256 => repeat('e', 64),
      p_error_code => 'original_sha256_mismatch'
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected or not exists (
    select 1 from public.contract_document_jobs
    where id = document_job_id and status = 'processing'
      and original_sha256 = original_hash
  ) then
    raise exception 'Recovery regression: completion accepted a changed source hash';
  end if;
  update public.contract_document_jobs
  set status = 'needs_review', error_code = 'dlp_location_invalid',
      lease_token = null, lease_expires_at = null
  where id = document_job_id;
  update public.contracts
  set document_processing_status = 'needs_review',
      document_processing_error_code = 'dlp_location_invalid'
  where id = document_contract_id;

  -- A validated contract must never be put back through OCR -> AI recovery.
  perform set_config('app.explicit_contract_validation', 'on', true);
  update public.contracts set status = 'valideret' where id = document_contract_id;
  perform set_config('app.explicit_contract_validation', 'off', true);
  rejected := false;
  begin
    perform public.requeue_contract_document_job_for_recovery(
      document_job_id, 'dlp_location_invalid', original_hash, 1000
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Recovery regression: validated contract was accepted';
  end if;
end $$;

select pass('OCR recovery is service-only, hash-fenced and preserves legal status');
select * from finish();

rollback;
