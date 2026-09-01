begin;

select plan(1);

do $$
declare
  test_org uuid := '00000000-0000-4000-8000-000000000101';
  contract_not_required uuid := '10000000-0000-4000-8000-000000000101';
  contract_needs_review uuid := '20000000-0000-4000-8000-000000000101';
  contract_failed uuid := '30000000-0000-4000-8000-000000000101';
  ordinary_contract uuid := '40000000-0000-4000-8000-000000000101';
  source_not_required uuid := '50000000-0000-4000-8000-000000000101';
  source_needs_review uuid := '60000000-0000-4000-8000-000000000101';
  source_failed uuid := '70000000-0000-4000-8000-000000000101';
  ordinary_job uuid := '80000000-0000-4000-8000-000000000101';
  rogue_job uuid := '80000000-0000-4000-8000-000000000102';
  test_run_id uuid := '90000000-0000-4000-8000-000000000101';
  targets jsonb;
  cohort_digest text;
  prepared record;
  claimed_ordinary public.contract_document_jobs;
  claimed_one public.contract_document_jobs;
  claimed_two public.contract_document_jobs;
  claimed_three public.contract_document_jobs;
  target_one public.contract_document_backfill_targets;
  target_two public.contract_document_backfill_targets;
  target_three public.contract_document_backfill_targets;
  completed_job public.contract_document_jobs;
  completion_result boolean;
