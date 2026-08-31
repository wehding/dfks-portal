-- A long OCR pass may exceed the original fixed lease. A per-claim token
-- prevents a stale worker from renewing or completing a job after another
-- worker has reclaimed it, while a heartbeat keeps the active claim alive.
alter table public.contract_document_jobs
  add column if not exists lease_token uuid,
  add column if not exists last_upload_authorised_at timestamptz,
  add column if not exists spatial_sha256 text;

alter table public.contract_document_jobs
  drop constraint if exists contract_document_jobs_spatial_sha256_check,
  add constraint contract_document_jobs_spatial_sha256_check check (
    spatial_sha256 is null or spatial_sha256 ~ '^[0-9a-f]{64}$'
  );

-- A deployment must never make pre-existing upload capabilities immediately
-- eligible for garbage collection. A conservative one-time quarantine is
-- cheaper than guessing when an older signed upload token was minted.
update public.contract_document_jobs
set last_upload_authorised_at = now()
where last_upload_authorised_at is null;

create or replace function public.claim_next_contract_document_job(p_lease_minutes integer default 30)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.contract_document_jobs;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- A worker that exhausted every attempt cannot be reclaimed. Move it out of
  -- processing so the portal cleanup pass can remove any unpromoted lease
  -- artifacts instead of leaving private storage behind indefinitely.
  with exhausted as (
    update public.contract_document_jobs
    set status = 'failed',
        lease_token = null,
        lease_expires_at = null,
        error_code = 'max_attempts_exceeded',
        safe_error_message = 'Dokumentet kunne ikke færdigbehandles efter det maksimale antal forsøg.',
        updated_at = now()
    where status = 'processing'
      and lease_expires_at < now()
      and attempts >= 5
    returning contract_id
  )
  update public.contracts as contract
  set document_processing_status = 'failed',
      document_processing_error_code = 'max_attempts_exceeded'
  where contract.id in (select contract_id from exhausted);

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
  update public.contract_document_jobs as job
  set status = 'processing',
      attempts = attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 60))),
      error_code = null,
      safe_error_message = null,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.* into claimed;

  if claimed.id is not null then
    update public.contracts
    set document_processing_status = 'processing', document_processing_error_code = null
    where id = claimed.contract_id;
  end if;
  return claimed;
end;
$$;

revoke all on function public.claim_next_contract_document_job(integer) from public, anon, authenticated;
grant execute on function public.claim_next_contract_document_job(integer) to service_role;

create or replace function public.renew_contract_document_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_minutes integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.contract_document_jobs
  set lease_expires_at = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 60))),
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > now();
  renewed := found;
  return renewed;
end;
$$;

revoke all on function public.renew_contract_document_job_lease(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.renew_contract_document_job_lease(uuid, uuid, integer)
  to service_role;

-- Upload credentials are minted only after this atomic lease renewal and
-- timestamp update. Garbage collection uses the timestamp as a durable
-- quarantine boundary, including when the worker completes immediately after
-- receiving the signed upload token.
create or replace function public.authorise_contract_document_job_upload(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_minutes integer default 30
)
returns public.contract_document_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorised public.contract_document_jobs;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.contract_document_jobs
  set lease_expires_at = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 60))),
      last_upload_authorised_at = now(),
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > now()
  returning * into authorised;

  return authorised;
end;
$$;

