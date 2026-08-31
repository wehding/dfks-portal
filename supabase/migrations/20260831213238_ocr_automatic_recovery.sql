-- Typed, bounded and immutable automatic recovery for terminal OCR jobs.
-- Only service-role RPCs can schedule a derivative generation. The original
-- storage path/hash and every terminal job remain immutable evidence.

create or replace function private.contract_document_recovery_policy_for_error(
  p_error_code text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case nullif(btrim(p_error_code), '')
    when 'ocr_spatial_quality' then 'spatial_remap_v2'
    when 'dlp_location_invalid' then 'dlp_coordinate_normalization_v1'
    when 'processed_file_too_large' then 'processed_pdf_downscale_v1'
    when 'vision_page_too_large' then 'vision_page_downscale_v1'
    when 'vision_response_too_large' then 'vision_pagewise_chunking_v1'
    else null
  end;
$$;

revoke all on function private.contract_document_recovery_policy_for_error(text)
  from public, anon, authenticated, service_role;

create or replace function private.contract_document_review_error_code_valid(
  p_error_code text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p_error_code), '') = any (array[
    'processing_deadline_exceeded',
    'invalid_download_origin',
    'file_too_large',
    'invalid_pdf',
    'original_sha256_mismatch',
    'ocr_no_readable_text',
    'ocr_unreadable_page',
    'ocr_spatial_quality',
    'orientation_uncertain',
    'page_geometry_unavailable',
    'document_page_limit_exceeded',
    'document_raster_budget_exceeded',
    'document_text_limit_exceeded',
    'processed_file_too_large',
    'spatial_artifact_too_large',
    'dlp_request_too_large',
    'dlp_too_many_locations',
    'dlp_response_too_large',
    'dlp_location_invalid',
    'dlp_location_out_of_bounds',
    'dlp_location_missing',
    'dlp_redacted_image_missing',
    'dlp_redacted_image_invalid',
    'dlp_redaction_not_applied',
    'dlp_image_dimensions_changed',
    'dlp_canonical_image_invalid',
    'vision_page_too_large',
    'vision_request_too_large',
    'vision_response_too_large',
    'vision_word_limit_exceeded',
    'low_text_quality'
  ]::text[]);
$$;

revoke all on function private.contract_document_review_error_code_valid(text)
  from public, anon, authenticated, service_role;

