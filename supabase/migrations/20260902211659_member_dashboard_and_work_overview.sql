-- Medlemmets overblik skal kunne huske, at rettighedssiden er set, og de to
-- tunge portalvisninger skal kunne hente deres startdata i en enkelt runde.

alter table public.org_affiliations
  add column if not exists economy_overview_viewed_at timestamptz;

comment on column public.org_affiliations.economy_overview_viewed_at is
  'Foerste vellykkede, organisationsspecifikke indlaesning af medlemmets oekonomioversigt.';

create or replace function public.mark_member_economy_overview_viewed(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_user_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewed_at timestamptz;
begin
  if not exists (
    select 1
    from public.rettighedshavere holder
    join public.org_affiliations affiliation
      on affiliation.rights_holder_id = holder.id
     and affiliation.org_id = p_org_id
    where holder.id = p_rights_holder_id
      and holder.user_id = p_user_id
  ) then
    raise exception 'Economy overview access denied';
  end if;

  update public.org_affiliations affiliation
  set economy_overview_viewed_at = coalesce(affiliation.economy_overview_viewed_at, now())
  where affiliation.org_id = p_org_id
    and affiliation.rights_holder_id = p_rights_holder_id
  returning affiliation.economy_overview_viewed_at into viewed_at;

  return viewed_at;
end;
$$;

revoke all on function public.mark_member_economy_overview_viewed(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_member_economy_overview_viewed(uuid, uuid, uuid)
  to service_role;

-- Bevar tidligere gennemfoerte rettighedstjek, hvor auditsporet entydigt
-- identificerer baade organisation og rettighedshaver.
with prior_views as (
  select
    event.actor_org_id as org_id,
    event.target_member_uuid as rights_holder_id,
    min(event.occurred_at) as first_viewed_at
  from public.audit_events event
  where event.system_component = 'portal.rights.allocations'
    and event.outcome = 'success'
    and event.actor_org_id is not null
    and event.target_member_uuid is not null
  group by event.actor_org_id, event.target_member_uuid
)
update public.org_affiliations affiliation
set economy_overview_viewed_at = prior_views.first_viewed_at
from prior_views
where affiliation.org_id = prior_views.org_id
  and affiliation.rights_holder_id = prior_views.rights_holder_id
  and affiliation.economy_overview_viewed_at is null;

create or replace function public.get_member_dashboard_overview_v2(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_user_id uuid,
  p_preview_limit integer default 5
)
returns table (
  contracts_missing_work_count bigint,
  review_work_count bigint,
  share_task_count bigint,
  unread_contract_count bigint,
  pending_work_request_count bigint,
  pending_screening_count bigint,
  contract_required_work_count bigint,
  legacy_declaration_task_count bigint,
  economy_overview_viewed_at timestamptz,
  share_tasks jsonb,
  unread_contracts jsonb,
  pending_work_requests jsonb,
  pending_screenings jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select *
    from public.get_member_dashboard_task_overview(
      p_org_id,
      p_rights_holder_id,
      p_user_id,
      p_preview_limit
    )
  ),
  declaration_count as (
    select count(distinct task.root_work_id)::bigint as value
    from public.list_member_legacy_declaration_tasks(p_org_id, p_rights_holder_id) task
  ),
  affiliation as (
    select row.economy_overview_viewed_at
    from public.org_affiliations row
    where row.org_id = p_org_id
      and row.rights_holder_id = p_rights_holder_id
    limit 1
  )
  select
    base.contracts_missing_work_count,
    base.review_work_count,
    base.share_task_count,
    base.unread_contract_count,
    base.pending_work_request_count,
    base.pending_screening_count,
    public.count_member_contract_required_works(p_org_id, p_rights_holder_id),
    coalesce(declaration_count.value, 0),
    affiliation.economy_overview_viewed_at,
    base.share_tasks,
    base.unread_contracts,
    base.pending_work_requests,
    base.pending_screenings
  from base
  cross join declaration_count
  left join affiliation on true;
$$;

revoke all on function public.get_member_dashboard_overview_v2(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_member_dashboard_overview_v2(uuid, uuid, uuid, integer)
  to service_role;

create or replace function public.list_member_work_page_v2(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_search text default '',
  p_work_type text default 'all',
  p_status text default 'all',
  p_sort text default 'date',
  p_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 20
)
returns table (
  logical_key text,
  work_ids uuid[],
  assignment_ids uuid[],
  scope_ids uuid[],
  filtered_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with assignment_groups as materialized (
    select
      case when work.parent_work_id is not null and work.season_number is not null
        then 'season:' || work.parent_work_id::text || ':' || work.season_number::text
        else 'work:' || work.id::text end as logical_key,
      array_agg(distinct work.id) as work_ids,
      array_agg(distinct assignment.id) as assignment_ids,
      array[]::uuid[] as scope_ids,
      coalesce(parent.title, work.title) as title,
      coalesce(parent.type, work.type) as work_type,
      coalesce(parent.year, work.year) as work_year,
      work.parent_work_id,
      work.season_number,
      max(assignment.created_at) as created_at,
      string_agg(distinct coalesce(assignment.role, ''), ' ') as role_search,
      bool_or(work.year is null or nullif(btrim(work.title), '') is null or nullif(btrim(work.type), '') is null) as missing_data
    from public.work_assignments assignment
    join public.works work on work.id = assignment.work_id
    left join public.works parent on parent.id = work.parent_work_id
    where assignment.org_id = p_org_id and assignment.rights_holder_id = p_rights_holder_id
    group by 1, coalesce(parent.title, work.title), coalesce(parent.type, work.type),
      coalesce(parent.year, work.year), work.parent_work_id, work.season_number
  ),
  scope_groups as materialized (
    select
      'season:' || scope.series_work_id::text || ':' || scope.season_number::text as logical_key,
      array[scope.series_work_id]::uuid[] as work_ids,
      array_agg(distinct assignment.id) as assignment_ids,
      array_agg(distinct scope.id) as scope_ids,
      series.title, series.type as work_type, series.year as work_year,
      scope.series_work_id as parent_work_id, scope.season_number,
      max(coalesce(scope.updated_at, assignment.created_at)) as created_at,
      string_agg(distinct coalesce(assignment.role, ''), ' ') as role_search,
      (series.year is null or nullif(btrim(series.title), '') is null or nullif(btrim(series.type), '') is null) as missing_data
    from public.member_series_episode_scopes scope
    join public.works series on series.id = scope.series_work_id
    join public.work_assignments assignment on assignment.work_id = scope.series_work_id
      and assignment.org_id = scope.org_id and assignment.rights_holder_id = scope.rights_holder_id
    where scope.org_id = p_org_id and scope.rights_holder_id = p_rights_holder_id
    group by scope.series_work_id, scope.season_number, series.title, series.type, series.year
  ),
  combined as materialized (select * from assignment_groups union all select * from scope_groups),
  grouped_values as (
    select logical_key, max(title) as title, max(work_type) as work_type,
      max(work_year) as work_year,
      (array_agg(parent_work_id) filter (where parent_work_id is not null))[1] as parent_work_id,
      max(season_number) as season_number, max(created_at) as created_at,
      string_agg(distinct role_search, ' ') as role_search,
      bool_or(missing_data) as missing_data
    from combined group by logical_key
  ),
  grouped_work_ids as (
    select logical_key, array_agg(distinct value) as work_ids
    from combined cross join lateral unnest(work_ids) value group by logical_key
  ),
  grouped_assignment_ids as (
    select logical_key, array_agg(distinct value) as assignment_ids
    from combined cross join lateral unnest(assignment_ids) value group by logical_key
  ),
  grouped_scope_ids as (
    select logical_key, array_agg(distinct value) as scope_ids
    from combined cross join lateral unnest(scope_ids) value group by logical_key
  ),
  grouped as materialized (
    select value.*, work_ids.work_ids, assignment_ids.assignment_ids,
      coalesce(scope_ids.scope_ids, array[]::uuid[]) as scope_ids
    from grouped_values value
    join grouped_work_ids work_ids using (logical_key)
    join grouped_assignment_ids assignment_ids using (logical_key)
    left join grouped_scope_ids scope_ids using (logical_key)
  ),
  enriched as (
    select grouped.*,
      case when p_sort = 'contract' or p_status in ('missingContract', 'hasContract') then exists (
        select 1 from public.contracts contract
        where contract.org_id = p_org_id and contract.rights_holder_id = p_rights_holder_id
          and contract.superseded_by_contract_id is null
          and (contract.work_id = any(grouped.work_ids)
            or (grouped.parent_work_id is not null and contract.work_id = grouped.parent_work_id and contract.season_number = grouped.season_number))
      ) else false end as has_contract,
      case when p_status = 'missingEpisodes' then exists (
        select 1 from public.member_series_episode_scopes scope
        where scope.id = any(grouped.scope_ids) and scope.status = 'pending'
      ) else false end as missing_episodes,
      case when p_status = 'unresolvedShares' then (
        exists (select 1 from public.member_work_collaboration_reviews review
          where review.org_id = p_org_id and review.rights_holder_id = p_rights_holder_id
            and review.status in ('pending', 'disputed')
            and (review.work_id = any(grouped.work_ids) or review.work_id = grouped.parent_work_id))
        or exists (select 1 from public.work_share_participants participant
          join public.work_share_cases share_case on share_case.id = participant.case_id
          where participant.org_id = p_org_id and participant.rights_holder_id = p_rights_holder_id
            and participant.excluded_at is null and participant.relationship_status = 'pending'
            and share_case.status <> 'resolved'
            and (participant.work_id = any(grouped.work_ids) or participant.work_id = grouped.parent_work_id))
      ) else false end as unresolved_shares,
      case when p_status = 'pending' then exists (
        select 1 from public.work_change_requests request
        where request.org_id = p_org_id and request.requested_by_rights_holder_id = p_rights_holder_id
          and request.work_id = any(grouped.work_ids) and request.status = 'pending'
      ) else false end as has_pending,
      case when p_status = 'rejected' then exists (
        select 1 from public.work_change_requests request
        where request.org_id = p_org_id and request.requested_by_rights_holder_id = p_rights_holder_id
          and request.work_id = any(grouped.work_ids) and request.status = 'rejected'
      ) else false end as has_rejected,
      case when p_status = 'messages' then exists (
        select 1 from public.work_change_requests request
        join public.work_change_request_comments comment on comment.request_id = request.id
        where request.org_id = p_org_id and request.requested_by_rights_holder_id = p_rights_holder_id
          and request.work_id = any(grouped.work_ids) and comment.author_role = 'admin'
          and comment.member_read_at is null
      ) else false end as has_message
    from grouped
  ),
  filtered as materialized (
    select * from enriched
    where (
      nullif(btrim(p_search), '') is null
      or title ilike '%' || btrim(p_search) || '%'
      or work_type ilike '%' || btrim(p_search) || '%'
      or work_year::text = btrim(p_search)
      or season_number::text = btrim(p_search)
      or role_search ilike '%' || btrim(p_search) || '%'
      or exists (
        select 1 from public.work_distributions distribution
        left join public.broadcasters broadcaster on broadcaster.id = distribution.broadcaster_id
        where distribution.org_id = p_org_id
          and distribution.work_id = any(enriched.work_ids)
          and coalesce(broadcaster.name, distribution.broadcaster_name, '') ilike '%' || btrim(p_search) || '%'
      )
    )
      and (coalesce(p_work_type, 'all') = 'all'
        or (p_work_type = 'film' and work_type in ('spillefilm', 'kortfilm'))
        or (p_work_type = 'series' and work_type in ('tv-serie', 'tv-program', 'reality', 'sport'))
        or (p_work_type = 'documentary' and work_type in ('dokumentarfilm', 'dokumentar-serie'))
        or work_type = p_work_type)
      and (coalesce(p_status, 'all') = 'all'
        or (p_status = 'messages' and has_message)
        or (p_status = 'pending' and has_pending)
        or (p_status = 'rejected' and has_rejected)
        or (p_status = 'missingContract' and not has_contract)
        or (p_status = 'hasContract' and has_contract)
        or (p_status = 'missingData' and missing_data)
        or (p_status = 'missingEpisodes' and missing_episodes)
        or (p_status = 'unresolvedShares' and unresolved_shares))
  ),
  counts as (
    select (select count(*) from filtered) filtered_count,
      (select count(*) from grouped) total_count
  ),
  paged as (
    select * from filtered order by
      case when p_sort = 'title' and p_direction = 'asc' then title end asc nulls last,
      case when p_sort = 'title' and p_direction = 'desc' then title end desc nulls last,
      case when p_sort = 'year' and p_direction = 'asc' then work_year end asc nulls last,
      case when p_sort = 'year' and p_direction = 'desc' then work_year end desc nulls last,
      case when p_sort = 'type' and p_direction = 'asc' then work_type end asc nulls last,
      case when p_sort = 'type' and p_direction = 'desc' then work_type end desc nulls last,
      case when p_sort = 'role' and p_direction = 'asc' then role_search end asc nulls last,
      case when p_sort = 'role' and p_direction = 'desc' then role_search end desc nulls last,
      case when p_sort = 'episode' and p_direction = 'asc' then season_number end asc nulls last,
      case when p_sort = 'episode' and p_direction = 'desc' then season_number end desc nulls last,
      case when p_sort = 'contract' and p_direction = 'asc' then has_contract::integer end asc,
      case when p_sort = 'contract' and p_direction = 'desc' then has_contract::integer end desc,
      case when coalesce(p_sort, 'date') = 'date' and p_direction = 'asc' then created_at end asc nulls last,
      case when coalesce(p_sort, 'date') = 'date' and p_direction <> 'asc' then created_at end desc nulls last,
      logical_key asc
    offset (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100)
    limit least(greatest(p_page_size, 1), 100)
  )
  select paged.logical_key, paged.work_ids, paged.assignment_ids, paged.scope_ids,
    counts.filtered_count, counts.total_count
  from counts left join paged on true;
$$;

revoke all on function public.list_member_work_page_v2(uuid, uuid, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_member_work_page_v2(uuid, uuid, text, text, text, text, text, integer, integer)
  to service_role;

-- Returnerer faerdige, lette listeelementer for den aktuelle side. Detaljer,
-- kommentarer og medklippere forbliver i de eksisterende lazy-load kald.
create or replace function public.list_member_work_overview_page(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_search text default '',
  p_work_type text default 'all',
  p_status text default 'all',
  p_sort text default 'date',
  p_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 20
)
returns table (
  item jsonb,
  filtered_count bigint,
  total_count bigint,
  legacy_required_work_ids uuid[],
  legacy_declared_work_ids uuid[],
  legacy_task_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with page_keys as materialized (
    select * from public.list_member_work_page_v2(
      p_org_id, p_rights_holder_id, p_search, p_work_type, p_status,
      p_sort, p_direction, p_page, p_page_size
    )
  ),
  valid_keys as (
    select * from page_keys where logical_key is not null
  ),
  legacy_tasks as materialized (
    select * from public.list_member_legacy_declaration_tasks(p_org_id, p_rights_holder_id)
  ),
  legacy_required as (
    select coalesce(array_agg(distinct scope_id), array[]::uuid[]) as ids
    from legacy_tasks task
    cross join lateral unnest(task.qualifying_scope_ids) scope_id
  ),
  legacy_declared as (
    select coalesce(array_agg(distinct declared.work_id), array[]::uuid[]) as ids
    from public.list_member_legacy_declared_scope_ids(p_org_id, p_rights_holder_id) declared
  ),
  work_items as (
    select
      key.logical_key,
      jsonb_build_object(
        'kind', 'work',
        'work', jsonb_build_object(
          'assignment', jsonb_build_object(
            'id', assignment.id,
            'work_id', work.id,
            'rights_holder_id', p_rights_holder_id,
            'role', assignment.role,
            'contract_id', assignment.contract_id,
            'episode_id', assignment.episode_id,
            'created_at', assignment.created_at,
            'episodes', null,
            'works', jsonb_build_object(
              'id', work.id,
              'title', work.title,
              'type', work.type,
              'year', work.year,
              'production_year', work.production_year,
              'duration_minutes', work.duration_minutes,
              'episode_count', work.episode_count,
              'parent_work_id', work.parent_work_id,
              'season_number', work.season_number,
              'episode_number', work.episode_number,
              'genre', work.genre,
              'director', work.director,
              'production_companies', work.production_companies,
              'status', work.status,
              'dfi_id', work.dfi_id,
              'tmdb_id', work.tmdb_id,
              'imdb_id', work.imdb_id,
              'poster_url', work.poster_url,
              'description', work.description,
              'work_production_numbers', coalesce((
                select jsonb_agg(jsonb_build_object('tv_station', number.tv_station, 'number', number.number))
                from public.work_production_numbers number where number.work_id = work.id
              ), '[]'::jsonb),
              'work_distributions', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'broadcaster_name', distribution.broadcaster_name,
                  'broadcasters', case when broadcaster.id is null then null else jsonb_build_object(
                    'name', broadcaster.name, 'logo_path', broadcaster.logo_path
                  ) end
                ))
                from public.work_distributions distribution
                left join public.broadcasters broadcaster on broadcaster.id = distribution.broadcaster_id
                where distribution.org_id = p_org_id and distribution.work_id = work.id
              ), '[]'::jsonb)
            )
          )
        ),
        'contractCount', case when exists (
          select 1 from public.contracts contract
          where contract.org_id = p_org_id
            and contract.rights_holder_id = p_rights_holder_id
            and contract.superseded_by_contract_id is null
            and contract.work_id = work.id
        ) then 1 else 0 end,
        'pendingCount', (
          select count(*) from public.work_change_requests request
          where request.org_id = p_org_id
            and request.requested_by_rights_holder_id = p_rights_holder_id
            and request.work_id = work.id and request.status = 'pending'
        ),
        'unreadCount', (
          select count(*) from public.work_change_request_comments comment
          join public.work_change_requests request on request.id = comment.request_id
          where request.org_id = p_org_id
            and request.requested_by_rights_holder_id = p_rights_holder_id
            and request.work_id = work.id
            and comment.author_role = 'admin' and comment.member_read_at is null
        )
      ) as item
    from valid_keys key
    join lateral (
      select candidate.* from public.work_assignments candidate
      where candidate.id = any(key.assignment_ids)
      order by candidate.created_at desc nulls last, candidate.id
      limit 1
    ) assignment on true
    join public.works work on work.id = assignment.work_id
    where key.logical_key like 'work:%'
  ),
  season_items as (
    select
      key.logical_key,
      jsonb_build_object(
        'kind', 'season',
        'key', key.logical_key,
        'parentWorkId', parent.id,
        'seasonNumber', split_part(key.logical_key, ':', 3)::integer,
        'title', parent.title,
        'type', parent.type,
        'year', parent.year,
        'productionYear', parent.production_year,
        'posterUrl', parent.poster_url,
        'episodeCount', greatest(
          coalesce((select count(distinct episode.id) from public.works episode where episode.id = any(key.work_ids) and episode.parent_work_id = parent.id), 0),
          coalesce((select cardinality(scope.episode_numbers) from public.member_series_episode_scopes scope where scope.id = any(key.scope_ids) order by scope.updated_at desc limit 1), 0)
        ),
        'workIds', coalesce((
          select jsonb_agg(distinct episode.id)
          from public.works episode
          where episode.id = any(key.work_ids) and episode.parent_work_id = parent.id
        ), '[]'::jsonb),
        'assignmentIds', to_jsonb(key.assignment_ids),
        'contractCount', greatest(
          (
            select count(distinct episode.id)
            from public.works episode
            where episode.id = any(key.work_ids)
              and episode.parent_work_id = parent.id
              and exists (
                select 1 from public.contracts contract
                where contract.org_id = p_org_id
                  and contract.rights_holder_id = p_rights_holder_id
                  and contract.superseded_by_contract_id is null
                  and (
                    contract.work_id = episode.id
                    or (contract.work_id = parent.id and (
                      contract.season_number is null
                      or contract.season_number = episode.season_number
                    ) and (
                      contract.episode_numbers is null
                      or cardinality(contract.episode_numbers) = 0
                      or episode.episode_number = any(contract.episode_numbers)
                    ))
                  )
              )
          ),
          case when not exists (
            select 1
            from public.works episode
            where episode.id = any(key.work_ids)
              and episode.parent_work_id = parent.id
          ) then (
            select count(*)
            from public.contracts contract
            where contract.org_id = p_org_id
              and contract.rights_holder_id = p_rights_holder_id
              and contract.superseded_by_contract_id is null
              and contract.work_id = parent.id
              and (
                contract.season_number is null
                or contract.season_number = split_part(key.logical_key, ':', 3)::integer
              )
          ) else 0 end
        ),
        'pendingCount', (
          select count(*) from public.work_change_requests request
          where request.org_id = p_org_id
            and request.requested_by_rights_holder_id = p_rights_holder_id
            and request.work_id = any(key.work_ids) and request.status = 'pending'
        ),
        'unreadCount', (
          select count(*) from public.work_change_request_comments comment
          join public.work_change_requests request on request.id = comment.request_id
          where request.org_id = p_org_id
            and request.requested_by_rights_holder_id = p_rights_holder_id
            and request.work_id = any(key.work_ids)
            and comment.author_role = 'admin' and comment.member_read_at is null
        ),
        'roleSummary', coalesce((
          select case when count(distinct nullif(trim(assignment.role), '')) > 1 then 'Flere roller'
            else min(nullif(trim(assignment.role), '')) end
          from public.work_assignments assignment
          where assignment.id = any(key.assignment_ids)
        ), null),
        'createdAt', (
          select max(assignment.created_at) from public.work_assignments assignment
          where assignment.id = any(key.assignment_ids)
        ),
        'episodeSelectionStatus', coalesce((
          select scope.status from public.member_series_episode_scopes scope
          where scope.id = any(key.scope_ids) order by scope.updated_at desc limit 1
        ), 'confirmed'),
        'episodeScopeId', (
          select scope.id from public.member_series_episode_scopes scope
          where scope.id = any(key.scope_ids) order by scope.updated_at desc limit 1
        ),
        'coversWholeSeason', coalesce((
          select scope.covers_whole_season from public.member_series_episode_scopes scope
          where scope.id = any(key.scope_ids) order by scope.updated_at desc limit 1
        ), false)
      ) as item
    from valid_keys key
    join public.works parent on parent.id = split_part(key.logical_key, ':', 2)::uuid
    where key.logical_key like 'season:%'
  ),
  items as (
    select * from work_items union all select * from season_items
  ),
  summary as (
    select
      coalesce((select max(key.filtered_count) from page_keys key), 0)::bigint as filtered_count,
      coalesce((select max(key.total_count) from page_keys key), 0)::bigint as total_count,
      legacy_required.ids as legacy_required_work_ids,
      legacy_declared.ids as legacy_declared_work_ids,
      (select count(distinct task.root_work_id) from legacy_tasks task)::bigint as legacy_task_count
    from legacy_required cross join legacy_declared
  )
  select items.item, summary.filtered_count, summary.total_count,
    summary.legacy_required_work_ids, summary.legacy_declared_work_ids,
    summary.legacy_task_count
  from summary
  left join items on true
  left join valid_keys key on key.logical_key = items.logical_key
  order by array_position((select array_agg(ordered.logical_key) from valid_keys ordered), items.logical_key);
$$;

revoke all on function public.list_member_work_overview_page(uuid, uuid, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_member_work_overview_page(uuid, uuid, text, text, text, text, text, integer, integer)
  to service_role;
