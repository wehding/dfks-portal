-- Producer association memberships are source-specific facts. They deliberately
-- live outside employer_legal_entities so an external list cannot overwrite
-- verified CVR/DFI or administrator-maintained producer data.

create table if not exists public.producer_association_memberships (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  association_code text not null default 'producentforeningen'
    check (association_code = 'producentforeningen'),
  group_code text not null
    check (group_code in ('documentary', 'fiction', 'tv', 'advertising', 'dubbing', 'animation')),
  group_label text not null,
  membership_type text not null default 'unknown'
    check (membership_type in ('ordinary', 'associate', 'unknown')),
  source_name text not null,
  owner_ceo_text text,
  website text,
  address text,
  postal_city text,
  source_url text not null,
  source_hash text,
  is_active boolean not null default true,
  verified_on date not null,
  last_seen_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employer_id, association_code, group_code)
);

create index if not exists producer_association_memberships_employer_idx
  on public.producer_association_memberships (employer_id, is_active, group_code);
create index if not exists producer_association_memberships_verified_idx
  on public.producer_association_memberships (association_code, verified_on desc);

create table if not exists public.producer_association_sync_runs (
  id uuid primary key default gen_random_uuid(),
  association_code text not null default 'producentforeningen'
    check (association_code = 'producentforeningen'),
  status text not null default 'preview'
    check (status in ('preview', 'applied', 'failed')),
  verified_on date not null,
  source_rows integer not null default 0 check (source_rows >= 0),
  unique_producers integer not null default 0 check (unique_producers >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  changed_count integer not null default 0 check (changed_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  snapshot jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists producer_association_sync_runs_created_idx
  on public.producer_association_sync_runs (association_code, created_at desc);

alter table public.producer_association_memberships enable row level security;
alter table public.producer_association_sync_runs enable row level security;

drop policy if exists "Admins read producer association memberships" on public.producer_association_memberships;
create policy "Admins read producer association memberships"
  on public.producer_association_memberships for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

drop policy if exists "Admins manage producer association memberships" on public.producer_association_memberships;
create policy "Admins manage producer association memberships"
  on public.producer_association_memberships for all to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
  with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

drop policy if exists "Admins read producer association sync runs" on public.producer_association_sync_runs;
create policy "Admins read producer association sync runs"
  on public.producer_association_sync_runs for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

drop policy if exists "Admins manage producer association sync runs" on public.producer_association_sync_runs;
create policy "Admins manage producer association sync runs"
  on public.producer_association_sync_runs for all to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
  with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

revoke all on public.producer_association_memberships, public.producer_association_sync_runs from anon;
grant select, insert, update, delete on public.producer_association_memberships, public.producer_association_sync_runs to authenticated;
grant all on public.producer_association_memberships, public.producer_association_sync_runs to service_role;

comment on table public.producer_association_memberships is
  'Source-specific Producentforeningen membership by producer and membership group.';
comment on column public.producer_association_memberships.owner_ceo_text is
  'Unsplit public source value; Producentforeningen labels this combined field Ejere / CEO.';
comment on table public.producer_association_sync_runs is
  'Auditable preview/apply runs. A failed or empty fetch never removes active memberships.';
