-- Paginated producer summaries for the admin archive. The browser receives
-- only list-safe aggregates; legal entities and contact data remain lazy.

create or replace function public.list_admin_producer_summaries(
  target_org_id uuid,
  search_text text default null,
  status_filter text default null,
  association_filter text default null,
  producer_type_filter text default null,
  rights_holder_filter uuid default null,
  sort_field text default 'name',
  sort_direction text default 'asc',
  page_number integer default 1,
  page_size integer default 20
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with contract_links as (
  select c.id, c.employer_id, c.status, c.created_at, c.rights_holder_id
  from public.contracts c
  where c.org_id = target_org_id and c.employer_id is not null
  union
  select c.id, ce.employer_id, c.status, c.created_at, c.rights_holder_id
  from public.contract_employers ce
  join public.contracts c on c.id = ce.contract_id
  where c.org_id = target_org_id
),
work_links as (
  select w.id, w.employer_id, w.status, w.created_at
  from public.works w
  where w.org_id = target_org_id and w.employer_id is not null
  union
  select w.id, we.employer_id, w.status, w.created_at
  from public.work_employers we
  join public.works w on w.id = we.work_id
  where w.org_id = target_org_id
     or exists (select 1 from public.work_organisations wo where wo.work_id = w.id and wo.org_id = target_org_id)
),
base as (
  select
    e.id,
    e.name,
    e.parent_id,
    parent.name as parent_name,
    e.dfi_company_id,
    e.broadcaster_id,
    case when bool_or(cl.status = 'kladde') then 'attention'
         when count(distinct cl.id) > 0 or count(distinct wl.id) > 0 then 'active'
         else 'inactive' end as status,
    count(distinct wl.id)::integer as work_count,
    count(distinct cl.id)::integer as contract_count,
    greatest(max(wl.created_at), max(cl.created_at), e.created_at) as latest_activity,
    case when b.id is null then null else jsonb_build_object(
      'name', b.name, 'logo_path', b.logo_path, 'content_type', b.content_type
    ) end as broadcasters,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'relation_id', ept.id,
        'id', pt.id,
        'code', pt.code,
        'name', pt.name,
        'origin', pt.origin,
        'source', ept.source,
        'membership_type', ept.membership_type
      ) order by pt.name)
      from public.employer_producer_types ept
      join public.producer_types pt on pt.id = ept.producer_type_id
      where ept.employer_id = e.id and ept.is_active
    ), '[]'::jsonb) as producer_types,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ept.id,
        'group_code', pt.code,
        'group_label', pt.name,
        'membership_type', case when ept.membership_type = 'member' then 'ordinary' else coalesce(ept.membership_type, 'unknown') end
      ) order by pt.name)
      from public.employer_producer_types ept
      join public.producer_types pt on pt.id = ept.producer_type_id
      where ept.employer_id = e.id and ept.is_active and ept.source = 'producentforeningen'
    ), '[]'::jsonb) as association_memberships
  from public.employers e
  left join public.employers parent on parent.id = e.parent_id
  left join public.broadcasters b on b.id = e.broadcaster_id
  left join contract_links cl on cl.employer_id = e.id
  left join work_links wl on wl.employer_id = e.id
  where e.merged_into_id is null and e.archived_at is null
    and (nullif(trim(search_text), '') is null or
      e.name ilike '%' || trim(search_text) || '%' or
      parent.name ilike '%' || trim(search_text) || '%' or
      exists (select 1 from public.employer_aliases ea where ea.employer_id = e.id and ea.alias ilike '%' || trim(search_text) || '%') or
      exists (select 1 from public.employer_legal_entities ele where ele.employer_id = e.id and ele.archived_at is null and (ele.legal_name ilike '%' || trim(search_text) || '%' or ele.registration_number ilike '%' || trim(search_text) || '%'))
    )
    and (producer_type_filter is null or exists (
      select 1 from public.employer_producer_types ept
      join public.producer_types pt on pt.id = ept.producer_type_id
      where ept.employer_id = e.id and ept.is_active and pt.code = producer_type_filter
    ))
    and (rights_holder_filter is null or
      exists (select 1 from contract_links rcl where rcl.employer_id = e.id and rcl.rights_holder_id = rights_holder_filter) or
      exists (
        select 1 from work_links rwl
        join public.work_assignments wa on wa.work_id = rwl.id and wa.org_id = target_org_id
        where rwl.employer_id = e.id and wa.rights_holder_id = rights_holder_filter
      )
    )
  group by e.id, e.name, e.parent_id, parent.name, e.dfi_company_id, e.broadcaster_id,
           e.created_at, b.id, b.name, b.logo_path, b.content_type
),
filtered as (
  select b.*
  from base b
  where (status_filter is null or b.status = status_filter)
    and (
      association_filter is null
      or (association_filter in ('ordinary', 'member') and b.association_memberships @> '[{"membership_type":"ordinary"}]'::jsonb)
      or (association_filter = 'associate' and b.association_memberships @> '[{"membership_type":"associate"}]'::jsonb and not b.association_memberships @> '[{"membership_type":"ordinary"}]'::jsonb)
      or (association_filter = 'none' and jsonb_array_length(b.association_memberships) = 0)
      or (association_filter = 'unknown' and jsonb_array_length(b.association_memberships) > 0 and not b.association_memberships @> '[{"membership_type":"ordinary"}]'::jsonb and not b.association_memberships @> '[{"membership_type":"associate"}]'::jsonb)
    )
),
ordered as (
  select f.*
  from filtered f
  order by
    case when sort_field = 'name' and sort_direction = 'asc' then f.name end asc,
    case when sort_field = 'name' and sort_direction = 'desc' then f.name end desc,
    case when sort_field = 'parent' and sort_direction = 'asc' then f.parent_name end asc nulls last,
    case when sort_field = 'parent' and sort_direction = 'desc' then f.parent_name end desc nulls last,
    case when sort_field = 'status' and sort_direction = 'asc' then f.status end asc,
    case when sort_field = 'status' and sort_direction = 'desc' then f.status end desc,
    case when sort_field = 'works' and sort_direction = 'asc' then f.work_count end asc,
    case when sort_field = 'works' and sort_direction = 'desc' then f.work_count end desc,
    case when sort_field = 'contracts' and sort_direction = 'asc' then f.contract_count end asc,
    case when sort_field = 'contracts' and sort_direction = 'desc' then f.contract_count end desc,
    case when sort_field = 'latest' and sort_direction = 'asc' then f.latest_activity end asc nulls last,
    case when sort_field = 'latest' and sort_direction = 'desc' then f.latest_activity end desc nulls last,
    f.id
  limit least(greatest(page_size, 1), 100)
  offset (greatest(page_number, 1) - 1) * least(greatest(page_size, 1), 100)
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(to_jsonb(o)) from ordered o), '[]'::jsonb),
  'filteredCount', (select count(*) from filtered),
  'totalCount', (select count(*) from public.employers e where e.merged_into_id is null and e.archived_at is null),
  'page', greatest(page_number, 1),
  'pageSize', least(greatest(page_size, 1), 100)
);
$$;

revoke all on function public.list_admin_producer_summaries(uuid,text,text,text,text,uuid,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.list_admin_producer_summaries(uuid,text,text,text,text,uuid,text,text,integer,integer) to service_role;

create index if not exists contract_reviews_org_queue_idx
  on public.contract_reviews (org_id, status, reviewed_at desc, id)
  where soft_deleted_at is null;
create index if not exists contract_review_jobs_latest_idx
  on public.contract_review_jobs (review_id, created_at desc);
create index if not exists employers_active_name_idx
  on public.employers (lower(name), id)
  where merged_into_id is null and archived_at is null;
