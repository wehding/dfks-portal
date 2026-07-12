create table if not exists public.screening_source_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  source text not null,
  batch_key text not null,
  title text not null,
  normalized_title text not null,
  channel text,
  screening_date date,
  season integer,
  episode integer,
  production_year integer,
  duration_minutes integer,
  view_count bigint,
  created_at timestamptz not null default now()
);

create index if not exists screening_source_rows_match_idx
  on public.screening_source_rows (org_id, normalized_title, screening_date);
create index if not exists screening_source_rows_batch_idx
  on public.screening_source_rows (org_id, batch_key);

alter table public.screening_source_rows enable row level security;
grant select, insert, update, delete on public.screening_source_rows to authenticated;

drop policy if exists "Orgadmins administrerer visningskilder" on public.screening_source_rows;
create policy "Orgadmins administrerer visningskilder"
on public.screening_source_rows for all to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));

alter table public.screening_claims
  add column if not exists source_match_status text not null default 'unchecked',
  add column if not exists source_row_id uuid references public.screening_source_rows(id) on delete set null,
  add column if not exists source_match_score integer,
  add column if not exists source_checked_at timestamptz;

alter table public.screening_claims drop constraint if exists screening_claims_source_match_status_check;
alter table public.screening_claims add constraint screening_claims_source_match_status_check
  check (source_match_status in ('unchecked','found','not_found'));

create index if not exists screening_claims_source_match_idx
  on public.screening_claims (org_id, source_match_status, created_at desc);
