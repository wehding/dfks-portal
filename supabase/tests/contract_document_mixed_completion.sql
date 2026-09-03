begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  work_id uuid := gen_random_uuid();
  test_contract_id uuid := gen_random_uuid();
  job_id uuid := gen_random_uuid();
  claimed public.contract_document_jobs;
  output_path text;
  spatial_path text;
begin
  insert into public.organisations (id, name)
  values (test_org, 'Mixed OCR completion test ' || test_org::text);
  insert into public.works (id, org_id, title, type)
  values (work_id, test_org, 'Mixed OCR completion work', 'fiktion');
  insert into public.contracts (id, org_id, work_id, type, status, pdf_url)
  values (test_contract_id, test_org, work_id, 'A-løn', 'kladde', test_org || '/mixed.pdf');
  insert into public.contract_document_jobs (
    id, org_id, contract_id, original_storage_path, output_storage_path,
    spatial_data_path, priority
  ) values (
    job_id, test_org, test_contract_id, test_org || '/mixed.pdf',
    test_org || '/processed/mixed.pdf',
    test_org || '/processed/mixed-layout.json.gz', 2147483647
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into claimed from public.claim_next_contract_document_job(30);
  if claimed.id <> job_id or claimed.lease_token is null then
    raise exception 'Mixed OCR regression: test job was not claimed';
  end if;

  output_path := test_org || '/processed/' || test_contract_id || '/leases/'
    || claimed.lease_token || '/normalised.pdf';
  spatial_path := test_org || '/processed/' || test_contract_id || '/leases/'
    || claimed.lease_token || '/vision-layout.json.gz';
  update public.contract_document_jobs
  set output_storage_path = output_path, spatial_data_path = spatial_path
  where id = job_id and lease_token = claimed.lease_token;

  -- The counts are mutually exclusive source-page classes: one native page
  -- plus one OCR-required page in a two-page mixed source. Both pages may have
  -- passed through DLP/Vision when the safe derivative was rebuilt.
  perform public.finish_contract_document_job_v4(
    job_id, claimed.lease_token,
    'completed', 'mixed', 'google-vision-eu-v1', '[]'::jsonb,
    true, 2, 1200, 1, 1, 0, '{"PERSON_NAME": 1}'::jsonb,
    0.99, 0.90, 1.0, repeat('a', 64), repeat('b', 64),
    'dfks-contract-redaction-v1', 'google-vision-spatial-v2', repeat('c', 64), null, null
  );

  if not exists (
      select 1 from public.contract_document_jobs
      where id = job_id and status = 'completed' and lease_token is null
        and spatial_sha256 = repeat('c', 64)
        and native_page_count = 1 and ocr_page_count = 1 and page_count = 2
    )
    or not exists (
      select 1 from public.contracts
      where id = test_contract_id and status = 'kladde'
        and pdf_url = test_org || '/mixed.pdf'
        and processed_pdf_url = output_path
        and document_processing_status = 'ready'
    )
    or (select count(*) from public.contract_ai_jobs
        where contract_id = test_contract_id and attachment_id is null
          and status = 'queued') <> 1 then
    raise exception 'Mixed OCR regression: valid mixed completion was not committed atomically';
  end if;
end $$;

select pass('Blandet PDF bruger gensidigt udelukkende sidetællinger og afsluttes sikkert');
select * from finish();

rollback;
