begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  actor_id uuid := gen_random_uuid();
  work_id uuid := gen_random_uuid();
  previous_id uuid := gen_random_uuid();
  current_id uuid := gen_random_uuid();
  job_id uuid := gen_random_uuid();
  second_contract_id uuid := gen_random_uuid();
  third_contract_id uuid := gen_random_uuid();
  second_job_id uuid := gen_random_uuid();
  third_job_id uuid := gen_random_uuid();
  claimed public.contract_document_jobs;
  claimed_second public.contract_document_jobs;
  claimed_third public.contract_document_jobs;
begin
  if has_table_privilege('anon', 'public.contract_document_jobs', 'SELECT')
    or has_table_privilege('authenticated', 'public.contract_document_jobs', 'SELECT')
    or has_function_privilege('authenticated', 'public.claim_next_contract_document_job(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job(uuid,text,jsonb,boolean,integer,integer,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finish_contract_document_job_v2(uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text)', 'EXECUTE') then
    raise exception 'Document queue regression: browser roles can access the server-only queue';
  end if;

  insert into public.organisations (id, name) values (test_org, 'Document security test ' || test_org::text);
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (actor_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', actor_id || '@example.invalid', '', now(), now());
  insert into public.works (id, org_id, title, type) values (work_id, test_org, 'Versionsværk', 'fiktion');
  insert into public.contracts (id, org_id, work_id, type, status, pdf_url)
  values
    (previous_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/previous.pdf'),
    (current_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/current.pdf');

  perform set_config('request.jwt.claim.role', 'service_role', true);

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
  select * into claimed from public.claim_next_contract_document_job(10);
  select * into claimed_second from public.claim_next_contract_document_job(10);
  select * into claimed_third from public.claim_next_contract_document_job(10);
  if claimed.id is null or claimed_second.id is null or claimed_third.id is null
    or claimed.id = claimed_second.id or claimed.id = claimed_third.id or claimed_second.id = claimed_third.id
    or claimed.status <> 'processing' or claimed_second.status <> 'processing' or claimed_third.status <> 'processing' then
    raise exception 'Document queue regression: job was not claimed safely';
  end if;
  if position('for update skip locked' in lower(pg_get_functiondef('public.claim_next_contract_document_job(integer)'::regprocedure))) = 0 then
    raise exception 'Document queue regression: parallel claims are not protected by SKIP LOCKED';
  end if;
  perform public.finish_contract_document_job_v2(
    job_id, 'completed', 'image_only', 'google-vision-eu-v1', '[]'::jsonb,
    true, 2, 1000, 0, 2, 0, '{"DENMARK_CPR_NUMBER": 1}'::jsonb,
    0.99, 0.90, 1.0, repeat('a', 64), repeat('b', 64), null, null
  );
  if not exists (
    select 1 from public.contracts
    where id = current_id and pdf_url = test_org || '/current.pdf'
      and processed_pdf_url = test_org || '/processed/current.pdf'
      and document_processing_status = 'ready'
      and document_ocr_engine = 'google-vision-eu-v1'
      and document_spatial_data_path = test_org || '/processed/vision-layout.json.gz'
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
  perform public.finish_contract_document_job_v2(
    second_job_id, 'not_required', 'native_text', null, '[]'::jsonb,
    false, 1, 750, 1, 0, 0, '{}'::jsonb,
    null, null, null, repeat('c', 64), null, null, null
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
end $$;

select pass('Kontraktversioner og dokumentkø har server-only adgang og bevarer originalen');
select * from finish();

rollback;
