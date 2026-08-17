-- Robust, resumable contract-import pipeline.
-- The migration is additive: old queued/error jobs remain claimable while new
-- workers persist extraction output before matching and finalisation.

alter table public.contract_ai_jobs
  drop constraint if exists contract_ai_jobs_status_check,
  drop constraint if exists contract_ai_jobs_stage_check,
  drop constraint if exists contract_ai_jobs_failure_class_check;

alter table public.contract_ai_jobs
  add column if not exists stage text not null default 'extraction',
  add column if not exists failure_class text,
  add column if not exists error_code text,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists lease_expires_at timestamptz,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists schema_version text,
  add column if not exists result_data jsonb,
  add column if not exists provider_request_id text,
  add column if not exists usage_run_id uuid references public.ai_usage_runs(id) on delete set null,
  add column if not exists input_tokens integer not null default 0,
  add column if not exists output_tokens integer not null default 0,
  add column if not exists chunk_count integer not null default 0;

alter table public.contract_ai_jobs
  add constraint contract_ai_jobs_status_check
    check (status in ('queued','processing','retry_wait','blocked','done','dead','error')),
  add constraint contract_ai_jobs_stage_check
    check (stage in ('extraction','matching','finalizing','complete')),
  add constraint contract_ai_jobs_failure_class_check
    check (failure_class is null or failure_class in ('configuration','billing','rate_limit','transient','input','invalid_output','internal'));

comment on column public.contract_ai_jobs.result_data is
  'Server-only structured AI extraction. Never contains the source document or masked document text.';
comment on column public.contract_ai_jobs.lease_expires_at is
  'Lease deadline used to recover jobs after a worker stops unexpectedly.';

update public.contract_ai_jobs
set next_attempt_at = coalesce(updated_at, created_at, now()),
    stage = case when status = 'done' then 'complete' else 'extraction' end
where next_attempt_at is null or (status = 'done' and stage <> 'complete');

drop index if exists public.contract_ai_jobs_one_active_attachment;
create unique index contract_ai_jobs_one_active_attachment
  on public.contract_ai_jobs (attachment_id)
  where attachment_id is not null and status in ('queued','processing','retry_wait','blocked','error');

create index if not exists contract_ai_jobs_claim_idx
  on public.contract_ai_jobs (status, next_attempt_at, priority, created_at)
  where status in ('queued','retry_wait','processing','error');
create index if not exists contract_ai_jobs_lease_idx
  on public.contract_ai_jobs (lease_expires_at)
  where status = 'processing';
create index if not exists employer_aliases_alias_trgm_idx
  on public.employer_aliases using gin (lower(alias) extensions.gin_trgm_ops);
create index if not exists employer_legal_entities_name_trgm_idx
  on public.employer_legal_entities using gin (lower(legal_name) extensions.gin_trgm_ops);
create index if not exists contracts_working_title_trgm_idx
  on public.contracts using gin (lower(working_title) extensions.gin_trgm_ops)
  where working_title is not null;

alter table public.contract_import_items
  drop constraint if exists contract_import_items_status_check;

alter table public.contract_import_items
  add constraint contract_import_items_status_check check (status in (
    'awaiting_upload','uploaded','duplicate','possible_duplicate','queued','analysing','matching',
    'missing_owner','missing_work','awaiting_episode_confirmation','ready_for_review',
    'completed','retryable_error','blocked','needs_ocr','dead','cancelled'
  )),
  add column if not exists producer_match_score numeric(5,2),
  add column if not exists producer_match_evidence jsonb not null default '[]'::jsonb,
  add column if not exists owner_candidate_ids uuid[] not null default '{}',
  add column if not exists work_candidate_ids uuid[] not null default '{}',
  add column if not exists producer_candidate_ids uuid[] not null default '{}',
  add column if not exists possible_duplicate_of uuid references public.contracts(id) on delete set null,
  add column if not exists duplicate_evidence jsonb not null default '[]'::jsonb;

