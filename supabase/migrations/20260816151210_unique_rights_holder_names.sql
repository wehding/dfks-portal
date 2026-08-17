create or replace function public.normalize_rights_holder_name(value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'))
$$;

create table public.rights_holder_name_claims (
  normalized_name text primary key check (normalized_name <> ''),
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> ''),
  claim_type text not null check (claim_type in ('canonical', 'variant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rights_holder_name_claims_holder_idx
  on public.rights_holder_name_claims (rights_holder_id, claim_type);

alter table public.rights_holder_name_claims enable row level security;
revoke all on public.rights_holder_name_claims from public, anon, authenticated;
grant all on public.rights_holder_name_claims to service_role;

-- Fjern kun redundante varianter på samme profil. Ukendte konflikter mellem
-- forskellige profiler skal stoppe migreringen nedenfor og må ikke løses automatisk.
update public.rettighedshavere holder
set alternative_names = coalesce((
  select array_agg(distinct cleaned.name order by cleaned.name)
  from (
    select btrim(variant) as name
    from unnest(coalesce(holder.alternative_names, '{}'::text[])) variant
    where public.normalize_rights_holder_name(variant) <> ''
      and public.normalize_rights_holder_name(variant) <> public.normalize_rights_holder_name(holder.full_name)
  ) cleaned
), '{}'::text[])
where holder.archived_at is null;

-- Kontrolleret nulstilling af testprofilens gamle Kasper/Lars-personmatch.
with test_holder as (
  update public.rettighedshavere
  set
    alternative_names = array(
      select variant
      from unnest(coalesce(alternative_names, '{}'::text[])) variant
      where public.normalize_rights_holder_name(variant) <> public.normalize_rights_holder_name('Lars Wissing')
    ),
    dfi_person_id = null,
    tmdb_person_id = null,
    wikidata_qid = null,
    imdb_nm = null
  where lower(email) = 'test@dfks.dk'
  returning id, user_id, full_name
), deleted_identities as (
  delete from public.rights_holder_external_identities identities
  using test_holder
  where identities.rights_holder_id = test_holder.id
  returning identities.rights_holder_id
), audit as (
  insert into public.audit_events (
    action, entity_type, entity_id, entity_label, actor_type, source, changes, metadata
  )
  select
    'update', 'rettighedshavere', id::text, full_name, 'system', 'database',
    jsonb_build_array(
      jsonb_build_object('field', 'alternative_names', 'old', '[redacted]', 'new', '[cleaned]'),
      jsonb_build_object('field', 'person_identity', 'old', '[redacted]', 'new', null)
    ),
    jsonb_build_object('reason', 'reset_stale_test_profile_person_identity', 'email', 'test@dfks.dk')
  from test_holder
  returning id, entity_id
)
insert into public.audit_event_organisations (event_id, org_id, org_name, occurred_at)
select audit.id, affiliation.org_id, organisation.name, now()
from audit
join public.org_affiliations affiliation on affiliation.rights_holder_id::text = audit.entity_id
left join public.organisations organisation on organisation.id = affiliation.org_id
on conflict do nothing;

-- Stop migreringen frem for at vælge vilkårligt, hvis der fortsat er konflikter.
do $$
declare
  conflict_name text;
begin
  with names as (
    select id, public.normalize_rights_holder_name(full_name) normalized_name
    from public.rettighedshavere
    where archived_at is null
    union all
    select holder.id, public.normalize_rights_holder_name(variant)
    from public.rettighedshavere holder
    cross join lateral unnest(coalesce(holder.alternative_names, '{}'::text[])) variant
    where holder.archived_at is null
  )
  select normalized_name into conflict_name
  from names
  where normalized_name <> ''
  group by normalized_name
  having count(distinct id) > 1
  limit 1;

  if conflict_name is not null then
    raise exception 'Navnekonflikt skal løses før migrering: %', conflict_name;
  end if;
end
$$;

insert into public.rights_holder_name_claims (normalized_name, rights_holder_id, display_name, claim_type)
select public.normalize_rights_holder_name(full_name), id, btrim(full_name), 'canonical'
from public.rettighedshavere
where archived_at is null and public.normalize_rights_holder_name(full_name) <> ''
union all
select public.normalize_rights_holder_name(variant), holder.id, btrim(variant), 'variant'
from public.rettighedshavere holder
cross join lateral unnest(coalesce(holder.alternative_names, '{}'::text[])) variant
where holder.archived_at is null
  and public.normalize_rights_holder_name(variant) <> '';

create or replace function public.sync_rights_holder_name_claims()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.rights_holder_name_claims where rights_holder_id = old.id;
    return old;
  end if;

  delete from public.rights_holder_name_claims where rights_holder_id = new.id;
  if new.archived_at is not null then
    return new;
  end if;

  insert into public.rights_holder_name_claims (normalized_name, rights_holder_id, display_name, claim_type)
  values (public.normalize_rights_holder_name(new.full_name), new.id, btrim(new.full_name), 'canonical');

  insert into public.rights_holder_name_claims (normalized_name, rights_holder_id, display_name, claim_type)
  select distinct on (public.normalize_rights_holder_name(variant))
    public.normalize_rights_holder_name(variant), new.id, btrim(variant), 'variant'
  from unnest(coalesce(new.alternative_names, '{}'::text[])) variant
  where public.normalize_rights_holder_name(variant) <> ''
    and public.normalize_rights_holder_name(variant) <> public.normalize_rights_holder_name(new.full_name)
  order by public.normalize_rights_holder_name(variant), btrim(variant);

  return new;
end
$$;

revoke all on function public.sync_rights_holder_name_claims() from public, anon, authenticated;
grant execute on function public.sync_rights_holder_name_claims() to service_role;

create trigger sync_rights_holder_name_claims_trigger
after insert or update of full_name, alternative_names, archived_at or delete
on public.rettighedshavere
for each row execute function public.sync_rights_holder_name_claims();

create or replace function public.replace_rights_holder_person_identity(
  p_rights_holder_id uuid,
  p_variants text[],
  p_identities jsonb,
  p_portrait_url text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(coalesce(p_identities, '[]'::jsonb)) <> 'array' then
    raise exception 'Identiteter skal være en liste.';
  end if;

  update public.rettighedshavere
  set
    alternative_names = coalesce(p_variants, '{}'::text[]),
    portrait_url = coalesce(nullif(p_portrait_url, ''), portrait_url),
    dfi_person_id = (select (item->>'external_id')::bigint from jsonb_array_elements(coalesce(p_identities, '[]'::jsonb)) item where item->>'source' = 'dfi' limit 1),
    tmdb_person_id = (select (item->>'external_id')::bigint from jsonb_array_elements(coalesce(p_identities, '[]'::jsonb)) item where item->>'source' = 'tmdb' limit 1),
    wikidata_qid = (select item->>'external_id' from jsonb_array_elements(coalesce(p_identities, '[]'::jsonb)) item where item->>'source' = 'wikidata' limit 1),
    imdb_nm = (select item->>'external_id' from jsonb_array_elements(coalesce(p_identities, '[]'::jsonb)) item where item->>'source' = 'imdb' limit 1)
  where id = p_rights_holder_id;

  if not found then raise exception 'Rettighedshaveren blev ikke fundet.'; end if;

  delete from public.rights_holder_external_identities where rights_holder_id = p_rights_holder_id;
  insert into public.rights_holder_external_identities (
    rights_holder_id, source, external_id, display_name, match_score, match_reason, selected_automatically
  )
  select
    p_rights_holder_id,
    item->>'source',
    item->>'external_id',
    nullif(item->>'display_name', ''),
    nullif(item->>'match_score', '')::numeric,
    nullif(item->>'match_reason', ''),
    coalesce((item->>'selected_automatically')::boolean, false)
  from jsonb_array_elements(coalesce(p_identities, '[]'::jsonb)) item;
end
$$;

revoke all on function public.replace_rights_holder_person_identity(uuid, text[], jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_rights_holder_person_identity(uuid, text[], jsonb, text) to service_role;