create or replace function private.contract_document_review_details_valid(
  p_details jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  detail_key text;
  reason_value jsonb;
  page_value jsonb;
  reason_key text;
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    return false;
  end if;

  for detail_key in select jsonb_object_keys(p_details) loop
    if detail_key not in ('schemaVersion', 'reasons') then
      return false;
    end if;
  end loop;
  if not (p_details ? 'schemaVersion')
    or jsonb_typeof(p_details -> 'schemaVersion') <> 'number'
    or (p_details ->> 'schemaVersion') <> '1'
    or not (p_details ? 'reasons')
    or jsonb_typeof(p_details -> 'reasons') <> 'array'
    or jsonb_array_length(p_details -> 'reasons') > 20 then
    return false;
  end if;

  for reason_value in select value from jsonb_array_elements(p_details -> 'reasons') loop
    if jsonb_typeof(reason_value) <> 'object' then
      return false;
    end if;
    for reason_key in select jsonb_object_keys(reason_value) loop
      if reason_key not in ('code', 'pageNumbers') then
        return false;
      end if;
    end loop;
    if not (reason_value ? 'code')
      or jsonb_typeof(reason_value -> 'code') <> 'string'
      or not private.contract_document_review_error_code_valid(reason_value ->> 'code')
      or not (reason_value ? 'pageNumbers')
      or jsonb_typeof(reason_value -> 'pageNumbers') <> 'array'
      or jsonb_array_length(reason_value -> 'pageNumbers') > 200 then
      return false;
    end if;
    for page_value in select value from jsonb_array_elements(reason_value -> 'pageNumbers') loop
      if jsonb_typeof(page_value) <> 'number'
        or page_value::text !~ '^[0-9]+$'
        or (page_value::text)::integer not between 1 and 200 then
        return false;
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

revoke all on function private.contract_document_review_details_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.contract_document_review_details_valid(jsonb)
  to service_role;

create or replace function private.canonical_contract_document_review_details(
  p_details jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  canonical jsonb;
begin
  if not private.contract_document_review_details_valid(p_details) then
    raise exception 'invalid review details' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'reasons', coalesce(jsonb_agg(
      jsonb_build_object(
        'code', reason_codes.code,
        'pageNumbers', reason_codes.page_numbers
      ) order by reason_codes.code
    ), '[]'::jsonb)
  ) into canonical
  from (
    select code,
      coalesce((
        select jsonb_agg(page_number order by page_number)
        from (
          select distinct (page_value::text)::integer as page_number
          from jsonb_array_elements(p_details -> 'reasons') as all_reason(reason)
          cross join lateral jsonb_array_elements(all_reason.reason -> 'pageNumbers') as pages(page_value)
          where all_reason.reason ->> 'code' = codes.code
        ) as unique_pages
      ), '[]'::jsonb) as page_numbers
    from (
      select distinct reason ->> 'code' as code
      from jsonb_array_elements(p_details -> 'reasons') as reason_rows(reason)
    ) as codes
  ) as reason_codes;
  return canonical;
end;
$$;

revoke all on function private.canonical_contract_document_review_details(jsonb)
  from public, anon, authenticated, service_role;

alter table public.contract_document_jobs
  add column if not exists review_details jsonb not null default
    '{"schemaVersion":1,"reasons":[]}'::jsonb,
  add column if not exists recovery_origin text not null default 'initial',
  add column if not exists automatic_recovery_policy text,
  add column if not exists automatic_recovery_generation smallint not null default 0,
  add column if not exists automatic_recovery_state text not null default 'not_applicable';

-- Recovery generations form one immutable lineage. SET NULL could turn a
-- recovery into an apparent initial job and violate the lineage check. A
-- deferred NO ACTION constraint preserves history, rejects deletion of a lone
-- parent, and still allows the owning contract to delete its complete lineage
-- atomically through the existing contract cascade.
alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_recovery_of_job_id_fkey,
  add constraint contract_document_jobs_recovery_of_job_id_fkey
    foreign key (recovery_of_job_id)
    references public.contract_document_jobs(id)
    on delete no action
    deferrable initially deferred;

-- Existing immutable retry generations were explicitly created by a member or
-- an operator. They are not counted as automatic recovery generations.
update public.contract_document_jobs
set recovery_origin = case
      when recovery_of_job_id is null then 'initial'
      when recovery_reason_code = 'member_retry' then 'member'
      else 'operator'
    end,
    automatic_recovery_policy = null,
    automatic_recovery_generation = 0,
    automatic_recovery_state = 'not_applicable',
    review_details = case
      when private.contract_document_review_error_code_valid(error_code)
        then jsonb_build_object(
          'schemaVersion', 1,
          'reasons', jsonb_build_array(
            jsonb_build_object('code', error_code, 'pageNumbers', '[]'::jsonb)
          )
        )
      else '{"schemaVersion":1,"reasons":[]}'::jsonb
    end
where recovery_origin = 'initial'
  and automatic_recovery_policy is null
  and automatic_recovery_generation = 0
  and review_details = '{"schemaVersion":1,"reasons":[]}'::jsonb;

create or replace function private.set_contract_document_job_recovery_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recovery_of_job_id is null then
    new.recovery_origin := 'initial';
  elsif new.recovery_origin = 'automatic' then
    -- Explicit automatic generations carry a checked policy and generation.
    null;
  elsif new.recovery_reason_code = 'member_retry' then
    new.recovery_origin := 'member';
  else
    new.recovery_origin := 'operator';
  end if;
  return new;
end;
$$;

revoke all on function private.set_contract_document_job_recovery_origin()
  from public, anon, authenticated, service_role;

drop trigger if exists contract_document_jobs_set_recovery_origin
  on public.contract_document_jobs;
create trigger contract_document_jobs_set_recovery_origin
before insert on public.contract_document_jobs
for each row execute function private.set_contract_document_job_recovery_origin();

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_review_details_check,
  add constraint contract_document_jobs_review_details_check check (
    private.contract_document_review_details_valid(review_details)
  ),
  drop constraint if exists contract_document_jobs_recovery_origin_check,
  add constraint contract_document_jobs_recovery_origin_check check (
    recovery_origin in ('initial', 'automatic', 'member', 'operator')
  ),
  drop constraint if exists contract_document_jobs_recovery_origin_lineage_check,
  add constraint contract_document_jobs_recovery_origin_lineage_check check (
    (recovery_origin = 'initial') = (recovery_of_job_id is null)
  ),
  drop constraint if exists contract_document_jobs_automatic_policy_check,
  add constraint contract_document_jobs_automatic_policy_check check (
    automatic_recovery_policy is null
    or automatic_recovery_policy in (
      'spatial_remap_v2',
      'dlp_coordinate_normalization_v1',
      'processed_pdf_downscale_v1',
      'vision_page_downscale_v1',
      'vision_pagewise_chunking_v1'
    )
  ),
  drop constraint if exists contract_document_jobs_automatic_generation_check,
  add constraint contract_document_jobs_automatic_generation_check check (
    (
      recovery_origin = 'automatic'
      and automatic_recovery_policy is not null
      and automatic_recovery_generation between 1 and 2
    )
    or (
      recovery_origin <> 'automatic'
      and automatic_recovery_policy is null
      and automatic_recovery_generation = 0
    )
  ),
  drop constraint if exists contract_document_jobs_automatic_state_check,
  add constraint contract_document_jobs_automatic_state_check check (
    automatic_recovery_state in (
      'not_applicable', 'queued', 'exhausted', 'ineligible', 'completed'
    )
  ),
  drop constraint if exists contract_document_jobs_review_disposition_check,
  add constraint contract_document_jobs_review_disposition_check check (
    review_disposition is null
    or review_disposition in (
      'retry_after_pipeline_fix', 'rescan_requested', 'manual_overlay',
      'manual_review_required'
    )
  );

create unique index if not exists contract_document_jobs_one_automatic_generation
  on public.contract_document_jobs(
    contract_id, automatic_recovery_generation
  )
  where recovery_origin = 'automatic';

create index if not exists contract_document_jobs_automatic_recovery_candidates
  on public.contract_document_jobs(status, updated_at, id)
  where status = 'needs_review' and recovery_origin in ('initial', 'automatic');

comment on column public.contract_document_jobs.review_details is
  'Sanitised operational evidence: allowlisted diagnostic codes and page numbers only.';
comment on column public.contract_document_jobs.automatic_recovery_generation is
  'Global automatic recovery generation for the contract; hard-capped at two.';

create or replace function private.queue_contract_document_job_automatic_recovery_core(
  p_source_job_id uuid,
  p_actor_user_id uuid default null
)
returns table(
  outcome text,
  source_job_id uuid,
  recovery_job_id uuid,
  policy_code text,
  automatic_generation smallint,
  downstream_ai_policy text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_job public.contract_document_jobs;
  locked_contract public.contracts;
  existing_child public.contract_document_jobs;
  selected_policy_code text;
  selected_ai_policy text;
  next_generation smallint;
  automatic_count integer;
  recovery_id uuid := gen_random_uuid();
  canonical_details jsonb;
  actor_kind text := case when p_actor_user_id is null then 'system' else 'user' end;
begin
  if p_source_job_id is null then
    raise exception 'invalid automatic recovery request' using errcode = '22023';
  end if;

  -- Lock order is always source job, then contract. This serialises completion,
  -- batch recovery and explicit admin recovery without an in-place reset.
  select job.* into source_job
  from public.contract_document_jobs as job
  where job.id = p_source_job_id
  for update of job;
  if source_job.id is null then
    raise exception 'document job not found' using errcode = 'P0002';
  end if;

  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = source_job.contract_id
  for update of contract;
  if locked_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if source_job.org_id <> locked_contract.org_id
    or source_job.original_storage_path is distinct from locked_contract.pdf_url then
    raise exception 'document recovery source mismatch' using errcode = '55000';
  end if;

  select child.* into existing_child
  from public.contract_document_jobs as child
  where child.recovery_of_job_id = source_job.id
  order by child.created_at desc, child.id desc
  limit 1;
  if existing_child.id is not null then
    return query select
      'already_queued'::text,
      source_job.id,
      existing_child.id,
      existing_child.automatic_recovery_policy,
      existing_child.automatic_recovery_generation,
      existing_child.downstream_ai_policy;
    return;
  end if;

  if source_job.status <> 'needs_review'
    or locked_contract.status not in ('kladde', 'valideret')
    or locked_contract.document_processing_status <> 'needs_review'
    or locked_contract.document_processing_error_code is distinct from source_job.error_code then
    raise exception 'document recovery generation mismatch' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.contract_document_jobs as newer
    where newer.contract_id = source_job.contract_id
      and newer.id <> source_job.id
      and (
        newer.created_at > source_job.created_at
        or (newer.created_at = source_job.created_at and newer.id::text > source_job.id::text)
      )
  ) then
    raise exception 'newer document generation exists' using errcode = '55000';
  end if;

  if source_job.review_disposition = 'rescan_requested' then
    update public.contract_document_jobs
    set automatic_recovery_state = 'ineligible', updated_at = now()
    where id = source_job.id;
    return query select
      'rescan_requested'::text, source_job.id, null::uuid, null::text,
      source_job.automatic_recovery_generation, source_job.downstream_ai_policy;
    return;
  end if;
  if source_job.review_disposition in ('manual_review_required', 'manual_overlay')
    or source_job.automatic_recovery_state in ('ineligible', 'exhausted', 'completed') then
    return query select
      case
        when source_job.automatic_recovery_state = 'exhausted' then 'limit_reached'
        else 'manual_review_required'
      end::text,
      source_job.id, null::uuid, null::text,
      source_job.automatic_recovery_generation, source_job.downstream_ai_policy;
    return;
  end if;

  selected_policy_code := private.contract_document_recovery_policy_for_error(source_job.error_code);
  canonical_details := private.canonical_contract_document_review_details(
    jsonb_build_object(
      'schemaVersion', 1,
      'reasons', coalesce(source_job.review_details -> 'reasons', '[]'::jsonb)
        || case
          when private.contract_document_review_error_code_valid(source_job.error_code)
            then jsonb_build_array(jsonb_build_object(
              'code', source_job.error_code,
              'pageNumbers', '[]'::jsonb
            ))
          else '[]'::jsonb
        end
    )
  );

  if selected_policy_code is null
    or source_job.original_sha256 is null
    or source_job.original_sha256 !~ '^[0-9a-f]{64}$' then
    update public.contract_document_jobs
    set review_disposition = 'manual_review_required',
        reviewed_at = now(),
        reviewed_by = p_actor_user_id,
        automatic_recovery_state = 'ineligible',
        review_details = canonical_details,
        updated_at = now()
    where id = source_job.id;

    perform public.append_audit_event_v2(
      p_action => 'job',
      p_entity_type => 'contract_document_job',
      p_entity_id => source_job.id::text,
      p_actor_user_id => p_actor_user_id,
      p_actor_type => actor_kind,
      p_actor_org_id => source_job.org_id,
      p_source => 'database',
      p_metadata => jsonb_build_object(
        'event_code', 'ocr_automatic_recovery_ineligible',
        'error_code', case
          when private.contract_document_review_error_code_valid(source_job.error_code)
            then source_job.error_code
          else 'unclassified'
        end,
        'has_valid_source_hash', source_job.original_sha256 ~ '^[0-9a-f]{64}$'
      ),
      p_target_member_uuid => locked_contract.rights_holder_id,
      p_purpose_code => 'contract_document_processing',
      p_data_categories => array['contract_data']::text[],
      p_system_component => 'ocr_automatic_recovery',
      p_org_ids => array[source_job.org_id]::uuid[]
    );

    return query select
      'manual_review_required'::text, source_job.id, null::uuid,
      selected_policy_code, source_job.automatic_recovery_generation,
      source_job.downstream_ai_policy;
    return;
  end if;

  select count(*)::integer into automatic_count
  from public.contract_document_jobs as generation
  where generation.contract_id = source_job.contract_id
    and generation.recovery_origin = 'automatic';

  if automatic_count >= 2 then
    update public.contract_document_jobs
    set review_disposition = 'manual_review_required',
        reviewed_at = now(),
        reviewed_by = p_actor_user_id,
        automatic_recovery_state = 'exhausted',
        review_details = canonical_details,
        updated_at = now()
    where id = source_job.id;

    perform public.append_audit_event_v2(
      p_action => 'job',
      p_entity_type => 'contract_document_job',
      p_entity_id => source_job.id::text,
      p_actor_user_id => p_actor_user_id,
      p_actor_type => actor_kind,
      p_actor_org_id => source_job.org_id,
      p_source => 'database',
      p_metadata => jsonb_build_object(
        'event_code', 'ocr_automatic_recovery_exhausted',
        'error_code', case
          when private.contract_document_review_error_code_valid(source_job.error_code)
            then source_job.error_code
          else 'unclassified'
        end,
        'policy_code', selected_policy_code,
        'automatic_generation_limit', 2
      ),
      p_target_member_uuid => locked_contract.rights_holder_id,
      p_purpose_code => 'contract_document_processing',
      p_data_categories => array['contract_data']::text[],
      p_system_component => 'ocr_automatic_recovery',
      p_org_ids => array[source_job.org_id]::uuid[]
    );

    return query select
      'limit_reached'::text, source_job.id, null::uuid, selected_policy_code,
      2::smallint, source_job.downstream_ai_policy;
    return;
  end if;

  if exists (
    select 1
    from public.contract_document_jobs as active
    where active.contract_id = source_job.contract_id
      and active.id <> source_job.id
      and (
        active.status in ('queued', 'processing')
        or (active.status = 'failed' and active.attempts < 5)
      )
  ) then
    raise exception 'another document job is active' using errcode = '55000';
  end if;

  next_generation := (automatic_count + 1)::smallint;
  selected_ai_policy := case
    when locked_contract.status = 'valideret' then 'preserve'
    else 'reanalyze'
  end;

  insert into public.contract_document_jobs (
    id, org_id, contract_id, original_storage_path, output_storage_path,
    status, priority, attempts, next_attempt_at, created_by,
    original_sha256, recovery_of_job_id, downstream_ai_policy,
    recovery_reason_code, review_details, recovery_origin,
    automatic_recovery_policy, automatic_recovery_generation,
    automatic_recovery_state, created_at
  ) values (
    recovery_id, source_job.org_id, source_job.contract_id,
    source_job.original_storage_path,
    source_job.org_id::text || '/processed/' || source_job.contract_id::text
      || '/pending/' || recovery_id::text || '/normalised.pdf',
    'queued', 1100, 0, now(), source_job.created_by,
    lower(source_job.original_sha256), source_job.id, selected_ai_policy,
    'automatic_' || selected_policy_code, canonical_details, 'automatic',
    selected_policy_code, next_generation, 'queued', clock_timestamp()
  );

  update public.contract_document_jobs
  set review_disposition = 'retry_after_pipeline_fix',
      reviewed_at = now(),
      reviewed_by = p_actor_user_id,
      automatic_recovery_state = 'queued',
      review_details = canonical_details,
      updated_at = now()
  where id = source_job.id;

  update public.contracts
  set document_processing_status = 'pending',
      document_processing_error_code = null
  where id = source_job.contract_id
    and org_id = source_job.org_id
    and pdf_url is not distinct from source_job.original_storage_path;
  if not found then
    raise exception 'document recovery contract fence failed' using errcode = '55000';
  end if;

  perform public.append_audit_event_v2(
    p_action => 'job',
    p_entity_type => 'contract_document_job',
    p_entity_id => recovery_id::text,
    p_actor_user_id => p_actor_user_id,
    p_actor_type => actor_kind,
    p_actor_org_id => source_job.org_id,
    p_source => 'database',
    p_metadata => jsonb_build_object(
      'event_code', 'ocr_automatic_recovery_queued',
      'error_code', case
        when private.contract_document_review_error_code_valid(source_job.error_code)
          then source_job.error_code
        else 'unclassified'
      end,
      'policy_code', selected_policy_code,
      'automatic_generation', next_generation
    ),
    p_target_member_uuid => locked_contract.rights_holder_id,
    p_purpose_code => 'contract_document_processing',
    p_data_categories => array['contract_data']::text[],
    p_system_component => 'ocr_automatic_recovery',
    p_org_ids => array[source_job.org_id]::uuid[]
  );

  return query select
    'queued'::text, source_job.id, recovery_id, selected_policy_code,
    next_generation, selected_ai_policy;
end;
$$;

revoke all on function private.queue_contract_document_job_automatic_recovery_core(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.queue_contract_document_job_automatic_recovery(
  p_source_job_id uuid
)
returns table(
  outcome text,
  source_job_id uuid,
  recovery_job_id uuid,
  policy_code text,
  automatic_generation smallint,
  downstream_ai_policy text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select *
    from private.queue_contract_document_job_automatic_recovery_core(
      p_source_job_id, null
    );
end;
$$;

revoke all on function public.queue_contract_document_job_automatic_recovery(uuid)
  from public, anon, authenticated;
grant execute on function public.queue_contract_document_job_automatic_recovery(uuid)
  to service_role;

create or replace function public.queue_contract_document_job_automatic_recovery_batch(
  p_limit integer default 100
)
returns table(
  outcome text,
  source_job_id uuid,
  recovery_job_id uuid,
  policy_code text,
  automatic_generation smallint,
  downstream_ai_policy text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  queued record;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid automatic recovery batch limit' using errcode = '22023';
  end if;

  for candidate in
    select job.id
    from public.contract_document_jobs as job
    join public.contracts as contract
      on contract.id = job.contract_id
     and contract.org_id = job.org_id
     and contract.pdf_url is not distinct from job.original_storage_path
     and contract.status in ('kladde', 'valideret')
     and contract.document_processing_status = 'needs_review'
     and contract.document_processing_error_code is not distinct from job.error_code
    where job.status = 'needs_review'
      and job.review_disposition is null
      and job.automatic_recovery_state not in ('ineligible', 'exhausted', 'completed')
      and job.original_sha256 ~ '^[0-9a-f]{64}$'
      and private.contract_document_recovery_policy_for_error(job.error_code) is not null
      and not exists (
        select 1
        from public.contract_document_jobs as newer
        where newer.contract_id = job.contract_id
          and newer.id <> job.id
          and (
            newer.created_at > job.created_at
            or (newer.created_at = job.created_at and newer.id::text > job.id::text)
          )
      )
    order by job.updated_at asc, job.id asc
    limit p_limit
    for update of job skip locked
  loop
    select * into queued
    from private.queue_contract_document_job_automatic_recovery_core(
      candidate.id, null
    );
    return query select
      queued.outcome::text,
      queued.source_job_id::uuid,
      queued.recovery_job_id::uuid,
      queued.policy_code::text,
      queued.automatic_generation::smallint,
      queued.downstream_ai_policy::text;
  end loop;
end;
$$;

revoke all on function public.queue_contract_document_job_automatic_recovery_batch(integer)
  from public, anon, authenticated;
grant execute on function public.queue_contract_document_job_automatic_recovery_batch(integer)
  to service_role;

create or replace function public.admin_contract_document_review_action(
  p_contract_id uuid,
  p_org_id uuid,
  p_action text,
  p_actor_user_id uuid
)
returns table(outcome text, job_id uuid, review_disposition text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_job public.contract_document_jobs;
  locked_contract public.contracts;
  recovery_result record;
  selected_disposition text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_contract_id is null or p_org_id is null or p_actor_user_id is null
    or p_action not in (
      'retry', 'request_rescan', 'require_manual_review', 'manual_overlay'
    ) then
    raise exception 'invalid review action' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.user_org_roles as role_row
    where role_row.user_id = p_actor_user_id
      and (
        role_row.role = 'superadmin'
        or (
          role_row.org_id = p_org_id
          and role_row.role in ('admin', 'org-admin', 'jurist')
        )
      )
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select job.* into selected_job
  from public.contract_document_jobs as job
  where job.contract_id = p_contract_id
    and job.org_id = p_org_id
    and job.status = 'needs_review'
  order by job.created_at desc, job.id desc
  limit 1
  for update of job;
  if selected_job.id is null then
    raise exception 'review job not found' using errcode = 'P0002';
  end if;

  select contract.* into locked_contract
  from public.contracts as contract
  where contract.id = p_contract_id and contract.org_id = p_org_id
  for update of contract;
  if locked_contract.id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if selected_job.original_storage_path is distinct from locked_contract.pdf_url
    or (
      p_action = 'retry'
      and locked_contract.document_processing_status not in ('needs_review', 'pending')
    )
    or (
      p_action <> 'retry'
      and locked_contract.document_processing_status <> 'needs_review'
    ) then
    raise exception 'review action generation mismatch' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.contract_document_jobs as newer
    where newer.contract_id = selected_job.contract_id
      and newer.id <> selected_job.id
      and (
        newer.created_at > selected_job.created_at
        or (
          newer.created_at = selected_job.created_at
          and newer.id::text > selected_job.id::text
        )
      )
  ) and not (
    p_action = 'retry'
    and exists (
      select 1
      from public.contract_document_jobs as child
      where child.recovery_of_job_id = selected_job.id
    )
  ) then
    raise exception 'newer document generation exists' using errcode = '55000';
  end if;
  if p_action = 'request_rescan' and locked_contract.status <> 'kladde' then
    raise exception 'rescan requires a draft contract' using errcode = '55000';
  end if;

  if p_action = 'retry' then
    select * into recovery_result
    from private.queue_contract_document_job_automatic_recovery_core(
      selected_job.id, p_actor_user_id
    );
    if recovery_result.outcome in ('queued', 'already_queued') then
      perform public.append_audit_event_v2(
        p_action => 'job',
        p_entity_type => 'contract_document_job',
        p_entity_id => selected_job.id::text,
        p_actor_user_id => p_actor_user_id,
        p_actor_type => 'user',
        p_actor_org_id => p_org_id,
        p_source => 'admin',
        p_metadata => jsonb_build_object(
          'event_code', 'ocr_admin_retry_requested',
          'retry_outcome', case
            when recovery_result.outcome = 'queued' then 'queued'
            else 'already_queued'
          end,
          'error_code', case
            when private.contract_document_review_error_code_valid(selected_job.error_code)
              then selected_job.error_code
            else 'unclassified'
          end
        ),
        p_target_member_uuid => locked_contract.rights_holder_id,
        p_purpose_code => 'contract_document_processing',
        p_data_categories => array['contract_data']::text[],
        p_system_component => 'admin_contract_document_review',
        p_org_ids => array[p_org_id]::uuid[]
      );

      return query select
        case
          when recovery_result.outcome = 'queued' then 'retry_queued'::text
          else 'retry_already_queued'::text
        end,
        recovery_result.recovery_job_id::uuid,
        'retry_after_pipeline_fix'::text;
    else
      return query select
        ('retry_' || recovery_result.outcome)::text,
        selected_job.id,
        (select job.review_disposition
         from public.contract_document_jobs as job
         where job.id = selected_job.id);
    end if;
    return;
  end if;

  selected_disposition := case p_action
    when 'request_rescan' then 'rescan_requested'
    when 'manual_overlay' then 'manual_overlay'
    else 'manual_review_required'
  end;

  update public.contract_document_jobs
  set review_disposition = selected_disposition,
      reviewed_at = now(),
      reviewed_by = p_actor_user_id,
      automatic_recovery_state = 'ineligible',
      updated_at = now()
  where id = selected_job.id
    and org_id = p_org_id;

  update public.contracts
  set document_processing_status = 'needs_review',
      document_processing_error_code = case
        when p_action = 'request_rescan' then 'ocr_rescan_required'
        else document_processing_error_code
      end
  where id = p_contract_id and org_id = p_org_id;

  perform public.append_audit_event_v2(
    p_action => 'update',
    p_entity_type => 'contract_document_job',
    p_entity_id => selected_job.id::text,
    p_actor_user_id => p_actor_user_id,
    p_actor_type => 'user',
    p_actor_org_id => p_org_id,
    p_source => 'admin',
    p_metadata => jsonb_build_object(
      'event_code', 'ocr_review_disposition_changed',
      'review_action', p_action,
      'review_disposition', selected_disposition,
      'error_code', case
        when private.contract_document_review_error_code_valid(selected_job.error_code)
          then selected_job.error_code
        else 'unclassified'
      end
    ),
    p_target_member_uuid => locked_contract.rights_holder_id,
    p_purpose_code => 'contract_document_processing',
    p_data_categories => array['contract_data']::text[],
    p_system_component => 'admin_contract_document_review',
    p_org_ids => array[p_org_id]::uuid[]
  );

  return query select
    selected_disposition, selected_job.id, selected_disposition;
end;
$$;

revoke all on function public.admin_contract_document_review_action(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_contract_document_review_action(uuid, uuid, text, uuid)
  to service_role;

-- V6 adds sanitised page-level review evidence and atomically schedules a
-- bounded recovery generation after a needs_review completion.
create or replace function public.finish_contract_document_job_v6(
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
  p_safe_error_message text default null,
  p_review_details jsonb default '{"schemaVersion":1,"reasons":[]}'::jsonb
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished public.contract_document_jobs;
  canonical_details jsonb;
  effective_original_sha256 text;
  fenced_contract_id uuid;
  active_job public.contract_document_jobs;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.contract_document_review_details_valid(
    coalesce(p_review_details, '{"schemaVersion":1,"reasons":[]}'::jsonb)
  ) then
    raise exception 'invalid review details' using errcode = '22023';
  end if;
  if p_status = 'needs_review'
    and (
      p_error_code is null
      or not private.contract_document_review_error_code_valid(p_error_code)
    ) then
    raise exception 'needs_review requires a known safe error code'
      using errcode = '22023';
  end if;
  if p_page_count is not null and exists (
    select 1
    from jsonb_array_elements(p_review_details -> 'reasons') as reason_rows(reason)
    cross join lateral jsonb_array_elements(reason_rows.reason -> 'pageNumbers') as pages(page_number)
    where (pages.page_number::text)::integer > p_page_count
  ) then
    raise exception 'review page exceeds document page count' using errcode = '22023';
  end if;
  if p_status <> 'needs_review'
    and p_review_details <> '{"schemaVersion":1,"reasons":[]}'::jsonb then
    raise exception 'review details require needs_review status' using errcode = '22023';
  end if;
  if p_original_sha256 is not null and p_original_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'invalid original hash' using errcode = '22023';
  end if;

  select job.contract_id into fenced_contract_id
  from public.contract_document_jobs as job
  where job.id = p_job_id;
  if fenced_contract_id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fenced_contract_id::text, 438221948)
  );
  select job.* into active_job
  from public.contract_document_jobs as job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > now()
  for update;
  if active_job.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;
  if active_job.original_sha256 is not null
    and p_original_sha256 is not null
    and lower(active_job.original_sha256) <> lower(p_original_sha256) then
    raise exception 'original hash changed during processing' using errcode = '55000';
  end if;
  effective_original_sha256 := coalesce(
    lower(p_original_sha256),
    lower(active_job.original_sha256)
  );

  canonical_details := case
    when p_status = 'needs_review' then
      private.canonical_contract_document_review_details(
        jsonb_build_object(
          'schemaVersion', 1,
          'reasons', coalesce(p_review_details -> 'reasons', '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object(
              'code', p_error_code,
              'pageNumbers', '[]'::jsonb
            ))
        )
      )
    else '{"schemaVersion":1,"reasons":[]}'::jsonb
  end;

  select * into finished
  from public.finish_contract_document_job_v5(
    p_job_id, p_lease_token, p_status, p_document_classification, p_ocr_engine,
    p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
    p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
    p_redaction_counts, p_spatial_accuracy_score, p_spatial_median_iou,
    p_spatial_center_inside_ratio, effective_original_sha256, p_processed_sha256,
    p_redaction_profile, p_spatial_schema_version, p_spatial_sha256,
    p_error_code, p_safe_error_message
  );

  update public.contract_document_jobs
  set review_details = canonical_details,
      updated_at = now()
  where id = finished.id;

  if finished.recovery_origin = 'automatic'
    and p_status in ('completed', 'not_required') then
    with recursive lineage(id, recovery_of_job_id) as (
      select job.id, job.recovery_of_job_id
      from public.contract_document_jobs as job
      where job.id = finished.id
      union all
      select parent.id, parent.recovery_of_job_id
      from public.contract_document_jobs as parent
      join lineage on parent.id = lineage.recovery_of_job_id
    )
    update public.contract_document_jobs as ancestor
    set automatic_recovery_state = 'completed', updated_at = now()
    where ancestor.id in (select lineage.id from lineage);
  elsif p_status = 'needs_review' then
    perform 1
    from private.queue_contract_document_job_automatic_recovery_core(finished.id, null);
  end if;

  select job.* into finished
  from public.contract_document_jobs as job
  where job.id = p_job_id;
  return finished;
end;
$$;

-- All legacy completion entrypoints are now fail-closed for runtime callers.
revoke execute on function public.finish_contract_document_job(
  uuid, text, jsonb, boolean, integer, integer, text, text
) from service_role;
revoke execute on function public.finish_contract_document_job_v2(
  uuid, text, text, text, jsonb, boolean, integer, integer, integer, integer,
  integer, jsonb, numeric, numeric, numeric, text, text, text, text
) from service_role;
revoke execute on function public.finish_contract_document_job_v3(
  uuid, text, text, text, jsonb, boolean, integer, integer, integer, integer,
  integer, jsonb, numeric, numeric, numeric, text, text, text, text, text, text
) from service_role;
revoke execute on function public.finish_contract_document_job_v4(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) from service_role;
revoke execute on function public.finish_contract_document_job_v5(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) from service_role;

revoke all on function public.finish_contract_document_job_v6(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v6(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text, jsonb
) to service_role;
