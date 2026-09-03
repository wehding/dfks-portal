begin;

select plan(10);

select has_table(
  'public', 'contract_owner_verifications',
  'ejerskabskontrollen har en særskilt server-only tabel'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.contract_owner_verifications'::regclass),
  'RLS er slået til på ejerskabskontrollen'
);
select ok(
  not has_table_privilege('anon', 'public.contract_owner_verifications', 'SELECT'),
  'anon kan ikke læse ejerskabskontrollen'
);
select ok(
  not has_table_privilege('authenticated', 'public.contract_owner_verifications', 'SELECT'),
  'browserbrugere kan ikke læse ejerskabskontrollen direkte'
);
select ok(
  has_table_privilege('service_role', 'public.contract_owner_verifications', 'SELECT'),
  'service-laget kan læse ejerskabskontrollen'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.review_contract_owner(uuid,uuid,bigint,text,uuid,text,uuid,uuid,text,uuid,integer,jsonb,numeric)',
    'EXECUTE'
  ),
  'browserbrugere kan ikke kalde beslutnings-RPC direkte'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.review_contract_owner(uuid,uuid,bigint,text,uuid,text,uuid,uuid,text,uuid,integer,jsonb,numeric)',
    'EXECUTE'
  ),
  'service-laget kan kalde beslutnings-RPC'
);
select is(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'list_contract_owner_verification_queue'
  ),
  1,
  'der findes kun én entydig kø-RPC-signatur'
);
select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = 'public.contracts'::regclass
      and not tgisinternal
      and tgname in ('guard_contract_owner_change', 'ensure_contract_owner_verification_consistency')
  ),
  2,
  'direkte ejerskifte og inkonsistent state er beskyttet af databasetriggere'
);

