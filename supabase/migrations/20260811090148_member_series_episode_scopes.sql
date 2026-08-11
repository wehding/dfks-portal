create table public.member_series_episode_scopes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  series_work_id uuid not null references public.works(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  episode_numbers integer[] not null default '{}',
  covers_whole_season boolean not null default false,
  source text not null default 'mine_works' check (source in ('onboarding', 'contract_upload', 'contract_link', 'mine_works', 'legacy')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_series_episode_scope_selection_check check (
    (status = 'pending' and covers_whole_season = false and cardinality(episode_numbers) = 0 and confirmed_at is null)
    or
    (status = 'confirmed' and (covers_whole_season or cardinality(episode_numbers) > 0) and confirmed_at is not null)
  ),
  unique (org_id, rights_holder_id, series_work_id, season_number)
);

create index member_series_episode_scopes_holder_status_idx
  on public.member_series_episode_scopes (rights_holder_id, status, updated_at desc);
create index member_series_episode_scopes_org_status_idx
  on public.member_series_episode_scopes (org_id, status, updated_at desc);

alter table public.contracts
  add column episode_scope_id uuid references public.member_series_episode_scopes(id) on delete set null;

create index contracts_episode_scope_idx on public.contracts (episode_scope_id)
  where episode_scope_id is not null;

comment on table public.member_series_episode_scopes is
  'Medlemmets eksplicitte afsnitsvalg pr. serie og sæson. Pending er et ubesvaret valg; en tom afsnitsliste betyder kun hele sæsonen, når covers_whole_season er sand.';
comment on column public.contracts.episode_scope_id is
  'Fælles medlemsbekræftelse af afsnit for kontraktens serie og sæson.';

alter table public.member_series_episode_scopes enable row level security;
revoke all on public.member_series_episode_scopes from public, anon, authenticated;
grant select on public.member_series_episode_scopes to authenticated;
grant all on public.member_series_episode_scopes to service_role;

create policy "Members read own series episode scopes"
  on public.member_series_episode_scopes for select to authenticated
  using (public.current_user_is_member_owner(rights_holder_id));

create policy "Admins read organisation series episode scopes"
  on public.member_series_episode_scopes for select to authenticated
  using (public.current_user_can_admin_org(org_id));

-- Brug kun medlemmets aktive bekræftelser som bevis på et afsluttet valg.
-- contracts.episode_numbers kan også indeholde AI-/adminudtræk og må derfor
-- ikke i sig selv løfte en sæson fra pending til confirmed.
with candidates as (
  select
    c.id as contract_id,
    c.org_id,
    c.rights_holder_id,
    coalesce(w.parent_work_id, w.id) as series_work_id,
    c.season_number,
    confirmation.id as confirmation_id,
    confirmation.scope as confirmation_scope,
    confirmation.episode_numbers as confirmed_episode_numbers,
    confirmation.confirmed_at
  from public.contracts c
  join public.works w on w.id = c.work_id
  left join public.contract_episode_confirmations confirmation
    on confirmation.contract_id = c.id
   and confirmation.invalidated_at is null
  where c.rights_holder_id is not null
    and c.season_number is not null
    and (w.type in ('tv-serie', 'dokumentar-serie') or w.parent_work_id is not null)
), expanded as (
  select candidate.*, episode_number
  from candidates candidate
  left join lateral unnest(coalesce(candidate.confirmed_episode_numbers, '{}')) as episode_number on true
), grouped as (
  select
    org_id,
    rights_holder_id,
    series_work_id,
    season_number,
    bool_or(confirmation_id is not null) as has_confirmation,
    coalesce(bool_or(confirmation_scope = 'entire_season'), false) as whole_season,
    coalesce(array_agg(distinct episode_number order by episode_number)
      filter (where episode_number is not null), '{}') as selected_episodes,
    max(confirmed_at) as confirmed_at
  from expanded
  group by org_id, rights_holder_id, series_work_id, season_number
)
insert into public.member_series_episode_scopes (
  org_id, rights_holder_id, series_work_id, season_number, status,
  episode_numbers, covers_whole_season, source, confirmed_at
)
select
  org_id,
  rights_holder_id,
  series_work_id,
  season_number,
  case when has_confirmation then 'confirmed' else 'pending' end,
  case when whole_season then '{}' else selected_episodes end,
  whole_season,
  'legacy',
  case when has_confirmation then confirmed_at else null end
from grouped
on conflict (org_id, rights_holder_id, series_work_id, season_number) do nothing;

update public.contracts c
set episode_scope_id = scope.id
from public.member_series_episode_scopes scope
join public.works contract_work on coalesce(contract_work.parent_work_id, contract_work.id) = scope.series_work_id
where c.org_id = scope.org_id
  and c.rights_holder_id = scope.rights_holder_id
  and c.season_number = scope.season_number
  and c.episode_scope_id is null
  and c.work_id = contract_work.id;
