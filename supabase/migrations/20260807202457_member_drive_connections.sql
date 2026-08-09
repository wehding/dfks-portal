-- Separate, server-only drive connections owned by individual portal members.
alter table public.import_connections
  add column connection_kind text not null default 'organisation'
    check (connection_kind in ('organisation', 'member')),
  add column owner_user_id uuid references auth.users(id) on delete cascade,
  add column rights_holder_id uuid references public.rettighedshavere(id) on delete cascade;

alter table public.import_connections
  drop constraint if exists import_connections_org_id_provider_provider_account_id_key;

alter table public.import_connections
  add constraint import_connections_owner_shape_check check (
    (connection_kind = 'organisation' and owner_user_id is null and rights_holder_id is null)
    or
    (connection_kind = 'member' and owner_user_id is not null and rights_holder_id is not null)
  );

create unique index import_connections_organisation_account_idx
  on public.import_connections(org_id, provider, provider_account_id)
  where connection_kind = 'organisation';
create unique index import_connections_member_account_idx
  on public.import_connections(owner_user_id, provider, provider_account_id)
  where connection_kind = 'member';
create index import_connections_member_owner_idx
  on public.import_connections(owner_user_id, updated_at desc)
  where connection_kind = 'member';

comment on column public.import_connections.owner_user_id is
  'Auth owner for a personal connection. Only server routes may access the row or credentials.';
comment on column public.import_connections.rights_holder_id is
  'Rights-holder snapshot used to bind member imports to the correct profile.';

-- One-time OAuth attempts prevent state replay and bind callbacks to the signed-in user.
create table public.import_oauth_attempts (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  provider text not null check (provider in ('google_drive','onedrive','dropbox')),
  connection_kind text not null check (connection_kind in ('organisation','member')),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rights_holder_id uuid references public.rettighedshavere(id) on delete cascade,
  return_path text not null,
  code_verifier_encrypted text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (
    (connection_kind = 'organisation' and rights_holder_id is null)
    or (connection_kind = 'member' and rights_holder_id is not null)
  )
);
create index import_oauth_attempts_expiry_idx on public.import_oauth_attempts(expires_at) where used_at is null;

alter table public.import_oauth_attempts enable row level security;
revoke all on public.import_oauth_attempts from public, anon, authenticated;
grant all on public.import_oauth_attempts to service_role;
create policy import_oauth_attempts_server_only on public.import_oauth_attempts
  for all to anon, authenticated using (false) with check (false);
