create or replace function public.list_member_work_page(
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
  with assignment_groups as (
    select
      case
        when work.parent_work_id is not null and work.season_number is not null
          then 'season:' || work.parent_work_id::text || ':' || work.season_number::text
        else 'work:' || work.id::text
      end as logical_key,
      array_agg(distinct work.id) as work_ids,
      array_agg(distinct assignment.id) as assignment_ids,
      array[]::uuid[] as scope_ids,
      coalesce(parent.title, work.title) as title,
      coalesce(parent.type, work.type) as work_type,
      coalesce(parent.year, work.year) as work_year,
      work.parent_work_id,
      work.season_number,
      max(assignment.created_at) as created_at,
      bool_or(work.year is null or nullif(btrim(work.title), '') is null or nullif(btrim(work.type), '') is null) as missing_data
    from public.work_assignments assignment
    join public.works work on work.id = assignment.work_id
    left join public.works parent on parent.id = work.parent_work_id
    where assignment.org_id = p_org_id
      and assignment.rights_holder_id = p_rights_holder_id
    group by 1, coalesce(parent.title, work.title), coalesce(parent.type, work.type),
      coalesce(parent.year, work.year), work.parent_work_id, work.season_number
  ),
  scope_groups as (
    select
      'season:' || scope.series_work_id::text || ':' || scope.season_number::text as logical_key,
      array[scope.series_work_id]::uuid[] as work_ids,
      array_agg(distinct assignment.id) as assignment_ids,
      array_agg(distinct scope.id) as scope_ids,
      series.title,
      series.type as work_type,
      series.year as work_year,
      scope.series_work_id as parent_work_id,
      scope.season_number,
      max(coalesce(scope.updated_at, assignment.created_at)) as created_at,
      (series.year is null or nullif(btrim(series.title), '') is null or nullif(btrim(series.type), '') is null) as missing_data
    from public.member_series_episode_scopes scope
    join public.works series on series.id = scope.series_work_id
    join public.work_assignments assignment
      on assignment.work_id = scope.series_work_id
      and assignment.org_id = scope.org_id
      and assignment.rights_holder_id = scope.rights_holder_id
    where scope.org_id = p_org_id
      and scope.rights_holder_id = p_rights_holder_id
    group by scope.series_work_id, scope.season_number, series.title, series.type, series.year
  ),
  combined as (
    select * from assignment_groups
    union all
    select * from scope_groups
  ),
  grouped_values as (
    select
      combined.logical_key,
      max(combined.title) as title,
      max(combined.work_type) as work_type,
      max(combined.work_year) as work_year,
      (array_agg(combined.parent_work_id) filter (where combined.parent_work_id is not null))[1] as parent_work_id,
      max(combined.season_number) as season_number,
      max(combined.created_at) as created_at,
      bool_or(combined.missing_data) as missing_data
    from combined
    group by combined.logical_key
  ),
  grouped_work_ids as (
    select combined.logical_key, array_agg(distinct value) as work_ids
    from combined
    cross join lateral unnest(combined.work_ids) value
    group by combined.logical_key
  ),
  grouped_assignment_ids as (
    select combined.logical_key, array_agg(distinct value) as assignment_ids
    from combined
    cross join lateral unnest(combined.assignment_ids) value
    group by combined.logical_key
  ),
  grouped_scope_ids as (
    select combined.logical_key, array_agg(distinct value) as scope_ids
    from combined
    cross join lateral unnest(combined.scope_ids) value
    group by combined.logical_key
  ),
  grouped as (
    select
      value.*,
      work_ids.work_ids,
      assignment_ids.assignment_ids,
      coalesce(scope_ids.scope_ids, array[]::uuid[]) as scope_ids
    from grouped_values value
    join grouped_work_ids work_ids using (logical_key)
    join grouped_assignment_ids assignment_ids using (logical_key)
    left join grouped_scope_ids scope_ids using (logical_key)
  ),
  enriched as (
    select grouped.*,
      exists (
        select 1 from public.contracts contract
        where contract.org_id = p_org_id
          and contract.rights_holder_id = p_rights_holder_id
          and contract.superseded_by_contract_id is null
          and (
            contract.work_id = any(grouped.work_ids)
            or (grouped.parent_work_id is not null and contract.work_id = grouped.parent_work_id and contract.season_number = grouped.season_number)
          )
      ) as has_contract,
      exists (
        select 1 from public.member_series_episode_scopes scope
        where scope.id = any(grouped.scope_ids) and scope.status = 'pending'
      ) as missing_episodes,
      exists (
        select 1 from public.work_change_requests request
        where request.org_id = p_org_id
          and request.requested_by_rights_holder_id = p_rights_holder_id
          and request.work_id = any(grouped.work_ids)
          and request.status = 'pending'
      ) as has_pending,
      exists (
        select 1 from public.work_change_requests request
        where request.org_id = p_org_id
          and request.requested_by_rights_holder_id = p_rights_holder_id
          and request.work_id = any(grouped.work_ids)
          and request.status = 'rejected'
      ) as has_rejected,
      exists (
        select 1
        from public.work_change_requests request
        join public.work_change_request_comments comment on comment.request_id = request.id
        where request.org_id = p_org_id
          and request.requested_by_rights_holder_id = p_rights_holder_id
          and request.work_id = any(grouped.work_ids)
          and comment.author_role = 'admin'
          and comment.member_read_at is null
      ) as has_message
    from grouped
  ),
  filtered as (
    select enriched.*
    from enriched
    where (nullif(btrim(p_search), '') is null or enriched.title ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_work_type, 'all') = 'all' or enriched.work_type = p_work_type)
      and (
        coalesce(p_status, 'all') = 'all'
        or (p_status = 'messages' and enriched.has_message)
        or (p_status = 'pending' and enriched.has_pending)
        or (p_status = 'rejected' and enriched.has_rejected)
        or (p_status = 'missingContract' and not enriched.has_contract)
        or (p_status = 'hasContract' and enriched.has_contract)
        or (p_status = 'missingData' and enriched.missing_data)
        or (p_status = 'missingEpisodes' and enriched.missing_episodes)
      )
  ),
  counts as (
    select
      (select count(*) from filtered) as filtered_count,
      (select count(*) from grouped) as total_count
  ),
  paged as (
    select filtered.*
    from filtered
    order by
      case when p_sort = 'title' and p_direction = 'asc' then filtered.title end asc nulls last,
      case when p_sort = 'title' and p_direction = 'desc' then filtered.title end desc nulls last,
      case when p_sort = 'year' and p_direction = 'asc' then filtered.work_year end asc nulls last,
      case when p_sort = 'year' and p_direction = 'desc' then filtered.work_year end desc nulls last,
      case when p_sort = 'type' and p_direction = 'asc' then filtered.work_type end asc nulls last,
      case when p_sort = 'type' and p_direction = 'desc' then filtered.work_type end desc nulls last,
      case when p_sort = 'contract' and p_direction = 'asc' then filtered.has_contract::integer end asc,
      case when p_sort = 'contract' and p_direction = 'desc' then filtered.has_contract::integer end desc,
      case when coalesce(p_sort, 'date') = 'date' and p_direction = 'asc' then filtered.created_at end asc nulls last,
      case when coalesce(p_sort, 'date') = 'date' and p_direction <> 'asc' then filtered.created_at end desc nulls last,
      filtered.logical_key asc
    offset (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100)
    limit least(greatest(p_page_size, 1), 100)
  )
  select paged.logical_key, paged.work_ids, paged.assignment_ids, paged.scope_ids,
    counts.filtered_count, counts.total_count
  from counts left join paged on true;
$$;

revoke all on function public.list_member_work_page(uuid, uuid, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_member_work_page(uuid, uuid, text, text, text, text, text, integer, integer)
  to service_role;
