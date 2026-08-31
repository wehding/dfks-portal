begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  contract_id uuid := gen_random_uuid();
  blocked_id uuid := gen_random_uuid();
  validated_contract_id uuid := gen_random_uuid();
  validated_blocked_id uuid := gen_random_uuid();
  foreign_contract_id uuid := gen_random_uuid();
  foreign_recovery_id uuid := gen_random_uuid();
  exhausted_id uuid := gen_random_uuid();
  runnable_id uuid := gen_random_uuid();
  original_path text;
  processed_path text;
  queued record;
  finished record;
  rejected boolean;
begin
  if has_function_privilege(
      'public',
      'public.queue_blocked_contract_ai_job_for_recovery(uuid,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.queue_blocked_contract_ai_job_for_recovery(uuid,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.queue_blocked_contract_ai_job_for_recovery(uuid,text,text,text,text)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.queue_blocked_contract_ai_job_for_recovery(uuid,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.finish_blocked_contract_ai_job_recovery(uuid,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'public',
      'public.finish_blocked_contract_ai_job_recovery(uuid,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.finish_blocked_contract_ai_job_recovery(uuid,uuid)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.finish_blocked_contract_ai_job_recovery(uuid,uuid)',
      'EXECUTE'
    ) then
    raise exception 'AI recovery regression: service-only privileges are incorrect';
  end if;

  insert into public.organisations(id, name)
  values (test_org, 'Guarded AI recovery ' || test_org::text);
  original_path := test_org || '/' || contract_id || '/original.pdf';
  processed_path := test_org || '/' || contract_id || '/processed.pdf';
  insert into public.contracts(
    id, org_id, type, status, pdf_url, processed_pdf_url,
    document_processing_status
  ) values (
    contract_id, test_org, 'a-løn', 'kladde', original_path, processed_path,
    'ready'
  );
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, priority, attempts,
    failure_class, error_code, error_message, next_attempt_at,
    provider, model, prompt_version, schema_version, input_storage_path,
    result_data, provider_request_id, usage_run_id,
    input_tokens, output_tokens, chunk_count, created_at
  ) values (
    blocked_id, contract_id, test_org, 'blocked', 'extraction', 100, 1,
    'billing', 'invalid_request_error', 'Sikker udbyderfejl', now(),
    'anthropic', 'claude-sonnet-4-6', 'prompt-v1', 'schema-v1', processed_path,
    null, null, null, 0, 0, 0, now() - interval '1 minute'
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  rejected := false;
  begin
    perform public.queue_blocked_contract_ai_job_for_recovery(
      blocked_id, 'billing', 'invalid_request_error', 'anthropic', 'wrong-model'
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected or not exists (
    select 1 from public.contract_ai_jobs
    where id = blocked_id and status = 'blocked'
      and failure_class = 'billing' and error_code = 'invalid_request_error'
  ) then
    raise exception 'AI recovery regression: runtime precondition was bypassed';
  end if;

  select * into queued
  from public.queue_blocked_contract_ai_job_for_recovery(
    blocked_id, 'billing', 'invalid_request_error',
    'anthropic', 'claude-sonnet-4-6'
  );
  if queued.outcome <> 'queued' or queued.blocked_job_id <> blocked_id
    or queued.recovery_job_id is null
    or not exists (
      select 1 from public.contract_ai_jobs
      where id = blocked_id and status = 'blocked'
        and failure_class = 'billing' and error_code = 'invalid_request_error'
        and error_message = 'Sikker udbyderfejl'
        and input_storage_path = processed_path
    )
    or not exists (
      select 1 from public.contract_ai_jobs
      where id = queued.recovery_job_id and status = 'queued'
        and stage = 'extraction' and attempts = 0
        and provider = 'anthropic' and model = 'claude-sonnet-4-6'
        and prompt_version = 'prompt-v1' and schema_version = 'schema-v1'
        and recovery_of_job_id = blocked_id
        and input_storage_path is null
    ) then
    raise exception 'AI recovery regression: fresh generation was not created safely';
  end if;

  -- The partial unique index is the non-cooperative race fence for every
  -- direct insert path in the application.
  rejected := false;
  begin
    insert into public.contract_ai_jobs(
      contract_id, org_id, status, stage, priority
    ) values (contract_id, test_org, 'queued', 'extraction', 100);
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'AI recovery regression: duplicate runnable generation was accepted';
  end if;

  rejected := false;
  begin
    perform public.queue_blocked_contract_ai_job_for_recovery(
      blocked_id, 'billing', 'invalid_request_error',
      'anthropic', 'claude-sonnet-4-6'
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'AI recovery regression: same blocked generation was queued twice';
  end if;

  update public.contract_ai_jobs
  set status = 'done', stage = 'complete', input_storage_path = processed_path,
      completed_at = now(), result_data = '{"ok":true}'::jsonb
  where id = queued.recovery_job_id;

  -- A completed AI generation from a different contract can never be used to
  -- supersede this blocked row, even when the caller knows both UUIDs.
  insert into public.contracts(
    id, org_id, type, status, pdf_url, processed_pdf_url,
    document_processing_status
  ) values (
    foreign_contract_id, test_org, 'a-løn', 'kladde',
    test_org || '/' || foreign_contract_id || '/original.pdf',
    test_org || '/' || foreign_contract_id || '/processed.pdf', 'ready'
  );
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, provider, model,
    input_storage_path, result_data, recovery_of_job_id
  ) values (
    foreign_recovery_id, foreign_contract_id, test_org, 'done', 'complete',
    'anthropic', 'claude-sonnet-4-6',
    test_org || '/' || foreign_contract_id || '/processed.pdf',
    '{"ok":true}'::jsonb, null
  );
  rejected := false;
  begin
    perform public.finish_blocked_contract_ai_job_recovery(
      blocked_id, foreign_recovery_id
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'AI recovery regression: cross-contract completion was accepted';
  end if;

  select * into finished
  from public.finish_blocked_contract_ai_job_recovery(
    blocked_id, queued.recovery_job_id
  );
  if finished.outcome <> 'superseded'
    or not exists (
      select 1 from public.contract_ai_jobs
      where id = blocked_id and status = 'dead'
        and failure_class = 'billing' and error_code = 'invalid_request_error'
        and error_message = 'Sikker udbyderfejl'
        and input_storage_path = processed_path
        and superseded_by_job_id = queued.recovery_job_id
        and superseded_at is not null
    )
    or not exists (
      select 1 from public.contract_ai_jobs
      where id = queued.recovery_job_id and status = 'done'
        and result_data = '{"ok":true}'::jsonb
    )
    or not exists (
      select 1 from public.contracts
      where id = contract_id and status = 'kladde'
        and document_processing_status = 'ready'
    ) then
    raise exception 'AI recovery regression: successful recovery did not preserve history';
  end if;

  -- An exhausted error is historical, not runnable. It must not prevent one
  -- new queued generation for the same contract.
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, provider, model
  ) values (
    exhausted_id, contract_id, test_org, 'error', 'extraction', 5,
    'anthropic', 'claude-sonnet-4-6'
  );
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, attempts, provider, model
  ) values (
    runnable_id, contract_id, test_org, 'queued', 'extraction', 0,
    'anthropic', 'claude-sonnet-4-6'
  );
  if not exists (
    select 1 from public.contract_ai_jobs
    where id = exhausted_id and status = 'error' and attempts = 5
  ) or not exists (
    select 1 from public.contract_ai_jobs
    where id = runnable_id and status = 'queued'
  ) then
    raise exception 'AI recovery regression: exhausted error blocked a runnable generation';
  end if;
  delete from public.contract_ai_jobs where id in (runnable_id, exhausted_id);

  -- A legally validated contract is never eligible for extraction recovery.
  original_path := test_org || '/' || validated_contract_id || '/original.pdf';
  processed_path := test_org || '/' || validated_contract_id || '/processed.pdf';
  insert into public.contracts(
    id, org_id, type, status, pdf_url, processed_pdf_url,
    document_processing_status
  ) values (
    validated_contract_id, test_org, 'a-løn', 'valideret', original_path,
    processed_path, 'ready'
  );
  insert into public.contract_ai_jobs(
    id, contract_id, org_id, status, stage, failure_class, error_code,
    provider, model, input_storage_path
  ) values (
    validated_blocked_id, validated_contract_id, test_org, 'blocked',
    'extraction', 'billing', 'invalid_request_error', 'anthropic',
    'claude-sonnet-4-6', processed_path
  );
  rejected := false;
  begin
    perform public.queue_blocked_contract_ai_job_for_recovery(
      validated_blocked_id, 'billing', 'invalid_request_error',
      'anthropic', 'claude-sonnet-4-6'
    );
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'AI recovery regression: validated contract was accepted';
  end if;
end $$;

select pass('AI recovery creates one fresh generation and preserves blocked evidence');
select * from finish();

rollback;
