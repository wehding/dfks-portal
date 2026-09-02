begin;

select plan(4);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_contract_owner_candidate(uuid,uuid,uuid,uuid,uuid,text,numeric)',
    'EXECUTE'
  ),
  'browserbrugere kan ikke registrere AI-ejerforslag direkte'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_contract_owner_candidate(uuid,uuid,uuid,uuid,uuid,text,numeric)',
    'EXECUTE'
  ),
  'service-laget kan registrere et valideret AI-ejerforslag'
);

do $$
declare
  test_org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  current_holder uuid;
  valid_candidate uuid;
  archived_candidate uuid;
  cross_org_candidate uuid;
  inactive_holder uuid;
  candidate_contract uuid;
  inactive_contract uuid;
  current_revision bigint;
  audit_count integer;
  decision jsonb;
  cross_org_rejected boolean := false;
  archived_rejected boolean := false;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into public.organisations(id, name) values
    (test_org, 'Blokeringsgrænse ' || test_org::text),
    (other_org, 'Anden blokeringsgrænse ' || other_org::text);
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
  ) values (
    admin_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    admin_user || '@example.invalid',
    '',
    now(),
    now()
  );
  insert into public.user_org_roles(user_id, org_id, role)
  values (admin_user, test_org, 'admin');

  insert into public.rettighedshavere(full_name, email)
  values ('Nuværende ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into current_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('Gyldig kandidat ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into valid_candidate;
  insert into public.rettighedshavere(full_name, email, archived_at)
  values (
    'Arkiveret kandidat ' || gen_random_uuid(),
    gen_random_uuid() || '@example.invalid',
    now()
  ) returning id into archived_candidate;
  insert into public.rettighedshavere(full_name, email)
  values ('Fremmed kandidat ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into cross_org_candidate;
  insert into public.rettighedshavere(full_name, email)
  values ('Inaktiv historisk ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into inactive_holder;

  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from) values
    (test_org, current_holder, true, current_date),
    (test_org, valid_candidate, true, current_date),
    (test_org, archived_candidate, true, current_date),
    (test_org, inactive_holder, true, current_date),
    (other_org, cross_org_candidate, true, current_date);

  insert into public.contracts(org_id, rights_holder_id, type, status, working_title)
  values (test_org, current_holder, 'a-løn', 'kladde', 'Blokeret kandidatkontrol')
  returning id into candidate_contract;
  select revision into current_revision
  from public.contract_owner_verifications
  where contract_id = candidate_contract;
  select count(*)::integer into audit_count
  from public.audit_events
  where entity_type = 'contract_owner_verification'
    and entity_id = candidate_contract::text;

  begin
    perform public.review_contract_owner(
      candidate_contract,
      current_holder,
      current_revision,
      'blocked',
      cross_org_candidate,
      'wrong_organization',
      admin_user,
      test_org,
      'admin'
    );
  exception when insufficient_privilege then
    cross_org_rejected := true;
  end;
  if not cross_org_rejected
    or not exists (
      select 1
      from public.contract_owner_verifications
      where contract_id = candidate_contract
        and revision = current_revision
        and status = 'pending'
        and assigned_rights_holder_id = current_holder
        and proposed_rights_holder_id is null
    )
    or not exists (
      select 1 from public.contracts
      where id = candidate_contract and rights_holder_id = current_holder
    )
    or (
      select count(*)::integer
      from public.audit_events
      where entity_type = 'contract_owner_verification'
        and entity_id = candidate_contract::text
    ) <> audit_count then
    raise exception 'Cross-org-kandidat blev ikke afvist atomisk ved blokering';
  end if;

  begin
    perform public.review_contract_owner(
      candidate_contract,
      current_holder,
      current_revision,
      'blocked',
      archived_candidate,
      'inactive_profile',
      admin_user,
      test_org,
      'admin'
    );
  exception when insufficient_privilege then
    archived_rejected := true;
  end;
  if not archived_rejected
    or not exists (
      select 1
      from public.contract_owner_verifications
      where contract_id = candidate_contract
        and revision = current_revision
        and status = 'pending'
        and assigned_rights_holder_id = current_holder
        and proposed_rights_holder_id is null
    )
    or (
      select count(*)::integer
      from public.audit_events
      where entity_type = 'contract_owner_verification'
        and entity_id = candidate_contract::text
    ) <> audit_count then
    raise exception 'Arkiveret kandidat blev ikke afvist atomisk ved blokering';
  end if;

  insert into public.contracts(org_id, rights_holder_id, type, status, working_title)
  values (test_org, inactive_holder, 'a-løn', 'kladde', 'Inaktiv historisk ejer')
  returning id into inactive_contract;
  update public.contract_owner_verifications
  set assignment_origin = 'historical_assignment'
  where contract_id = inactive_contract;
  update public.org_affiliations
  set valid_to = current_date - 1
  where org_id = test_org and rights_holder_id = inactive_holder;
  select revision into current_revision
  from public.contract_owner_verifications
  where contract_id = inactive_contract;

  decision := public.review_contract_owner(
    inactive_contract,
    inactive_holder,
    current_revision,
    'blocked',
    null,
    'inactive_profile',
    admin_user,
    test_org,
    'admin'
  );
  if decision ->> 'status' <> 'blocked'
    or not exists (
      select 1
      from public.contracts
      where id = inactive_contract and rights_holder_id = inactive_holder
    )
    or not exists (
      select 1
      from public.contract_owner_verifications
      where contract_id = inactive_contract
        and status = 'blocked'
        and assigned_rights_holder_id = inactive_holder
        and proposed_rights_holder_id is null
        and reviewed_by = admin_user
    ) then
    raise exception 'Blokering uden ny kandidat bevarede ikke den inaktive historiske ejer';
  end if;
end;
$$;

select pass(
  'blokerede sager afviser utilgængelige kandidater atomisk og kan bevare en historisk inaktiv ejer'
);

do $$
declare
  test_org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  current_holder uuid;
  proposed_holder uuid;
  candidate_contract uuid;
  foreign_contract uuid;
  rollback_contract uuid;
  candidate_ai_job uuid := gen_random_uuid();
  foreign_ai_job uuid := gen_random_uuid();
  rollback_ai_job uuid := gen_random_uuid();
  candidate_document_job uuid := gen_random_uuid();
  foreign_document_job uuid := gen_random_uuid();
  candidate_input text;
  foreign_input text;
  rollback_input text;
  initial_revision bigint;
  resulting_revision bigint;
  provenance_count integer;
  first_result jsonb;
  second_result jsonb;
  wrong_ai_rejected boolean := false;
  wrong_document_rejected boolean := false;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into public.organisations(id, name) values
    (test_org, 'Kandidat-RPC ' || test_org::text),
    (other_org, 'Fremmed kandidat-RPC ' || other_org::text);
  insert into public.rettighedshavere(full_name, email)
  values ('Tildelt ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into current_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('Foreslået ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into proposed_holder;
  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from) values
    (test_org, current_holder, true, current_date),
    (test_org, proposed_holder, true, current_date);

  candidate_input := test_org::text || '/processed/candidate.pdf';
  foreign_input := other_org::text || '/processed/foreign.pdf';
  rollback_input := test_org::text || '/processed/rollback.pdf';
  insert into public.contracts(org_id, rights_holder_id, type, status, working_title, pdf_url)
  values (test_org, current_holder, 'a-løn', 'kladde', 'Kandidat-idempotens', candidate_input)
  returning id into candidate_contract;
  insert into public.contracts(org_id, rights_holder_id, type, status, working_title, pdf_url)
  values (other_org, null, 'a-løn', 'kladde', 'Fremmed evidens', foreign_input)
  returning id into foreign_contract;
  insert into public.contracts(org_id, rights_holder_id, type, status, working_title, pdf_url)
  values (test_org, current_holder, 'a-løn', 'kladde', 'Rollback-evidens', rollback_input)
  returning id into rollback_contract;

  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, completed_at,
    input_storage_path
  ) values
    (candidate_ai_job, candidate_contract, test_org, 'done', 'complete', 1, now(), candidate_input),
    (foreign_ai_job, foreign_contract, other_org, 'done', 'complete', 1, now(), foreign_input),
    (rollback_ai_job, rollback_contract, test_org, 'done', 'complete', 1, now(), rollback_input);
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, completed_at, spatial_data_path, spatial_accuracy_score,
    spatial_schema_version, spatial_sha256
  ) values
    (
      candidate_document_job,
      test_org,
      candidate_contract,
      test_org::text || '/original/candidate.pdf',
      candidate_input,
      'completed',
      1,
      now(),
      test_org::text || '/spatial/candidate.json.gz',
      0.99000,
      'google-v3',
      repeat('a', 64)
    ),
    (
      foreign_document_job,
      other_org,
      foreign_contract,
      other_org::text || '/original/foreign.pdf',
      foreign_input,
      'completed',
      1,
      now(),
      other_org::text || '/spatial/foreign.json.gz',
      0.99000,
      'google-v3',
      repeat('b', 64)
    );

  select revision into initial_revision
  from public.contract_owner_verifications
  where contract_id = candidate_contract;
  first_result := public.record_contract_owner_candidate(
    candidate_contract,
    test_org,
    proposed_holder,
    candidate_ai_job,
    candidate_document_job,
    'owner-match-v1',
    96
  );
  select revision into resulting_revision
  from public.contract_owner_verifications
  where contract_id = candidate_contract;
  if coalesce((first_result ->> 'unchanged')::boolean, true)
    or resulting_revision <> initial_revision + 1
    or not exists (
      select 1
      from public.contracts
      where id = candidate_contract and rights_holder_id = current_holder
    )
    or not exists (
      select 1
      from public.contract_owner_verifications
      where contract_id = candidate_contract
        and assigned_rights_holder_id = current_holder
        and proposed_rights_holder_id = proposed_holder
        and evidence_subject_rights_holder_id = proposed_holder
        and status = 'conflict'
        and reason_code = 'ai_candidate'
        and evidence_ai_job_id = candidate_ai_job
        and evidence_document_job_id = candidate_document_job
        and evidence_spatial_sha256 = repeat('a', 64)
        and evidence_spatial_schema_version = 'google-v3'
        and evidence_confidence = 0.9600
    ) then
    raise exception 'Kandidat-RPC afledte ikke den låste nuværende ejer og evidens korrekt';
  end if;

  select count(*)::integer into provenance_count
  from public.contract_owner_provenance
  where contract_id = candidate_contract
    and rights_holder_id = proposed_holder
    and origin = 'ai_suggestion'
    and source_record_type = 'contract_ai_job'
    and source_record_id = candidate_ai_job
    and evidence_ai_job_id = candidate_ai_job;
  second_result := public.record_contract_owner_candidate(
    candidate_contract,
    test_org,
    proposed_holder,
    candidate_ai_job,
    candidate_document_job,
    'owner-match-v1',
    96
  );
  if not coalesce((second_result ->> 'unchanged')::boolean, false)
    or (second_result ->> 'revision')::bigint <> resulting_revision
    or (
      select revision
      from public.contract_owner_verifications
      where contract_id = candidate_contract
    ) <> resulting_revision
    or provenance_count <> 1
    or (
      select count(*)::integer
      from public.contract_owner_provenance
      where contract_id = candidate_contract
        and rights_holder_id = proposed_holder
        and origin = 'ai_suggestion'
        and source_record_type = 'contract_ai_job'
        and source_record_id = candidate_ai_job
        and evidence_ai_job_id = candidate_ai_job
    ) <> 1 then
    raise exception 'Gentaget kandidatregistrering var ikke idempotent';
  end if;

  select revision into initial_revision
  from public.contract_owner_verifications
  where contract_id = rollback_contract;
  begin
    perform public.record_contract_owner_candidate(
      rollback_contract,
      test_org,
      proposed_holder,
      foreign_ai_job,
      null,
      'owner-match-wrong-ai',
      90
    );
  exception when invalid_parameter_value then
    wrong_ai_rejected := true;
  end;
  if not wrong_ai_rejected
    or not exists (
      select 1
      from public.contract_owner_verifications
      where contract_id = rollback_contract
        and revision = initial_revision
        and assigned_rights_holder_id = current_holder
        and proposed_rights_holder_id is null
        and evidence_ai_job_id is null
        and evidence_document_job_id is null
    )
    or exists (
      select 1
      from public.contract_owner_provenance
      where contract_id = rollback_contract and origin = 'ai_suggestion'
    ) then
    raise exception 'Forkert AI-binding blev ikke rullet helt tilbage';
  end if;

  begin
    perform public.record_contract_owner_candidate(
      rollback_contract,
      test_org,
      proposed_holder,
      rollback_ai_job,
      foreign_document_job,
      'owner-match-wrong-document',
      90
    );
  exception when invalid_parameter_value then
    wrong_document_rejected := true;
  end;
  if not wrong_document_rejected
    or not exists (
      select 1
      from public.contract_owner_verifications
      where contract_id = rollback_contract
        and revision = initial_revision
        and assigned_rights_holder_id = current_holder
        and proposed_rights_holder_id is null
        and evidence_ai_job_id is null
        and evidence_document_job_id is null
    )
    or exists (
      select 1
      from public.contract_owner_provenance
      where contract_id = rollback_contract and origin = 'ai_suggestion'
    ) then
    raise exception 'Forkert dokumentbinding blev ikke rullet helt tilbage';
  end if;
end;
$$;

select pass(
  'kandidat-RPC er låst, idempotent og ruller forkerte AI- og dokumentbindinger helt tilbage'
);

select * from finish();
rollback;
