-- Fence every OCR -> AI generation with both a rotating lease token and the
-- exact storage object selected when the job was claimed. OCR completion
-- changes contracts.processed_pdf_url and marks older AI jobs dead in one
-- transaction; a worker from the original-PDF generation can therefore no
-- longer checkpoint or apply data after that transaction commits.

alter table public.contract_ai_jobs
  add column if not exists lease_token uuid,
  add column if not exists input_storage_path text;

comment on column public.contract_ai_jobs.lease_token is
  'Rotating service-only ownership token. Every mutating AI worker RPC must present the current token.';
comment on column public.contract_ai_jobs.input_storage_path is
  'Exact attachment/original/processed object selected at claim time. Used as the OCR generation fence.';

create or replace function public.clear_inactive_contract_ai_job_lease()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'processing' then
    new.lease_token := null;
  end if;
  return new;
end;
$$;

drop trigger if exists contract_ai_jobs_clear_inactive_lease on public.contract_ai_jobs;
create trigger contract_ai_jobs_clear_inactive_lease
before insert or update of status on public.contract_ai_jobs
for each row execute function public.clear_inactive_contract_ai_job_lease();

revoke all on function public.clear_inactive_contract_ai_job_lease() from public, anon, authenticated;

-- The return shape changes by two columns, so PostgreSQL requires a drop.
drop function if exists public.claim_next_contract_ai_job(uuid, uuid);
create function public.claim_next_contract_ai_job(p_job_id uuid default null, p_org_id uuid default null)
returns table(
  id uuid,
  contract_id uuid,
  org_id uuid,
  attempts integer,
  pdf_url text,
  attachment_id uuid,
  stage text,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  result_data jsonb,
  lease_expires_at timestamptz,
  created_by uuid,
  lease_token uuid,
  input_storage_path text
)
language sql
security definer
set search_path = ''
as $$
  with claim_guard as (
    select pg_catalog.pg_advisory_xact_lock(438221947) as locked
  ), picked as (
    select j.id,
           coalesce(a.pdf_url, c.processed_pdf_url, c.pdf_url) as selected_input
    from public.contract_ai_jobs j
    join public.contracts c on c.id = j.contract_id
    left join public.contract_attachments a on a.id = j.attachment_id
    cross join claim_guard
    where (
      j.status = 'queued'
      or (j.status = 'retry_wait' and j.next_attempt_at <= now())
      or (j.status = 'error' and j.attempts < 5 and j.next_attempt_at <= now())
      or (j.status = 'processing' and coalesce(j.lease_expires_at, j.started_at + interval '15 minutes') <= now())
    )
      and (p_job_id is null or j.id = p_job_id)
      and (p_org_id is null or j.org_id = p_org_id)
      and coalesce(a.pdf_url, c.processed_pdf_url, c.pdf_url) is not null
      and (
        select count(*) from public.contract_ai_jobs active
        where active.status = 'processing' and active.lease_expires_at > now()
      ) < 2
    order by j.priority asc, j.next_attempt_at asc, j.created_at asc
    limit 1
    for update of j skip locked
  ), updated as (
    update public.contract_ai_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        started_at = now(),
        lease_expires_at = now() + interval '15 minutes',
        lease_token = gen_random_uuid(),
        input_storage_path = picked.selected_input,
        updated_at = now(),
        failure_class = null,
        error_code = null,
        error_message = null
    from picked
    where j.id = picked.id
    returning j.*
  )
  select u.id, u.contract_id, u.org_id, u.attempts,
         u.input_storage_path, u.attachment_id, u.stage,
         u.provider, u.model, u.prompt_version, u.schema_version,
         u.result_data, u.lease_expires_at, u.created_by,
         u.lease_token, u.input_storage_path
  from updated u;
$$;

revoke all on function public.claim_next_contract_ai_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_contract_ai_job(uuid, uuid) to service_role;

