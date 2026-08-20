-- Aftalelicens-modulets batch-historik lå tidligere i browserens localStorage
-- (dfks_batches) — skrøbeligt: kvote-overskridelse fejlede stille (ingen
-- fejlbesked), historikken var kun synlig i én browser, og forsvandt ved
-- browser-skift eller cache-ryd. Nu en rigtig, delt databasetabel, samme
-- mønster som screening_source_rows/screening_claims.

create table if not exists public.aftalelicens_batches (
  id            text primary key,   -- matcher det eksisterende batch_<timestamp>-format
  org_id        uuid not null references public.organisations(id) on delete cascade,
  kilde         text not null,
  year          integer not null,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid references auth.users(id) on delete set null,
  total_rows    integer not null default 0,
  filtered_rows integer not null default 0,
  status        text not null default 'imported'
                  check (status in ('imported', 'sorting', 'weighted', 'completed')),
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists aftalelicens_batches_org_id_idx
  on public.aftalelicens_batches (org_id, uploaded_at desc);

alter table public.aftalelicens_batches enable row level security;

drop policy if exists "Orgadmins administrerer aftalelicens-batches" on public.aftalelicens_batches;
create policy "Orgadmins administrerer aftalelicens-batches"
on public.aftalelicens_batches for all to authenticated
using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']))
with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin','jurist']));
