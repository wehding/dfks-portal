-- One canonical producer type register. Producentforeningen groups and
-- organisation-defined types are represented by the same catalogue and
-- producers may have several active types.

create table public.producer_types (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z0-9_]{2,80}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  normalized_name text generated always as (lower(trim(name))) stored,
  origin text not null default 'custom'
    check (origin in ('system', 'producentforeningen', 'custom')),
  created_by_org_id uuid references public.organisations(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code),
  unique (normalized_name)
);

create table public.organisation_producer_types (
  org_id uuid not null references public.organisations(id) on delete cascade,
  producer_type_id uuid not null references public.producer_types(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (org_id, producer_type_id)
);

create table public.employer_producer_types (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  producer_type_id uuid not null references public.producer_types(id) on delete cascade,
  source text not null default 'manual'
    check (source in ('manual', 'producentforeningen', 'broadcaster', 'migration')),
  membership_type text
    check (membership_type is null or membership_type in ('member', 'associate', 'unknown')),
  source_name text,
  source_url text,
  source_identifier text,
  source_metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  verified_on date,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employer_id, producer_type_id, source)
);

create index employer_producer_types_employer_active_idx
  on public.employer_producer_types (employer_id, producer_type_id)
  where is_active;
create index employer_producer_types_type_active_idx
  on public.employer_producer_types (producer_type_id, employer_id)
  where is_active;
create index organisation_producer_types_type_idx
  on public.organisation_producer_types (producer_type_id, org_id);

insert into public.producer_types (code, name, origin)
values
  ('documentary', 'Dokumentarfilm', 'producentforeningen'),
  ('tv', 'TV', 'producentforeningen'),
  ('feature_fiction', 'Spillefilm / fiktion', 'producentforeningen'),
  ('dubbing', 'Dubbing', 'producentforeningen'),
  ('advertising', 'Reklamefilm', 'producentforeningen'),
  ('animation', 'Animation', 'producentforeningen'),
  ('streamer', 'Streamer', 'system'),
  ('broadcaster', 'Broadcaster', 'system')
on conflict (code) do nothing;

-- Preserve organisation-created categories in the new shared catalogue.
insert into public.producer_types (code, name, origin)
select
  'custom_' || substr(encode(extensions.digest(normalized_name, 'sha256'), 'hex'), 1, 20),
  name,
  'custom'
from public.producer_categories
on conflict (normalized_name) do nothing;

insert into public.organisation_producer_types (org_id, producer_type_id, display_order)
select relation.org_id, target.id, relation.display_order
from public.organisation_producer_categories relation
join public.producer_categories legacy on legacy.id = relation.producer_category_id
join public.producer_types target on target.normalized_name = legacy.normalized_name
on conflict do nothing;

-- DFKS uses the full initial catalogue.
insert into public.organisation_producer_types (org_id, producer_type_id, display_order)
select organisation.id, type.id,
  row_number() over (order by type.name)::integer - 1
from public.organisations organisation
cross join public.producer_types type
where organisation.id = '3dfcad23-03ce-4de0-82f2-6566dfcd88a5'::uuid
  and type.code in ('documentary','tv','feature_fiction','dubbing','advertising','animation','streamer','broadcaster')
on conflict do nothing;

-- Migrate the authoritative Producentforeningen facts.
insert into public.employer_producer_types (
  employer_id, producer_type_id, source, membership_type, source_name,
  source_url, source_identifier, source_metadata, is_active, verified_on,
  last_seen_at, created_by, created_at, updated_at
)
select
  membership.employer_id,
  type.id,
  'producentforeningen',
  case membership.membership_type
    when 'ordinary' then 'member'
    when 'associate' then 'associate'
    else 'unknown'
  end,
  membership.source_name,
  membership.source_url,
  membership.association_code || ':' || membership.group_code,
  jsonb_strip_nulls(jsonb_build_object(
    'group_label', membership.group_label,
    'owner_ceo_text', membership.owner_ceo_text,
    'website', membership.website,
    'address', membership.address,
    'postal_city', membership.postal_city,
    'source_hash', membership.source_hash
  )),
  membership.is_active,
  membership.verified_on,
  membership.last_seen_at,
  membership.created_by,
  membership.created_at,
  membership.updated_at
