begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  foreign_org uuid := gen_random_uuid();
  actor_id uuid := gen_random_uuid();
  holder_id uuid;
  test_contract_id uuid := gen_random_uuid();
  source_job_id uuid := gen_random_uuid();
  foreign_contract_id uuid := gen_random_uuid();
  foreign_job_id uuid := gen_random_uuid();
  test_run_id uuid := gen_random_uuid();
  targets jsonb;
  cohort_digest text;
  prepared record;
  initial_job public.contract_document_jobs;
  recovery_result record;
  recovery_job public.contract_document_jobs;
  completed_job public.contract_document_jobs;
  completion_result boolean;
  completion_state text;
  recovery_audit_id uuid;
  duplicate_rejected boolean := false;
  original_contract_status text;
  original_pdf_url text;
begin
  if has_function_privilege(
      'authenticated',
      'public.queue_contract_document_geometry_backfill_recovery(uuid,text,jsonb,integer,uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.queue_contract_document_geometry_backfill_recovery(uuid,text,jsonb,integer,uuid)',
      'EXECUTE'
    ) then
    raise exception 'Geometry recovery regression: privileged API exposure';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Geometry recovery ' || test_org::text);
  insert into public.organisations(id, name)
  values (foreign_org, 'Foreign geometry recovery ' || foreign_org::text);
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
  ) values (
    actor_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', actor_id || '@example.invalid', '', now(), now()
  );
  select id into holder_id from public.rettighedshavere where user_id = actor_id;
  if holder_id is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (actor_id, 'Geometry recovery member', actor_id || '@example.invalid')
    returning id into holder_id;
  end if;
  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from)
  values (test_org, holder_id, true, current_date);

  insert into public.contracts(
    id, org_id, rights_holder_id, type, status, pdf_url,
    document_processing_status, document_processing_error_code
  ) values (
    test_contract_id, test_org, holder_id, 'a-løn', 'kladde',
    test_org || '/' || test_contract_id || '/original.pdf',
    'needs_review', 'ocr_spatial_quality'
  );
  select status, pdf_url into original_contract_status, original_pdf_url
  from public.contracts where id = test_contract_id;

  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, original_sha256, page_count, error_code
  ) values (
    source_job_id, test_org, test_contract_id,
    test_org || '/' || test_contract_id || '/original.pdf',
    test_org || '/processed/' || test_contract_id || '/source.pdf',
    'needs_review', 100, 1, repeat('a', 64), 1, 'ocr_spatial_quality'
  );
  insert into public.contracts(
    id, org_id, type, status, pdf_url, document_processing_status,
    document_processing_error_code
  ) values (
    foreign_contract_id, foreign_org, 'a-løn', 'kladde',
    foreign_org || '/' || foreign_contract_id || '/original.pdf',
    'needs_review', 'ocr_spatial_quality'
  );
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, original_sha256, page_count, error_code
  ) values (
    foreign_job_id, foreign_org, foreign_contract_id,
    foreign_org || '/' || foreign_contract_id || '/original.pdf',
    foreign_org || '/processed/' || foreign_contract_id || '/source.pdf',
    'needs_review', 100, 1, repeat('d', 64), 1, 'ocr_spatial_quality'
  );

  targets := jsonb_build_array(jsonb_build_object(
    'contractId', test_contract_id,
    'sourceJobId', source_job_id,
    'originalSha256', repeat('a', 64),
    'originalPageCount', 1,
    'originalPathDigest', private.contract_document_path_digest(original_pdf_url),
    'contractStatus', original_contract_status,
    'priorProcessingStatus', 'needs_review'
  ));
  select encode(extensions.digest(string_agg(
    lower(item ->> 'contractId') || '|'
      || lower(item ->> 'sourceJobId') || '|'
      || lower(item ->> 'originalSha256') || '|'
      || ((item ->> 'originalPageCount')::integer)::text || '|'
      || lower(item ->> 'originalPathDigest') || '|'
      || (item ->> 'contractStatus') || '|'
      || (item ->> 'priorProcessingStatus'),
    E'\n' order by lower(item ->> 'contractId')
  ), 'sha256'), 'hex') into cohort_digest
  from jsonb_array_elements(targets) as rows(item);

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into prepared
  from public.prepare_contract_document_geometry_backfill_run(
    test_run_id, 1, cohort_digest, targets, 1200, null
  );
  if prepared.outcome <> 'queued' then
    raise exception 'Geometry recovery regression: fixture run was not prepared';
  end if;

  select * into initial_job
  from public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30);
  begin
    perform public.finish_contract_document_job_v8(
      initial_job.id, initial_job.lease_token, 'needs_review', 'mixed',
      'google-vision-eu-v1', '[]'::jsonb, false, 1, 0, 0, 1, 0,
      1.01, 0.80, 0.96, repeat('a', 64), null,
      'google-vision-direct-v1', 'google-vision-spatial-v3', null,
      'ocr_spatial_quality', 'Geometrien kræver kontrol.',
      '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[1]}]}'::jsonb
    );
    raise exception 'Geometry recovery regression: unsafe spatial metric was accepted';
  exception when sqlstate '22023' then
    null;
  end;
  perform public.finish_contract_document_job_v8(
    initial_job.id, initial_job.lease_token, 'needs_review', 'mixed',
    'google-vision-eu-v1', '[]'::jsonb, false, 1, 0, 0, 1, 0,
    0.91, 0.80, 0.96, repeat('a', 64), null,
    'google-vision-direct-v1', 'google-vision-spatial-v3', null,
    'ocr_spatial_quality', 'Geometrien kræver kontrol.',
    '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[1]}]}'::jsonb
  );
  if (select state from public.contract_document_backfill_runs where id = test_run_id)
      <> 'quality_pending'
    or (select recovery_generation from public.contract_document_backfill_targets
      where run_id = test_run_id and contract_id = test_contract_id) <> 0
    or not exists (
      select 1
      from public.contract_document_jobs as review_job
      where review_job.id = initial_job.id
        and review_job.spatial_accuracy_score = 0.91
        and review_job.spatial_median_iou = 0.80
        and review_job.spatial_center_inside_ratio = 0.96
        and review_job.spatial_schema_version = 'google-vision-spatial-v3'
        and review_job.spatial_sha256 is null
        and review_job.spatial_data_path is null
        and review_job.review_details =
          '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[1]}]}'::jsonb
    ) then
    raise exception 'Geometry recovery regression: terminal fixture did not reach quality gate';
  end if;

  begin
    perform public.complete_contract_document_geometry_backfill_run(
      test_run_id, cohort_digest, repeat('7', 64), 0, 1, 0
    );
    raise exception 'Geometry recovery regression: partial quality gate was accepted';
  exception when sqlstate '55000' then
    null;
  end;
  if (select state from public.contract_document_backfill_runs where id = test_run_id)
      <> 'quality_pending' then
    raise exception 'Geometry recovery regression: partial approval closed the recoverable run';
  end if;

  begin
    perform public.queue_contract_document_geometry_backfill_recovery(
      test_run_id,
      cohort_digest,
      jsonb_build_array(jsonb_build_object(
        'contractId', test_contract_id,
        'currentJobId', foreign_job_id,
        'currentGeneration', 0,
        'status', 'needs_review',
        'errorCode', 'ocr_spatial_quality',
        'originalSha256', repeat('d', 64)
      )),
      1250,
      null
    );
    raise exception 'Geometry recovery regression: cross-org current job was accepted';
  exception when sqlstate '55000' then
    null;
  end;

  select * into recovery_result
  from public.queue_contract_document_geometry_backfill_recovery(
    test_run_id,
    cohort_digest,
    jsonb_build_array(jsonb_build_object(
      'contractId', test_contract_id,
      'currentJobId', initial_job.id,
      'currentGeneration', 0,
      'status', 'needs_review',
      'errorCode', 'ocr_spatial_quality',
      'originalSha256', repeat('a', 64)
    )),
    1250,
    null
  );
  if recovery_result.outcome <> 'queued'
    or recovery_result.queued_count <> 1
    or recovery_result.minimum_generation <> 1
    or recovery_result.maximum_generation <> 1 then
    raise exception 'Geometry recovery regression: recovery batch was not queued';
  end if;

  select job.* into recovery_job
  from public.contract_document_backfill_targets as target
  join public.contract_document_jobs as job on job.id = target.queued_job_id
  where target.run_id = test_run_id and target.contract_id = test_contract_id;
  if recovery_job.id is null
    or recovery_job.id = initial_job.id
    or recovery_job.status <> 'queued'
    or recovery_job.recovery_of_job_id <> initial_job.id
    or recovery_job.recovery_reason_code <> 'geometry_quality_recovery_v1'
    or recovery_job.backfill_source_job_id <> source_job_id
    or recovery_job.downstream_ai_policy <> 'preserve'
    or recovery_job.original_sha256 <> repeat('a', 64)
    or recovery_job.backfill_recovery_audit_event_id is null
    or not public.verify_audit_event_subjects(recovery_job.backfill_recovery_audit_event_id)
    or not exists (
      select 1
      from public.audit_event_subjects as subject
      where subject.event_id = recovery_job.backfill_recovery_audit_event_id
        and subject.target_member_uuid = holder_id
    ) then
    raise exception 'Geometry recovery regression: child lineage or member audit is incomplete';
  end if;
  if not exists (
      select 1 from public.contract_document_jobs
      where id = initial_job.id
        and status = 'needs_review'
        and error_code = 'ocr_spatial_quality'
        and original_sha256 = repeat('a', 64)
        and superseded_by_job_id is null
    )
    or (select recovery_generation from public.contract_document_backfill_targets
      where run_id = test_run_id and contract_id = test_contract_id) <> 1
    or (select state from public.contract_document_backfill_runs where id = test_run_id) <> 'queued'
    or (select status from public.contracts where id = test_contract_id) <> original_contract_status
    or (select pdf_url from public.contracts where id = test_contract_id) <> original_pdf_url
    or exists (select 1 from public.contract_ai_jobs where contract_id = test_contract_id) then
    raise exception 'Geometry recovery regression: terminal/source/business state was mutated';
  end if;

  -- Exact retry is idempotent and must not add another child/audit action.
  select * into recovery_result
  from public.queue_contract_document_geometry_backfill_recovery(
    test_run_id,
    cohort_digest,
    jsonb_build_array(jsonb_build_object(
      'contractId', test_contract_id,
      'currentJobId', initial_job.id,
      'currentGeneration', 0,
      'status', 'needs_review',
      'errorCode', 'ocr_spatial_quality',
      'originalSha256', repeat('a', 64)
    )),
    1250,
    null
  );
  if recovery_result.outcome <> 'already_queued'
    or (select count(*) from public.contract_document_jobs
      where backfill_run_id = test_run_id and contract_id = test_contract_id) <> 2 then
    raise exception 'Geometry recovery regression: exact retry was not idempotent';
  end if;

  begin
    insert into public.contract_document_jobs(
      id, org_id, contract_id, original_storage_path, output_storage_path,
      status, priority, attempts, original_sha256, downstream_ai_policy,
      processing_profile, backfill_run_id, backfill_source_job_id, processing_intent
    ) values (
      gen_random_uuid(), test_org, test_contract_id, original_pdf_url,
      test_org || '/processed/' || test_contract_id || '/duplicate.pdf',
      'queued', 1250, 0, repeat('a', 64), 'preserve',
      'google-vision-direct-v1', test_run_id, source_job_id,
      'direct_vision_geometry_backfill_v1'
    );
  exception when unique_violation then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then
    raise exception 'Geometry recovery regression: concurrent active generation was accepted';
  end if;

  select * into recovery_job
  from public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30);
  if recovery_job.id is distinct from (
      select queued_job_id from public.contract_document_backfill_targets
      where run_id = test_run_id and contract_id = test_contract_id
    )
    or recovery_job.recovery_of_job_id <> initial_job.id
    or public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30) is not null then
    raise exception 'Geometry recovery regression: claim did not follow target pointer';
  end if;

  update public.contract_document_jobs as job
  set output_storage_path = job.org_id::text || '/processed/' || job.contract_id::text
        || '/leases/' || job.lease_token::text || '/normalised.pdf',
      spatial_data_path = job.org_id::text || '/processed/' || job.contract_id::text
        || '/leases/' || job.lease_token::text || '/vision-layout.json.gz'
  where job.id = recovery_job.id;
  select * into recovery_job from public.contract_document_jobs where id = recovery_job.id;
  select * into completed_job from public.finish_contract_document_job_v8(
    recovery_job.id, recovery_job.lease_token, 'completed', 'mixed',
    'google-vision-eu-v1', '[]'::jsonb, true, 1, 500, 0, 1, 0,
    0.99, 0.90, 1.0, repeat('a', 64), repeat('b', 64),
    'google-vision-direct-v1', 'google-vision-spatial-v3', repeat('c', 64),
    null, null, '{"schemaVersion":1,"reasons":[]}'::jsonb
  );
  if completed_job.status <> 'completed'
    or (select outcome from public.contract_document_backfill_targets
      where run_id = test_run_id and contract_id = test_contract_id) <> 'completed'
    or (select status from public.contracts where id = test_contract_id) <> original_contract_status
    or (select pdf_url from public.contracts where id = test_contract_id) <> original_pdf_url
    or exists (select 1 from public.contract_ai_jobs where contract_id = test_contract_id)
    or (select superseded_by_job_id from public.contract_document_jobs
      where id = source_job_id) <> completed_job.id
    or (select superseded_by_job_id from public.contract_document_jobs
      where id = initial_job.id) is not null then
    raise exception 'Geometry recovery regression: completion changed status, AI, original or lineage';
  end if;

  recovery_audit_id := completed_job.backfill_recovery_audit_event_id;
  update public.contract_document_jobs
  set recovery_reason_code = 'unexpected_recovery_reason'
  where id = completed_job.id;
  if private.contract_document_geometry_recovery_chain_valid(
      test_run_id, test_contract_id, completed_job.id, 1
    ) then
    raise exception 'Geometry recovery regression: recovery reason tampering was accepted';
  end if;
  begin
    perform public.complete_contract_document_geometry_backfill_run(
      test_run_id, cohort_digest, repeat('8', 64), 1, 0, 0
    );
    raise exception 'Geometry recovery regression: quality gate accepted reason tampering';
  exception when sqlstate '55000' then
    null;
  end;
  update public.contract_document_jobs
  set recovery_reason_code = 'geometry_quality_recovery_v1'
  where id = completed_job.id;

  update public.contract_document_jobs
  set backfill_recovery_audit_event_id = null
  where id = completed_job.id;
  begin
    perform public.complete_contract_document_geometry_backfill_run(
      test_run_id, cohort_digest, repeat('8', 64), 1, 0, 0
    );
    raise exception 'Geometry recovery regression: quality gate accepted unaudited recovery';
  exception when sqlstate '55000' then
    null;
  end;
  update public.contract_document_jobs
  set backfill_recovery_audit_event_id = recovery_audit_id
  where id = completed_job.id;

  completion_result := public.complete_contract_document_geometry_backfill_run(
    test_run_id, cohort_digest, repeat('9', 64), 1, 0, 0
  );
  select state into completion_state
  from public.contract_document_backfill_runs where id = test_run_id;
  if completion_result is distinct from true or completion_state <> 'completed' then
    raise exception 'Geometry recovery regression: quality gate rejected valid chain (result %, state %)',
      completion_result, completion_state;
  end if;
end;
$$;

select pass('Vision v3 geometry recovery is immutable, pointer-scoped and audit-bound');

select * from finish();
rollback;