revoke all on function public.authorise_contract_document_job_upload(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.authorise_contract_document_job_upload(uuid, uuid, integer)
  to service_role;

create or replace function public.finish_contract_document_job_v4(
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
  finished public.contract_document_jobs;
  active_job public.contract_document_jobs;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock and verify ownership before delegating to the existing atomic
  -- completion/AI-enqueue function. The lock prevents a reclaim race.
  select * into active_job
  from public.contract_document_jobs
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > now()
  for update;
  if not found then
    raise exception 'job not found or lease inactive' using errcode = 'P0002';
  end if;

  -- Completion is a security boundary: the derivative is not made visible
  -- to the portal unless all integrity, geometry and lease-scoped path
  -- evidence is present. Expected document problems must use needs_review.
  if p_status = 'completed' and (
    p_document_classification not in ('image_only', 'mixed')
    or p_ocr_engine is distinct from 'google-vision-eu-v1'
    or p_ocr_applied is distinct from true
    or p_page_count is null or p_page_count < 1 or p_page_count > 200
    or p_text_char_count is null or p_text_char_count < 1
    or p_ocr_page_count is null or p_ocr_page_count < 1
    or p_unreadable_page_count is distinct from 0
    or coalesce(p_native_page_count, 0) + coalesce(p_ocr_page_count, 0) <> p_page_count
    or p_original_sha256 is null or p_original_sha256 !~ '^[0-9a-f]{64}$'
    or p_processed_sha256 is null or p_processed_sha256 !~ '^[0-9a-f]{64}$'
    or p_original_sha256 = p_processed_sha256
    or nullif(active_job.output_storage_path, '') is null
    or active_job.output_storage_path = active_job.original_storage_path
    or active_job.output_storage_path <> (
      active_job.org_id::text || '/processed/' || active_job.contract_id::text
      || '/leases/' || p_lease_token::text || '/normalised.pdf'
    )
    or nullif(active_job.spatial_data_path, '') is null
    or active_job.spatial_data_path <> (
      active_job.org_id::text || '/processed/' || active_job.contract_id::text
      || '/leases/' || p_lease_token::text || '/vision-layout.json.gz'
    )
    or not exists (
      select 1
      from public.contracts as source_contract
      where source_contract.id = active_job.contract_id
        and source_contract.org_id = active_job.org_id
        and source_contract.pdf_url = active_job.original_storage_path
    )
    or p_spatial_sha256 is null or p_spatial_sha256 !~ '^[0-9a-f]{64}$'
    or p_spatial_accuracy_score is null or p_spatial_accuracy_score < 0.95
    or p_spatial_median_iou is null or p_spatial_median_iou < 0.85
    or p_spatial_center_inside_ratio is null or p_spatial_center_inside_ratio < 0.98
  ) then
    raise exception 'completed OCR lacks required integrity evidence'
      using errcode = '22023';
  end if;

  select * into finished
  from public.finish_contract_document_job_v3(
    p_job_id, p_status, p_document_classification, p_ocr_engine,
    p_orientation_corrections, p_ocr_applied, p_page_count, p_text_char_count,
    p_native_page_count, p_ocr_page_count, p_unreadable_page_count,
    p_redaction_counts, p_spatial_accuracy_score, p_spatial_median_iou,
    p_spatial_center_inside_ratio, p_original_sha256, p_processed_sha256,
    p_redaction_profile, p_spatial_schema_version, p_error_code,
    p_safe_error_message
  );

  update public.contract_document_jobs
  set lease_token = null,
      spatial_sha256 = case when p_status = 'completed' then p_spatial_sha256 else null end,
      updated_at = now()
  where id = finished.id
  returning * into finished;
  return finished;
end;
$$;

-- Only the token-enforcing wrapper may be invoked by the service client.
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
revoke all on function public.finish_contract_document_job_v4(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) from public, anon, authenticated;
grant execute on function public.finish_contract_document_job_v4(
  uuid, uuid, text, text, text, jsonb, boolean, integer, integer, integer,
  integer, integer, jsonb, numeric, numeric, numeric, text, text, text, text,
  text, text, text
) to service_role;

comment on column public.contract_document_jobs.lease_token is
  'Kortlivet, server-only ejerskabstoken som roteres ved hvert claim.';
comment on column public.contract_document_jobs.last_upload_authorised_at is
  'Seneste serverautoriserede signed-upload-token. Bruges som sikker karantænegrænse for lease-artefakter.';
comment on column public.contract_document_jobs.spatial_sha256 is
  'SHA-256 af den komprimerede geometrifil, som slutauditen verificerer før backfill godkendes.';

-- Storage objects are deleted through the Storage API, never directly here.
-- The function exposes only old, unpromoted lease artifacts to the service
-- client. Three hours exceeds the signed-upload-token lifetime, so a stale
-- token cannot recreate an object after the cleanup pass removed it.
create or replace function public.list_abandoned_contract_document_lease_artifacts(
  p_limit integer default 25
)
returns table(storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'invalid cleanup limit' using errcode = '22023';
  end if;

  return query
  select object.name
  from storage.objects as object
  where object.bucket_id = 'kontrakter'
    and object.created_at < now() - interval '3 hours'
    and object.name ~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '/processed/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '/leases/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '/(normalised[.]pdf|vision-layout[.]json[.]gz)$'
    )
    and not exists (
      select 1
      from public.contracts as contract
      where contract.pdf_url = object.name
         or contract.processed_pdf_url = object.name
         or contract.document_spatial_data_path = object.name
    )
    -- Originaler og promoverede derivater er permanente referencer. Et
    -- terminalt needs_review/failed-job kan derimod pege på en halv uploadet
    -- lease-fil, som skal kunne ryddes efter token-karantænen.
    and not exists (
      select 1
      from public.contract_document_jobs as job
      where object.name = job.original_storage_path
         or (
           object.name in (job.output_storage_path, job.spatial_data_path)
           and (
             job.status in ('queued', 'processing', 'completed', 'not_required')
             or (job.status = 'failed' and job.attempts < 5)
           )
         )
    )
    and not exists (
      select 1
      from public.contract_attachments as attachment
      where attachment.pdf_url = object.name
    )
    -- The path itself contains only immutable UUID segments. Relating by the
    -- organisation and contract segments lets old lease namespaces be
    -- collected after the one authoritative queue has become terminal.
    and exists (
      select 1
      from public.contract_document_jobs as terminal_job
      where terminal_job.org_id::text = split_part(object.name, '/', 1)
        and terminal_job.contract_id::text = split_part(object.name, '/', 3)
        and (
          terminal_job.status in ('completed', 'needs_review', 'not_required')
          or (terminal_job.status = 'failed' and terminal_job.attempts >= 5)
        )
    )
    -- A processing, queued or retryable job can still renew/reclaim a lease.
    -- Excluding the entire contract while any such job exists removes the
    -- expiry/finish TOCTOU: a selected path cannot become current through the
    -- existing claim, renew or finish functions after this statement.
    and not exists (
      select 1
      from public.contract_document_jobs as nonterminal_job
      where nonterminal_job.org_id::text = split_part(object.name, '/', 1)
        and nonterminal_job.contract_id::text = split_part(object.name, '/', 3)
        and (
          nonterminal_job.status in ('queued', 'processing')
          or (nonterminal_job.status = 'failed' and nonterminal_job.attempts < 5)
        )
    )
    -- Signed upload tokens may remain valid after a terminal callback. Wait
    -- beyond their lifetime, conservatively using the newest authorisation
    -- for the entire contract rather than only the path currently on the job.
    and not exists (
      select 1
      from public.contract_document_jobs as recently_authorised_job
      where recently_authorised_job.org_id::text = split_part(object.name, '/', 1)
        and recently_authorised_job.contract_id::text = split_part(object.name, '/', 3)
        and recently_authorised_job.last_upload_authorised_at >= now() - interval '3 hours'
    )
  order by object.created_at, object.name
  limit p_limit;
end;
$$;

revoke all on function public.list_abandoned_contract_document_lease_artifacts(integer)
  from public, anon, authenticated;
grant execute on function public.list_abandoned_contract_document_lease_artifacts(integer)
  to service_role;

-- Contract bytes are accessed only through server-authorised actions and
-- short-lived signed URLs. Browser-wide bucket policies allowed members to
-- list, upload and in some cases delete other members' files in the same org.
drop policy if exists "Admins kan læse kontrakter" on storage.objects;
drop policy if exists "Authenticated kan uploade kontrakter" on storage.objects;
drop policy if exists "Admins kan uploade kontrakter" on storage.objects;
drop policy if exists "Admins kan slette kontrakter" on storage.objects;

insert into storage.buckets(id, name, public, file_size_limit)
values ('kontrakter', 'kontrakter', false, 26214400)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit;

-- Signed member uploads are one-time, short-lived intents. The bucket-level
-- limit closes the oversized-upload bypass; the intent table provides quota,
-- ownership, expiry and deterministic orphan cleanup without exposing the
-- contract bucket to browser roles.
create table if not exists public.contract_upload_intents (
  id uuid primary key default gen_random_uuid(),
  -- These references deliberately become null instead of deleting the row.
  -- The intent is also the storage-cleanup tombstone: deleting an account,
  -- organisation or rights holder must not strand a still-valid signed upload.
  owner_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.organisations(id) on delete set null,
  rights_holder_id uuid references public.rettighedshavere(id) on delete set null,
  storage_path text not null unique check (storage_path <> '' and storage_path !~ '[\r\n]'),
  expected_size bigint not null check (expected_size between 1 and 26214400),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  contract_id uuid references public.contracts(id) on delete set null,
  created_at timestamptz not null default now(),
  check (consumed_at is null or consumed_at >= created_at)
);
create index if not exists contract_upload_intents_expiry_idx
  on public.contract_upload_intents(expires_at)
  where consumed_at is null;
create index if not exists contract_upload_intents_owner_created_idx
  on public.contract_upload_intents(owner_id, created_at desc);
alter table public.contract_upload_intents enable row level security;
revoke all on table public.contract_upload_intents from public, anon, authenticated;
grant select, insert, update, delete on table public.contract_upload_intents to service_role;

create or replace function public.create_contract_upload_intent(
  p_owner_id uuid,
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_storage_path text,
  p_expected_size bigint
)
returns public.contract_upload_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.contract_upload_intents;
  active_count integer;
  recent_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expected_size < 1 or p_expected_size > 26214400
    or nullif(p_storage_path, '') is null or p_storage_path ~ '[\r\n]' then
    raise exception 'invalid upload intent' using errcode = '22023';
  end if;
  if p_storage_path !~ (
      '^' || p_org_id::text || '/' || p_owner_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](pdf|doc|docx|txt)$'
    ) or not exists (
      select 1
      from public.rettighedshavere as holder
      join public.org_affiliations as affiliation
        on affiliation.rights_holder_id = holder.id
       and affiliation.org_id = p_org_id
       and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
      where holder.id = p_rights_holder_id and holder.user_id = p_owner_id
    ) then
    raise exception 'upload intent ownership mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));
  select count(*) into active_count
  from public.contract_upload_intents
  where owner_id = p_owner_id and consumed_at is null and expires_at > now();
  select count(*) into recent_count
  from public.contract_upload_intents
  where owner_id = p_owner_id and created_at > now() - interval '1 hour';
  if active_count >= 5 or recent_count >= 30 then
    raise exception 'upload intent quota exceeded' using errcode = '54000';
  end if;

  insert into public.contract_upload_intents(
    owner_id, org_id, rights_holder_id, storage_path, expected_size
  ) values (
    p_owner_id, p_org_id, p_rights_holder_id, p_storage_path, p_expected_size
  ) returning * into created;
  return created;
end;
$$;

create or replace function public.consume_contract_upload_intent(
  p_owner_id uuid,
  p_storage_path text
)
returns public.contract_upload_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed public.contract_upload_intents;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.contract_upload_intents
  set consumed_at = now()
  where owner_id = p_owner_id
    and storage_path = p_storage_path
    and consumed_at is null
    and expires_at > now()
  returning * into consumed;
  return consumed;
end;
$$;

revoke all on function public.create_contract_upload_intent(uuid, uuid, uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function public.consume_contract_upload_intent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_contract_upload_intent(uuid, uuid, uuid, text, bigint)
  to service_role;
grant execute on function public.consume_contract_upload_intent(uuid, text)
  to service_role;
