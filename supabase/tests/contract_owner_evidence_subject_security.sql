begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  current_holder uuid;
  suggested_holder uuid;
  replacement_holder uuid;
  confirm_contract uuid;
  reassign_contract uuid;
  blocked_contract uuid;
  confirm_ai_job uuid := gen_random_uuid();
  reassign_ai_job uuid := gen_random_uuid();
  blocked_ai_job uuid := gen_random_uuid();
  confirm_document_job uuid := gen_random_uuid();
  reassign_document_job uuid := gen_random_uuid();
  blocked_document_job uuid := gen_random_uuid();
  current_revision bigint;
  blocked_rejected boolean := false;
  input_path text;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into public.organisations(id, name)
  values (test_org, 'Evidensperson ' || test_org::text);
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (
    admin_user, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', admin_user || '@example.invalid', '', now(), now()
  );
  insert into public.user_org_roles(user_id, org_id, role)
  values (admin_user, test_org, 'admin');

  insert into public.rettighedshavere(full_name, email)
  values ('Nuværende evidensejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into current_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('AI-foreslået evidensejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into suggested_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('Manuelt valgt evidensejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into replacement_holder;
  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from) values
    (test_org, current_holder, true, current_date),
    (test_org, suggested_holder, true, current_date),
    (test_org, replacement_holder, true, current_date);

  input_path := test_org::text || '/processed/evidence-confirm.pdf';
  insert into public.contracts(org_id, rights_holder_id, type, status, working_title, pdf_url)
  values (test_org, current_holder, 'a-løn', 'kladde', 'Modbevis ved bekræftelse', input_path)
  returning id into confirm_contract;
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, completed_at, input_storage_path
  ) values (confirm_ai_job, confirm_contract, test_org, 'done', 'complete', 1, now(), input_path);
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, completed_at, spatial_data_path, spatial_accuracy_score,
    spatial_schema_version, spatial_sha256
  ) values (
    confirm_document_job, test_org, confirm_contract,
    test_org::text || '/original/evidence-confirm.pdf', input_path,
    'completed', 1, now(), test_org::text || '/spatial/evidence-confirm.json.gz',
    0.99, 'google-v3', repeat('a', 64)
  );
  perform public.record_contract_owner_candidate(
    confirm_contract, test_org, suggested_holder, confirm_ai_job,
    confirm_document_job, 'owner-evidence-v1', 95
  );
  select revision into current_revision
  from public.contract_owner_verifications where contract_id = confirm_contract;
  perform public.review_contract_owner(
    confirm_contract, current_holder, current_revision, 'confirm', current_holder,
    'admin_verified_existing_owner', admin_user, test_org, 'admin',
    confirm_document_job, 1, '{"x":1,"y":1,"width":5,"height":5}'::jsonb, 0.9
  );
  if not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = confirm_contract
      and status = 'confirmed'
      and assigned_rights_holder_id = current_holder
      and proposed_rights_holder_id is null
      and evidence_subject_rights_holder_id = suggested_holder
      and evidence_ai_job_id = confirm_ai_job
      and evidence_document_job_id = confirm_document_job
      and evidence_spatial_sha256 = repeat('a', 64)
      and evidence_page is null and evidence_bbox is null and evidence_confidence is null
  ) then
    raise exception 'Bekræftelse bevarede ikke råt modbevis eller ryddede ikke beslutningsgeometrien';
  end if;

  input_path := test_org::text || '/processed/evidence-reassign.pdf';
  insert into public.contracts(org_id, rights_holder_id, type, status, working_title, pdf_url)
  values (test_org, current_holder, 'a-løn', 'kladde', 'Modbevis ved omplacering', input_path)
  returning id into reassign_contract;
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, completed_at, input_storage_path
  ) values (reassign_ai_job, reassign_contract, test_org, 'done', 'complete', 1, now(), input_path);
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, completed_at, spatial_data_path, spatial_accuracy_score,
    spatial_schema_version, spatial_sha256
  ) values (
    reassign_document_job, test_org, reassign_contract,
    test_org::text || '/original/evidence-reassign.pdf', input_path,
    'completed', 1, now(), test_org::text || '/spatial/evidence-reassign.json.gz',
    0.99, 'google-v3', repeat('b', 64)
  );
  perform public.record_contract_owner_candidate(
    reassign_contract, test_org, suggested_holder, reassign_ai_job,
    reassign_document_job, 'owner-evidence-v1', 95
  );
  select revision into current_revision
  from public.contract_owner_verifications where contract_id = reassign_contract;
  perform public.review_contract_owner(
    reassign_contract, current_holder, current_revision, 'reassign', replacement_holder,
    'wrong_owner', admin_user, test_org, 'admin',
    reassign_document_job, 2, '{"x":2,"y":2,"width":6,"height":6}'::jsonb, 0.8
  );
  if not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = reassign_contract
      and status = 'corrected'
      and assigned_rights_holder_id = replacement_holder
      and proposed_rights_holder_id is null
      and evidence_subject_rights_holder_id = suggested_holder
      and evidence_ai_job_id = reassign_ai_job
      and evidence_document_job_id = reassign_document_job
      and evidence_spatial_sha256 = repeat('b', 64)
      and evidence_page is null and evidence_bbox is null and evidence_confidence is null
  ) then
    raise exception 'Omplacering bevarede ikke råt modbevis eller ryddede ikke beslutningsgeometrien';
  end if;

  input_path := test_org::text || '/processed/evidence-blocked.pdf';
  insert into public.contracts(org_id, rights_holder_id, type, status, working_title, pdf_url)
  values (test_org, current_holder, 'a-løn', 'kladde', 'Blokeret positiv evidens', input_path)
  returning id into blocked_contract;
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, completed_at, input_storage_path
  ) values (blocked_ai_job, blocked_contract, test_org, 'done', 'complete', 1, now(), input_path);
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, completed_at, spatial_data_path, spatial_accuracy_score,
    spatial_schema_version, spatial_sha256
  ) values (
    blocked_document_job, test_org, blocked_contract,
    test_org::text || '/original/evidence-blocked.pdf', input_path,
    'completed', 1, now(), test_org::text || '/spatial/evidence-blocked.json.gz',
    0.99, 'google-v3', repeat('c', 64)
  );
  perform public.record_contract_owner_candidate(
    blocked_contract, test_org, suggested_holder, blocked_ai_job,
    blocked_document_job, 'owner-evidence-v1', 95
  );
  select revision into current_revision
  from public.contract_owner_verifications where contract_id = blocked_contract;
  begin
    perform public.review_contract_owner(
      blocked_contract, current_holder, current_revision, 'blocked', suggested_holder,
      'evidence_conflict', admin_user, test_org, 'admin', blocked_document_job
    );
  exception when invalid_parameter_value then
    blocked_rejected := true;
  end;
  if not blocked_rejected or not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = blocked_contract
      and revision = current_revision
      and status = 'conflict'
      and evidence_subject_rights_holder_id = suggested_holder
  ) then
    raise exception 'Blokering accepterede positiv evidens eller ændrede sagen trods afvisning';
  end if;
end;
$$;

select pass(
  'rå AI-evidens er personbundet modbevis, beslutningsgeometri kræver samme mål, og blokerede sager afviser positiv evidens'
);

select * from finish();
rollback;