do $$
declare
  test_org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  jurist_user uuid := gen_random_uuid();
  member_user uuid := gen_random_uuid();
  old_holder uuid;
  new_holder uuid;
  archived_holder uuid;
  cross_org_holder uuid;
  member_holder uuid;
  test_contract uuid;
  member_contract uuid;
  ai_contract uuid;
  ownerless_contract uuid;
  ownerless_member_contract uuid;
  intake_batch uuid;
  member_intake_batch uuid;
  blocked_contract uuid;
  inactive_holder uuid;
  test_work uuid;
  current_revision bigint;
  first_revision bigint;
  decision jsonb;
  audit_id uuid;
  direct_change_rejected boolean := false;
  jurist_rejected boolean := false;
  jurist_queue_rejected boolean := false;
  archived_rejected boolean := false;
  cross_org_rejected boolean := false;
  stale_rejected boolean := false;
  validation_owner_change_rejected boolean := false;
  invalid_confirm_reason_rejected boolean := false;
  missing_confirm_reason_rejected boolean := false;
  invalid_reassign_reason_rejected boolean := false;
  invalid_blocked_reason_rejected boolean := false;
  ai_job_id uuid := gen_random_uuid();
  ai_lease uuid := gen_random_uuid();
  matching_ai_job_id uuid := gen_random_uuid();
  matching_ai_lease uuid := gen_random_uuid();
  ai_input text;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into public.organisations(id, name) values
    (test_org, 'Ejerskabstest ' || test_org::text),
    (other_org, 'Anden ejerskabstest ' || other_org::text);
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (admin_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', admin_user || '@example.invalid', '', now(), now()),
    (jurist_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', jurist_user || '@example.invalid', '', now(), now()),
    (member_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', member_user || '@example.invalid', '', now(), now());
  insert into public.user_org_roles(user_id, org_id, role) values
    (admin_user, test_org, 'admin'),
    (jurist_user, test_org, 'jurist');

  insert into public.rettighedshavere(full_name, email)
  values ('Historisk ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into old_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('Ny ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into new_holder;
  insert into public.rettighedshavere(full_name, email, archived_at)
  values ('Arkiveret ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid', now())
  returning id into archived_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('Anden organisation ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into cross_org_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('Inaktiv ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into inactive_holder;

  select id into member_holder
  from public.rettighedshavere
  where user_id = member_user;
  if member_holder is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (member_user, 'Sessionmedlem ' || gen_random_uuid(), member_user || '@example.invalid')
    returning id into member_holder;
  end if;

  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from) values
    (test_org, old_holder, true, current_date),
    (test_org, new_holder, true, current_date),
    (test_org, archived_holder, true, current_date),
    (test_org, member_holder, true, current_date),
    (test_org, inactive_holder, true, current_date),
    (other_org, cross_org_holder, true, current_date);

  insert into public.contracts(org_id, rights_holder_id, type, status, working_title, created_by)
  values (test_org, null, 'a-løn', 'kladde', 'Ejerløs admin-intake', admin_user)
  returning id into ownerless_contract;
  if not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = ownerless_contract
      and assignment_origin = 'unknown'
      and assigned_rights_holder_id is null
  ) then
    raise exception 'Ejerløs admin-intake blev fejlklassificeret som admin-valgt ejer';
  end if;

  insert into public.contract_import_batches(org_id, created_by, source, status)
  values (test_org, admin_user, 'computer', 'receiving')
  returning id into intake_batch;
  begin
    perform public.record_contract_owner_provenance(
      ownerless_contract, test_org, new_holder, 'admin_selected_at_intake',
      jurist_user, 'contract_import_batch', intake_batch, null
    );
  exception when insufficient_privilege then
    null;
  end;
  if not exists (
    select 1 from public.contracts
    where id = ownerless_contract and rights_holder_id is null
  ) or not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = ownerless_contract
      and assigned_rights_holder_id is null
      and assignment_origin = 'unknown'
      and status = 'pending'
  ) or exists (
    select 1 from public.contract_owner_provenance
    where contract_id = ownerless_contract and rights_holder_id = new_holder
  ) then
    raise exception 'Afvist intake-ejerskab blev ikke rullet fuldt tilbage';
  end if;

  perform public.record_contract_owner_provenance(
    ownerless_contract, test_org, new_holder, 'admin_selected_at_intake',
    admin_user, 'contract_import_batch', intake_batch, null
  );
  if not exists (
    select 1 from public.contracts
    where id = ownerless_contract and rights_holder_id = new_holder
  ) or not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = ownerless_contract
      and assigned_rights_holder_id = new_holder
      and assignment_origin = 'admin_selected_at_intake'
      and status = 'pending'
  ) or not exists (
    select 1 from public.contract_owner_provenance
    where contract_id = ownerless_contract
      and rights_holder_id = new_holder
      and origin = 'admin_selected_at_intake'
      and source_record_id = intake_batch
  ) then
    raise exception 'Admin-intake tildelte ikke ejer og proveniens atomisk';
  end if;
  perform public.record_contract_owner_provenance(
    ownerless_contract, test_org, new_holder, 'admin_selected_at_intake',
    admin_user, 'contract_import_batch', intake_batch, null
  );
  if (
    select count(*)
    from public.contract_owner_provenance
    where contract_id = ownerless_contract
      and rights_holder_id = new_holder
      and origin = 'admin_selected_at_intake'
      and source_record_id = intake_batch
  ) <> 1 then
    raise exception 'Retry af intake-proveniens oprettede dubletter';
  end if;

  insert into public.contracts(org_id, rights_holder_id, type, status, working_title)
  values (test_org, old_holder, 'a-løn', 'kladde', 'Ejerskabskontrol')
  returning id into test_contract;
  if not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = test_contract
      and assigned_rights_holder_id = old_holder
      and status = 'pending'
      and assignment_origin = 'unknown'
  ) then
    raise exception 'Nye kontrakter blev ikke lagt i pending-køen';
  end if;

  begin
    update public.contracts set rights_holder_id = new_holder where id = test_contract;
  exception when insufficient_privilege then
    direct_change_rejected := true;
  end;
  if not direct_change_rejected then
    raise exception 'Direkte ejerskifte blev tilladt';
  end if;

  select revision into current_revision
  from public.contract_owner_verifications where contract_id = test_contract;

  begin
    perform public.review_contract_owner(
      test_contract, old_holder, current_revision, 'confirm', old_holder,
      'wrong_owner', admin_user, test_org, 'admin'
    );
  exception when invalid_parameter_value then
    invalid_confirm_reason_rejected := true;
  end;
  begin
    perform public.review_contract_owner(
      test_contract, old_holder, current_revision, 'confirm', old_holder,
      null, admin_user, test_org, 'admin'
    );
  exception when invalid_parameter_value then
    missing_confirm_reason_rejected := true;
  end;
  begin
    perform public.review_contract_owner(
      test_contract, old_holder, current_revision, 'reassign', new_holder,
      'manual_identity_check', admin_user, test_org, 'admin'
    );
  exception when invalid_parameter_value then
    invalid_reassign_reason_rejected := true;
  end;
  begin
    perform public.review_contract_owner(
      test_contract, old_holder, current_revision, 'blocked', null,
      'admin_verified_correction', admin_user, test_org, 'admin'
    );
  exception when invalid_parameter_value then
    invalid_blocked_reason_rejected := true;
  end;
  if not invalid_confirm_reason_rejected
    or not missing_confirm_reason_rejected
    or not invalid_reassign_reason_rejected
    or not invalid_blocked_reason_rejected
    or not exists (
      select 1
      from public.contract_owner_verifications
      where contract_id = test_contract
        and revision = current_revision
        and status = 'pending'
        and reason_code is null
    ) then
    raise exception 'Beslutningsspecifik reason-code allowlist blev omgået eller muterede state';
  end if;

  begin
    perform public.review_contract_owner(
      test_contract, old_holder, current_revision, 'confirm', old_holder,
      'manual_identity_check', jurist_user, test_org, 'jurist'
    );
  exception when insufficient_privilege then
    jurist_rejected := true;
  end;
  if not jurist_rejected then
    raise exception 'Juristen fik adgang til ejerskabsbeslutningen';
  end if;
  begin
    perform * from public.list_contract_owner_verification_queue(
      test_org, jurist_user, 'jurist', null, null, null, 50, 0
    );
  exception when insufficient_privilege then
    jurist_queue_rejected := true;
  end;
  if not jurist_queue_rejected then
    raise exception 'Juristen fik adgang til ejerskabskøen';
  end if;

  begin
    perform public.review_contract_owner(
      test_contract, old_holder, current_revision, 'reassign', archived_holder,
      'wrong_owner', admin_user, test_org, 'admin'
    );
  exception when insufficient_privilege then
    archived_rejected := true;
  end;
  if not archived_rejected then
    raise exception 'En arkiveret målprofil blev tilladt';
  end if;
  begin
    perform public.review_contract_owner(
      test_contract, old_holder, current_revision, 'reassign', cross_org_holder,
      'wrong_owner', admin_user, test_org, 'admin'
    );
  exception when insufficient_privilege then
    cross_org_rejected := true;
  end;
  if not cross_org_rejected then
    raise exception 'En målprofil fra en anden organisation blev tilladt';
  end if;

  first_revision := current_revision;
  decision := public.review_contract_owner(
    test_contract, old_holder, current_revision, 'confirm', old_holder,
    'manual_identity_check', admin_user, test_org, 'admin'
  );
  current_revision := (decision ->> 'revision')::bigint;
  if decision ->> 'status' <> 'confirmed' then
    raise exception 'Adminbekræftelsen blev ikke gemt';
  end if;

  begin
    perform public.review_contract_owner(
      test_contract, old_holder, first_revision, 'confirm', old_holder,
      'manual_identity_check', admin_user, test_org, 'admin'
    );
  exception when serialization_failure then
    stale_rejected := true;
  end;
  if not stale_rejected then
    raise exception 'En forældet revisionsbeslutning blev tilladt';
  end if;

  insert into public.works(org_id, title, type, status)
  values (test_org, 'Ejerskabstestværk', 'serie', 'godkendt')
  returning id into test_work;
  insert into public.contract_episode_confirmations(
    contract_id, org_id, rights_holder_id, work_id, season_number, scope,
    episode_numbers, work_data_version, confirmed_by
  ) values (
    test_contract, test_org, old_holder, test_work, 1, 'selected_episodes',
    array[1], 'test-v1', member_user
  );
  insert into public.work_assignments(org_id, work_id, rights_holder_id, role)
  values (test_org, test_work, old_holder, 'Klipper');
  insert into public.contract_validations(
    contract_id, org_id, validated_by, validated_at
  ) values (test_contract, test_org, admin_user, now());
  perform set_config('app.explicit_contract_validation', 'on', true);
  update public.contracts set status = 'valideret' where id = test_contract;

  decision := public.review_contract_owner(
    test_contract, old_holder, current_revision, 'reassign', new_holder,
    'wrong_owner', admin_user, test_org, 'admin'
  );
  audit_id := (decision ->> 'auditEventId')::uuid;
  if not exists (
    select 1 from public.contracts
    where id = test_contract and rights_holder_id = new_holder and status = 'kladde'
  ) or not exists (
    select 1 from public.contract_episode_confirmations
    where contract_id = test_contract and invalidated_at is not null
  ) or not exists (
    select 1 from public.contract_validations
    where contract_id = test_contract and validated_by is null and validated_at is null
  ) then
    raise exception 'Ejerskiftet genåbnede ikke den validerede kontrakt sikkert';
  end if;
  if not exists (
    select 1 from public.work_assignments
    where work_id = test_work and rights_holder_id = old_holder
  ) then
    raise exception 'Kontraktens ejerskifte flyttede fejlagtigt værkkrediteringen';
  end if;
  if (
    select count(*) from public.audit_event_subjects
    where event_id = audit_id and target_member_uuid in (old_holder, new_holder)
  ) <> 2 then
    raise exception 'Auditsporet indeholder ikke både gammel og ny rettighedshaver';
  end if;
  if exists (
    select 1 from public.audit_events
    where id = audit_id
      and metadata::text ~* '(Historisk ejer|Ny ejer|@example[.]invalid)'
  ) then
    raise exception 'Auditmetadata indeholder personhenførbare labels';
  end if;
  if not exists (
    select 1 from public.contract_owner_provenance
    where contract_id = test_contract
      and rights_holder_id = new_holder
      and origin = 'admin_manual'
      and authenticated_user_id = admin_user
      and source_record_type = 'audit_event'
      and source_record_id = audit_id
  ) then
    raise exception 'Det manuelle ejerskifte mangler uforanderlig beslutningsproveniens';
  end if;

  insert into public.contracts(org_id, rights_holder_id, type, status, working_title)
  values (test_org, inactive_holder, 'a-løn', 'kladde', 'Inaktiv historisk ejer')
  returning id into blocked_contract;
  update public.contract_owner_verifications
  set assignment_origin = 'historical_assignment'
  where contract_id = blocked_contract;
  update public.org_affiliations
  set valid_to = current_date - 1
  where org_id = test_org and rights_holder_id = inactive_holder;
  update public.contract_owner_verifications
  set proposed_rights_holder_id = new_holder,
      status = 'conflict',
      reason_code = 'inactive_profile',
      revision = revision + 1
  where contract_id = blocked_contract;
  select revision into current_revision
  from public.contract_owner_verifications where contract_id = blocked_contract;
  decision := public.review_contract_owner(
    blocked_contract, inactive_holder, current_revision, 'blocked', null,
    'inactive_profile', admin_user, test_org, 'admin'
  );
  if decision ->> 'status' <> 'blocked' or not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = blocked_contract
      and status = 'blocked'
      and assigned_rights_holder_id = inactive_holder
      and proposed_rights_holder_id = new_holder
  ) then
    raise exception 'Blokering af inaktiv current owner bevarede ikke ejeren og forslaget';
  end if;

  begin
    perform public.admin_validate_contract(
      test_contract, 'kladde', null, null, null, old_holder
    );
  exception when insufficient_privilege then
    validation_owner_change_rejected := true;
  end;
  if not validation_owner_change_rejected
    or not exists (
      select 1 from public.contracts
      where id = test_contract and rights_holder_id = new_holder
    ) then
    raise exception 'Validerings-RPC kunne ændre kontraktens ejer';
  end if;

  insert into public.contracts(
    org_id, rights_holder_id, type, status, working_title, created_by
  ) values (
    test_org, null, 'a-løn', 'kladde', 'Sessionbundet Drive-import', member_user
  ) returning id into ownerless_member_contract;
  insert into public.contract_import_batches(org_id, created_by, source, status)
  values (test_org, member_user, 'google_drive', 'receiving')
  returning id into member_intake_batch;
  perform public.record_contract_owner_provenance(
    ownerless_member_contract, test_org, member_holder, 'authenticated_member_drive',
    member_user, 'contract_import_batch', member_intake_batch, null
  );
  select revision into first_revision
  from public.contract_owner_verifications where contract_id = ownerless_member_contract;
  if not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = ownerless_member_contract
      and status = 'confirmed'
      and assigned_rights_holder_id = member_holder
      and assignment_origin = 'authenticated_member_drive'
      and reason_code = 'session_bound_owner'
      and reviewed_by = member_user
  ) or not exists (
    select 1 from public.contracts
    where id = ownerless_member_contract and rights_holder_id = member_holder
  ) then
    raise exception 'Sessionbundet Drive-import blev ikke atomisk tildelt og bekræftet';
  end if;

  ai_input := test_org::text || '/contracts/ai-owner-test.pdf';
  insert into public.contracts(
    org_id, rights_holder_id, type, status, working_title, pdf_url
  ) values (
    test_org, old_holder, 'a-løn', 'kladde', 'AI-ejerskabsforslag', ai_input
  ) returning id into ai_contract;
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, started_at,
    lease_expires_at, lease_token, input_storage_path
  ) values (
    ai_job_id, ai_contract, test_org, 'processing', 'matching', 1, now(),
    now() + interval '10 minutes', ai_lease, ai_input
  );
  perform public.apply_contract_ai_extraction_v2(
    ai_job_id,
    ai_lease,
    ai_input,
    jsonb_build_object(
      'extractedData', '{}'::jsonb,
      'validation', '{}'::jsonb,
      'contract', jsonb_build_object(
        'ownerSuggestionId', new_holder,
        'rightsHolderId', null
      ),
      'import', jsonb_build_object('status', 'ready_for_review', 'matchVersion', 'owner-v1')
    )
  );
  if not exists (
    select 1 from public.contracts
    where id = ai_contract and rights_holder_id = old_holder
  ) or not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = ai_contract
      and assigned_rights_holder_id = old_holder
      and proposed_rights_holder_id = new_holder
      and evidence_subject_rights_holder_id = new_holder
      and status = 'conflict'
      and reason_code = 'ai_owner_conflict'
      and evidence_ai_job_id = ai_job_id
  ) then
    raise exception 'AI-forslaget ændrede ejer eller manglede konflikt/evidensbinding';
  end if;
  update public.contract_ai_jobs
  set status = 'done', stage = 'complete', completed_at = now()
  where id = ai_job_id;
  if not exists (
    select 1
    from public.list_contract_owner_verification_queue(
      test_org, admin_user, 'admin', array['conflict'], array['unknown'], null, 50, 0
    ) as queue_row
    where queue_row.contract_id = ai_contract
      and queue_row.ai_evidence_available
      and not queue_row.spatial_evidence_available
  ) then
    raise exception 'Køen anvendte ikke den eksakt bundne, færdige AI-generation';
  end if;

  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, started_at,
    lease_expires_at, lease_token, input_storage_path
  ) values (
    matching_ai_job_id, ai_contract, test_org, 'processing', 'matching', 1, now(),
    now() + interval '10 minutes', matching_ai_lease, ai_input
  );
  perform public.apply_contract_ai_extraction_v2(
    matching_ai_job_id,
    matching_ai_lease,
    ai_input,
    jsonb_build_object(
      'extractedData', '{}'::jsonb,
      'validation', '{}'::jsonb,
      'contract', jsonb_build_object(
        'ownerSuggestionId', old_holder,
        'rightsHolderId', null
      ),
      'import', jsonb_build_object('status', 'ready_for_review', 'matchVersion', 'owner-v2')
    )
  );
  if not exists (
    select 1 from public.contract_owner_verifications
    where contract_id = ai_contract
      and assigned_rights_holder_id = old_holder
      and proposed_rights_holder_id is null
      and evidence_subject_rights_holder_id = old_holder
      and status = 'pending'
      and reason_code = 'ai_matches_assigned'
      and evidence_ai_job_id = matching_ai_job_id
  ) then
    raise exception 'Et senere AI-match ryddede ikke den tidligere konflikt sikkert';
  end if;
end;
$$;

select pass(
  'ejerskab er sessionbundet, admin-afgrænset, revisionssikkert, auditeret og AI-forslag ændrer aldrig ejer'
);

select * from finish();
rollback;
