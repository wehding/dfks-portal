-- Contract version chains and server-only PDF normalisation/OCR queue.
-- The original file remains immutable in contracts.pdf_url. Processed derivatives
-- are stored separately and may be regenerated without changing the legal source.

alter table public.contracts
  add column if not exists superseded_by_contract_id uuid references public.contracts(id) on delete restrict,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists processed_pdf_url text,
  add column if not exists document_processing_status text not null default 'pending',
  add column if not exists document_processing_error_code text,
  add column if not exists document_processed_at timestamptz;

alter table public.contracts
  drop constraint if exists contracts_document_processing_status_check,
  add constraint contracts_document_processing_status_check
    check (document_processing_status in ('pending', 'processing', 'ready', 'needs_review', 'failed', 'not_required')),
  drop constraint if exists contracts_superseded_metadata_check,
  add constraint contracts_superseded_metadata_check check (
    (superseded_by_contract_id is null and superseded_at is null)
    or (superseded_by_contract_id is not null and superseded_at is not null)
  ),
  drop constraint if exists contracts_not_self_superseded_check,
  add constraint contracts_not_self_superseded_check check (superseded_by_contract_id is null or superseded_by_contract_id <> id);

create unique index if not exists contracts_one_direct_predecessor_idx
  on public.contracts (superseded_by_contract_id)
  where superseded_by_contract_id is not null;
create index if not exists contracts_current_org_idx
  on public.contracts (org_id, created_at desc)
  where superseded_by_contract_id is null;

create table if not exists public.contract_document_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  original_storage_path text not null,
  output_storage_path text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'needs_review')),
  priority integer not null default 100,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  orientation_corrections jsonb not null default '[]'::jsonb,
  ocr_applied boolean not null default false,
  page_count integer,
  text_char_count integer,
  error_code text,
  safe_error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint contract_document_jobs_safe_paths check (
    original_storage_path !~ '(^|/)\.\.(/|$)'
    and output_storage_path !~ '(^|/)\.\.(/|$)'
  )
);

create unique index if not exists contract_document_jobs_one_active_contract_idx
  on public.contract_document_jobs (contract_id)
  where status in ('queued', 'processing', 'failed');
create index if not exists contract_document_jobs_claim_idx
  on public.contract_document_jobs (status, next_attempt_at, priority desc, created_at)
  where status in ('queued', 'processing', 'failed');

alter table public.contract_document_jobs enable row level security;
revoke all on table public.contract_document_jobs from anon, authenticated;
grant select, insert, update on table public.contract_document_jobs to service_role;

create or replace function public.claim_next_contract_document_job(p_lease_minutes integer default 10)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.contract_document_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with candidate as (
    select id
    from public.contract_document_jobs
    where (
      (status = 'queued' and next_attempt_at <= now())
      or (status = 'failed' and next_attempt_at <= now())
      or (status = 'processing' and lease_expires_at < now())
    )
    and attempts < 5
    order by priority desc, created_at
    for update skip locked
    limit 1
  )
  update public.contract_document_jobs j
  set status = 'processing',
      attempts = attempts + 1,
      lease_expires_at = now() + make_interval(mins => greatest(1, least(p_lease_minutes, 30))),
      error_code = null,
      safe_error_message = null,
      updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.* into claimed;

  if claimed.id is not null then
    update public.contracts
    set document_processing_status = 'processing', document_processing_error_code = null
    where id = claimed.contract_id;
  end if;
  return claimed;
end;
$$;

