-- Vedvarende, manuel drevimport. OAuth-tokens og koeelementer er server-only.
alter table public.import_sources alter column auto_sync set default false;
update public.import_sources set auto_sync = false where auto_sync = true;

create table public.drive_import_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null references public.import_connections(id) on delete cascade,
  source_id uuid references public.import_sources(id) on delete set null,
  batch_id uuid references public.contract_import_batches(id) on delete set null,
  connection_kind text not null check (connection_kind in ('organisation','member')),
  started_by uuid references auth.users(id) on delete set null,
  rights_holder_id uuid references public.rettighedshavere(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','discovering','processing','completed','partially_failed','failed','cancelled')),
  root_folder_id text,
  recursive boolean not null default false,
  discovered_count integer not null default 0 check (discovered_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  last_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((connection_kind = 'organisation' and source_id is not null and rights_holder_id is null)
    or (connection_kind = 'member' and source_id is null and rights_holder_id is not null))
);

create table public.drive_import_folders (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.drive_import_runs(id) on delete cascade,
  provider_folder_id text not null,
  page_token text not null default '',
  status text not null default 'queued' check (status in ('queued','processing','done','error')),
  attempts integer not null default 0,
  locked_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, provider_folder_id, page_token)
);

create table public.drive_import_queue_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.drive_import_runs(id) on delete cascade,
  provider_file_id text not null,
  provider_revision text not null,
  file_name text not null,
  content_type text,
  file_size_bytes bigint not null default 0 check (file_size_bytes between 0 and 26214400),
  status text not null default 'queued' check (status in ('queued','processing','imported','duplicate','error','cancelled')),
  attempts integer not null default 0,
  locked_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, provider_file_id, provider_revision)
);

create index drive_import_runs_org_created_idx on public.drive_import_runs(org_id, created_at desc);
create index drive_import_folders_claim_idx on public.drive_import_folders(run_id, status, created_at);
create index drive_import_items_claim_idx on public.drive_import_queue_items(run_id, status, created_at);

alter table public.drive_import_runs enable row level security;
alter table public.drive_import_folders enable row level security;
alter table public.drive_import_queue_items enable row level security;
revoke all on public.drive_import_runs, public.drive_import_folders, public.drive_import_queue_items from public, anon, authenticated;
grant all on public.drive_import_runs, public.drive_import_folders, public.drive_import_queue_items to service_role;

create policy drive_import_runs_server_only on public.drive_import_runs for all to anon, authenticated using (false) with check (false);
create policy drive_import_folders_server_only on public.drive_import_folders for all to anon, authenticated using (false) with check (false);
create policy drive_import_queue_items_server_only on public.drive_import_queue_items for all to anon, authenticated using (false) with check (false);

create or replace function public.claim_drive_import_folder(p_run_id uuid)
returns setof public.drive_import_folders
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.drive_import_folders folder
  set status = 'processing', attempts = attempts + 1, locked_at = now(), updated_at = now()
  where folder.id = (
    select candidate.id from public.drive_import_folders candidate
    where candidate.run_id = p_run_id
      and (candidate.status = 'queued' or (candidate.status = 'processing' and candidate.locked_at < now() - interval '5 minutes'))
      and candidate.attempts < 4
    order by candidate.created_at, candidate.id
    for update skip locked limit 1
  )
  returning folder.*;
end;
$$;

create or replace function public.claim_drive_import_item(p_run_id uuid)
returns setof public.drive_import_queue_items
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.drive_import_queue_items item
  set status = 'processing', attempts = attempts + 1, locked_at = now(), updated_at = now()
  where item.id = (
    select candidate.id from public.drive_import_queue_items candidate
    where candidate.run_id = p_run_id
      and (candidate.status = 'queued' or (candidate.status = 'processing' and candidate.locked_at < now() - interval '5 minutes'))
      and candidate.attempts < 4
    order by candidate.created_at, candidate.id
    for update skip locked limit 1
  )
  returning item.*;
end;
$$;

revoke all on function public.claim_drive_import_folder(uuid), public.claim_drive_import_item(uuid) from public, anon, authenticated;
grant execute on function public.claim_drive_import_folder(uuid), public.claim_drive_import_item(uuid) to service_role;

comment on table public.drive_import_runs is 'Server-only progress for manual organisation and member drive imports.';
comment on table public.drive_import_queue_items is 'Provider metadata only. No OAuth token or document content is stored here.';
