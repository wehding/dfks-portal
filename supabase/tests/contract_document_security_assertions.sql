begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  actor_id uuid := gen_random_uuid();
  rights_holder_id uuid;
  upload_file_id uuid := gen_random_uuid();
  atomic_upload_file_id uuid := gen_random_uuid();
  deferred_upload_file_id uuid := gen_random_uuid();
  rollback_upload_file_id uuid := gen_random_uuid();
  work_id uuid := gen_random_uuid();
  previous_id uuid := gen_random_uuid();
  current_id uuid := gen_random_uuid();
  job_id uuid := gen_random_uuid();
  second_contract_id uuid := gen_random_uuid();
  third_contract_id uuid := gen_random_uuid();
  second_job_id uuid := gen_random_uuid();
  third_job_id uuid := gen_random_uuid();
  claim_result_one public.contract_document_jobs;
  claim_result_two public.contract_document_jobs;
  claim_result_three public.contract_document_jobs;
  claimed public.contract_document_jobs;
  claimed_second public.contract_document_jobs;
  claimed_third public.contract_document_jobs;
  upload_authorised public.contract_document_jobs;
  stale_upload_authorisation public.contract_document_jobs;
  expected_output_path text;
  expected_spatial_path text;
  abandoned_lease_path text;
  recent_lease_path text;
  invalid_lease_path text;
  active_lease_path text;
  quarantined_lease_path text;
  contract_source_lease_path text;
  job_source_lease_path text;
  attachment_lease_path text;
  cleanup_paths text[];
  invalid_completion_rejected boolean := false;
  upload_intent public.contract_upload_intents;
  consumed_intent public.contract_upload_intents;
  atomic_upload_intent public.contract_upload_intents;
  deferred_upload_intent public.contract_upload_intents;
  rollback_upload_intent public.contract_upload_intents;
  atomic_contract public.contracts;
  deferred_contract public.contracts;
  atomic_finalization_token uuid := gen_random_uuid();
  reclaimed_finalization_token uuid := gen_random_uuid();
  recovery_finalization_token uuid := gen_random_uuid();
  atomic_request_hash text := repeat('1', 64);
  deferred_finalization_token uuid := gen_random_uuid();
  deferred_request_hash text := repeat('2', 64);
  finalization_claim record;
  finalized_contract public.contracts;
  mismatched_finalization_rejected boolean := false;
  atomic_failure_rejected boolean := false;
  expired_finalization_rejected boolean := false;
  cleanup_claim record;
  cleanup_creation_rejected boolean := false;
  cleanup_finished boolean := false;
  cleanup_state text;
  cleanup_token_cleared boolean := false;
  cleanup_object_marked boolean := false;
  cross_contract_path_rejected boolean := false;
  partial_contract_id uuid := gen_random_uuid();
  partial_job_id uuid := gen_random_uuid();
  partial_lease_token uuid := gen_random_uuid();
  partial_output_path text;
  partial_spatial_path text;
  fresh_contract_id uuid := gen_random_uuid();
  fresh_job_id uuid := gen_random_uuid();
  fresh_lease_token uuid := gen_random_uuid();
  fresh_output_path text;
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_attribute as attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attnum = any (constraint_row.conkey)
    where constraint_row.conrelid = 'public.contract_upload_intents'::regclass
      and constraint_row.contype = 'f'
      and attribute_row.attname in ('owner_id', 'org_id', 'rights_holder_id')
      and constraint_row.confdeltype <> 'n'
  ) then
    raise exception 'Upload intent regression: identity deletion can remove a storage-cleanup tombstone';
  end if;
  if (
    select count(*)
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_attribute as attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attnum = any (constraint_row.conkey)
    where constraint_row.conrelid = 'public.contract_upload_intents'::regclass
      and constraint_row.contype = 'f'
      and attribute_row.attname in ('owner_id', 'org_id', 'rights_holder_id')
  ) <> 3 then
    raise exception 'Upload intent regression: cleanup tombstone identity constraints are incomplete';
  end if;
  if has_table_privilege('anon', 'public.contract_document_jobs', 'SELECT')
    or has_table_privilege('authenticated', 'public.contract_document_jobs', 'SELECT')
    or has_function_privilege('authenticated', 'public.claim_next_contract_document_job(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_next_direct_vision_replacement_job(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.requeue_direct_vision_not_required_replacements()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job(uuid,text,jsonb,boolean,integer,integer,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v2(uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v3(uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.renew_contract_document_job_lease(uuid,uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.authorise_contract_document_job_upload(uuid,uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.list_abandoned_contract_document_lease_artifacts(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v4(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v5(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v7(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v8(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.prepare_contract_document_geometry_backfill_run(uuid,integer,text,jsonb,integer,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.queue_contract_document_geometry_backfill_recovery(uuid,text,jsonb,integer,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_next_contract_document_geometry_backfill_job(uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.complete_contract_document_geometry_backfill_run(uuid,text,text,integer,integer,integer)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.contract_document_backfill_runs', 'SELECT')
    or has_table_privilege('authenticated', 'public.contract_document_backfill_targets', 'SELECT')
    or has_function_privilege('authenticated', 'public.queue_direct_vision_replacement_generation(uuid,text,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_contract_document_artifact_deletions(integer,uuid)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.contract_document_artifact_deletions', 'SELECT')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v6(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.queue_contract_document_job_automatic_recovery(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.queue_contract_document_job_automatic_recovery_batch(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.admin_contract_document_review_action(uuid,uuid,text,uuid)', 'EXECUTE')
    or has_table_privilege('anon', 'public.contract_upload_intents', 'SELECT')
    or has_table_privilege('authenticated', 'public.contract_upload_intents', 'SELECT')
    or has_function_privilege('authenticated', 'public.create_contract_upload_intent(uuid,uuid,uuid,text,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.consume_contract_upload_intent(uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.create_member_uploaded_contract(uuid,uuid,uuid,uuid,text,bigint,text,uuid,integer,integer[],boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.rollback_member_uploaded_contract(uuid,uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_member_uploaded_contract_finalization(uuid,uuid,uuid,uuid,uuid,text,text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_member_uploaded_contract_finalization(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb,uuid,integer,text,integer[],boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_contract_upload_intent_cleanup(text,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_upload_intent_cleanup(uuid,uuid,text,boolean)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.finish_contract_document_job_v3(uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.finish_contract_document_job_v4(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.finish_contract_document_job(uuid,text,jsonb,boolean,integer,integer,text,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.finish_contract_document_job_v2(uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.finish_contract_document_job_v5(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.finish_contract_document_job_v6(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.finish_contract_document_job_v7(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.finish_contract_document_job_v8(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,numeric,numeric,numeric,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.prepare_contract_document_geometry_backfill_run(uuid,integer,text,jsonb,integer,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.queue_contract_document_geometry_backfill_recovery(uuid,text,jsonb,integer,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.claim_next_contract_document_geometry_backfill_job(uuid,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.complete_contract_document_geometry_backfill_run(uuid,text,text,integer,integer,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.claim_next_direct_vision_replacement_job(integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.requeue_direct_vision_not_required_replacements()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.queue_contract_document_job_automatic_recovery(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.queue_contract_document_job_automatic_recovery_batch(integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.admin_contract_document_review_action(uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'Document queue regression: browser roles can access the server-only queue';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and (coalesce(qual, '') ilike '%kontrakter%'
        or coalesce(with_check, '') ilike '%kontrakter%')
  ) then
    raise exception 'Contract storage regression: browser roles can access contract bytes directly';
  end if;
  if exists (select 1 from storage.buckets where id = 'kontrakter' and public) then
    raise exception 'Contract storage regression: contract bucket is public';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'kontrakter' and file_size_limit is not null and file_size_limit <= 26214400
  ) then
    raise exception 'Contract storage regression: bucket upload limit exceeds 25 MB';
  end if;

  insert into public.organisations (id, name) values (test_org, 'Document security test ' || test_org::text);
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (actor_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', actor_id || '@example.invalid', '', now(), now());
  select id into rights_holder_id from public.rettighedshavere where user_id = actor_id;
  if rights_holder_id is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (actor_id, 'Document test actor', actor_id || '@example.invalid')
    returning id into rights_holder_id;
  end if;
  insert into public.org_affiliations(org_id, rights_holder_id, is_member)
  values (test_org, rights_holder_id, true);
  insert into public.works (id, org_id, title, type) values (work_id, test_org, 'Versionsværk', 'fiktion');
  insert into public.contracts (id, org_id, work_id, type, status, pdf_url)
  values
    (previous_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/previous.pdf'),
    (current_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/current.pdf');

  perform set_config('request.jwt.claim.role', 'service_role', true);

  select * into upload_intent from public.create_contract_upload_intent(
    actor_id,
    test_org,
    rights_holder_id,
    test_org || '/' || actor_id || '/' || upload_file_id || '.pdf',
    1024
  );
  if upload_intent.id is null or upload_intent.expires_at <= now()
    or upload_intent.expected_size <> 1024 or upload_intent.consumed_at is not null
    or upload_intent.purge_after < upload_intent.created_at + interval '2 hours 15 minutes'
    or upload_intent.purge_after < upload_intent.expires_at
    or upload_intent.expired_object_cleanup_at is not null then
    raise exception 'Upload intent regression: secure intent was not created';
  end if;
  select * into consumed_intent from public.consume_contract_upload_intent(
    actor_id, upload_intent.storage_path
  );
  if consumed_intent.id is null or consumed_intent.consumed_at is null then
    raise exception 'Upload intent regression: intent was not consumed atomically';
  end if;
  select * into consumed_intent from public.consume_contract_upload_intent(
    actor_id, upload_intent.storage_path
  );
  if consumed_intent.id is not null then
    raise exception 'Upload intent regression: intent was consumed twice';
  end if;

  select * into atomic_upload_intent from public.create_contract_upload_intent(
    actor_id, test_org, rights_holder_id,
    test_org || '/' || actor_id || '/' || atomic_upload_file_id || '.pdf', 2048
  );
  select * into atomic_contract from public.create_member_uploaded_contract(
    actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
    atomic_upload_intent.storage_path, 2048, 'Atomisk upload', work_id,
    null, null, false
  );
  if atomic_contract.id is null
    or atomic_contract.status <> 'kladde'
    or atomic_contract.pdf_url <> atomic_upload_intent.storage_path
    or not exists (
      select 1 from public.contract_document_jobs
      where contract_id = atomic_contract.id and status = 'queued'
        and original_storage_path = atomic_upload_intent.storage_path
    )
    or not exists (
      select 1 from public.contract_upload_intents
      where id = atomic_upload_intent.id and consumed_at is not null
        and contract_id = atomic_contract.id
    ) then
    raise exception 'Upload commit regression: PDF contract and OCR job were not committed atomically';
  end if;
  if (select id from public.create_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_upload_intent.storage_path, 2048, 'Atomisk upload', work_id,
      null, null, false
    )) <> atomic_contract.id
    or (select count(*) from public.contract_document_jobs where contract_id = atomic_contract.id) <> 1 then
    raise exception 'Upload commit regression: retry created a duplicate contract or OCR job';
  end if;
  -- Even if the original long park has elapsed, an untouched queue row may be
  -- atomically re-parked before finalization. It must remain unclaimable for
  -- the full finalization lease.
  update public.contract_document_jobs
  set next_attempt_at = now()
  where contract_id = atomic_contract.id;
  select * into finalization_claim
  from public.claim_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
    atomic_contract.id, atomic_upload_intent.storage_path,
    atomic_request_hash, atomic_finalization_token
  );
  if finalization_claim.outcome <> 'claimed'
    or finalization_claim.finalization_token <> atomic_finalization_token
    or not exists (
      select 1 from public.contract_document_jobs
      where contract_id = atomic_contract.id
        and next_attempt_at > now() + interval '9 minutes'
    ) then
    raise exception 'Upload finalization regression: first caller did not receive the lease';
  end if;
  select * into finalization_claim
  from public.claim_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
    atomic_contract.id, atomic_upload_intent.storage_path,
    atomic_request_hash, gen_random_uuid()
  );
  if finalization_claim.outcome <> 'in_progress'
    or public.rollback_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_contract.id, atomic_upload_intent.storage_path, gen_random_uuid()
    ) then
    raise exception 'Upload finalization regression: concurrent caller acquired or rolled back the upload';
  end if;
  update public.contract_upload_intents
  set finalization_claimed_at = now() - interval '11 minutes'
  where id = atomic_upload_intent.id;
  select * into finalization_claim
  from public.claim_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
    atomic_contract.id, atomic_upload_intent.storage_path,
    atomic_request_hash, reclaimed_finalization_token
  );
  if finalization_claim.outcome <> 'claimed'
    or finalization_claim.finalization_token <> reclaimed_finalization_token
    or public.rollback_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_contract.id, atomic_upload_intent.storage_path, atomic_finalization_token
    ) then
    raise exception 'Upload finalization regression: crashed request was not safely reclaimed';
  end if;
  atomic_finalization_token := reclaimed_finalization_token;

  -- Once a parked worker row has moved, an expired finalization lease may not
  -- be reclaimed or completed. The original and draft remain for service/manual
  -- recovery instead of being rolled back under an uncertain worker outcome.
  update public.contract_upload_intents
  set finalization_claimed_at = now() - interval '11 minutes'
  where id = atomic_upload_intent.id;
  update public.contract_document_jobs
  set status = 'processing', attempts = 1, lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '30 minutes'
  where contract_id = atomic_contract.id;
  select * into finalization_claim
  from public.claim_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
    atomic_contract.id, atomic_upload_intent.storage_path,
    atomic_request_hash, recovery_finalization_token
  );
  begin
    perform public.finish_member_uploaded_contract_finalization(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_contract.id, atomic_upload_intent.storage_path,
      atomic_finalization_token, atomic_request_hash,
      null, '{}'::jsonb, null, null, null, null, false
    );
  exception when sqlstate 'P0002' then
    expired_finalization_rejected := true;
  end;
  if finalization_claim.outcome <> 'recovery_required'
    or not expired_finalization_rejected then
    raise exception 'Upload finalization regression: touched worker state was reclaimed or completed';
  end if;
  if public.rollback_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_contract.id, atomic_upload_intent.storage_path, atomic_finalization_token
    )
    or not exists (select 1 from public.contracts where id = atomic_contract.id)
    or not exists (select 1 from public.contract_document_jobs where contract_id = atomic_contract.id) then
    raise exception 'Upload rollback regression: an already claimed document job was deleted';
  end if;
  update public.contract_document_jobs
  set status = 'queued', attempts = 0, lease_token = null, lease_expires_at = null
  where contract_id = atomic_contract.id;
  select * into finalization_claim
  from public.claim_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
    atomic_contract.id, atomic_upload_intent.storage_path,
    atomic_request_hash, recovery_finalization_token
  );
  if finalization_claim.outcome <> 'claimed' then
    raise exception 'Upload finalization regression: safe manual retry could not reclaim parked work';
  end if;
  atomic_finalization_token := recovery_finalization_token;
  if public.rollback_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_contract.id, atomic_upload_intent.storage_path || '.wrong', atomic_finalization_token
    )
    or not exists (select 1 from public.contracts where id = atomic_contract.id)
    or not exists (select 1 from public.contract_document_jobs where contract_id = atomic_contract.id) then
    raise exception 'Upload rollback regression: mismatched identity deleted committed state';
  end if;
  if not public.rollback_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_contract.id, atomic_upload_intent.storage_path, atomic_finalization_token
    ) then
    raise exception 'Upload rollback regression: verified rollback returned false';
  end if;
  if exists (select 1 from public.contracts where id = atomic_contract.id) then
    raise exception 'Upload rollback regression: draft remained after confirmed rollback';
  end if;
  if exists (select 1 from public.contract_document_jobs where contract_id = atomic_contract.id) then
    raise exception 'Upload rollback regression: document job remained after confirmed rollback';
  end if;
  if not exists (
      select 1 from public.contract_upload_intents
      where id = atomic_upload_intent.id
        and contract_id is null
        and consumed_at is not null
        and expires_at <= now()
        and cleanup_status = 'pending'
        and cleanup_claim_token is null
    ) then
    raise exception 'Upload rollback regression: intent did not become an expired unlinked tombstone';
  end if;
  if public.rollback_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, atomic_upload_intent.id,
      atomic_contract.id, atomic_upload_intent.storage_path, atomic_finalization_token
    ) then
    raise exception 'Upload rollback regression: the same draft was rolled back twice';
  end if;

  select * into deferred_upload_intent from public.create_contract_upload_intent(
    actor_id, test_org, rights_holder_id,
    test_org || '/' || actor_id || '/' || deferred_upload_file_id || '.docx', 2048
  );
  select * into deferred_contract from public.create_member_uploaded_contract(
    actor_id, test_org, rights_holder_id, deferred_upload_intent.id,
    deferred_upload_intent.storage_path, 2048, 'Udsat AI-upload', work_id,
    null, null, true
  );
  if deferred_contract.id is null
    or exists (select 1 from public.contract_document_jobs where contract_id = deferred_contract.id)
    or exists (select 1 from public.contract_ai_jobs where contract_id = deferred_contract.id) then
    raise exception 'Upload commit regression: deferred non-PDF flow changed behavior';
  end if;
  select * into finalization_claim
  from public.claim_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, deferred_upload_intent.id,
    deferred_contract.id, deferred_upload_intent.storage_path,
    deferred_request_hash, deferred_finalization_token
  );
  select * into finalized_contract
  from public.finish_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, deferred_upload_intent.id,
    deferred_contract.id, deferred_upload_intent.storage_path,
    deferred_finalization_token, deferred_request_hash,
    '{"submittedByMember":true}'::jsonb, '{}'::jsonb,
    null, null, null, null, false
  );
  if finalized_contract.id <> deferred_contract.id
    or not exists (
      select 1 from public.contract_upload_intents
      where id = deferred_upload_intent.id
        and finalization_status = 'finalized'
        and finalization_token is null
        and finalization_request_hash = deferred_request_hash
    )
    or not exists (
      select 1 from public.contract_validations
      where contract_id = deferred_contract.id
        and notes::jsonb @> '{"submittedByMember":true}'::jsonb
    ) then
    raise exception 'Upload finalization regression: completion was not atomic';
  end if;
  select * into finalization_claim
  from public.claim_member_uploaded_contract_finalization(
    actor_id, test_org, rights_holder_id, deferred_upload_intent.id,
    deferred_contract.id, deferred_upload_intent.storage_path,
    deferred_request_hash, gen_random_uuid()
  );
  if finalization_claim.outcome <> 'already_finalized'
    or public.rollback_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, deferred_upload_intent.id,
      deferred_contract.id, deferred_upload_intent.storage_path, deferred_finalization_token
    ) then
    raise exception 'Upload finalization regression: completed request was not idempotent or could be rolled back';
  end if;
  begin
    perform public.claim_member_uploaded_contract_finalization(
      actor_id, test_org, rights_holder_id, deferred_upload_intent.id,
      deferred_contract.id, deferred_upload_intent.storage_path,
      repeat('3', 64), gen_random_uuid()
    );
  exception when sqlstate 'P0002' then
    mismatched_finalization_rejected := true;
  end;
  if not mismatched_finalization_rejected then
    raise exception 'Upload finalization regression: changed request reused finalized upload';
  end if;

  select * into rollback_upload_intent from public.create_contract_upload_intent(
    actor_id, test_org, rights_holder_id,
    test_org || '/' || actor_id || '/' || rollback_upload_file_id || '.pdf', 2048
  );
  begin
    perform public.create_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, rollback_upload_intent.id,
      rollback_upload_intent.storage_path, 2048, 'Rollback upload', gen_random_uuid(),
      null, null, false
    );
  exception when foreign_key_violation then
    atomic_failure_rejected := true;
  end;
  if not atomic_failure_rejected
    or exists (select 1 from public.contracts where pdf_url = rollback_upload_intent.storage_path)
    or exists (
      select 1 from public.contract_upload_intents
      where id = rollback_upload_intent.id
        and (consumed_at is not null or contract_id is not null)
    ) then
    raise exception 'Upload commit regression: failed transaction left partial database state';
  end if;

  update public.contract_upload_intents
  set expires_at = now() - interval '1 minute'
  where id = rollback_upload_intent.id;
  select * into cleanup_claim
  from public.claim_contract_upload_intent_cleanup('expired', 1, 300);
  if cleanup_claim.intent_id <> rollback_upload_intent.id
    or cleanup_claim.cleanup_claim_token is null
    or cleanup_claim.cleanup_kind <> 'expired'
    or not exists (
      select 1 from public.contract_upload_intents
      where id = rollback_upload_intent.id
        and cleanup_status = 'claimed'
        and cleanup_claim_token = cleanup_claim.cleanup_claim_token
    ) then
    raise exception 'Upload cleanup regression: expired intent was not atomically claimed';
  end if;
  begin
    perform public.create_member_uploaded_contract(
      actor_id, test_org, rights_holder_id, rollback_upload_intent.id,
      rollback_upload_intent.storage_path, 2048, 'Cleanup race upload', work_id,
      null, null, false
    );
  exception when sqlstate 'P0002' then
    cleanup_creation_rejected := sqlerrm = 'upload intent cleanup in progress';
  end;
  if not cleanup_creation_rejected then
    raise exception 'Upload cleanup regression: contract creation accepted a cleanup-claimed intent';
  end if;
  cleanup_finished := public.finish_contract_upload_intent_cleanup(
    rollback_upload_intent.id, cleanup_claim.cleanup_claim_token, 'expired', false
  );
  select cleanup_status, cleanup_claim_token is null
  into cleanup_state, cleanup_token_cleared
  from public.contract_upload_intents
  where id = rollback_upload_intent.id;
  if not cleanup_finished or cleanup_state <> 'pending' or not cleanup_token_cleared then
    raise exception 'Upload cleanup regression: failed storage cleanup was not released for retry (finished %, status %, token cleared %)',
      cleanup_finished, cleanup_state, cleanup_token_cleared;
  end if;
  select * into cleanup_claim
  from public.claim_contract_upload_intent_cleanup('expired', 1, 300);
  cleanup_finished := public.finish_contract_upload_intent_cleanup(
    rollback_upload_intent.id, cleanup_claim.cleanup_claim_token, 'expired', true
  );
  select cleanup_status, expired_object_cleanup_at is not null
  into cleanup_state, cleanup_object_marked
  from public.contract_upload_intents
  where id = rollback_upload_intent.id;
  if cleanup_claim.intent_id <> rollback_upload_intent.id
    or not cleanup_finished
    or cleanup_state <> 'completed'
    or not cleanup_object_marked then
    raise exception 'Upload cleanup regression: successful cleanup was not persisted';
  end if;
  if position('for update skip locked' in lower(pg_get_functiondef(
      'public.claim_contract_upload_intent_cleanup(text,integer,integer)'::regprocedure
    ))) = 0
    or position('for update' in lower(pg_get_functiondef(
      'public.create_member_uploaded_contract(uuid,uuid,uuid,uuid,text,bigint,text,uuid,integer,integer[],boolean)'::regprocedure
    ))) = 0 then
    raise exception 'Upload cleanup regression: cleanup and creation do not share row locks';
  end if;

  -- The upload assertions above have their own queue row. Remove their
  -- rolled-back fixtures before the independent three-worker claim test.
  delete from public.contracts where id in (atomic_contract.id, deferred_contract.id);

  perform public.link_contract_version(previous_id, current_id, actor_id);
  if not exists (select 1 from public.contracts where id = previous_id and superseded_by_contract_id = current_id) then
    raise exception 'Version regression: previous contract was not linked';
  end if;

  insert into public.contract_document_jobs (id, org_id, contract_id, original_storage_path, output_storage_path, spatial_data_path)
  values (job_id, test_org, current_id, test_org || '/current.pdf', test_org || '/processed/current.pdf', test_org || '/processed/vision-layout.json.gz');
  insert into public.contracts (id, org_id, work_id, type, status, pdf_url)
  values
    (second_contract_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/second.pdf'),
    (third_contract_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/third.pdf');
  insert into public.contract_document_jobs (id, org_id, contract_id, original_storage_path, output_storage_path)
  values
    (second_job_id, test_org, second_contract_id, test_org || '/second.pdf', test_org || '/processed/second.pdf'),
    (third_job_id, test_org, third_contract_id, test_org || '/third.pdf', test_org || '/processed/third.pdf');
  select * into claim_result_one from public.claim_next_contract_document_job(10);
  select * into claim_result_two from public.claim_next_contract_document_job(10);
  select * into claim_result_three from public.claim_next_contract_document_job(10);
  if claim_result_one.id is null or claim_result_two.id is null or claim_result_three.id is null
    or claim_result_one.id = claim_result_two.id
    or claim_result_one.id = claim_result_three.id
    or claim_result_two.id = claim_result_three.id then
    raise exception 'Document queue regression: parallel claims did not return three distinct jobs';
  end if;
  -- created_at values can tie inside this transaction, so map each claim back
  -- to the fixture by job id instead of assuming positional claim order.
  select * into claimed from public.contract_document_jobs where id = job_id;
  select * into claimed_second from public.contract_document_jobs where id = second_job_id;
  select * into claimed_third from public.contract_document_jobs where id = third_job_id;
  if claimed.id is null or claimed_second.id is null or claimed_third.id is null
    or claimed.status <> 'processing' or claimed_second.status <> 'processing' or claimed_third.status <> 'processing'
    or claimed.lease_token is null or claimed_second.lease_token is null or claimed_third.lease_token is null
    or claimed.lease_token = claimed_second.lease_token or claimed.lease_token = claimed_third.lease_token
    or claimed_second.lease_token = claimed_third.lease_token then
    raise exception 'Document queue regression: job was not claimed safely';
  end if;
  if position('for update skip locked' in lower(pg_get_functiondef('public.claim_next_contract_document_job(integer)'::regprocedure))) = 0 then
    raise exception 'Document queue regression: parallel claims are not protected by SKIP LOCKED';
  end if;
  if not public.renew_contract_document_job_lease(job_id, (select lease_token from public.contract_document_jobs where id = job_id), 30) then
    raise exception 'Lease regression: active owner could not renew document lease';
  end if;
  if public.renew_contract_document_job_lease(job_id, gen_random_uuid(), 30) then
    raise exception 'Lease regression: stale owner renewed document lease';
  end if;
  select * into upload_authorised
  from public.authorise_contract_document_job_upload(
    second_job_id, claimed_second.lease_token, 30
  );
  if upload_authorised.id <> second_job_id
    or upload_authorised.lease_token <> claimed_second.lease_token
    or upload_authorised.last_upload_authorised_at is null
    or upload_authorised.lease_expires_at <= now() then
    raise exception 'Upload authorisation regression: active lease was not atomically quarantined';
  end if;
  select * into stale_upload_authorisation
  from public.authorise_contract_document_job_upload(
    second_job_id, gen_random_uuid(), 30
  );
  if stale_upload_authorisation.id is not null then
    raise exception 'Upload authorisation regression: stale lease received upload authority';
  end if;
  expected_output_path := test_org || '/processed/' || current_id || '/leases/' || claimed.lease_token || '/normalised.pdf';
  expected_spatial_path := test_org || '/processed/' || current_id || '/leases/' || claimed.lease_token || '/vision-layout.json.gz';
  update public.contract_document_jobs
  set output_storage_path = expected_output_path,
      spatial_data_path = expected_spatial_path
  where id = job_id and lease_token = claimed.lease_token;
  perform public.finish_contract_document_job_v4(
    job_id, (select lease_token from public.contract_document_jobs where id = job_id),
    'completed', 'image_only', 'google-vision-eu-v1', '[]'::jsonb,
    true, 2, 1000, 0, 2, 0, '{"DENMARK_CPR_NUMBER": 1}'::jsonb,
    0.99, 0.90, 1.0, repeat('a', 64), repeat('b', 64),
    'dfks-contract-redaction-v1', 'google-vision-spatial-v2', repeat('c', 64), null, null
  );
  if not exists (
    select 1 from public.contracts
    where id = current_id and pdf_url = test_org || '/current.pdf'
      and processed_pdf_url = expected_output_path
      and document_processing_status = 'ready'
      and document_ocr_engine = 'google-vision-eu-v1'
      and document_spatial_data_path = expected_spatial_path
      and document_redaction_profile = 'dfks-contract-redaction-v1'
      and document_spatial_schema_version = 'google-vision-spatial-v2'
      and exists (
        select 1 from public.contract_document_jobs as completed_job
        where completed_job.id = job_id
          and completed_job.spatial_sha256 = repeat('c', 64)
      )
      and status = 'kladde'
  ) then
    raise exception 'Document queue regression: original or derivative state is incorrect';
  end if;
  if not exists (
    select 1 from public.contract_ai_jobs
    where contract_id = current_id and attachment_id is null and status = 'queued'
  ) then
    raise exception 'Document queue regression: completed OCR did not atomically queue AI analysis';
  end if;
  if (select count(*) from public.contract_ai_jobs
      where contract_id = current_id and attachment_id is null and status = 'queued') <> 1 then
    raise exception 'Document queue regression: completed OCR did not create exactly one active AI job';
  end if;

  -- A valid lease token is insufficient if the service accidentally supplies
  -- another contract's prefix. Completion must bind both derivative paths to
  -- the claimed job's own organisation and contract.
  update public.contract_document_jobs
  set output_storage_path = test_org || '/processed/' || current_id || '/leases/'
        || claimed_third.lease_token || '/normalised.pdf',
      spatial_data_path = test_org || '/processed/' || current_id || '/leases/'
        || claimed_third.lease_token || '/vision-layout.json.gz'
  where id = third_job_id;
  begin
    perform public.finish_contract_document_job_v4(
      third_job_id, claimed_third.lease_token,
      'completed', 'image_only', 'google-vision-eu-v1', '[]'::jsonb,
      true, 1, 500, 0, 1, 0, '{}'::jsonb,
      0.99, 0.90, 1.0, repeat('d', 64), repeat('e', 64),
      'dfks-contract-redaction-v1', 'google-vision-spatial-v2', repeat('f', 64), null, null
    );
  exception when sqlstate '22023' then
    cross_contract_path_rejected := true;
  end;
  if not cross_contract_path_rejected then
    raise exception 'Document queue regression: cross-contract derivative prefix was accepted';
  end if;

  perform public.finish_contract_document_job_v4(
    second_job_id, (select lease_token from public.contract_document_jobs where id = second_job_id),
    'not_required', 'native_text', null, '[]'::jsonb,
    false, 1, 750, 1, 0, 0, '{}'::jsonb,
    null, null, null, repeat('c', 64), null, null, null, null, null
  );
  if not exists (
    select 1 from public.contracts
    where id = second_contract_id
      and pdf_url = test_org || '/second.pdf'
      and processed_pdf_url is null
      and document_processing_status = 'not_required'
      and status = 'kladde'
  ) then
    raise exception 'Document queue regression: native PDF was modified or misclassified';
  end if;

  partial_output_path := test_org || '/processed/' || partial_contract_id
    || '/leases/' || partial_lease_token || '/normalised.pdf';
  partial_spatial_path := test_org || '/processed/' || partial_contract_id
    || '/leases/' || partial_lease_token || '/vision-layout.json.gz';
  fresh_output_path := test_org || '/processed/' || fresh_contract_id
    || '/leases/' || fresh_lease_token || '/normalised.pdf';
  insert into public.contracts(id, org_id, work_id, type, status, pdf_url)
  values
    (partial_contract_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/partial-original.pdf'),
    (fresh_contract_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/fresh-original.pdf');
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    spatial_data_path, status, attempts, last_upload_authorised_at
  ) values
    (partial_job_id, test_org, partial_contract_id, test_org || '/partial-original.pdf',
      partial_output_path, partial_spatial_path, 'needs_review', 1, now() - interval '4 hours'),
    (fresh_job_id, test_org, fresh_contract_id, test_org || '/fresh-original.pdf',
      fresh_output_path, null, 'needs_review', 1, now());

  -- Exercise every cleanup safety boundary with lease-shaped storage names.
  -- Only the unreferenced artifact for the old, terminal contract may pass.
  abandoned_lease_path := test_org || '/processed/' || current_id
    || '/leases/' || gen_random_uuid() || '/normalised.pdf';
  recent_lease_path := test_org || '/processed/' || current_id
    || '/leases/' || gen_random_uuid() || '/normalised.pdf';
  invalid_lease_path := test_org || '/processed/' || current_id
    || '/leases/' || gen_random_uuid() || '/original.pdf';
  active_lease_path := test_org || '/processed/' || third_contract_id
    || '/leases/' || claimed_third.lease_token || '/normalised.pdf';
  quarantined_lease_path := test_org || '/processed/' || second_contract_id
    || '/leases/' || gen_random_uuid() || '/normalised.pdf';
  contract_source_lease_path := test_org || '/processed/' || current_id
    || '/leases/' || gen_random_uuid() || '/normalised.pdf';
  job_source_lease_path := test_org || '/processed/' || current_id
    || '/leases/' || gen_random_uuid() || '/normalised.pdf';
  attachment_lease_path := test_org || '/processed/' || current_id
    || '/leases/' || gen_random_uuid() || '/normalised.pdf';

  update public.contract_document_jobs
  set output_storage_path = active_lease_path
  where id = third_job_id and lease_token = claimed_third.lease_token;
  update public.contracts
  set pdf_url = contract_source_lease_path
  where id = current_id;
  update public.contract_document_jobs
  set original_storage_path = job_source_lease_path
  where id = job_id;
  insert into public.contract_attachments(contract_id, org_id, type, pdf_url)
  values (current_id, test_org, 'allonge', attachment_lease_path);

  insert into storage.objects(bucket_id, name, created_at)
  values
    ('kontrakter', abandoned_lease_path, now() - interval '4 hours'),
    ('kontrakter', recent_lease_path, now() - interval '1 hour'),
    ('kontrakter', invalid_lease_path, now() - interval '4 hours'),
    ('kontrakter', active_lease_path, now() - interval '4 hours'),
    ('kontrakter', quarantined_lease_path, now() - interval '4 hours'),
    ('kontrakter', contract_source_lease_path, now() - interval '4 hours'),
    ('kontrakter', job_source_lease_path, now() - interval '4 hours'),
    ('kontrakter', attachment_lease_path, now() - interval '4 hours'),
    ('kontrakter', expected_output_path, now() - interval '4 hours'),
    ('kontrakter', expected_spatial_path, now() - interval '4 hours'),
    ('kontrakter', partial_output_path, now() - interval '4 hours'),
    ('kontrakter', partial_spatial_path, now() - interval '4 hours'),
    ('kontrakter', fresh_output_path, now() - interval '4 hours');
  select array_agg(storage_path order by storage_path)
  into cleanup_paths
  from public.list_abandoned_contract_document_lease_artifacts(25)
  where storage_path in (
    abandoned_lease_path, recent_lease_path, invalid_lease_path,
    active_lease_path, quarantined_lease_path, contract_source_lease_path,
    job_source_lease_path, attachment_lease_path, expected_output_path,
    expected_spatial_path, partial_output_path, partial_spatial_path,
    fresh_output_path
  );
  if cleanup_paths is distinct from (
      select array_agg(path order by path)
      from unnest(array[abandoned_lease_path, partial_output_path, partial_spatial_path]) as path
    ) then
    raise exception 'Lease cleanup regression: unsafe or incomplete artifact selection';
  end if;

  -- A worker cannot mark an OCR result ready without the complete integrity
  -- and geometry evidence required by the v4 boundary.
  begin
    perform public.finish_contract_document_job_v4(
      third_job_id, (select lease_token from public.contract_document_jobs where id = third_job_id),
      'completed', 'image_only', 'google-vision-eu-v1', '[]'::jsonb,
      true, null, null, 0, 0, 0, '{}'::jsonb,
      null, null, null, null, null,
      'dfks-contract-redaction-v1', 'google-vision-spatial-v2', null, null
    );
  exception when sqlstate '22023' then
    invalid_completion_rejected := true;
  end;
  if not invalid_completion_rejected then
    raise exception 'Document queue regression: incomplete OCR evidence was accepted';
  end if;
  if not exists (
    select 1 from public.contract_document_jobs
    where id = third_job_id and status = 'processing' and lease_token = claimed_third.lease_token
  ) then
    raise exception 'Document queue regression: rejected completion mutated the active job';
  end if;
end $$;

select pass('Kontraktversioner og dokumentkø har server-only adgang og bevarer originalen');
select * from finish();

rollback;
