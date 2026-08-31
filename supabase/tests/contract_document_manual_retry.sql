begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  actor_id uuid := gen_random_uuid();
  other_actor_id uuid := gen_random_uuid();
  actor_holder_id uuid;
  other_holder_id uuid;
  terminal_contract_id uuid := gen_random_uuid();
  failed_contract_id uuid := gen_random_uuid();
  active_contract_id uuid := gen_random_uuid();
  completed_contract_id uuid := gen_random_uuid();
  native_contract_id uuid := gen_random_uuid();
  rescan_contract_id uuid := gen_random_uuid();
  new_contract_id uuid := gen_random_uuid();
  foreign_contract_id uuid := gen_random_uuid();
  non_pdf_contract_id uuid := gen_random_uuid();
  terminal_job_id uuid := gen_random_uuid();
  failed_job_id uuid := gen_random_uuid();
  active_job_id uuid := gen_random_uuid();
  completed_job_id uuid := gen_random_uuid();
  native_job_id uuid := gen_random_uuid();
  rescan_job_id uuid := gen_random_uuid();
  retry_result record;
  failed_recovery_id uuid;
  failed_lease uuid := gen_random_uuid();
  ownership_rejected boolean := false;
  non_pdf_rejected boolean := false;
  rescan_rejected boolean := false;
