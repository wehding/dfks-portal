begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  actor_id uuid := gen_random_uuid();
  rights_holder_id uuid;
  draft_contract_id uuid := gen_random_uuid();
  validated_contract_id uuid := gen_random_uuid();
  rescan_contract_id uuid := gen_random_uuid();
  manual_contract_id uuid := gen_random_uuid();
  batch_contract_id uuid := gen_random_uuid();
  completion_contract_id uuid := gen_random_uuid();
  deletion_contract_id uuid := gen_random_uuid();
  draft_source_id uuid := gen_random_uuid();
  validated_source_id uuid := gen_random_uuid();
  rescan_source_id uuid := gen_random_uuid();
  manual_source_id uuid := gen_random_uuid();
  batch_source_id uuid := gen_random_uuid();
  completion_job_id uuid := gen_random_uuid();
  deletion_source_id uuid := gen_random_uuid();
  completion_lease uuid := gen_random_uuid();
  first_recovery record;
  replayed_recovery record;
  second_recovery record;
  exhausted record;
  validated_recovery record;
  rescan_result record;
  manual_result record;
  batch_result record;
  review_action record;
  rejected boolean;
  original_hash text := repeat('a', 64);
  original_path text;
begin
  if private.contract_document_recovery_policy_for_error('ocr_spatial_quality') <> 'spatial_remap_v2'
    or private.contract_document_recovery_policy_for_error('dlp_location_invalid') <> 'dlp_coordinate_normalization_v1'
    or private.contract_document_recovery_policy_for_error('processed_file_too_large') <> 'processed_pdf_downscale_v1'
    or private.contract_document_recovery_policy_for_error('vision_page_too_large') <> 'vision_page_downscale_v1'
    or private.contract_document_recovery_policy_for_error('vision_response_too_large') <> 'vision_pagewise_chunking_v1'
    or private.contract_document_recovery_policy_for_error('orientation_uncertain') is not null
    or private.contract_document_recovery_policy_for_error('ocr_unreadable_page') is not null then
    raise exception 'Automatic recovery allowlist regression';
  end if;

  if private.contract_document_review_details_valid(
      '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[2,1,2]}]}'::jsonb
    ) is not true
    or private.contract_document_review_details_valid(
      '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[201]}]}'::jsonb
    ) is not false
    or private.contract_document_review_details_valid(
      '{"schemaVersion":1,"reasons":[],"rawText":"forbidden"}'::jsonb
    ) is not false then
    raise exception 'Sanitised review detail schema regression';
  end if;

  if has_function_privilege(
      'service_role',
      'public.finish_contract_document_job(uuid,text,jsonb,boolean,integer,integer,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.finish_contract_document_job_v2(uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.finish_contract_document_job_v3(uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.finish_contract_document_job_v4(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.finish_contract_document_job_v5(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.finish_contract_document_job_v6(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.queue_contract_document_job_automatic_recovery(uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.queue_contract_document_job_automatic_recovery_batch(integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.admin_contract_document_review_action(uuid,uuid,text,uuid)',
      'EXECUTE'
    ) then
    raise exception 'Automatic recovery privilege regression';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Automatic OCR recovery ' || test_org::text);
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
  ) values (
    actor_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', actor_id || '@example.invalid', '', now(), now()
  );
  select id into rights_holder_id
  from public.rettighedshavere where user_id = actor_id;
  if rights_holder_id is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (actor_id, 'Automatic recovery actor', actor_id || '@example.invalid')
    returning id into rights_holder_id;
  end if;
  insert into public.user_org_roles(user_id, org_id, role)
  values (actor_id, test_org, 'admin');

  insert into public.contracts(
    id, org_id, rights_holder_id, type, status, pdf_url,
    document_processing_status, document_processing_error_code
  ) values
    (draft_contract_id, test_org, rights_holder_id, 'a-løn', 'kladde',
      test_org || '/' || draft_contract_id || '/original.pdf',
      'needs_review', 'ocr_spatial_quality'),
    (validated_contract_id, test_org, rights_holder_id, 'a-løn', 'kladde',
      test_org || '/' || validated_contract_id || '/original.pdf',
      'needs_review', 'ocr_spatial_quality'),
    (rescan_contract_id, test_org, rights_holder_id, 'a-løn', 'kladde',
      test_org || '/' || rescan_contract_id || '/original.pdf',
      'needs_review', 'ocr_spatial_quality'),
    (manual_contract_id, test_org, rights_holder_id, 'a-løn', 'kladde',
      test_org || '/' || manual_contract_id || '/original.pdf',
      'needs_review', 'orientation_uncertain'),
    (batch_contract_id, test_org, rights_holder_id, 'a-løn', 'kladde',
      test_org || '/' || batch_contract_id || '/original.pdf',
      'needs_review', 'vision_page_too_large'),
    (completion_contract_id, test_org, rights_holder_id, 'a-løn', 'kladde',
      test_org || '/' || completion_contract_id || '/original.pdf',
      'processing', null),
    (deletion_contract_id, test_org, rights_holder_id, 'a-løn', 'kladde',
      test_org || '/' || deletion_contract_id || '/original.pdf',
      'needs_review', 'ocr_spatial_quality');

  perform set_config('app.explicit_contract_validation', 'on', true);
  update public.contracts set status = 'valideret'
  where id = validated_contract_id;
  perform set_config('app.explicit_contract_validation', 'off', true);

  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, error_code, original_sha256, review_disposition,
    reviewed_at, review_details, lease_token, lease_expires_at
  ) values
    (draft_source_id, test_org, draft_contract_id,
      test_org || '/' || draft_contract_id || '/original.pdf',
      test_org || '/processed/' || draft_contract_id || '/source.pdf',
      'needs_review', 1, 'ocr_spatial_quality', original_hash, null, null,
      '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[2,1,2]}]}'::jsonb,
      null, null),
    (validated_source_id, test_org, validated_contract_id,
      test_org || '/' || validated_contract_id || '/original.pdf',
      test_org || '/processed/' || validated_contract_id || '/source.pdf',
      'needs_review', 1, 'ocr_spatial_quality', original_hash, null, null,
      '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[1]}]}'::jsonb,
      null, null),
    (rescan_source_id, test_org, rescan_contract_id,
      test_org || '/' || rescan_contract_id || '/original.pdf',
      test_org || '/processed/' || rescan_contract_id || '/source.pdf',
      'needs_review', 1, 'ocr_spatial_quality', original_hash,
      'rescan_requested', now(),
      '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[1]}]}'::jsonb,
      null, null),
    (manual_source_id, test_org, manual_contract_id,
      test_org || '/' || manual_contract_id || '/original.pdf',
      test_org || '/processed/' || manual_contract_id || '/source.pdf',
      'needs_review', 1, 'orientation_uncertain', original_hash, null, null,
      '{"schemaVersion":1,"reasons":[{"code":"orientation_uncertain","pageNumbers":[1]}]}'::jsonb,
      null, null),
    (batch_source_id, test_org, batch_contract_id,
      test_org || '/' || batch_contract_id || '/original.pdf',
      test_org || '/processed/' || batch_contract_id || '/source.pdf',
      'needs_review', 1, 'vision_page_too_large', original_hash, null, null,
      '{"schemaVersion":1,"reasons":[{"code":"vision_page_too_large","pageNumbers":[1]}]}'::jsonb,
      null, null),
    (completion_job_id, test_org, completion_contract_id,
      test_org || '/' || completion_contract_id || '/original.pdf',
      test_org || '/processed/' || completion_contract_id || '/pending.pdf',
      'processing', 1, null, original_hash, null, null,
      '{"schemaVersion":1,"reasons":[]}'::jsonb,
      completion_lease, now() + interval '10 minutes'),
    (deletion_source_id, test_org, deletion_contract_id,
      test_org || '/' || deletion_contract_id || '/original.pdf',
      test_org || '/processed/' || deletion_contract_id || '/source.pdf',
      'needs_review', 1, 'ocr_spatial_quality', original_hash, null, null,
      '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[1]}]}'::jsonb,
      null, null);

  perform set_config('request.jwt.claim.role', 'service_role', true);

  original_path := (
    select original_storage_path from public.contract_document_jobs
    where id = draft_source_id
  );
  select * into first_recovery
  from public.queue_contract_document_job_automatic_recovery(draft_source_id);
  if first_recovery.outcome <> 'queued'
    or first_recovery.automatic_generation <> 1
    or first_recovery.policy_code <> 'spatial_remap_v2'
    or first_recovery.downstream_ai_policy <> 'reanalyze'
    or (select original_storage_path from public.contract_document_jobs where id = draft_source_id) <> original_path
    or (select original_sha256 from public.contract_document_jobs where id = draft_source_id) <> original_hash
    or (select original_sha256 from public.contract_document_jobs where id = first_recovery.recovery_job_id) <> original_hash
    or (select review_details #> '{reasons,0,pageNumbers}' from public.contract_document_jobs where id = draft_source_id) <> '[1, 2]'::jsonb then
    raise exception 'First automatic recovery generation regression';
  end if;
  select * into replayed_recovery
  from public.queue_contract_document_job_automatic_recovery(draft_source_id);
  if replayed_recovery.outcome <> 'already_queued'
    or replayed_recovery.recovery_job_id <> first_recovery.recovery_job_id then
    raise exception 'Automatic recovery callback replay created a duplicate';
  end if;

  update public.contract_document_jobs
  set status = 'needs_review', error_code = 'dlp_location_invalid',
      review_details = '{"schemaVersion":1,"reasons":[{"code":"dlp_location_invalid","pageNumbers":[1]}]}'::jsonb,
      updated_at = now() + interval '1 second'
  where id = first_recovery.recovery_job_id;
  update public.contracts
  set document_processing_status = 'needs_review',
      document_processing_error_code = 'dlp_location_invalid'
  where id = draft_contract_id;
  select * into second_recovery
  from public.queue_contract_document_job_automatic_recovery(first_recovery.recovery_job_id);
  if second_recovery.outcome <> 'queued'
    or second_recovery.automatic_generation <> 2
    or second_recovery.policy_code <> 'dlp_coordinate_normalization_v1' then
    raise exception 'Second automatic recovery generation regression';
  end if;

  update public.contract_document_jobs
  set status = 'needs_review', error_code = 'vision_response_too_large',
      review_details = '{"schemaVersion":1,"reasons":[{"code":"vision_response_too_large","pageNumbers":[1]}]}'::jsonb,
      updated_at = now() + interval '2 seconds'
  where id = second_recovery.recovery_job_id;
  update public.contracts
  set document_processing_status = 'needs_review',
      document_processing_error_code = 'vision_response_too_large'
  where id = draft_contract_id;
  select * into exhausted
  from public.queue_contract_document_job_automatic_recovery(second_recovery.recovery_job_id);
  if exhausted.outcome <> 'limit_reached'
    or (select review_disposition from public.contract_document_jobs
        where id = second_recovery.recovery_job_id) <> 'manual_review_required'
    or (select count(*) from public.contract_document_jobs
        where contract_id = draft_contract_id and recovery_origin = 'automatic') <> 2 then
    raise exception 'Global automatic generation cap regression';
  end if;

  select * into validated_recovery
  from public.queue_contract_document_job_automatic_recovery(validated_source_id);
  if validated_recovery.outcome <> 'queued'
    or validated_recovery.downstream_ai_policy <> 'preserve' then
    raise exception 'Validated contract preserve-policy regression';
  end if;

  select * into rescan_result
  from public.queue_contract_document_job_automatic_recovery(rescan_source_id);
  if rescan_result.outcome <> 'rescan_requested'
    or exists (select 1 from public.contract_document_jobs where recovery_of_job_id = rescan_source_id) then
    raise exception 'Rescan jobs must never be retried automatically';
  end if;

  select * into manual_result
  from public.queue_contract_document_job_automatic_recovery(manual_source_id);
  if manual_result.outcome <> 'manual_review_required'
    or exists (select 1 from public.contract_document_jobs where recovery_of_job_id = manual_source_id) then
    raise exception 'Non-allowlisted errors must remain manual';
  end if;

  select * into batch_result
  from public.queue_contract_document_job_automatic_recovery_batch(10)
  where source_job_id = batch_source_id;
  if batch_result.outcome <> 'queued'
    or batch_result.policy_code <> 'vision_page_downscale_v1' then
    raise exception 'Historical automatic recovery batch regression';
  end if;

  rejected := false;
  begin
    perform public.finish_contract_document_job_v6(
      p_job_id => completion_job_id,
      p_lease_token => completion_lease,
      p_status => 'needs_review',
      p_page_count => 1,
      p_original_sha256 => repeat('b', 64),
      p_error_code => 'ocr_spatial_quality'
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected
    or (select original_sha256 from public.contract_document_jobs
        where id = completion_job_id) <> original_hash
    or (select status from public.contract_document_jobs
        where id = completion_job_id) <> 'processing' then
    raise exception 'V6 accepted or persisted a changed original hash';
  end if;

  rejected := false;
  begin
    perform public.finish_contract_document_job_v6(
      p_job_id => completion_job_id,
      p_lease_token => completion_lease,
      p_status => 'needs_review',
      p_page_count => 1,
      p_original_sha256 => original_hash,
      p_error_code => 'ocr_spatial_quality',
      p_review_details => '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[2]}]}'::jsonb
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Completion accepted an out-of-range review page';
  end if;

  perform public.finish_contract_document_job_v6(
    p_job_id => completion_job_id,
    p_lease_token => completion_lease,
    p_status => 'needs_review',
    p_page_count => 1,
    p_original_sha256 => original_hash,
    p_error_code => 'processed_file_too_large'
  );
  if not exists (
      select 1
      from public.contract_document_jobs as completed_job
      cross join lateral jsonb_array_elements(
        completed_job.review_details -> 'reasons'
      ) as reasons(reason)
      where completed_job.id = completion_job_id
        and reasons.reason ->> 'code' = 'processed_file_too_large'
    ) or not exists (
      select 1
      from public.contract_document_jobs
      where recovery_of_job_id = completion_job_id
        and automatic_recovery_policy = 'processed_pdf_downscale_v1'
        and automatic_recovery_generation = 1
    ) then
    raise exception 'V6 did not add the safe reason and queue recovery atomically';
  end if;

  select * into review_action
  from public.admin_contract_document_review_action(
    completion_contract_id, test_org, 'retry', actor_id
  );
  if review_action.outcome <> 'retry_already_queued'
    or review_action.review_disposition <> 'retry_after_pipeline_fix' then
    raise exception 'Admin retry replay did not return the existing recovery';
  end if;

  select * into review_action
  from public.admin_contract_document_review_action(
    rescan_contract_id, test_org, 'request_rescan', actor_id
  );
  if review_action.outcome <> 'rescan_requested'
    or review_action.review_disposition <> 'rescan_requested' then
    raise exception 'Admin rescan action regression';
  end if;

  rejected := false;
  begin
    perform public.admin_contract_document_review_action(
      validated_contract_id, test_org, 'request_rescan', actor_id
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Validated contract accepted a rescan request';
  end if;

  if not exists (
    select 1 from public.audit_events as event
    where event.entity_type = 'contract_document_job'
      and event.actor_org_id = test_org
      and event.metadata ->> 'event_code' = 'ocr_automatic_recovery_queued'
      and event.metadata::text not ilike '%original.pdf%'
  ) then
    raise exception 'Automatic recovery audit regression';
  end if;

  if not exists (
    select 1
    from public.audit_events as event
    join public.audit_event_subjects as subject
      on subject.event_id = event.id
     and subject.target_member_uuid = rights_holder_id
    where event.entity_type = 'contract_document_job'
      and event.actor_user_id = actor_id
      and event.actor_org_id = test_org
      and event.source = 'admin'
      and event.metadata ->> 'event_code' = 'ocr_admin_retry_requested'
      and event.metadata ->> 'retry_outcome' = 'already_queued'
      and event.metadata::text not ilike '%original.pdf%'
  ) then
    raise exception 'Accepted admin retry replay was not audited with its member subject';
  end if;

  perform public.queue_contract_document_job_automatic_recovery(deletion_source_id);
  if (select count(*) from public.contract_document_jobs
      where contract_id = deletion_contract_id) <> 2 then
    raise exception 'Deletion regression fixture did not create a recovery lineage';
  end if;
  delete from public.contracts where id = deletion_contract_id;
  set constraints contract_document_jobs_recovery_of_job_id_fkey immediate;
  if exists (
    select 1 from public.contract_document_jobs
    where contract_id = deletion_contract_id
  ) then
    raise exception 'Deleting a contract did not remove its complete recovery lineage';
  end if;
end;
$$;

select pass('automatic OCR recovery is typed, bounded, immutable and service-only');
select * from finish();

rollback;