-- Internal helper. The row lock is held until the calling RPC commits, which
-- serialises application of extraction data against OCR completion's update
-- of the same AI-job row.
create or replace function public.lock_current_contract_ai_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text
)
returns public.contract_ai_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  fenced public.contract_ai_jobs;
  current_input text;
  fenced_contract_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select contract_id into fenced_contract_id
  from public.contract_ai_jobs
  where id = p_job_id;
  if not found then
    raise exception 'AI job generation is no longer current' using errcode = 'P0002';
  end if;

  -- One transaction-level generation lock per contract establishes the same
  -- lock order for OCR completion and AI application. It prevents the cycle
  -- AI-job -> contract versus contract -> AI-job.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fenced_contract_id::text, 438221948)
  );

  select * into fenced
  from public.contract_ai_jobs
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
    and input_storage_path = p_input_storage_path
    and lease_expires_at > now()
  for update;
  if not found then
    raise exception 'AI job generation is no longer current' using errcode = 'P0002';
  end if;

  select coalesce(attachment.pdf_url, contract.processed_pdf_url, contract.pdf_url)
  into current_input
  from public.contracts contract
  left join public.contract_attachments attachment on attachment.id = fenced.attachment_id
  where contract.id = fenced.contract_id;

  if current_input is distinct from fenced.input_storage_path then
    raise exception 'AI job input generation was superseded' using errcode = 'P0002';
  end if;
  return fenced;
end;
$$;

