create table if not exists public.onboarding_work_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  dfi_person_id bigint,
  tmdb_person_id bigint,
  status text not null default 'queued' check (status in ('queued','processing','complete','partial','error')),
  total_items integer not null default 0 check (total_items >= 0),
  completed_items integer not null default 0 check (completed_items >= 0),
  failed_items integer not null default 0 check (failed_items >= 0),
  current_title text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists onboarding_work_import_one_active_per_user
  on public.onboarding_work_import_jobs(user_id)
  where status in ('queued','processing');
create index if not exists onboarding_work_import_jobs_owner_idx
  on public.onboarding_work_import_jobs(user_id, created_at desc);
create index if not exists onboarding_work_import_jobs_queue_idx
  on public.onboarding_work_import_jobs(status, updated_at, created_at);

create table if not exists public.onboarding_work_import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.onboarding_work_import_jobs(id) on delete cascade,
  item_key text not null,
  position integer not null check (position >= 0),
  title text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in ('queued','processing','done','error')),
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, item_key)
);

create index if not exists onboarding_work_import_items_claim_idx
  on public.onboarding_work_import_items(job_id, status, position, created_at);

alter table public.onboarding_work_import_jobs enable row level security;
alter table public.onboarding_work_import_items enable row level security;

revoke all on public.onboarding_work_import_jobs, public.onboarding_work_import_items from public, anon, authenticated;
grant select on public.onboarding_work_import_jobs, public.onboarding_work_import_items to authenticated;
grant all on public.onboarding_work_import_jobs, public.onboarding_work_import_items to service_role;

drop policy if exists "Members can view own onboarding import jobs" on public.onboarding_work_import_jobs;
create policy "Members can view own onboarding import jobs"
  on public.onboarding_work_import_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Members can view own onboarding import items" on public.onboarding_work_import_items;
create policy "Members can view own onboarding import items"
  on public.onboarding_work_import_items for select to authenticated
  using (exists (
    select 1
    from public.onboarding_work_import_jobs job
    where job.id = onboarding_work_import_items.job_id
      and job.user_id = (select auth.uid())
  ));

create or replace function public.claim_onboarding_work_import_item(p_job_id uuid default null)
returns setof public.onboarding_work_import_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  update public.onboarding_work_import_items
  set status = 'queued', locked_at = null, updated_at = now()
  where status = 'processing'
    and locked_at < now() - interval '10 minutes'
    and (p_job_id is null or job_id = p_job_id);

  select item.id into claimed_id
  from public.onboarding_work_import_items item
  join public.onboarding_work_import_jobs job on job.id = item.job_id
  where (p_job_id is null or item.job_id = p_job_id)
    and job.status in ('queued','processing')
    and (item.status = 'queued' or (item.status = 'error' and item.attempts < 3))
  order by job.created_at, item.position, item.created_at
  for update of item skip locked
  limit 1;

  if claimed_id is null then return; end if;

  update public.onboarding_work_import_items
  set status = 'processing',
      attempts = attempts + 1,
      error_message = null,
      locked_at = now(),
      updated_at = now()
  where id = claimed_id;

  update public.onboarding_work_import_jobs job
  set status = 'processing',
      started_at = coalesce(job.started_at, now()),
      current_title = item.title,
      error_message = null,
      updated_at = now()
  from public.onboarding_work_import_items item
  where item.id = claimed_id and job.id = item.job_id;

  return query select * from public.onboarding_work_import_items where id = claimed_id;
end;
$$;

revoke all on function public.claim_onboarding_work_import_item(uuid) from public, anon, authenticated;
grant execute on function public.claim_onboarding_work_import_item(uuid) to service_role;

comment on table public.onboarding_work_import_jobs is
  'Genoptagelig serverkø til værkimport fra onboarding. Indeholder kun tekniske ejer-id’er og fremdrift.';
comment on column public.onboarding_work_import_items.payload is
  'Valgt værkmetadata fra DFI/TMDb/lokal database; må ikke indeholde profil- eller personfølsomme data.';
