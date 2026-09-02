begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  contract_id uuid := gen_random_uuid();
  source_job_id uuid := gen_random_uuid();
  recovery record;
  source_path text;
begin
  if has_function_privilege(
    'authenticated',
    'public.queue_word_contract_document_recovery(uuid,text,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'Word recovery must not be callable by browser roles';
  end if;

  source_path := test_org::text || '/archive/contract.docx';
  insert into public.organisations(id, name)
  values (test_org, 'Word recovery test ' || test_org::text);
  insert into public.contracts(
    id, org_id, type, status, pdf_url,
    document_processing_status, document_processing_error_code
  ) values (
    contract_id, test_org, 'a-løn', 'kladde', source_path,
    'needs_review', 'invalid_pdf'
  );
  insert into public.contract_document_jobs(
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, attempts, error_code, safe_error_message
  ) values (
    source_job_id, test_org, contract_id, source_path,
    test_org::text || '/processed/' || contract_id::text || '/old.pdf',
    'needs_review', 1, 'invalid_pdf', 'Filen er ikke en gyldig PDF.'
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into recovery from public.queue_word_contract_document_recovery(
    source_job_id, source_path, repeat('a', 64), 1000
  );

  if recovery.outcome <> 'queued'
    or recovery.source_job_id <> source_job_id
    or recovery.downstream_ai_policy <> 'reanalyze'
    or not exists (
      select 1 from public.contract_document_jobs
      where id = source_job_id and status = 'needs_review'
        and error_code = 'invalid_pdf'
        and review_disposition = 'retry_after_pipeline_fix'
    )
    or not exists (
      select 1 from public.contract_document_jobs
      where id = recovery.recovery_job_id and status = 'queued'
        and recovery_of_job_id = source_job_id
        and original_storage_path = source_path
        and original_sha256 = repeat('a', 64)
        and recovery_reason_code = 'word_conversion_enabled'
    )
    or not exists (
      select 1 from public.contracts
      where id = contract_id and document_processing_status = 'pending'
        and document_processing_error_code is null
    ) then
    raise exception 'Word recovery did not preserve history and create a fenced generation';
  end if;
end $$;

select pass('Word-kontrakter genkøs som immutable og hash-bundne jobgenerationer');
select * from finish();

rollback;