comment on column public.contract_import_items.producer_match_evidence is
  'Safe structured match reasons only; never source document text, contact data or secrets.';
comment on column public.contract_import_items.duplicate_evidence is
  'Safe duplicate signals such as normalized title/year/file metadata; never document content.';

-- Claim one due job with SKIP LOCKED. A crashed worker loses its lease and the
-- job becomes claimable again without requiring manual intervention.
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
  created_by uuid
)
language sql
security definer
set search_path = ''
as $$
  with claim_guard as (
    select pg_catalog.pg_advisory_xact_lock(438221947) as locked
  ), picked as (
    select j.id
    from public.contract_ai_jobs j cross join claim_guard
    where (
      j.status = 'queued'
      or (j.status = 'retry_wait' and j.next_attempt_at <= now())
      or (j.status = 'error' and j.attempts < 5 and j.next_attempt_at <= now())
      or (j.status = 'processing' and coalesce(j.lease_expires_at, j.started_at + interval '15 minutes') <= now())
    )
      and (p_job_id is null or j.id = p_job_id)
      and (p_org_id is null or j.org_id = p_org_id)
      and (
        select count(*) from public.contract_ai_jobs active
        where active.status = 'processing' and active.lease_expires_at > now()
      ) < 2
    order by j.priority asc, j.next_attempt_at asc, j.created_at asc
    limit 1
    for update skip locked
  ), updated as (
    update public.contract_ai_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        started_at = now(),
        lease_expires_at = now() + interval '15 minutes',
        updated_at = now(),
        failure_class = null,
        error_code = null,
        error_message = null
    from picked
    where j.id = picked.id
    returning j.*
  )
  select u.id, u.contract_id, u.org_id, u.attempts,
         coalesce(a.pdf_url, c.pdf_url), u.attachment_id, u.stage,
         u.provider, u.model, u.prompt_version, u.schema_version,
         u.result_data, u.lease_expires_at, u.created_by
  from updated u
  join public.contracts c on c.id = u.contract_id
  left join public.contract_attachments a on a.id = u.attachment_id;
$$;
revoke all on function public.claim_next_contract_ai_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_contract_ai_job(uuid, uuid) to service_role;

