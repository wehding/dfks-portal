begin;

select plan(1);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $$
declare
  test_org constant uuid := '81000000-0000-4000-8000-000000000001';
  test_contract constant uuid := '81000000-0000-4000-8000-000000000002';
  stale_job constant uuid := '81000000-0000-4000-8000-000000000003';
  current_job constant uuid := '81000000-0000-4000-8000-000000000004';
  original_path constant text := '81000000-0000-4000-8000-000000000001/original.pdf';
  processed_path constant text := '81000000-0000-4000-8000-000000000001/processed.pdf';
  stale_claim record;
  current_claim record;
  status_contract_id uuid;
  status_job_id uuid;
  status_claim record;
  expected_status text;
begin
  insert into public.organisations (id, name)
  values (test_org, 'AI generation fence test');

  insert into public.contracts (id, org_id, type, status, pdf_url)
  values (test_contract, test_org, 'A-løn', 'kladde', original_path);

  insert into public.contract_ai_jobs (
    id, contract_id, org_id, status, stage, priority, next_attempt_at
  ) values (
    stale_job, test_contract, test_org, 'queued', 'extraction', 1, now()
  );

  select * into stale_claim
  from public.claim_next_contract_ai_job(stale_job, test_org);
  if stale_claim.id <> stale_job
    or stale_claim.lease_token is null
    or stale_claim.input_storage_path <> original_path then
    raise exception 'generation fence regression: original generation was not bound at claim';
  end if;

  -- This models the atomic effect of a successful OCR completion: the
  -- processed derivative becomes authoritative and every older base job dies.
  update public.contracts
  set processed_pdf_url = processed_path, document_processing_status = 'ready'
  where id = test_contract;
  update public.contract_ai_jobs
  set status = 'dead', error_code = 'superseded_by_document_processing',
      lease_expires_at = null, completed_at = now()
  where id = stale_job;

  begin
    perform public.save_contract_ai_extraction_v2(
      stale_job, stale_claim.lease_token, stale_claim.input_storage_path,
      '{"workTitle":"STALE ORIGINAL"}'::jsonb, null
    );
    raise exception 'generation fence regression: stale checkpoint was accepted';
  exception when sqlstate 'P0002' then
    null;
  end;

  begin
    perform public.apply_contract_ai_extraction_v2(
      stale_job, stale_claim.lease_token, stale_claim.input_storage_path,
      jsonb_build_object(
        'extractedData', jsonb_build_object('workTitle', 'STALE ORIGINAL'),
        'validation', '{}'::jsonb,
        'contract', jsonb_build_object(
          'applyType', false,
          'applyOverenskomst', false,
          'applyWorkingTitle', true,
          'workingTitle', 'STALE ORIGINAL',
          'applyContractDate', false,
          'applyStartDate', false,
          'applyEndDate', false
        ),
        'employerIds', '[]'::jsonb,
        'series', null,
        'import', jsonb_build_object('status', 'ready_for_review')
      )
    );
    raise exception 'generation fence regression: stale contract write was accepted';
  exception when sqlstate 'P0002' then
    null;
  end;

  if exists (
    select 1 from public.contract_validations where contract_id = test_contract
  ) or exists (
    select 1 from public.contracts
    where id = test_contract and working_title = 'STALE ORIGINAL'
  ) then
    raise exception 'generation fence regression: stale original data escaped the atomic fence';
  end if;

  insert into public.contract_ai_jobs (
    id, contract_id, org_id, status, stage, priority, next_attempt_at
  ) values (
    current_job, test_contract, test_org, 'queued', 'extraction', 1, now()
  );
  select * into current_claim
  from public.claim_next_contract_ai_job(current_job, test_org);
  if current_claim.id <> current_job
    or current_claim.lease_token is null
    or current_claim.input_storage_path <> processed_path then
    raise exception 'generation fence regression: processed generation was not bound at claim';
  end if;

  perform public.save_contract_ai_extraction_v2(
    current_job, current_claim.lease_token, current_claim.input_storage_path,
    '{"workTitle":"PROCESSED OCR"}'::jsonb, null
  );
  perform public.apply_contract_ai_extraction_v2(
    current_job, current_claim.lease_token, current_claim.input_storage_path,
    jsonb_build_object(
      'extractedData', jsonb_build_object('workTitle', 'PROCESSED OCR'),
      'validation', jsonb_build_object(
        'hasCreditClause', false,
        'hasTerminationClause', false,
        'hasIndemnification', false,
        'hasOverenskomstIncorporation', false
      ),
      'contract', jsonb_build_object(
        'applyType', false,
        'applyOverenskomst', false,
        'applyWorkingTitle', true,
        'workingTitle', 'PROCESSED OCR',
        'applyContractDate', false,
        'applyStartDate', false,
        'applyEndDate', false
      ),
      'employerIds', '[]'::jsonb,
      'series', null,
      'import', jsonb_build_object('status', 'ready_for_review')
    )
  );
  perform public.finalize_contract_ai_job_v2(
    current_job, current_claim.lease_token, current_claim.input_storage_path
  );

  if not exists (
    select 1
    from public.contracts contract
    join public.contract_validations validation on validation.contract_id = contract.id
    join public.contract_ai_jobs job on job.id = current_job
    where contract.id = test_contract
      and contract.status = 'kladde'
      and contract.working_title = 'PROCESSED OCR'
      and validation.extracted_data ->> 'workTitle' = 'PROCESSED OCR'
      and job.status = 'done'
      and job.lease_token is null
      and job.input_storage_path = processed_path
  ) then
    raise exception 'generation fence regression: current OCR generation did not apply atomically';
  end if;

  -- OCR backfill reanalyses existing contracts. Extraction may enrich their
  -- fields, but it must never change an already established legal status.
  foreach expected_status in array array['valideret', 'arkiveret'] loop
    status_contract_id := gen_random_uuid();
    status_job_id := gen_random_uuid();
    if expected_status = 'valideret' then
      perform set_config('app.explicit_contract_validation', 'on', true);
    end if;
    insert into public.contracts (id, org_id, type, status, pdf_url)
    values (
      status_contract_id,
      test_org,
      'A-løn',
      expected_status,
      test_org::text || '/' || status_contract_id::text || '.pdf'
    );
    perform set_config('app.explicit_contract_validation', 'off', true);
    insert into public.contract_ai_jobs (
      id, contract_id, org_id, status, stage, priority, next_attempt_at
    ) values (
      status_job_id, status_contract_id, test_org, 'queued', 'extraction', 1, now()
    );
    select * into status_claim
    from public.claim_next_contract_ai_job(status_job_id, test_org);
    perform public.apply_contract_ai_extraction_v2(
      status_job_id, status_claim.lease_token, status_claim.input_storage_path,
      jsonb_build_object(
        'extractedData', jsonb_build_object('workTitle', upper(expected_status)),
        'validation', jsonb_build_object(
          'hasCreditClause', false,
          'hasTerminationClause', false,
          'hasIndemnification', false,
          'hasOverenskomstIncorporation', false
        ),
        'contract', jsonb_build_object(
          'applyType', false,
          'applyOverenskomst', false,
          'applyWorkingTitle', true,
          'workingTitle', upper(expected_status),
          'applyContractDate', false,
          'applyStartDate', false,
          'applyEndDate', false
        ),
        'employerIds', '[]'::jsonb,
        'series', null,
        'import', jsonb_build_object('status', 'ready_for_review')
      )
    );
    perform public.finalize_contract_ai_job_v2(
      status_job_id, status_claim.lease_token, status_claim.input_storage_path
    );
    if not exists (
      select 1 from public.contracts
      where id = status_contract_id and status = expected_status
    ) then
      raise exception 'generation fence regression: AI reanalysis changed legal status %', expected_status;
    end if;
  end loop;
end;
$$;

reset role;
select pass('Stale original-PDF worker cannot overwrite the current OCR generation');
select * from finish();

rollback;
