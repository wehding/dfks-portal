-- Kortlivede, serverstyrede arbejdskøer for kontraktarkivet.
-- Køerne indeholder kun kontrakt-id'er og ufølsom navigationsmetadata.

create table public.admin_contract_work_queues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('filtered', 'selected', 'validation', 'ownership')),
  label text not null check (char_length(label) between 1 and 80),
  current_position integer not null default 1 check (current_position >= 1),
  filter_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint admin_contract_work_queues_expiry_check check (expires_at > created_at),
  constraint admin_contract_work_queues_filter_context_check check (jsonb_typeof(filter_context) = 'object')
);

create table public.admin_contract_work_queue_items (
  queue_id uuid not null references public.admin_contract_work_queues(id) on delete cascade,
  position integer not null check (position >= 1),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped')),
  completed_at timestamptz,
  primary key (queue_id, position),
  unique (queue_id, contract_id),
  constraint admin_contract_work_queue_items_completion_check check (
    (status = 'pending' and completed_at is null)
    or (status in ('completed', 'skipped') and completed_at is not null)
  )
);

comment on table public.admin_contract_work_queues is
  'Kortlivede, server-only kontraktkøer afgrænset til én organisation og administrator.';
comment on column public.admin_contract_work_queues.filter_context is
  'Ufølsom filter- og sorteringsmetadata. Rå søgetekst og kontraktindhold må ikke lagres her.';
comment on table public.admin_contract_work_queue_items is
  'Stabilt snapshot af kontrakt-id''er til tastatur- og næste/forrige-navigation.';

create index admin_contract_work_queues_actor_expiry_idx
  on public.admin_contract_work_queues(created_by, org_id, expires_at desc);
create index admin_contract_work_queues_expiry_idx
  on public.admin_contract_work_queues(expires_at);
create index admin_contract_work_queue_items_contract_idx
  on public.admin_contract_work_queue_items(contract_id, queue_id);
create index admin_contract_work_queue_items_pending_idx
  on public.admin_contract_work_queue_items(queue_id, position)
  where status = 'pending';

alter table public.admin_contract_work_queues enable row level security;
alter table public.admin_contract_work_queue_items enable row level security;

revoke all on table public.admin_contract_work_queues from public, anon, authenticated;
revoke all on table public.admin_contract_work_queue_items from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_contract_work_queues to service_role;
grant select, insert, update, delete on table public.admin_contract_work_queue_items to service_role;

-- Engangskørslen for historiske ejere må højst oprettes én gang pr. organisation.
-- Eksisterende kørsler og deres revisionsspor bevares uændret.
create or replace function public.guard_single_contract_owner_backfill_run()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.contract_owner_backfill_runs existing
    where existing.org_id = new.org_id
  ) then
    raise exception 'contract owner backfill has already been created for this organisation'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_single_contract_owner_backfill_run() from public, anon, authenticated;
grant execute on function public.guard_single_contract_owner_backfill_run() to service_role;

create trigger guard_single_contract_owner_backfill_run
before insert on public.contract_owner_backfill_runs
for each row execute function public.guard_single_contract_owner_backfill_run();