create or replace function public.save_contract_ai_extraction(
  p_job_id uuid,
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
    raise exception 'Extraction result must be a JSON object';
  end if;
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
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'AI job is not leased'; end if;
end;
$$;
revoke all on function public.save_contract_ai_extraction(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_contract_ai_extraction(uuid, jsonb, text) to service_role;

create or replace function public.renew_contract_ai_job_lease(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contract_ai_jobs
  set lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'AI job is not leased'; end if;
end;
$$;
revoke all on function public.renew_contract_ai_job_lease(uuid) from public, anon, authenticated;
grant execute on function public.renew_contract_ai_job_lease(uuid) to service_role;

create or replace function public.advance_contract_ai_job(p_job_id uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_stage not in ('matching','finalizing') then raise exception 'Invalid AI job stage'; end if;
  update public.contract_ai_jobs
  set stage = p_stage, lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'AI job is not leased'; end if;
end;
$$;
revoke all on function public.advance_contract_ai_job(uuid, text) from public, anon, authenticated;
grant execute on function public.advance_contract_ai_job(uuid, text) to service_role;

create or replace function public.finalize_contract_ai_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contract_ai_jobs
  set status = 'done', stage = 'complete', completed_at = now(),
      lease_expires_at = null, next_attempt_at = now(), error_message = null,
      failure_class = null, error_code = null, result_data = null,
      masked_text = null, updated_at = now()
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'AI job is not leased'; end if;
end;
$$;
revoke all on function public.finalize_contract_ai_job(uuid) from public, anon, authenticated;
grant execute on function public.finalize_contract_ai_job(uuid) to service_role;

create or replace function public.fail_contract_ai_job(
  p_job_id uuid,
  p_status text,
  p_failure_class text,
  p_error_code text,
  p_error_message text,
  p_next_attempt_at timestamptz default null,
  p_refund_attempt boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('retry_wait','blocked','dead') then raise exception 'Invalid failure status'; end if;
  update public.contract_ai_jobs
  set status = p_status,
      attempts = case when p_refund_attempt then greatest(attempts - 1, 0) else attempts end,
      failure_class = left(p_failure_class, 50),
      error_code = left(p_error_code, 100),
      error_message = left(p_error_message, 500),
      next_attempt_at = coalesce(p_next_attempt_at, now()),
      lease_expires_at = null,
      updated_at = now()
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'AI job is not leased'; end if;
end;
$$;
revoke all on function public.fail_contract_ai_job(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.fail_contract_ai_job(uuid, text, text, text, text, timestamptz, boolean) to service_role;

-- Indexed/database-side candidate retrieval avoids downloading an arbitrary
-- first N rows before applying the deterministic match score in TypeScript.
create or replace function public.search_contract_work_candidates(p_query text, p_limit integer default 100)
returns table(id uuid, title text, alternative_titles text[], year integer, type text, search_similarity real)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.title, w.alternative_titles, w.year, w.type,
         greatest(
           extensions.similarity(lower(w.title), lower(trim(p_query))),
           coalesce((select max(extensions.similarity(lower(alias), lower(trim(p_query)))) from unnest(w.alternative_titles) alias), 0)
         )::real as search_similarity
  from public.works w
  where w.parent_work_id is null
    and length(trim(p_query)) >= 2
    and (
      lower(w.title) operator(extensions.%) lower(trim(p_query))
      or lower(w.title) like '%' || lower(trim(p_query)) || '%'
      or exists (
        select 1 from unnest(w.alternative_titles) alias
        where extensions.similarity(lower(alias), lower(trim(p_query))) >= 0.2
           or lower(alias) like '%' || lower(trim(p_query)) || '%'
      )
    )
  order by search_similarity desc, w.year desc nulls last, w.id
  limit least(greatest(p_limit, 1), 250);
$$;
revoke all on function public.search_contract_work_candidates(text, integer) from public, anon, authenticated;
grant execute on function public.search_contract_work_candidates(text, integer) to service_role;

create or replace function public.search_contract_holder_candidates(p_org_id uuid, p_query text, p_limit integer default 100)
returns table(id uuid, full_name text, alternative_names text[], search_similarity real)
language sql
stable
security definer
set search_path = ''
as $$
  select scored.id, scored.full_name, scored.alternative_names, max(scored.search_similarity)::real
  from (
    select r.id, r.full_name, r.alternative_names,
           greatest(
             extensions.similarity(lower(r.full_name), lower(trim(p_query))),
             coalesce((select max(extensions.similarity(lower(alias), lower(trim(p_query)))) from unnest(r.alternative_names) alias), 0)
           )::real as search_similarity
    from public.rettighedshavere r
    join public.org_affiliations oa on oa.rights_holder_id = r.id and oa.org_id = p_org_id
    where length(trim(p_query)) >= 2
      and (
        lower(r.full_name) operator(extensions.%) lower(trim(p_query))
        or lower(r.full_name) like '%' || lower(trim(p_query)) || '%'
        or exists (
          select 1 from unnest(r.alternative_names) alias
          where extensions.similarity(lower(alias), lower(trim(p_query))) >= 0.2
             or lower(alias) like '%' || lower(trim(p_query)) || '%'
        )
      )
  ) scored
  group by scored.id, scored.full_name, scored.alternative_names
  order by max(scored.search_similarity) desc, scored.id
  limit least(greatest(p_limit, 1), 250);
$$;
revoke all on function public.search_contract_holder_candidates(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_contract_holder_candidates(uuid, text, integer) to service_role;

create or replace function public.search_contract_duplicate_candidates(
  p_org_id uuid,
  p_contract_id uuid,
  p_title text,
  p_limit integer default 100
)
returns table(
  id uuid,
  working_title text,
  contract_date date,
  rights_holder_id uuid,
  work_id uuid,
  search_similarity real
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.working_title, c.contract_date, c.rights_holder_id, c.work_id,
         extensions.similarity(lower(c.working_title), lower(trim(p_title)))::real as search_similarity
  from public.contracts c
  where c.org_id = p_org_id
    and c.id <> p_contract_id
    and c.working_title is not null
    and length(trim(p_title)) >= 2
    and extensions.similarity(lower(c.working_title), lower(trim(p_title))) >= 0.45
  order by search_similarity desc, c.created_at desc, c.id
  limit least(greatest(p_limit, 1), 250);
$$;
revoke all on function public.search_contract_duplicate_candidates(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_contract_duplicate_candidates(uuid, uuid, text, integer) to service_role;

-- Batch counters include retry waits as pending work and explicit blocked/OCR
-- outcomes as failed/manual-attention outcomes.
create or replace function private.refresh_contract_import_batch(target_batch_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.contract_import_batches batch
  set discovered_count = stats.total,
      uploaded_count = stats.uploaded,
      duplicate_count = stats.duplicates,
      completed_count = stats.completed,
      failed_count = stats.failed,
      status = case
        when batch.status = 'cancelled' then 'cancelled'
        when stats.total = 0 or stats.pending > 0 then 'processing'
        when stats.failed > 0 then 'partially_failed'
        else 'completed'
      end,
      completed_at = case when stats.total > 0 and stats.pending = 0 then coalesce(batch.completed_at, now()) else null end,
      updated_at = now()
  from (
    select count(*)::integer total,
      count(*) filter (where status <> 'awaiting_upload')::integer uploaded,
      count(*) filter (where status in ('duplicate','possible_duplicate'))::integer duplicates,
      count(*) filter (where status in ('ready_for_review','completed','missing_owner','missing_work','awaiting_episode_confirmation','possible_duplicate'))::integer completed,
      count(*) filter (where status in ('blocked','needs_ocr','dead'))::integer failed,
      count(*) filter (where status in ('awaiting_upload','uploaded','queued','analysing','matching','retryable_error'))::integer pending
    from public.contract_import_items where batch_id = target_batch_id
  ) stats
  where batch.id = target_batch_id;
$$;
revoke all on function private.refresh_contract_import_batch(uuid) from public, anon, authenticated;
grant execute on function private.refresh_contract_import_batch(uuid) to service_role;

-- Once the new worker is deployed, a service-role-only setup call stores the
-- worker URL and secret in Vault and schedules a five-minute pg_cron job. No
-- secret is embedded in this migration or exposed to browser roles.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.configure_contract_import_cron(p_worker_url text, p_internal_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job bigint;
begin
  if p_worker_url !~ '^https://[^[:space:]]+/api/contracts/jobs/process$' then
    raise exception 'Worker URL must use HTTPS and end with /api/contracts/jobs/process';
  end if;
  if length(p_internal_secret) < 32 then raise exception 'Worker secret is too short'; end if;

  delete from vault.secrets where name in ('contract_import_worker_url','contract_import_worker_secret');
  perform vault.create_secret(p_worker_url, 'contract_import_worker_url', 'Contract import worker endpoint');
  perform vault.create_secret(p_internal_secret, 'contract_import_worker_secret', 'Internal API secret for contract import worker');

  select jobid into existing_job from cron.job where jobname = 'contract-import-worker';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'contract-import-worker',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'contract_import_worker_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'contract_import_worker_secret')
        ),
        body := '{"source":"supabase_cron"}'::jsonb,
        timeout_milliseconds := 10000
      );
    $cron$
  );
end;
$$;
revoke all on function public.configure_contract_import_cron(text, text) from public, anon, authenticated;
grant execute on function public.configure_contract_import_cron(text, text) to service_role;
