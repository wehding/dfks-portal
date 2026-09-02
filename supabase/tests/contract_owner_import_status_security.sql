begin;

select plan(1);

create or replace function pg_temp.reject_selected_owner_audit()
returns trigger
language plpgsql
as $$
begin
  if new.entity_type = 'contract_owner_verification'
    and new.entity_id = nullif(current_setting('app.test_reject_owner_audit', true), '') then
    raise exception 'forced owner audit failure';
  end if;
  return new;
end;
$$;

create trigger reject_selected_owner_audit
before insert on public.audit_events
for each row execute function pg_temp.reject_selected_owner_audit();

do $$
declare
  test_org uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  member_user uuid := gen_random_uuid();
  assigned_holder uuid;
  other_holder uuid;
  member_holder uuid;
  film_work uuid;
  series_work uuid;
  import_batch uuid;
  missing_work_contract uuid;
  film_contract uuid;
  series_contract uuid;
  rollback_contract uuid;
  confirmed_contract uuid;
  session_contract uuid;
  owner_ai_job_id uuid := gen_random_uuid();
  ai_lease uuid := gen_random_uuid();
  confirmed_ai_job_id uuid := gen_random_uuid();
  session_ai_job_id uuid := gen_random_uuid();
  ai_input text;
  current_revision bigint;
  corrected_revision bigint;
  candidate_result jsonb;
  rollback_rejected boolean := false;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into public.organisations(id, name)
  values (test_org, 'Importstatus ved ejerskifte ' || test_org::text);
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
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
  ) values (
    member_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    member_user || '@example.invalid',
    '',
    now(),
    now()
  );
  insert into public.user_org_roles(user_id, org_id, role)
  values (admin_user, test_org, 'admin');

  insert into public.rettighedshavere(full_name, email)
  values ('Ny ejer ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into assigned_holder;
  insert into public.rettighedshavere(full_name, email)
  values ('Anden kandidat ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into other_holder;
  insert into public.rettighedshavere(user_id, full_name, email)
  values (member_user, 'Sessionbundet ejer ' || gen_random_uuid(), member_user || '@example.invalid')
  returning id into member_holder;
  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from)
  values
    (test_org, assigned_holder, true, current_date),
    (test_org, other_holder, true, current_date),
    (test_org, member_holder, true, current_date);

  insert into public.works(org_id, title, type, status)
  values (test_org, 'Filmstatus ' || gen_random_uuid(), 'spillefilm', 'godkendt')
  returning id into film_work;
  insert into public.works(org_id, title, type, status)
  values (test_org, 'Seriestatus ' || gen_random_uuid(), 'tv-serie', 'godkendt')
  returning id into series_work;

  insert into public.contract_import_batches(org_id, created_by, source, status)
  values (test_org, admin_user, 'computer', 'processing')
  returning id into import_batch;

  insert into public.contracts(org_id, rights_holder_id, work_id, type, status, working_title)
  values (test_org, null, null, 'a-løn', 'kladde', 'Mangler værk')
  returning id into missing_work_contract;
  insert into public.contracts(org_id, rights_holder_id, work_id, type, status, working_title, pdf_url)
  values (
    test_org, null, film_work, 'a-løn', 'kladde', 'Film klar til kontrol',
    test_org::text || '/film-owner-status.pdf'
  ) returning id into film_contract;
  insert into public.contracts(org_id, rights_holder_id, work_id, type, status, working_title)
  values (test_org, null, series_work, 'a-løn', 'kladde', 'Serie kræver afsnit')
  returning id into series_contract;
  insert into public.contracts(org_id, rights_holder_id, work_id, type, status, working_title)
  values (test_org, null, film_work, 'a-løn', 'kladde', 'Rollback af importstatus')
  returning id into rollback_contract;
  insert into public.contracts(org_id, rights_holder_id, work_id, type, status, working_title, pdf_url)
  values (
    test_org, assigned_holder, film_work, 'a-løn', 'kladde', 'Manuelt bekræftet ejer',
    test_org::text || '/admin-confirmed-owner.pdf'
  ) returning id into confirmed_contract;
  insert into public.contracts(org_id, rights_holder_id, work_id, type, status, working_title, pdf_url)
  values (
    test_org, member_holder, film_work, 'a-løn', 'kladde', 'Sessionbundet ejer',
    test_org::text || '/session-bound-owner.pdf'
  ) returning id into session_contract;

  insert into public.contract_import_items(
    batch_id, org_id, original_file_name, file_size_bytes, contract_id, status
  ) values
    (import_batch, test_org, 'missing-work.pdf', 100, missing_work_contract, 'missing_owner'),
    (import_batch, test_org, 'film.pdf', 100, film_contract, 'missing_owner'),
    (import_batch, test_org, 'film-completed.pdf', 100, film_contract, 'completed'),
    (import_batch, test_org, 'film-duplicate.pdf', 100, film_contract, 'possible_duplicate'),
    (import_batch, test_org, 'film-dead.pdf', 100, film_contract, 'dead'),
    (import_batch, test_org, 'series.pdf', 100, series_contract, 'missing_owner'),
    (import_batch, test_org, 'series-ready.pdf', 100, series_contract, 'ready_for_review'),
    (import_batch, test_org, 'rollback.pdf', 100, rollback_contract, 'missing_owner');

  select revision into current_revision
  from public.contract_owner_verifications where contract_id = missing_work_contract;
  perform public.review_contract_owner(
    missing_work_contract, null, current_revision, 'reassign', assigned_holder,
    'wrong_owner', admin_user, test_org, 'admin'
  );
  select revision into current_revision
  from public.contract_owner_verifications where contract_id = film_contract;
  perform public.review_contract_owner(
    film_contract, null, current_revision, 'reassign', assigned_holder,
    'wrong_owner', admin_user, test_org, 'admin'
  );
  select revision into corrected_revision
  from public.contract_owner_verifications where contract_id = film_contract;
  select revision into current_revision
  from public.contract_owner_verifications where contract_id = series_contract;
  perform public.review_contract_owner(
    series_contract, null, current_revision, 'reassign', assigned_holder,
    'wrong_owner', admin_user, test_org, 'admin'
  );

  if not exists (
      select 1 from public.contract_import_items
      where contract_id = missing_work_contract and status = 'missing_work'
    ) or not exists (
      select 1 from public.contract_import_items
      where contract_id = film_contract and original_file_name = 'film.pdf'
        and status = 'ready_for_review'
    ) or not exists (
      select 1 from public.contract_import_items
      where contract_id = film_contract and original_file_name = 'film-completed.pdf'
        and status = 'ready_for_review'
    ) or not exists (
      select 1 from public.contract_import_items
      where contract_id = film_contract and original_file_name = 'film-duplicate.pdf'
        and status = 'possible_duplicate'
    ) or not exists (
      select 1 from public.contract_import_items
      where contract_id = series_contract and status = 'awaiting_episode_confirmation'
      group by contract_id
      having count(*) = 2
  ) then
    raise exception 'Ejerskiftet afledte ikke importstatus sikkert fra værk- og afsnitstilstand: %',
      (
        select jsonb_object_agg(original_file_name, status order by original_file_name)
        from public.contract_import_items
        where batch_id = import_batch
      );
  end if;

  -- A later AI generation may record immutable suggestion provenance, but it
  -- must not reopen or overwrite the administrator's corrected decision.
  ai_input := test_org::text || '/film-owner-status.pdf';
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, started_at,
    lease_expires_at, lease_token, input_storage_path
  ) values (
    owner_ai_job_id, film_contract, test_org, 'processing', 'matching', 1, now(),
    now() + interval '10 minutes', ai_lease, ai_input
  );
  update public.contract_import_items
  set ai_job_id = owner_ai_job_id,
      error_code = case when original_file_name = 'film-dead.pdf' then 'manual_failure' else error_code end,
      error_message = case when original_file_name = 'film-dead.pdf' then 'Bevar denne sikre fejl' else error_message end
  where batch_id = import_batch
    and original_file_name in ('film-duplicate.pdf', 'film-dead.pdf');
  perform public.apply_contract_ai_extraction_v2(
    owner_ai_job_id,
    ai_lease,
    ai_input,
    jsonb_build_object(
      'extractedData', '{}'::jsonb,
      'validation', '{}'::jsonb,
      'contract', jsonb_build_object('ownerSuggestionId', other_holder),
      'import', jsonb_build_object('status', 'ready_for_review', 'matchVersion', 'post-review-v1')
    )
  );
  if not exists (
    select 1
    from public.contract_owner_verifications
    where contract_id = film_contract
      and assigned_rights_holder_id = assigned_holder
      and proposed_rights_holder_id is null
      and status = 'corrected'
      and reason_code = 'wrong_owner'
      and reviewed_by = admin_user
      and reviewed_at is not null
      and revision = corrected_revision
      and evidence_subject_rights_holder_id is null
      and evidence_ai_job_id is null
      and evidence_document_job_id is null
  ) then
    raise exception 'AI-apply overskrev en afsluttet manuel ejerskabsbeslutning';
  end if;
  if not exists (
      select 1 from public.contract_import_items
      where batch_id = import_batch
        and original_file_name = 'film-duplicate.pdf'
        and status = 'possible_duplicate'
    ) or not exists (
      select 1 from public.contract_import_items
      where batch_id = import_batch
        and original_file_name = 'film-dead.pdf'
        and status = 'dead'
        and error_code = 'manual_failure'
        and error_message = 'Bevar denne sikre fejl'
  ) then
    raise exception 'AI-apply overskrev en terminal, dublet- eller fejlstatus';
  end if;

  select revision into current_revision
  from public.contract_owner_verifications where contract_id = rollback_contract;
  perform set_config('app.test_reject_owner_audit', rollback_contract::text, true);
  begin
    perform public.review_contract_owner(
      rollback_contract, null, current_revision, 'reassign', assigned_holder,
      'wrong_owner', admin_user, test_org, 'admin'
    );
  exception when others then
    rollback_rejected := true;
  end;
  perform set_config('app.test_reject_owner_audit', '', true);
  if not rollback_rejected
    or not exists (
      select 1 from public.contracts
      where id = rollback_contract and rights_holder_id is null
    )
    or not exists (
      select 1 from public.contract_owner_verifications
      where contract_id = rollback_contract
        and assigned_rights_holder_id is null
        and status = 'pending'
        and revision = current_revision
    )
    or not exists (
      select 1 from public.contract_import_items
      where contract_id = rollback_contract and status = 'missing_owner'
    )
    or exists (
      select 1 from public.audit_events
      where entity_type = 'contract_owner_verification'
        and entity_id = rollback_contract::text
    ) then
    raise exception 'Auditfejl rullede ikke ejer, verification og importstatus atomisk tilbage';
  end if;

  -- Server-side candidate discovery respects final administrator decisions,
  -- while a session-bound member assignment may still be reopened when later
  -- document evidence identifies another active member.
  select revision into current_revision
  from public.contract_owner_verifications where contract_id = confirmed_contract;
  perform public.review_contract_owner(
    confirmed_contract, assigned_holder, current_revision, 'confirm', assigned_holder,
    'manual_identity_check', admin_user, test_org, 'admin'
  );
  perform public.record_contract_owner_provenance(
    session_contract, test_org, member_holder, 'authenticated_member_upload',
    member_user, 'contract_upload_intent', gen_random_uuid(), null
  );
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, completed_at, input_storage_path
  ) values
    (
      confirmed_ai_job_id, confirmed_contract, test_org, 'done', 'complete', 1, now(),
      test_org::text || '/admin-confirmed-owner.pdf'
    ),
    (
      session_ai_job_id, session_contract, test_org, 'done', 'complete', 1, now(),
      test_org::text || '/session-bound-owner.pdf'
    );

  select revision into current_revision
  from public.contract_owner_verifications where contract_id = confirmed_contract;
  candidate_result := public.record_contract_owner_candidate(
    confirmed_contract, test_org, other_holder, confirmed_ai_job_id,
    null, 'admin-confirmed-v1', 95
  );
  if not coalesce((candidate_result ->> 'skipped')::boolean, false)
    or not exists (
      select 1 from public.contract_owner_verifications
      where contract_id = confirmed_contract
        and status = 'confirmed'
        and reason_code = 'manual_identity_check'
        and proposed_rights_holder_id is null
        and revision = current_revision
    )
    or exists (
      select 1 from public.contract_owner_provenance
      where contract_id = confirmed_contract and origin = 'ai_suggestion'
    ) then
    raise exception 'Kandidat-RPC genåbnede en manuelt bekræftet ejer';
  end if;

  candidate_result := public.record_contract_owner_candidate(
    session_contract, test_org, other_holder, session_ai_job_id,
    null, 'session-conflict-v1', 95
  );
  if coalesce((candidate_result ->> 'skipped')::boolean, true)
    or not exists (
      select 1 from public.contract_owner_verifications
      where contract_id = session_contract
        and assigned_rights_holder_id = member_holder
        and proposed_rights_holder_id = other_holder
        and status = 'conflict'
        and reason_code = 'ai_candidate'
        and reviewed_by is null
        and reviewed_at is null
    ) then
    raise exception 'Sessionbundet ejer kunne ikke genåbnes ved modstridende AI-evidens';
  end if;
end;
$$;

select pass(
  'ejerskifte afleder importstatus atomisk, og AI kan ikke overskrive en manuel afgørelse'
);

select * from finish();
rollback;