begin
  if has_table_privilege('authenticated', 'public.contract_document_backfill_runs', 'SELECT')
    or has_table_privilege('authenticated', 'public.contract_document_backfill_targets', 'SELECT')
    or has_function_privilege('authenticated', 'public.prepare_contract_document_geometry_backfill_run(uuid,integer,text,jsonb,integer,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_next_contract_document_geometry_backfill_job(uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.complete_contract_document_geometry_backfill_run(uuid,text,text,integer,integer,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.prepare_contract_document_geometry_backfill_run(uuid,integer,text,jsonb,integer,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.claim_next_contract_document_geometry_backfill_job(uuid,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.complete_contract_document_geometry_backfill_run(uuid,text,text,integer,integer,integer)', 'EXECUTE') then
    raise exception 'Geometry backfill regression: privileged API exposure';
  end if;
  if has_table_privilege('service_role', 'public.contract_document_backfill_runs', 'INSERT')
    or has_table_privilege('service_role', 'public.contract_document_backfill_runs', 'UPDATE')
    or has_table_privilege('service_role', 'public.contract_document_backfill_targets', 'INSERT')
    or has_table_privilege('service_role', 'public.contract_document_backfill_targets', 'UPDATE') then
    raise exception 'Geometry backfill regression: service role can bypass the audited mutation API';
  end if;
  if position('for update of backfill_run' in lower(pg_get_functiondef(
      'public.claim_next_contract_document_geometry_backfill_job(uuid,integer)'::regprocedure
    ))) = 0
    or position('for update of backfill_run' in lower(pg_get_functiondef(
      'public.finish_contract_document_job_v8(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)'::regprocedure
    ))) = 0 then
    raise exception 'Geometry backfill regression: terminal accounting is not serialized by run';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Geometry backfill ' || test_org::text);
  perform set_config('app.explicit_contract_validation', 'on', true);
  insert into public.contracts(
    id, org_id, type, status, pdf_url, document_processing_status,
    document_processing_error_code
  ) values
    (contract_not_required, test_org, 'a-løn', 'valideret',
      test_org || '/' || contract_not_required || '/original.pdf', 'not_required', null),
    (contract_needs_review, test_org, 'a-løn', 'afventer',
      test_org || '/' || contract_needs_review || '/original.pdf', 'needs_review', 'ocr_spatial_quality'),
    (contract_failed, test_org, 'a-løn', 'kladde',
      test_org || '/' || contract_failed || '/original.pdf', 'failed', 'document_processing_failed');
  perform set_config('app.explicit_contract_validation', 'off', true);
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, original_sha256, page_count, error_code
  ) values
    (source_not_required, test_org, contract_not_required,
      test_org || '/' || contract_not_required || '/original.pdf',
      test_org || '/processed/' || contract_not_required || '/source.pdf',
      'not_required', 100, 1, repeat('a', 64), 1, null),
    (source_needs_review, test_org, contract_needs_review,
      test_org || '/' || contract_needs_review || '/original.pdf',
      test_org || '/processed/' || contract_needs_review || '/source.pdf',
      'needs_review', 100, 1, repeat('b', 64), 2, 'ocr_spatial_quality'),
    (source_failed, test_org, contract_failed,
      test_org || '/' || contract_failed || '/original.pdf',
      test_org || '/processed/' || contract_failed || '/source.pdf',
      'failed', 100, 5, repeat('c', 64), 3, 'document_processing_failed');

  targets := jsonb_build_array(
    jsonb_build_object(
      'contractId', contract_not_required,
      'sourceJobId', source_not_required,
      'originalSha256', repeat('a', 64),
      'originalPageCount', 1,
      'originalPathDigest', private.contract_document_path_digest(
        test_org || '/' || contract_not_required || '/original.pdf'
      ),
      'contractStatus', 'valideret',
      'priorProcessingStatus', 'not_required'
    ),
    jsonb_build_object(
      'contractId', contract_needs_review,
      'sourceJobId', source_needs_review,
      'originalSha256', repeat('b', 64),
      'originalPageCount', 2,
      'originalPathDigest', private.contract_document_path_digest(
        test_org || '/' || contract_needs_review || '/original.pdf'
      ),
      'contractStatus', 'afventer',
      'priorProcessingStatus', 'needs_review'
    ),
    jsonb_build_object(
      'contractId', contract_failed,
      'sourceJobId', source_failed,
      'originalSha256', repeat('c', 64),
      'originalPageCount', 3,
      'originalPathDigest', private.contract_document_path_digest(
        test_org || '/' || contract_failed || '/original.pdf'
      ),
      'contractStatus', 'kladde',
      'priorProcessingStatus', 'failed'
    )
  );
  select encode(extensions.digest(string_agg(
    lower(target ->> 'contractId') || '|'
      || lower(target ->> 'sourceJobId') || '|'
      || lower(target ->> 'originalSha256') || '|'
      || ((target ->> 'originalPageCount')::integer)::text || '|'
      || lower(target ->> 'originalPathDigest') || '|'
      || (target ->> 'contractStatus') || '|'
      || (target ->> 'priorProcessingStatus'),
    E'\n' order by lower(target ->> 'contractId')
  ), 'sha256'), 'hex') into cohort_digest
  from jsonb_array_elements(targets) as rows(target);

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into prepared
  from public.prepare_contract_document_geometry_backfill_run(
    test_run_id, 3, cohort_digest, targets, 1200, null
  );
  if prepared.outcome <> 'queued' or prepared.queued_count <> 3
    or (select count(*) from public.contract_document_backfill_targets where run_id = test_run_id) <> 3
    or (select count(*) from public.contract_document_jobs where backfill_run_id = test_run_id) <> 3
    or not exists (
      select 1 from public.contract_document_backfill_runs as run
      where run.id = test_run_id and run.audit_event_id is not null
        and public.verify_audit_event_subjects(run.audit_event_id)
    ) then
    raise exception 'Geometry backfill regression: preparation was not atomic';
  end if;
  select * into prepared
  from public.prepare_contract_document_geometry_backfill_run(
    test_run_id, 3, cohort_digest, targets, 1200, null
  );
  if prepared.outcome <> 'already_prepared' or prepared.queued_count <> 3 then
    raise exception 'Geometry backfill regression: exact preparation retry was not idempotent';
  end if;
  if (select document_processing_status from public.contracts where id = contract_not_required) <> 'not_required'
    or (select document_processing_status from public.contracts where id = contract_needs_review) <> 'needs_review'
    or (select document_processing_status from public.contracts where id = contract_failed) <> 'failed' then
    raise exception 'Geometry backfill regression: preparation changed live contract state';
  end if;

  insert into public.contracts(id, org_id, type, status, pdf_url, document_processing_status)
  values (ordinary_contract, test_org, 'a-løn', 'kladde',
    test_org || '/' || ordinary_contract || '/original.pdf', 'pending');
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, next_attempt_at, original_sha256
  ) values (
    ordinary_job, test_org, ordinary_contract,
    test_org || '/' || ordinary_contract || '/original.pdf',
    test_org || '/processed/' || ordinary_contract || '/ordinary.pdf',
    'queued', 1, 0, now(), repeat('d', 64)
  );
  select * into claimed_ordinary from public.claim_next_contract_document_job(30);
  if claimed_ordinary.id <> ordinary_job
    or (select count(*) from public.contract_document_jobs
      where backfill_run_id = test_run_id and status <> 'queued') <> 0 then
    raise exception 'Geometry backfill regression: ordinary claim crossed cohort fence';
  end if;

  select * into claimed_one
  from public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30);
  select * into claimed_two
  from public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30);
  select * into claimed_three
  from public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30);
  if claimed_one.id is null or claimed_two.id is null or claimed_three.id is null
    or claimed_one.id in (claimed_two.id, claimed_three.id)
    or claimed_two.id = claimed_three.id then
    raise exception 'Geometry backfill regression: parallel claims were not distinct';
  end if;
  select * into target_one from public.contract_document_backfill_targets
    where queued_job_id = claimed_one.id;
  select * into target_two from public.contract_document_backfill_targets
    where queued_job_id = claimed_two.id;
  select * into target_three from public.contract_document_backfill_targets
    where queued_job_id = claimed_three.id;

  update public.contract_document_jobs as job
  set output_storage_path = job.org_id::text || '/processed/' || job.contract_id::text
        || '/leases/' || job.lease_token::text || '/normalised.pdf',
      spatial_data_path = job.org_id::text || '/processed/' || job.contract_id::text
        || '/leases/' || job.lease_token::text || '/vision-layout.json.gz'
  where job.id in (claimed_one.id, claimed_two.id, claimed_three.id);

  -- Complete the not_required baseline as a valid direct-Vision v3 derivative.
  select * into claimed_one from public.contract_document_jobs
    where contract_id = contract_not_required and backfill_run_id = test_run_id;
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, original_sha256, created_at
  ) values (
    rogue_job, test_org, contract_not_required,
    test_org || '/' || contract_not_required || '/original.pdf',
    test_org || '/processed/' || contract_not_required || '/rogue.pdf',
    'completed', 1, 1, repeat('a', 64), clock_timestamp() + interval '1 second'
  );
  begin
    perform public.finish_contract_document_job_v8(
      claimed_one.id, claimed_one.lease_token, 'completed', 'mixed',
      'google-vision-eu-v1', '[]'::jsonb, true, 1, 500, 0, 1, 0,
      0.99, 0.90, 1.0, repeat('a', 64), repeat('e', 64),
      'google-vision-direct-v1', 'google-vision-spatial-v3', repeat('f', 64),
      null, null, '{"schemaVersion":1,"reasons":[]}'::jsonb
    );
    raise exception 'Geometry backfill regression: newer generation was accepted';
  exception when sqlstate '55000' then
    null;
  end;
  delete from public.contract_document_jobs where id = rogue_job;
  select * into completed_job from public.finish_contract_document_job_v8(
    claimed_one.id, claimed_one.lease_token, 'completed', 'mixed',
    'google-vision-eu-v1', '[]'::jsonb, true, 1, 500, 0, 1, 0,
    0.99, 0.90, 1.0, repeat('a', 64), repeat('e', 64),
    'google-vision-direct-v1', 'google-vision-spatial-v3', repeat('f', 64),
    null, null, '{"schemaVersion":1,"reasons":[]}'::jsonb
  );
  if completed_job.status <> 'completed'
    or completed_job.output_storage_path = completed_job.original_storage_path
    or (select pdf_url from public.contracts where id = contract_not_required)
      <> test_org || '/' || contract_not_required || '/original.pdf'
    or (select status from public.contracts where id = contract_not_required) <> 'valideret'
    or exists (select 1 from public.contract_ai_jobs where contract_id = contract_not_required)
    or exists (
      select 1 from public.contract_document_artifact_deletions
      where replacement_job_id = completed_job.id
    ) then
    raise exception 'Geometry backfill regression: success changed source, status, AI or deletion state';
  end if;

  select * into claimed_two from public.contract_document_jobs
    where contract_id = contract_needs_review and backfill_run_id = test_run_id;
  perform public.finish_contract_document_job_v8(
    claimed_two.id, claimed_two.lease_token, 'needs_review', 'mixed',
    'google-vision-eu-v1', '[]'::jsonb, false, 2, 0, 0, 2, 0,
    null, null, null, repeat('b', 64), null,
    'google-vision-direct-v1', 'google-vision-spatial-v3', null,
    'ocr_spatial_quality', 'Geometrien kræver kontrol.',
    '{"schemaVersion":1,"reasons":[{"code":"ocr_spatial_quality","pageNumbers":[1]}]}'::jsonb
  );
  if (select document_processing_status from public.contracts where id = contract_needs_review) <> 'needs_review'
    or (select document_processing_error_code from public.contracts where id = contract_needs_review) <> 'ocr_spatial_quality' then
    raise exception 'Geometry backfill regression: review result changed prior contract state';
  end if;

  select * into claimed_three from public.contract_document_jobs
    where contract_id = contract_failed and backfill_run_id = test_run_id;
  update public.contract_document_jobs
  set attempts = 5, lease_expires_at = now() - interval '1 minute'
  where id = claimed_three.id;
  if public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30) is not null then
    raise exception 'Geometry backfill regression: exhausted generation was reclaimed';
  end if;
  if (select document_processing_status from public.contracts where id = contract_failed) <> 'failed'
    or (select status from public.contract_document_jobs where id = claimed_three.id) <> 'failed'
    or (select state from public.contract_document_backfill_runs where id = test_run_id) <> 'quality_pending' then
    raise exception 'Geometry backfill regression: terminal accounting or prior state failed';
  end if;
  if public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30) is not null then
    raise exception 'Geometry backfill regression: quality-pending run did not return an empty claim';
  end if;

  completion_result := public.complete_contract_document_geometry_backfill_run(
    test_run_id, cohort_digest, repeat('9', 64), 1, 1, 1
  );
  if completion_result is distinct from true then
    raise exception 'Geometry backfill regression: quality gate returned false';
  end if;
  if (select state from public.contract_document_backfill_runs where id = test_run_id) <> 'completed' then
    raise exception 'Geometry backfill regression: quality gate did not close the run';
  end if;
  if public.claim_next_contract_document_geometry_backfill_job(test_run_id, 30) is not null then
    raise exception 'Geometry backfill regression: completed run did not return an empty claim';
  end if;
  if not exists (
      select 1
      from public.audit_events as event
      where event.correlation_id = test_run_id
        and event.metadata ->> 'event_code' = 'vision_v3_geometry_backfill_quality_approved'
        and public.verify_audit_event_subjects(event.id)
    ) then
    raise exception 'Geometry backfill regression: quality audit event is missing or incomplete';
  end if;
end;
$$;

select pass('Vision v3 geometry backfill is isolated, immutable and quality-gated');

select * from finish();
rollback;