begin
  if has_function_privilege(
      'authenticated',
      'public.queue_or_retry_member_contract_document_job(uuid,uuid,uuid,uuid)',
      'EXECUTE'
    ) then
    raise exception 'Manual OCR retry regression: browser roles can invoke the service-only function';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Manual OCR retry ' || test_org::text);
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (actor_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', actor_id || '@example.invalid', '', now(), now()),
    (other_actor_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', other_actor_id || '@example.invalid', '', now(), now());

  select id into actor_holder_id from public.rettighedshavere where user_id = actor_id;
  if actor_holder_id is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (actor_id, 'OCR retry actor', actor_id || '@example.invalid')
    returning id into actor_holder_id;
  end if;
  select id into other_holder_id from public.rettighedshavere where user_id = other_actor_id;
  if other_holder_id is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (other_actor_id, 'OCR retry other actor', other_actor_id || '@example.invalid')
    returning id into other_holder_id;
  end if;
  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from)
  values
    (test_org, actor_holder_id, true, current_date),
    (test_org, other_holder_id, true, current_date);

  insert into public.contracts(
    id, org_id, rights_holder_id, type, status, pdf_url,
    document_processing_status, document_processing_error_code
  ) values
    (terminal_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/terminal.pdf', 'needs_review', 'low_text_quality'),
    (failed_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/failed.pdf', 'failed', 'max_attempts_exceeded'),
    (active_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/active.pdf', 'processing', null),
    (completed_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/completed.pdf', 'ready', null),
    (native_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/native.pdf', 'not_required', null),
    (rescan_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/rescan.pdf', 'needs_review', 'ocr_rescan_required'),
    (new_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/new.pdf', 'failed', 'missing_job'),
    (foreign_contract_id, test_org, other_holder_id, 'a-løn', 'kladde', test_org || '/' || other_actor_id || '/foreign.pdf', 'failed', 'missing_job'),
    (non_pdf_contract_id, test_org, actor_holder_id, 'a-løn', 'kladde', test_org || '/' || actor_id || '/contract.docx', 'failed', 'missing_job');

  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    spatial_data_path, status, attempts, next_attempt_at, lease_token,
    lease_expires_at, orientation_corrections, ocr_applied, page_count,
    text_char_count, error_code, safe_error_message, completed_at,
    ocr_engine, document_classification, native_page_count, ocr_page_count,
    unreadable_page_count, redaction_counts, spatial_accuracy_score,
    spatial_median_iou, spatial_center_inside_ratio, original_sha256,
    processed_sha256, redaction_profile, spatial_schema_version, spatial_sha256
  ) values (
    terminal_job_id, test_org, terminal_contract_id,
    test_org || '/' || actor_id || '/terminal.pdf',
    test_org || '/processed/' || terminal_contract_id || '/leases/' || gen_random_uuid() || '/normalised.pdf',
    test_org || '/processed/' || terminal_contract_id || '/leases/' || gen_random_uuid() || '/vision-layout.json.gz',
    'needs_review', 2, now(), gen_random_uuid(), now() - interval '1 minute',
    '[{"page":1,"degrees":90}]'::jsonb, true, 2, 500,
    'low_text_quality', 'Sikker dokumentfejl', now(), 'google-vision-eu-v1',
    'image_only', 0, 2, 0, '{"DENMARK_CPR_NUMBER":1}'::jsonb,
    0.98, 0.90, 0.99, repeat('a', 64), repeat('b', 64),
    'dfks-contract-redaction-v1', 'google-vision-spatial-v2', repeat('c', 64)
  );
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, error_code, safe_error_message
  ) values
    (failed_job_id, test_org, failed_contract_id, test_org || '/' || actor_id || '/failed.pdf', test_org || '/processed/' || failed_contract_id || '/old.pdf', 'failed', 5, 'max_attempts_exceeded', 'Sikker dokumentfejl'),
    (active_job_id, test_org, active_contract_id, test_org || '/' || actor_id || '/active.pdf', test_org || '/processed/' || active_contract_id || '/normalised.pdf', 'queued', 0, null, null),
    (completed_job_id, test_org, completed_contract_id, test_org || '/' || actor_id || '/completed.pdf', test_org || '/processed/' || completed_contract_id || '/normalised.pdf', 'completed', 1, null, null),
    (native_job_id, test_org, native_contract_id, test_org || '/' || actor_id || '/native.pdf', test_org || '/processed/' || native_contract_id || '/normalised.pdf', 'not_required', 1, null, null);
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, error_code, safe_error_message, review_disposition,
    reviewed_at, recovery_reason_code
  ) values (
    rescan_job_id, test_org, rescan_contract_id,
    test_org || '/' || actor_id || '/rescan.pdf',
    test_org || '/processed/' || rescan_contract_id || '/old.pdf',
    'needs_review', 1, 'ocr_spatial_quality', 'Sikker dokumentfejl',
    'rescan_requested', now(), 'source_scan_quality'
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);

  select * into retry_result from public.queue_or_retry_member_contract_document_job(
    actor_id, test_org, actor_holder_id, terminal_contract_id
  );
  if retry_result.outcome <> 'requeued' or retry_result.job_id = terminal_job_id then
    raise exception 'Manual OCR retry regression: needs_review job did not create a fresh generation';
  end if;
  if not exists (
    select 1 from public.contract_document_jobs
    where id = terminal_job_id
      and status = 'needs_review' and attempts = 2
      and error_code = 'low_text_quality'
      and spatial_data_path is not null and orientation_corrections <> '[]'::jsonb
      and ocr_applied and page_count = 2 and text_char_count = 500
      and original_sha256 = repeat('a', 64)
      and processed_sha256 = repeat('b', 64)
      and review_disposition = 'retry_after_pipeline_fix'
  ) or not exists (
    select 1 from public.contract_document_jobs
    where id = retry_result.job_id and status = 'queued' and attempts = 0
      and recovery_of_job_id = terminal_job_id
      and downstream_ai_policy = 'reanalyze'
      and recovery_reason_code = 'member_retry'
      and original_storage_path = test_org || '/' || actor_id || '/terminal.pdf'
      and original_sha256 = repeat('a', 64)
  ) then
    raise exception 'Manual OCR retry regression: terminal evidence was mutated or child generation is invalid';
  end if;
  if not exists (
    select 1 from public.contracts
    where id = terminal_contract_id and status = 'kladde'
      and document_processing_status = 'pending'
      and document_processing_error_code is null
  ) or exists (
    select 1 from public.contract_ai_jobs
    where contract_id = terminal_contract_id
  ) then
    raise exception 'Manual OCR retry regression: retry validated the contract or queued AI before OCR';
  end if;

  select * into retry_result from public.queue_or_retry_member_contract_document_job(
    actor_id, test_org, actor_holder_id, failed_contract_id
  );
  if retry_result.outcome <> 'requeued' or retry_result.job_id = failed_job_id
    or not exists (
      select 1 from public.contract_document_jobs
      where id = failed_job_id and status = 'failed' and attempts = 5
        and error_code = 'max_attempts_exceeded'
        and review_disposition = 'retry_after_pipeline_fix'
    ) or not exists (
      select 1 from public.contract_document_jobs
      where id = retry_result.job_id and status = 'queued' and attempts = 0
        and recovery_of_job_id = failed_job_id
        and downstream_ai_policy = 'reanalyze'
    ) then
    raise exception 'Manual OCR retry regression: permanently failed evidence was not preserved';
  end if;
  failed_recovery_id := retry_result.job_id;
  update public.contract_document_jobs
  set status = 'processing', attempts = 1, lease_token = failed_lease,
      lease_expires_at = now() + interval '10 minutes',
      output_storage_path = test_org || '/processed/' || failed_contract_id
        || '/leases/' || failed_lease || '/normalised.pdf',
      spatial_data_path = test_org || '/processed/' || failed_contract_id
        || '/leases/' || failed_lease || '/vision-layout.json.gz'
  where id = failed_recovery_id;
  perform public.finish_contract_document_job_v5(
    p_job_id => failed_recovery_id,
    p_lease_token => failed_lease,
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
    p_original_sha256 => repeat('d', 64),
    p_processed_sha256 => repeat('e', 64),
    p_redaction_profile => 'dfks-contract-redaction-v1',
    p_spatial_schema_version => 'google-vision-spatial-v2',
    p_spatial_sha256 => repeat('f', 64)
  );
  if not exists (
    select 1 from public.contract_document_jobs
    where id = failed_job_id and status = 'failed'
      and superseded_by_job_id = failed_recovery_id
      and superseded_at is not null
  ) or not exists (
    select 1 from public.contracts
    where id = failed_contract_id and status = 'kladde'
      and pdf_url = test_org || '/' || actor_id || '/failed.pdf'
      and document_processing_status = 'ready'
  ) then
    raise exception 'Manual OCR retry regression: successful child did not supersede failed evidence safely';
  end if;

  begin
    perform public.queue_or_retry_member_contract_document_job(
      actor_id, test_org, actor_holder_id, rescan_contract_id
    );
  exception when sqlstate '55000' then
    rescan_rejected := true;
  end;
  if not rescan_rejected or exists (
    select 1 from public.contract_document_jobs
    where recovery_of_job_id = rescan_job_id
  ) then
    raise exception 'Manual OCR retry regression: rescan request entered automatic recovery';
  end if;

  select * into retry_result from public.queue_or_retry_member_contract_document_job(
    actor_id, test_org, actor_holder_id, active_contract_id
  );
  if retry_result.outcome <> 'already_queued' or retry_result.job_id <> active_job_id then
    raise exception 'Manual OCR retry regression: active job was duplicated';
  end if;

  select * into retry_result from public.queue_or_retry_member_contract_document_job(
    actor_id, test_org, actor_holder_id, completed_contract_id
  );
  if retry_result.outcome <> 'already_processed' or retry_result.job_id <> completed_job_id then
    raise exception 'Manual OCR retry regression: completed job was reprocessed';
  end if;
  select * into retry_result from public.queue_or_retry_member_contract_document_job(
    actor_id, test_org, actor_holder_id, native_contract_id
  );
  if retry_result.outcome <> 'already_processed' or retry_result.job_id <> native_job_id then
    raise exception 'Manual OCR retry regression: native-text job was reprocessed';
  end if;

  select * into retry_result from public.queue_or_retry_member_contract_document_job(
    actor_id, test_org, actor_holder_id, new_contract_id
  );
  if retry_result.outcome <> 'queued'
    or not exists (
      select 1 from public.contract_document_jobs
      where id = retry_result.job_id and contract_id = new_contract_id
        and status = 'queued' and original_storage_path = test_org || '/' || actor_id || '/new.pdf'
    )
    or not exists (
      select 1 from public.contracts
      where id = new_contract_id and status = 'kladde'
        and document_processing_status = 'pending'
        and document_processing_error_code is null
    ) then
    raise exception 'Manual OCR retry regression: missing job was not created safely';
  end if;

  begin
    perform public.queue_or_retry_member_contract_document_job(
      actor_id, test_org, actor_holder_id, foreign_contract_id
    );
  exception when insufficient_privilege then
    ownership_rejected := true;
  end;
  if not ownership_rejected then
    raise exception 'Manual OCR retry regression: non-owner could queue another member''s contract';
  end if;

  begin
    perform public.queue_or_retry_member_contract_document_job(
      actor_id, test_org, actor_holder_id, non_pdf_contract_id
    );
  exception when others then
    non_pdf_rejected := true;
  end;
  if not non_pdf_rejected
    or exists (select 1 from public.contract_document_jobs where contract_id = non_pdf_contract_id) then
    raise exception 'Manual OCR retry regression: non-PDF contract entered the document queue';
  end if;

  if position('for update of job' in lower(pg_get_functiondef(
      'public.queue_or_retry_member_contract_document_job(uuid,uuid,uuid,uuid)'::regprocedure
    ))) = 0
    or position('for update of contract' in lower(pg_get_functiondef(
      'public.queue_or_retry_member_contract_document_job(uuid,uuid,uuid,uuid)'::regprocedure
    ))) = 0
    or position('for update of job' in lower(pg_get_functiondef(
      'public.queue_or_retry_member_contract_document_job(uuid,uuid,uuid,uuid)'::regprocedure
    ))) > position('for update of contract' in lower(pg_get_functiondef(
      'public.queue_or_retry_member_contract_document_job(uuid,uuid,uuid,uuid)'::regprocedure
    ))) then
    raise exception 'Manual OCR retry regression: queue/contract lock order changed';
  end if;
end $$;

select pass('Manuel OCR-genkø er atomisk, ejerskabsafgrænset og validerer aldrig kontrakten');
select * from finish();

rollback;
