alter table public.organisations
  add column if not exists contract_review_retention_months integer not null default 24,
  add column if not exists contract_review_retention_updated_at timestamptz,
  add column if not exists contract_review_retention_updated_by uuid,
  add constraint organisations_contract_review_retention_months_check
    check (contract_review_retention_months between 1 and 120);

alter table public.contract_reviews
  add column if not exists intake_source text not null default 'legacy',
  add column if not exists external_source_id text,
  add column if not exists file_hash text,
  add column if not exists intake_status text not null default 'complete',
  add column if not exists completed_at timestamptz,
  add column if not exists soft_deleted_at timestamptz,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists legal_hold_reason text,
  add column if not exists legal_hold_set_by uuid,
  add column if not exists legal_hold_review_at timestamptz;

create unique index if not exists contract_reviews_intake_dedup_idx
  on public.contract_reviews (org_id, intake_source, coalesce(external_source_id, ''), file_hash)
  where file_hash is not null and soft_deleted_at is null;

create table if not exists public.contract_review_jobs (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.contract_reviews(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','done','error')),
  attempts integer not null default 0,
  priority integer not null default 100,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists contract_review_jobs_active_review_idx
  on public.contract_review_jobs(review_id) where status in ('queued','processing');
create index if not exists contract_review_jobs_claim_idx
  on public.contract_review_jobs(status, next_attempt_at, priority, created_at);

alter table public.contract_review_jobs enable row level security;
create policy "Reviewstaff kan se reviewjobs" on public.contract_review_jobs
  for select to authenticated using (public.current_user_can_review_org(org_id));
revoke all on public.contract_review_jobs from public, anon, authenticated;
grant select on public.contract_review_jobs to authenticated;
grant all on public.contract_review_jobs to service_role;

create or replace function private.claim_contract_review_job(worker_id text)
returns setof public.contract_review_jobs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with candidate as (
    select id from public.contract_review_jobs
    where status in ('queued','error') and next_attempt_at <= now()
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by priority asc, created_at asc
    for update skip locked limit 1
  )
  update public.contract_review_jobs job
  set status = 'processing', attempts = attempts + 1, locked_at = now(), locked_by = worker_id, updated_at = now()
  from candidate where job.id = candidate.id returning job.*;
end;
$$;
revoke all on function private.claim_contract_review_job(text) from public, anon, authenticated;
grant execute on function private.claim_contract_review_job(text) to service_role;

create or replace function public.claim_contract_review_job(worker_id text)
returns setof public.contract_review_jobs language sql security invoker set search_path = ''
as $$ select * from private.claim_contract_review_job(worker_id); $$;
revoke all on function public.claim_contract_review_job(text) from public, anon, authenticated;
grant execute on function public.claim_contract_review_job(text) to service_role;

create table if not exists private.contract_review_deletion_certificates (
  id uuid primary key default gen_random_uuid(),
  review_hash text not null,
  org_id uuid not null,
  deleted_at timestamptz not null default now(),
  retention_months integer not null,
  deleted_by uuid,
  deletion_source text not null,
  unique (review_hash)
);
revoke all on private.contract_review_deletion_certificates from public, anon, authenticated;
grant all on private.contract_review_deletion_certificates to service_role;

create index if not exists contract_reviews_retention_due_idx
  on public.contract_reviews(org_id, completed_at)
  where completed_at is not null and legal_hold = false;

create or replace function private.finalize_contract_review_deletion(target_review_id uuid, actor_id uuid, deletion_origin text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare review_row public.contract_reviews%rowtype; retention integer;
begin
  select * into review_row from public.contract_reviews where id = target_review_id for update;
  if not found or review_row.legal_hold or review_row.completed_at is null then return false; end if;
  select contract_review_retention_months into retention from public.organisations where id = review_row.org_id;
  if review_row.completed_at + make_interval(months => retention) > now() then return false; end if;
  insert into private.contract_review_deletion_certificates(review_hash,org_id,retention_months,deleted_by,deletion_source)
  values (encode(extensions.digest(review_row.id::text,'sha256'),'hex'),review_row.org_id,retention,actor_id,deletion_origin)
  on conflict (review_hash) do nothing;
  update public.contract_reviews set storage_path = null, ai_result = null, compliance_extract = null,
    notes = null, member_email = null, member_name = null, soft_deleted_at = coalesce(soft_deleted_at,now()),
    intake_status = 'deleted', updated_at = now() where id = target_review_id;
  return true;
end; $$;
revoke all on function private.finalize_contract_review_deletion(uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.finalize_contract_review_deletion(uuid,uuid,text) to service_role;

create or replace function public.finalize_contract_review_deletion(target_review_id uuid, actor_id uuid, deletion_origin text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.finalize_contract_review_deletion(target_review_id,actor_id,deletion_origin); $$;
revoke all on function public.finalize_contract_review_deletion(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finalize_contract_review_deletion(uuid,uuid,text) to service_role;