revoke all on function public.lock_current_contract_ai_job(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.set_contract_ai_job_runtime_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  update public.contract_ai_jobs
  set provider = left(p_provider, 80),
      model = left(p_model, 160),
      prompt_version = left(p_prompt_version, 100),
      schema_version = left(p_schema_version, 100),
      updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
end;
$$;

create or replace function public.set_contract_ai_import_item_stage_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('analysing', 'matching') then
    raise exception 'invalid import stage' using errcode = '22023';
  end if;
  perform public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  update public.contract_import_items
  set status = p_status, updated_at = now()
  where ai_job_id = p_job_id;
end;
$$;

create or replace function public.save_contract_ai_extraction_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text,
  p_result_data jsonb,
  p_provider_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  extraction_meta jsonb := coalesce(p_result_data -> '_extractionMeta', '{}'::jsonb);
begin
  if p_result_data is null or jsonb_typeof(p_result_data) <> 'object' then
    raise exception 'Extraction result must be a JSON object' using errcode = '22023';
  end if;
  perform public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  update public.contract_ai_jobs
  set result_data = p_result_data,
      provider_request_id = left(p_provider_request_id, 200),
      usage_run_id = case
        when coalesce(extraction_meta ->> 'usageRunId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (extraction_meta ->> 'usageRunId')::uuid
        else null
      end,
      input_tokens = case when jsonb_typeof(extraction_meta -> 'inputTokens') = 'number'
        then greatest(0, (extraction_meta ->> 'inputTokens')::integer) else 0 end,
      output_tokens = case when jsonb_typeof(extraction_meta -> 'outputTokens') = 'number'
        then greatest(0, (extraction_meta ->> 'outputTokens')::integer) else 0 end,
      chunk_count = case when jsonb_typeof(extraction_meta -> 'chunkCount') = 'number'
        then greatest(0, (extraction_meta ->> 'chunkCount')::integer) else 0 end,
      stage = 'matching',
      lease_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
end;
$$;

create or replace function public.renew_contract_ai_job_lease_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  update public.contract_ai_jobs
  set lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
end;
$$;

-- Apply all contract, validation, producer, series and import-item mutations in
-- one fenced transaction. The JSON payload is server-only and every writable
-- field is selected explicitly below; it is not a generic patch facility.
create or replace function public.apply_contract_ai_extraction_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fenced public.contract_ai_jobs;
  extracted jsonb := coalesce(p_payload -> 'extractedData', '{}'::jsonb);
  validation_data jsonb := coalesce(p_payload -> 'validation', '{}'::jsonb);
  contract_data jsonb := coalesce(p_payload -> 'contract', '{}'::jsonb);
  import_data jsonb := coalesce(p_payload -> 'import', '{}'::jsonb);
  series_data jsonb := p_payload -> 'series';
  selected_work_id uuid;
  selected_holder_id uuid;
  selected_employer_id uuid;
  selected_series_id uuid;
  selected_scope public.member_series_episode_scopes;
  selected_season integer;
  actual_item_status text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(extracted) <> 'object'
    or jsonb_typeof(validation_data) <> 'object'
    or jsonb_typeof(contract_data) <> 'object'
    or jsonb_typeof(import_data) <> 'object' then
    raise exception 'invalid extraction payload' using errcode = '22023';
  end if;

  fenced := public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  if fenced.attachment_id is not null then
    raise exception 'attachment job cannot mutate the base contract' using errcode = '22023';
  end if;

  selected_work_id := case when coalesce(contract_data ->> 'workId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (contract_data ->> 'workId')::uuid else null end;
  selected_holder_id := case when coalesce(contract_data ->> 'rightsHolderId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (contract_data ->> 'rightsHolderId')::uuid else null end;
  selected_employer_id := case when coalesce(contract_data ->> 'employerId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (contract_data ->> 'employerId')::uuid else null end;

  insert into public.contract_validations (
    contract_id, org_id, holiday_pay_rate, beta_rate, has_credit_clause,
    has_termination_clause, termination_days_editor,
    termination_days_producer, has_indemnification,
    has_overenskomst_incorporation, extracted_data
  ) values (
    fenced.contract_id,
    fenced.org_id,
    nullif(validation_data ->> 'holidayPayRate', '')::numeric,
    nullif(validation_data ->> 'betaRate', '')::numeric,
    coalesce((validation_data ->> 'hasCreditClause')::boolean, false),
    coalesce((validation_data ->> 'hasTerminationClause')::boolean, false),
    nullif(validation_data ->> 'terminationDaysEditor', '')::integer,
    nullif(validation_data ->> 'terminationDaysProducer', '')::integer,
    coalesce((validation_data ->> 'hasIndemnification')::boolean, false),
    coalesce((validation_data ->> 'hasOverenskomstIncorporation')::boolean, false),
    extracted
  )
  on conflict (contract_id) do update set
    holiday_pay_rate = excluded.holiday_pay_rate,
    beta_rate = excluded.beta_rate,
    has_credit_clause = excluded.has_credit_clause,
    has_termination_clause = excluded.has_termination_clause,
    termination_days_editor = excluded.termination_days_editor,
    termination_days_producer = excluded.termination_days_producer,
    has_indemnification = excluded.has_indemnification,
    has_overenskomst_incorporation = excluded.has_overenskomst_incorporation,
    extracted_data = excluded.extracted_data;

  update public.contracts
  set type = case when coalesce((contract_data ->> 'applyType')::boolean, false)
        then coalesce(nullif(contract_data ->> 'type', ''), 'a-løn') else type end,
      overenskomst = case when coalesce((contract_data ->> 'applyOverenskomst')::boolean, false)
        then nullif(contract_data ->> 'overenskomst', '') else overenskomst end,
      working_title = case when coalesce((contract_data ->> 'applyWorkingTitle')::boolean, false)
        then nullif(contract_data ->> 'workingTitle', '') else working_title end,
      contract_date = case when coalesce((contract_data ->> 'applyContractDate')::boolean, false)
        then nullif(contract_data ->> 'contractDate', '')::date else contract_date end,
      start_date = case when coalesce((contract_data ->> 'applyStartDate')::boolean, false)
        then nullif(contract_data ->> 'startDate', '')::date else start_date end,
      end_date = case when coalesce((contract_data ->> 'applyEndDate')::boolean, false)
        then nullif(contract_data ->> 'endDate', '')::date else end_date end,
      rights_holder_id = coalesce(selected_holder_id, rights_holder_id),
      work_id = coalesce(selected_work_id, work_id),
      employer_id = coalesce(employer_id, selected_employer_id)
  where id = fenced.contract_id and org_id = fenced.org_id;
  if not found then
    raise exception 'contract disappeared during fenced apply' using errcode = 'P0002';
  end if;

  if selected_employer_id is not null
    and not exists (select 1 from public.contract_employers where contract_id = fenced.contract_id) then
    insert into public.contract_employers (
      contract_id, employer_id, relation_role, sort_order, source
    )
    select fenced.contract_id, employer_id, 'counterparty', ordinality - 1, 'contract_import'
    from jsonb_array_elements_text(coalesce(p_payload -> 'employerIds', '[]'::jsonb))
      with ordinality as value(employer_text, ordinality)
    cross join lateral (select value.employer_text::uuid as employer_id) parsed
    on conflict do nothing;
  end if;

  if series_data is not null and jsonb_typeof(series_data) = 'object'
    and selected_holder_id is not null
    and coalesce(series_data ->> 'seriesWorkId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    selected_series_id := (series_data ->> 'seriesWorkId')::uuid;
    selected_season := greatest(1, least(1000, coalesce(nullif(series_data ->> 'seasonNumber', '')::integer, 1)));
    insert into public.member_series_episode_scopes (
      org_id, rights_holder_id, series_work_id, season_number,
      status, episode_numbers, covers_whole_season, source, confirmed_at
    ) values (
      fenced.org_id, selected_holder_id, selected_series_id, selected_season,
      'pending', '{}', false, 'contract_upload', null
    )
    on conflict (org_id, rights_holder_id, series_work_id, season_number)
    do update set
      updated_at = case
        when public.member_series_episode_scopes.status = 'confirmed'
          then public.member_series_episode_scopes.updated_at
        else now()
      end,
      source = case
        when public.member_series_episode_scopes.status = 'confirmed'
          then public.member_series_episode_scopes.source
        else 'contract_upload'
      end
    returning * into selected_scope;

    update public.contracts
    set episode_scope_id = selected_scope.id,
        season_number = selected_scope.season_number,
        episode_numbers = case
          when selected_scope.status = 'confirmed' and selected_scope.covers_whole_season then '{}'
          when selected_scope.status = 'confirmed' then selected_scope.episode_numbers
          else null
        end
    where id = fenced.contract_id and org_id = fenced.org_id;
  end if;

  actual_item_status := coalesce(nullif(import_data ->> 'status', ''), 'ready_for_review');
  if selected_scope.id is not null and selected_scope.status <> 'confirmed'
    and actual_item_status = 'ready_for_review' then
    actual_item_status := 'awaiting_episode_confirmation';
  end if;

  update public.contract_import_items
  set status = actual_item_status,
      owner_match_score = nullif(import_data ->> 'ownerMatchScore', '')::numeric,
      work_match_score = nullif(import_data ->> 'workMatchScore', '')::numeric,
      producer_match_score = nullif(import_data ->> 'producerMatchScore', '')::numeric,
      owner_match_evidence = coalesce(import_data -> 'ownerMatchEvidence', '[]'::jsonb),
      work_match_evidence = coalesce(import_data -> 'workMatchEvidence', '[]'::jsonb),
      producer_match_evidence = coalesce(import_data -> 'producerMatchEvidence', '[]'::jsonb),
      owner_candidate_ids = coalesce(array(
        select candidate::uuid from jsonb_array_elements_text(coalesce(import_data -> 'ownerCandidateIds', '[]'::jsonb)) candidate
      ), '{}'),
      work_candidate_ids = coalesce(array(
        select candidate::uuid from jsonb_array_elements_text(coalesce(import_data -> 'workCandidateIds', '[]'::jsonb)) candidate
      ), '{}'),
      producer_candidate_ids = coalesce(array(
        select candidate::uuid from jsonb_array_elements_text(coalesce(import_data -> 'producerCandidateIds', '[]'::jsonb)) candidate
      ), '{}'),
      possible_duplicate_of = case
        when coalesce(import_data ->> 'possibleDuplicateOf', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (import_data ->> 'possibleDuplicateOf')::uuid
        else null
      end,
      duplicate_evidence = coalesce(import_data -> 'duplicateEvidence', '[]'::jsonb),
      match_version = left(import_data ->> 'matchVersion', 100),
      error_code = null,
      error_message = null,
      updated_at = now()
  where ai_job_id = p_job_id;

  update public.contract_ai_jobs
  set stage = 'finalizing', lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
  return actual_item_status;
end;
$$;

create or replace function public.apply_contract_attachment_extraction_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text,
  p_ai_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  fenced public.contract_ai_jobs;
begin
  if p_ai_result is null or jsonb_typeof(p_ai_result) <> 'object' then
    raise exception 'invalid attachment extraction payload' using errcode = '22023';
  end if;
  fenced := public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  if fenced.attachment_id is null then
    raise exception 'base contract job cannot mutate an attachment' using errcode = '22023';
  end if;
  update public.contract_attachments
  set ai_status = 'klar', ai_result = p_ai_result
  where id = fenced.attachment_id and contract_id = fenced.contract_id and org_id = fenced.org_id;
  if not found then
    raise exception 'attachment disappeared during fenced apply' using errcode = 'P0002';
  end if;
  update public.contract_ai_jobs
  set stage = 'finalizing', lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
end;
$$;

create or replace function public.finalize_contract_ai_job_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  update public.contract_ai_jobs
  set status = 'done', stage = 'complete', completed_at = now(),
      lease_expires_at = null, next_attempt_at = now(), error_message = null,
      failure_class = null, error_code = null, result_data = null,
      masked_text = null, updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
end;
$$;

create or replace function public.fail_contract_ai_job_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_input_storage_path text,
  p_status text,
  p_failure_class text,
  p_error_code text,
  p_error_message text,
  p_next_attempt_at timestamptz default null,
  p_refund_attempt boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('retry_wait', 'blocked', 'dead') then
    raise exception 'invalid failure status' using errcode = '22023';
  end if;
  begin
    perform public.lock_current_contract_ai_job(p_job_id, p_lease_token, p_input_storage_path);
  exception when sqlstate 'P0002' then
    return false;
  end;
  update public.contract_ai_jobs
  set status = p_status,
      attempts = case when p_refund_attempt then greatest(attempts - 1, 0) else attempts end,
      failure_class = left(p_failure_class, 50),
      error_code = left(p_error_code, 100),
      error_message = left(p_error_message, 500),
      next_attempt_at = coalesce(p_next_attempt_at, now()),
      lease_expires_at = null,
      updated_at = now()
  where id = p_job_id and lease_token = p_lease_token;
  return found;
end;
$$;

-- Old worker builds are deliberately unable to mutate jobs. A rolling deploy
-- can still claim, but every legacy checkpoint/apply/finalize call fails
-- closed until the new worker revision is active.
revoke execute on function public.save_contract_ai_extraction(uuid, jsonb, text) from service_role;
revoke execute on function public.renew_contract_ai_job_lease(uuid) from service_role;
revoke execute on function public.advance_contract_ai_job(uuid, text) from service_role;
revoke execute on function public.finalize_contract_ai_job(uuid) from service_role;
revoke execute on function public.fail_contract_ai_job(uuid, text, text, text, text, timestamptz, boolean) from service_role;

revoke all on function public.set_contract_ai_job_runtime_v2(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.set_contract_ai_import_item_stage_v2(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.save_contract_ai_extraction_v2(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.renew_contract_ai_job_lease_v2(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.apply_contract_ai_extraction_v2(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.apply_contract_attachment_extraction_v2(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_contract_ai_job_v2(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_contract_ai_job_v2(uuid, uuid, text, text, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;

grant execute on function public.set_contract_ai_job_runtime_v2(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.set_contract_ai_import_item_stage_v2(uuid, uuid, text, text) to service_role;
grant execute on function public.save_contract_ai_extraction_v2(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.renew_contract_ai_job_lease_v2(uuid, uuid, text) to service_role;
grant execute on function public.apply_contract_ai_extraction_v2(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.apply_contract_attachment_extraction_v2(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.finalize_contract_ai_job_v2(uuid, uuid, text) to service_role;
grant execute on function public.fail_contract_ai_job_v2(uuid, uuid, text, text, text, text, text, timestamptz, boolean) to service_role;

-- Acquire the same per-contract advisory lock before the existing document
-- completion function locks any rows. V4 itself remains the integrity gate;
-- V5 only guarantees a deadlock-free generation order.
create or replace function public.finish_contract_document_job_v5(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_document_classification text default null,
  p_ocr_engine text default null,
  p_orientation_corrections jsonb default '[]'::jsonb,
  p_ocr_applied boolean default false,
  p_page_count integer default null,
  p_text_char_count integer default null,
  p_native_page_count integer default 0,
  p_ocr_page_count integer default 0,
  p_unreadable_page_count integer default 0,
  p_redaction_counts jsonb default '{}'::jsonb,
  p_spatial_accuracy_score numeric default null,
  p_spatial_median_iou numeric default null,
  p_spatial_center_inside_ratio numeric default null,
  p_original_sha256 text default null,
  p_processed_sha256 text default null,
  p_redaction_profile text default null,
  p_spatial_schema_version text default null,
  p_spatial_sha256 text default null,
  p_error_code text default null,
  p_safe_error_message text default null
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  fenced_contract_id uuid;
  finished public.contract_document_jobs;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select contract_id into fenced_contract_id
  from public.contract_document_jobs
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > now();
  if not found then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fenced_contract_id::text, 438221948)
  );
  select * into finished
  from public.finish_contract_document_job_v4(
    p_job_id, p_lease_token, p_status, p_document_classification, p_ocr_engine,
    p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
    p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
    p_redaction_counts, p_spatial_accuracy_score, p_spatial_median_iou,
    p_spatial_center_inside_ratio, p_original_sha256, p_processed_sha256,
    p_redaction_profile, p_spatial_schema_version, p_spatial_sha256,
    p_error_code, p_safe_error_message
  );
  return finished;
end;
$$;

revoke execute on function public.finish_contract_document_job_v4(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) from service_role;
revoke all on function public.finish_contract_document_job_v5(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v5(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) to service_role;
