create table if not exists public.rights_holder_external_identities (
  id uuid primary key default gen_random_uuid(),
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  source text not null check (source in ('dfi','tmdb','wikidata','imdb')),
  external_id text not null,
  display_name text,
  match_score numeric(5,4),
  match_reason text,
  selected_automatically boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rights_holder_id, source, external_id),
  unique (source, external_id)
);

create index if not exists rights_holder_external_identities_holder_idx
  on public.rights_holder_external_identities(rights_holder_id, source);

insert into public.rights_holder_external_identities (rights_holder_id, source, external_id, display_name)
select id, 'dfi', dfi_person_id::text, full_name from public.rettighedshavere where dfi_person_id is not null
on conflict (source, external_id) do nothing;
insert into public.rights_holder_external_identities (rights_holder_id, source, external_id, display_name)
select id, 'tmdb', tmdb_person_id::text, full_name from public.rettighedshavere where tmdb_person_id is not null
on conflict (source, external_id) do nothing;
insert into public.rights_holder_external_identities (rights_holder_id, source, external_id, display_name)
select id, 'wikidata', wikidata_qid, full_name from public.rettighedshavere where wikidata_qid is not null
on conflict (source, external_id) do nothing;
insert into public.rights_holder_external_identities (rights_holder_id, source, external_id, display_name)
select id, 'imdb', imdb_nm, full_name from public.rettighedshavere where imdb_nm is not null
on conflict (source, external_id) do nothing;

alter table public.rights_holder_external_identities enable row level security;
grant select, insert, update, delete on public.rights_holder_external_identities to authenticated;

create policy "Brugere administrerer egne eksterne identiteter"
on public.rights_holder_external_identities for all to authenticated
using (exists (
  select 1 from public.rettighedshavere rh
  where rh.id = rights_holder_external_identities.rights_holder_id
    and rh.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.rettighedshavere rh
  where rh.id = rights_holder_external_identities.rights_holder_id
    and rh.user_id = (select auth.uid())
));

create policy "Orgadmins administrerer eksterne identiteter"
on public.rights_holder_external_identities for all to authenticated
using (exists (
  select 1 from public.org_affiliations oa
  where oa.rights_holder_id = rights_holder_external_identities.rights_holder_id
    and public.current_user_has_org_role(oa.org_id, array['superadmin','admin','org-admin','jurist'])
))
with check (exists (
  select 1 from public.org_affiliations oa
  where oa.rights_holder_id = rights_holder_external_identities.rights_holder_id
    and public.current_user_has_org_role(oa.org_id, array['superadmin','admin','org-admin','jurist'])
));