create or replace function public.finish_contract_document_job(
  p_job_id uuid,
  p_status text,
  p_orientation_corrections jsonb default '[]'::jsonb,
  p_ocr_applied boolean default false,
  p_page_count integer default null,
  p_text_char_count integer default null,
  p_error_code text default null,
  p_safe_error_message text default null
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  finished public.contract_document_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed', 'needs_review') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  update public.contract_document_jobs
  set status = p_status,
      orientation_corrections = coalesce(p_orientation_corrections, '[]'::jsonb),
      ocr_applied = coalesce(p_ocr_applied, false),
      page_count = p_page_count,
      text_char_count = p_text_char_count,
      error_code = left(p_error_code, 80),
      safe_error_message = left(p_safe_error_message, 500),
      lease_expires_at = null,
      completed_at = case when p_status = 'completed' then now() else null end,
      next_attempt_at = case when p_status = 'failed' and attempts < 5 then now() + make_interval(mins => attempts * 5) else next_attempt_at end,
      updated_at = now()
  where id = p_job_id and status = 'processing'
  returning * into finished;

  if finished.id is null then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;

  update public.contracts
  set processed_pdf_url = case when p_status = 'completed' then finished.output_storage_path else processed_pdf_url end,
      document_processing_status = case p_status when 'completed' then 'ready' when 'needs_review' then 'needs_review' else 'failed' end,
      document_processing_error_code = p_error_code,
      document_processed_at = case when p_status = 'completed' then now() else document_processed_at end
  where id = finished.contract_id;
  return finished;
end;
$$;

create or replace function public.link_contract_version(
  p_previous_contract_id uuid,
  p_current_contract_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_row public.contracts;
  current_row public.contracts;
  cursor_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into previous_row from public.contracts where id = p_previous_contract_id for update;
  select * into current_row from public.contracts where id = p_current_contract_id for update;
  if previous_row.id is null or current_row.id is null or previous_row.org_id <> current_row.org_id then
    raise exception 'contracts must exist in the same organisation' using errcode = '22023';
  end if;
  if previous_row.work_id is not null and current_row.work_id is not null and previous_row.work_id <> current_row.work_id then
    raise exception 'contracts must refer to the same work' using errcode = '22023';
  end if;
  cursor_id := p_current_contract_id;
  for i in 1..100 loop
    if cursor_id = p_previous_contract_id then
      raise exception 'version cycle rejected' using errcode = '22023';
    end if;
    select superseded_by_contract_id into cursor_id from public.contracts where id = cursor_id;
    exit when cursor_id is null;
  end loop;
  update public.contracts
  set superseded_by_contract_id = p_current_contract_id,
      superseded_at = now(),
      superseded_by_user_id = p_actor_user_id
  where id = p_previous_contract_id;
end;
$$;

revoke all on function public.claim_next_contract_document_job(integer) from public, anon, authenticated;
revoke all on function public.finish_contract_document_job(uuid, text, jsonb, boolean, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.link_contract_version(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_contract_document_job(integer) to service_role;
grant execute on function public.finish_contract_document_job(uuid, text, jsonb, boolean, integer, integer, text, text) to service_role;
grant execute on function public.link_contract_version(uuid, uuid, uuid) to service_role;

-- AI always reads the processed derivative when one exists. Attachments keep
-- their own file because they have a separate ingestion path.
create or replace function public.claim_next_contract_ai_job(p_job_id uuid default null, p_org_id uuid default null)
returns table(
  id uuid, contract_id uuid, org_id uuid, attempts integer, pdf_url text,
  attachment_id uuid, stage text, provider text, model text, prompt_version text,
  schema_version text, result_data jsonb, lease_expires_at timestamptz, created_by uuid
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
    set status = 'processing', attempts = j.attempts + 1, started_at = now(),
        lease_expires_at = now() + interval '15 minutes', updated_at = now(),
        failure_class = null, error_code = null, error_message = null
    from picked where j.id = picked.id returning j.*
  )
  select u.id, u.contract_id, u.org_id, u.attempts,
         coalesce(a.pdf_url, c.processed_pdf_url, c.pdf_url), u.attachment_id, u.stage,
         u.provider, u.model, u.prompt_version, u.schema_version,
         u.result_data, u.lease_expires_at, u.created_by
  from updated u
  join public.contracts c on c.id = u.contract_id
  left join public.contract_attachments a on a.id = u.attachment_id;
$$;
revoke all on function public.claim_next_contract_ai_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_contract_ai_job(uuid, uuid) to service_role;

-- Existing PDFs are queued without sending notifications. The queue is inert until
-- the private Cloud Run worker and its scheduler have been configured.
insert into public.contract_document_jobs (
  org_id, contract_id, original_storage_path, output_storage_path, priority
)
select c.org_id, c.id, c.pdf_url,
       c.org_id || '/processed/' || c.id || '/normalised.pdf', 10
from public.contracts c
where c.pdf_url is not null
  and lower(c.pdf_url) like '%.pdf'
  and c.processed_pdf_url is null
on conflict do nothing;

update public.contracts
set document_processing_status = case
  when pdf_url is null or lower(pdf_url) not like '%.pdf' then 'not_required'
  else 'pending'
end
where processed_pdf_url is null;
