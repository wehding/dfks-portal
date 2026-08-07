-- Skalerbar, organisationsafgraenset kontraktimport.
-- OAuth-tokens og importmetadata eksponeres aldrig til browserrollerne.

create table public.contract_import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  source text not null check (source in ('computer','google_drive','onedrive','dropbox','gmail','api')),
  connection_id uuid,
  status text not null default 'receiving'
    check (status in ('receiving','processing','completed','partially_failed','cancelled')),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  uploaded_count integer not null default 0 check (uploaded_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.import_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null check (provider in ('google_drive','onedrive','dropbox')),
  display_name text not null,
  provider_account_id text,
  account_label text,
  credentials_encrypted text not null,
  granted_scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','reauthorization_required','disabled','error')),
  token_expires_at timestamptz,
  last_tested_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, provider_account_id)
);

alter table public.contract_import_batches
  add constraint contract_import_batches_connection_id_fkey
  foreign key (connection_id) references public.import_connections(id) on delete set null;

create table public.import_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null references public.import_connections(id) on delete cascade,
  import_type text not null check (import_type in ('contracts','contract_reviews','screenings','members','producers','works')),
  provider_drive_id text,
  provider_folder_id text not null,
  display_name text not null,
  recursive boolean not null default true,
  auto_sync boolean not null default true,
  sync_cursor text,
  webhook_channel_id text,
  webhook_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, import_type, provider_folder_id)
);

create table public.contract_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.contract_import_batches(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  source_id uuid references public.import_sources(id) on delete set null,
  client_token uuid not null default gen_random_uuid(),
  original_file_name text not null,
  content_type text,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  storage_path text,
  file_hash text,
  provider_file_id text,
  provider_revision text,
  contract_id uuid references public.contracts(id) on delete set null,
  ai_job_id uuid references public.contract_ai_jobs(id) on delete set null,
  status text not null default 'awaiting_upload' check (status in (
    'awaiting_upload','uploaded','duplicate','queued','analysing','matching',
    'missing_owner','missing_work','awaiting_episode_confirmation','ready_for_review',
    'completed','retryable_error','dead','cancelled'
  )),
  owner_match_score numeric(5,2),
  work_match_score numeric(5,2),
  owner_match_evidence jsonb not null default '[]'::jsonb,
  work_match_evidence jsonb not null default '[]'::jsonb,
  match_version text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, client_token)
);

create table public.contract_file_fingerprints (
  org_id uuid not null references public.organisations(id) on delete cascade,
  file_hash text not null,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  import_item_id uuid references public.contract_import_items(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, file_hash)
);

create unique index contract_import_provider_revision_idx
  on public.contract_import_items(source_id, provider_file_id, provider_revision)
  where source_id is not null and provider_file_id is not null and provider_revision is not null;
create index contract_import_batches_org_created_idx on public.contract_import_batches(org_id, created_at desc);
create index contract_import_items_batch_status_idx on public.contract_import_items(batch_id, status, created_at);
create index contract_import_items_org_status_idx on public.contract_import_items(org_id, status, created_at);
create index contract_import_items_missing_owner_idx on public.contract_import_items(org_id, created_at desc)
  where status = 'missing_owner';

create table public.contract_episode_confirmations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  scope text not null check (scope in ('selected_episodes','entire_season')),
  episode_numbers integer[] not null default '{}',
  work_data_version text not null,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index contract_episode_confirmations_active_idx
  on public.contract_episode_confirmations(contract_id)
  where invalidated_at is null;

alter table public.contract_import_batches enable row level security;
alter table public.import_connections enable row level security;
alter table public.import_sources enable row level security;
alter table public.contract_import_items enable row level security;
alter table public.contract_file_fingerprints enable row level security;
alter table public.contract_episode_confirmations enable row level security;

revoke all on public.contract_import_batches, public.import_connections, public.import_sources,
  public.contract_import_items, public.contract_file_fingerprints, public.contract_episode_confirmations
  from public, anon, authenticated;
grant all on public.contract_import_batches, public.import_connections, public.import_sources,
  public.contract_import_items, public.contract_file_fingerprints, public.contract_episode_confirmations
  to service_role;

comment on column public.import_connections.credentials_encrypted is
  'Server-only OAuth tokens encrypted with INTEGRATION_ENCRYPTION_KEY. Never return through browser APIs.';
comment on column public.contract_import_items.owner_match_evidence is
  'Safe structured match reasons only; never contract text, contact data or secrets.';

-- Keep counters consistent without trusting the client.
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
      count(*) filter (where status = 'duplicate')::integer duplicates,
      count(*) filter (where status in ('ready_for_review','completed','missing_owner','missing_work','awaiting_episode_confirmation'))::integer completed,
      count(*) filter (where status in ('retryable_error','dead'))::integer failed,
      count(*) filter (where status in ('awaiting_upload','uploaded','queued','analysing','matching'))::integer pending
    from public.contract_import_items where batch_id = target_batch_id
  ) stats
  where batch.id = target_batch_id;
$$;
revoke all on function private.refresh_contract_import_batch(uuid) from public, anon, authenticated;
grant execute on function private.refresh_contract_import_batch(uuid) to service_role;

create or replace function private.contract_import_item_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_contract_import_batch(coalesce(new.batch_id, old.batch_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.contract_import_item_changed() from public, anon, authenticated;

create trigger contract_import_item_refresh_batch
after insert or update or delete on public.contract_import_items
for each row execute function private.contract_import_item_changed();
