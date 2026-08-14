begin;

select plan(1);

do $$
declare
  test_org uuid := gen_random_uuid();
  contract_one uuid := gen_random_uuid();
  contract_two uuid := gen_random_uuid();
  contract_three uuid := gen_random_uuid();
  job_one uuid := gen_random_uuid();
  job_two uuid := gen_random_uuid();
  job_three uuid := gen_random_uuid();
  claimed uuid;
begin
  insert into public.organisations (id, name)
  values (test_org, 'Robust import test ' || test_org::text);

  insert into public.contracts (id, org_id, type, status)
  values
    (contract_one, test_org, 'A-løn', 'kladde'),
    (contract_two, test_org, 'A-løn', 'kladde'),
    (contract_three, test_org, 'A-løn', 'kladde');

  insert into public.contract_ai_jobs (id, contract_id, org_id, status, priority, next_attempt_at)
  values
    (job_one, contract_one, test_org, 'queued', 1, now()),
    (job_two, contract_two, test_org, 'queued', 2, now()),
    (job_three, contract_three, test_org, 'queued', 3, now());

  select id into claimed from public.claim_next_contract_ai_job(null, test_org) limit 1;
  if claimed <> job_one then
    raise exception 'Job claim regression: expected first priority job, got %', claimed;
  end if;

  select id into claimed from public.claim_next_contract_ai_job(null, test_org) limit 1;
  if claimed <> job_two then
    raise exception 'Job claim regression: expected second priority job, got %', claimed;
  end if;

  select id into claimed from public.claim_next_contract_ai_job(null, test_org) limit 1;
  if claimed is not null then
    raise exception 'Concurrency regression: a third global job was claimed';
  end if;

  perform public.save_contract_ai_extraction(
    job_one,
    jsonb_build_object(
      'workingTitle', 'Testtitel',
      '_extractionMeta', jsonb_build_object('inputTokens', 1200, 'outputTokens', 150, 'chunkCount', 2)
    ),
    'provider-request-test'
  );
  if not exists (
    select 1 from public.contract_ai_jobs
    where id = job_one
      and stage = 'matching'
      and result_data ->> 'workingTitle' = 'Testtitel'
      and provider_request_id = 'provider-request-test'
      and input_tokens = 1200
      and output_tokens = 150
      and chunk_count = 2
  ) then
    raise exception 'Checkpoint regression: structured extraction was not saved';
  end if;

  perform public.renew_contract_ai_job_lease(job_one);
  if not exists (
    select 1 from public.contract_ai_jobs
    where id = job_one and lease_expires_at > now() + interval '14 minutes'
  ) then
    raise exception 'Lease regression: worker heartbeat did not extend the lease';
  end if;

  perform public.fail_contract_ai_job(
    job_one,
    'retry_wait',
    'transient',
    'retry_test',
    'Sikker testfejl',
    now(),
    true
  );
  if not exists (
    select 1 from public.contract_ai_jobs
    where id = job_one and attempts = 0 and lease_expires_at is null
  ) then
    raise exception 'Retry regression: refunded attempt or released lease is incorrect';
  end if;

  perform public.finalize_contract_ai_job(job_two);
  select id into claimed from public.claim_next_contract_ai_job(job_three, test_org) limit 1;
  if claimed <> job_three then
    raise exception 'Job claim regression: queued job was not claimable after a lease was released';
  end if;

  update public.contract_ai_jobs
  set result_data = '{"temporary":"checkpoint"}'::jsonb
  where id = job_three;
  perform public.finalize_contract_ai_job(job_three);
  if exists (
    select 1 from public.contract_ai_jobs
    where id = job_three
      and (status <> 'done' or stage <> 'complete' or result_data is not null)
  ) then
    raise exception 'Finalize regression: final job state or structured checkpoint cleanup is incorrect';
  end if;
end $$;

select pass('Kontraktimportens claim, checkpoint, retry og finalize-flow bestod');
select * from finish();

rollback;