from public.producer_association_memberships membership
join public.producer_types type on type.code = case membership.group_code
  when 'fiction' then 'feature_fiction'
  else membership.group_code
end
on conflict (employer_id, producer_type_id, source) do update
set membership_type = excluded.membership_type,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_identifier = excluded.source_identifier,
    source_metadata = excluded.source_metadata,
    is_active = excluded.is_active,
    verified_on = excluded.verified_on,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at;

-- Preserve legacy-only lists as custom producer types before removing the old
-- registry. Known ProF names are folded into their stable system type.
insert into public.producer_types (code, name, origin)
select distinct
  'legacy_' || substr(encode(extensions.digest(lower(trim(registry.association_name)), 'sha256'), 'hex'), 1, 20),
  trim(registry.association_name),
  'custom'
from public.employer_registries registry
where trim(registry.association_name) <> ''
  and lower(trim(registry.association_name)) not in (
    'prof', 'producentforeningen', 'dokumentarfilm', 'tv',
    'spillefilm - fiktion', 'spillefilm / fiktion', 'dubbing',
    'reklamefilm', 'animation'
  )
on conflict (normalized_name) do nothing;

insert into public.employer_producer_types (
  employer_id, producer_type_id, source, membership_type, source_name,
  is_active, verified_on, created_at, updated_at
)
select
  registry.employer_id,
  type.id,
  'migration',
  case when employer.associeret then 'associate' else 'member' end,
  registry.association_name,
  registry.valid_to is null or registry.valid_to >= current_date,
  coalesce(registry.valid_from, current_date),
  coalesce(registry.created_at, now()),
  now()
from public.employer_registries registry
join public.employers employer on employer.id = registry.employer_id
join public.producer_types type on type.normalized_name = lower(trim(registry.association_name))
where trim(registry.association_name) <> ''
on conflict (employer_id, producer_type_id, source) do nothing;

-- Broadcaster relationships are canonical type facts as well.
insert into public.employer_producer_types (
  employer_id, producer_type_id, source, source_name, source_identifier,
  is_active, verified_on, last_seen_at
)
select
  employer.id,
  type.id,
  'broadcaster',
  broadcaster.name,
  broadcaster.id::text,
  true,
  current_date,
  now()
from public.employers employer
join public.broadcasters broadcaster on broadcaster.id = employer.broadcaster_id
join public.producer_types type on type.code = case
  when lower(coalesce(broadcaster.content_type, '')) like '%stream%' then 'streamer'
  else 'broadcaster'
end
on conflict (employer_id, producer_type_id, source) do update
set source_name = excluded.source_name,
    source_identifier = excluded.source_identifier,
    is_active = true,
    verified_on = excluded.verified_on,
    last_seen_at = excluded.last_seen_at,
    updated_at = now();

alter table public.producer_types enable row level security;
alter table public.organisation_producer_types enable row level security;
alter table public.employer_producer_types enable row level security;

create policy "Staff read producer types" on public.producer_types
  for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist','viewer']));
create policy "Staff read organisation producer types" on public.organisation_producer_types
  for select to authenticated
  using (public.current_user_can_admin_org(org_id));
create policy "Staff read employer producer types" on public.employer_producer_types
  for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin','jurist','viewer']));

revoke all on public.producer_types, public.organisation_producer_types,
  public.employer_producer_types from public, anon, authenticated;
grant select on public.producer_types, public.organisation_producer_types,
  public.employer_producer_types to authenticated;
grant all on public.producer_types, public.organisation_producer_types,
  public.employer_producer_types to service_role;

create or replace function public.replace_employer_manual_producer_types(
  target_org_id uuid,
  target_employer_id uuid,
  target_type_ids uuid[],
  actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(coalesce(target_type_ids, '{}'::uuid[])) selected(id)
    where not exists (
      select 1 from public.organisation_producer_types allowed
      where allowed.org_id = target_org_id
        and allowed.producer_type_id = selected.id
    )
  ) then
    raise exception 'Producer type is not enabled for organisation';
  end if;

  delete from public.employer_producer_types
  where employer_id = target_employer_id and source = 'manual';

  insert into public.employer_producer_types (
    employer_id, producer_type_id, source, is_active, created_by
  )
  select target_employer_id, selected.id, 'manual', true, actor_id
  from unnest(coalesce(target_type_ids, '{}'::uuid[])) selected(id)
  on conflict (employer_id, producer_type_id, source) do update
  set is_active = true, updated_at = now();
end;
$$;
revoke all on function public.replace_employer_manual_producer_types(uuid,uuid,uuid[],uuid)
  from public, anon, authenticated;
grant execute on function public.replace_employer_manual_producer_types(uuid,uuid,uuid[],uuid)
  to service_role;

create or replace function public.replace_organisation_producer_types(
  target_org_id uuid,
  target_names text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare cleaned_names text[];
begin
  select coalesce(array_agg(name order by first_position), '{}'::text[])
  into cleaned_names
  from (
    select min(source.ordinality) as first_position, trim(source.name) as name
    from unnest(coalesce(target_names, '{}'::text[])) with ordinality source(name, ordinality)
    where length(trim(source.name)) between 2 and 120
    group by lower(trim(source.name)), trim(source.name)
  ) normalized;

  insert into public.producer_types (code, name, origin, created_by_org_id)
  select
    'custom_' || substr(encode(extensions.digest(lower(name), 'sha256'), 'hex'), 1, 20),
    name,
    'custom',
    target_org_id
  from unnest(cleaned_names) name
  on conflict (normalized_name) do nothing;

  delete from public.organisation_producer_types where org_id = target_org_id;
  insert into public.organisation_producer_types (org_id, producer_type_id, display_order)
  select target_org_id, type.id, source.ordinality::integer - 1
  from unnest(cleaned_names) with ordinality source(name, ordinality)
  join public.producer_types type on type.normalized_name = lower(trim(source.name));
end;
$$;
revoke all on function public.replace_organisation_producer_types(uuid,text[])
  from public, anon, authenticated;
grant execute on function public.replace_organisation_producer_types(uuid,text[])
  to service_role;

-- Statistics use a live, private fact view. It contains no copied salary data,
-- is not exposed through the Data API, and always reflects current opt-outs.
alter table public.organisations
  add column statistics_contract_scope text not null default 'validated_only'
  check (statistics_contract_scope in ('validated_only','validated_and_drafts'));

alter table public.organisations
  add column statistics_profile_config jsonb not null default jsonb_build_object(
    'professional_start_year', true,
    'primary_profession_type', false,
    'secondary_profession_types', false,
    'usual_work_mode', false,
    'primary_work_region', false
  );

alter table public.rettighedshavere
  add column professional_start_year integer,
  add column primary_profession_type_id uuid references public.profession_types(id) on delete set null,
  add column usual_work_mode text,
  add column primary_work_region_code text,
  add constraint rettighedshavere_professional_start_year_check
    check (professional_start_year is null or professional_start_year between 1940 and 2200),
  add constraint rettighedshavere_usual_work_mode_check
    check (usual_work_mode is null or usual_work_mode in ('employee','company','both','other','prefer_not_to_say'));

create table public.organisation_work_regions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  code text not null,
  name_da text not null,
  name_en text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
alter table public.organisation_work_regions enable row level security;
create policy "Organisation members read work regions" on public.organisation_work_regions
  for select to authenticated using (public.current_user_belongs_to_org(org_id));
revoke all on public.organisation_work_regions from public, anon, authenticated;
grant select on public.organisation_work_regions to authenticated;
grant all on public.organisation_work_regions to service_role;

create table public.rights_holder_profession_types (
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  profession_type_id uuid not null references public.profession_types(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rights_holder_id, profession_type_id)
);
alter table public.rights_holder_profession_types enable row level security;
create policy "Members read own profession types" on public.rights_holder_profession_types
  for select to authenticated
  using (exists (select 1 from public.rettighedshavere holder where holder.id = rights_holder_id and holder.user_id = (select auth.uid())));
revoke all on public.rights_holder_profession_types from public, anon, authenticated;
grant select on public.rights_holder_profession_types to authenticated;
grant all on public.rights_holder_profession_types to service_role;

drop table if exists analytics.contract_facts;
create view analytics.contract_facts
with (security_invoker = true)
as
select
  contract.id as contract_id,
  contract.org_id,
  contract.rights_holder_id,
  contract.status as contract_status,
  contract.type as contract_type,
  coalesce(
    case when validation.extracted_data->>'startDate' ~ '^(19|20|21)[0-9]{2}'
      then left(validation.extracted_data->>'startDate', 4)::integer end,
    extract(year from contract.start_date)::integer,
    extract(year from contract.contract_date)::integer
  ) as period_year,
  lower(trim(coalesce(
    validation.extracted_data->>'professionType',
    validation.extracted_data->>'role',
    ''
  ))) as profession_type,
  nullif(validation.extracted_data->>'productionType','') as production_type,
  holder.gender,
  holder.primary_profession_type_id,
  holder.professional_start_year,
  holder.usual_work_mode,
  holder.primary_work_region_code,
  contract.employer_id as legacy_producer_id,
  contract.rights_holder_id is not null
    and holder.opt_out_statistics = false as statistics_allowed,
  validation.extracted_data,
  contract.start_date,
  contract.contract_date,
  contract.created_at as source_updated_at
from public.contracts contract
join public.rettighedshavere holder on holder.id = contract.rights_holder_id
left join lateral (
  select cv.extracted_data
  from public.contract_validations cv
  where cv.contract_id = contract.id and cv.org_id = contract.org_id
  order by cv.validated_at desc nulls last, cv.created_at desc
  limit 1
) validation on true
where contract.status in ('valideret','kladde');

revoke all on schema analytics from public, anon, authenticated;
revoke all on analytics.contract_facts from public, anon, authenticated;
grant usage on schema analytics to service_role;
grant select on analytics.contract_facts to service_role;

create or replace function public.get_statistics_facts(
  target_org_id uuid,
  include_drafts boolean default false
)
returns table (
  contract_id uuid,
  rights_holder_id uuid,
  contract_status text,
  contract_type text,
  period_year integer,
  profession_type text,
  production_type text,
  gender text,
  primary_profession_type_id uuid,
  professional_start_year integer,
  usual_work_mode text,
  primary_work_region_code text,
  producer_ids uuid[],
  producer_type_codes text[],
  membership_types text[],
  statistics_data jsonb,
  start_date date,
  contract_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    fact.contract_id,
    fact.rights_holder_id,
    fact.contract_status,
    fact.contract_type,
    fact.period_year,
    fact.profession_type,
    fact.production_type,
    fact.gender,
    fact.primary_profession_type_id,
    fact.professional_start_year,
    fact.usual_work_mode,
    fact.primary_work_region_code,
    coalesce(producers.ids, '{}'::uuid[]),
    coalesce(types.codes, '{}'::text[]),
    coalesce(types.memberships, '{}'::text[]),
    jsonb_strip_nulls(jsonb_build_object(
      'salary', fact.extracted_data->'salary',
      'salaryUnit', fact.extracted_data->'salaryUnit',
      'pensionPercent', fact.extracted_data->'pensionPercent',
      'workingWeeks', fact.extracted_data->'workingWeeks',
      'startDate', fact.extracted_data->'startDate',
      'endDate', fact.extracted_data->'endDate',
      'svod', fact.extracted_data->'svod',
      'streamingReservation', fact.extracted_data->'streamingReservation',
      'streaming', fact.extracted_data->'streaming',
      'copydan', fact.extracted_data->'copydan',
      'copydanReservation', fact.extracted_data->'copydanReservation',
      'royalty', fact.extracted_data->'royalty',
      'royaltyClause', fact.extracted_data->'royaltyClause',
      'collectiveAgreement', fact.extracted_data->'collectiveAgreement',
      'overenskomst', fact.extracted_data->'overenskomst',
      'overenskomstIdentified', fact.extracted_data->'overenskomstIdentified',
      'aiDataMiningClause', fact.extracted_data->'aiDataMiningClause',
      'holidayPayRate', fact.extracted_data->'holidayPayRate',
      'betaRate', fact.extracted_data->'betaRate',
      'isFreelanceContract', fact.extracted_data->'isFreelanceContract'
    )),
    fact.start_date,
    fact.contract_date
  from analytics.contract_facts fact
  join public.org_affiliations affiliation
    on affiliation.org_id = fact.org_id
   and affiliation.rights_holder_id = fact.rights_holder_id
   and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
   and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
  left join lateral (
    select array_agg(distinct relation.employer_id) filter (where relation.employer_id is not null) ids
    from (
      select ce.employer_id
      from public.contract_employers ce
      where ce.contract_id = fact.contract_id
      union
      select fact.legacy_producer_id
    ) relation
  ) producers on true
  left join lateral (
    select
      array_agg(distinct type.code) filter (where type.code is not null) codes,
      array_agg(distinct relation.membership_type) filter (
        where relation.source = 'producentforeningen'
          and relation.membership_type is not null
      ) memberships
    from public.employer_producer_types relation
    join public.producer_types type on type.id = relation.producer_type_id
    where relation.is_active
      and relation.employer_id = any(coalesce(producers.ids, '{}'::uuid[]))
  ) types on true
  where fact.org_id = target_org_id
    and fact.statistics_allowed
    and fact.period_year is not null
    and (fact.contract_status = 'valideret' or include_drafts)
$$;
revoke all on function public.get_statistics_facts(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.get_statistics_facts(uuid,boolean)
  to service_role;

create index if not exists contracts_statistics_org_status_idx
  on public.contracts (org_id, status, rights_holder_id)
  where status in ('valideret','kladde');
create index if not exists contract_validations_statistics_idx
  on public.contract_validations (contract_id, org_id, validated_at desc, created_at desc);
create index if not exists org_affiliations_statistics_idx
  on public.org_affiliations (org_id, rights_holder_id);

-- The application has been migrated to the unified register above.
drop table public.organisation_producer_categories;
drop table public.producer_categories;
drop table public.producer_association_memberships;
drop table public.employer_registries;

-- Contract review queue: bounded retries and explicit dead-letter state.
alter table public.contract_review_jobs
  drop constraint if exists contract_review_jobs_status_check;
alter table public.contract_review_jobs
  add constraint contract_review_jobs_status_check
  check (status in ('queued','processing','done','error','dead'));

create or replace function private.claim_contract_review_job(worker_id text)
returns setof public.contract_review_jobs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with candidate as (
    select id
    from public.contract_review_jobs
    where status in ('queued','error')
      and attempts < 5
      and next_attempt_at <= now()
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by priority asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.contract_review_jobs job
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = worker_id,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

comment on table public.producer_types is
  'Shared canonical producer type catalogue including Producentforeningen groups.';
comment on table public.employer_producer_types is
  'Canonical many-to-many producer classification and association membership facts.';
comment on view analytics.contract_facts is
  'Live server-only statistics facts; no duplicated salary dataset.';
