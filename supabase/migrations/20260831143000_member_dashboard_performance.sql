-- Skalerbar medlemsoversigt: saml opgavetællere og korte previews i ét kald.
-- Funktionen returnerer aldrig kontrakt- eller beskedindhold ud over den titel,
-- medlemmet allerede ser som opgavelabel.

create or replace function public.get_member_dashboard_task_overview(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_user_id uuid,
  p_preview_limit integer default 5
)
returns table (
  works_missing_contract_count bigint,
  contracts_missing_work_count bigint,
  review_work_count bigint,
  share_task_count bigint,
  unread_contract_count bigint,
  pending_work_request_count bigint,
  pending_screening_count bigint,
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
  with
  missing_contract_works as (
    select distinct assignment.work_id
    from public.work_assignments assignment
    where assignment.org_id = p_org_id
      and assignment.rights_holder_id = p_rights_holder_id
      and assignment.work_id is not null
      and not exists (
        select 1
        from public.contracts contract
        where contract.org_id = p_org_id
          and contract.rights_holder_id = p_rights_holder_id
          and contract.superseded_by_contract_id is null
          and contract.work_id = assignment.work_id
      )
  ),
  missing_work_contracts as (
    select contract.id
    from public.contracts contract
    where contract.org_id = p_org_id
      and contract.rights_holder_id = p_rights_holder_id
      and contract.superseded_by_contract_id is null
      and contract.work_id is null
  ),
  review_groups as (
    select 'season:' || scope.series_work_id::text || ':' || scope.season_number::text as group_key
    from public.member_series_episode_scopes scope
    where scope.org_id = p_org_id
      and scope.rights_holder_id = p_rights_holder_id
      and scope.status = 'pending'
    union
    select case
      when work.parent_work_id is not null and work.season_number is not null
        then 'season:' || work.parent_work_id::text || ':' || work.season_number::text
      else 'work:' || review.work_id::text
    end
    from public.member_work_collaboration_reviews review
    join public.works work on work.id = review.work_id
    where review.org_id = p_org_id
      and review.rights_holder_id = p_rights_holder_id
      and review.status = 'pending'
  ),
  member_share_tasks as (
    select participant.id, participant.case_id, work.title, participant.created_at
    from public.work_share_participants participant
    join public.work_share_cases share_case on share_case.id = participant.case_id
    join public.works work on work.id = participant.work_id
    where participant.org_id = p_org_id
      and participant.rights_holder_id = p_rights_holder_id
      and participant.relationship_status = 'pending'
      and participant.excluded_at is null
      and share_case.status <> 'resolved'
  ),
  unread_member_contracts as (
    select contract.id, contract.working_title, max(comment.created_at) as latest_at
    from public.contracts contract
    join public.contract_comments comment on comment.contract_id = contract.id
    where contract.org_id = p_org_id
      and contract.rights_holder_id = p_rights_holder_id
      and contract.superseded_by_contract_id is null
      and comment.author_role = 'admin'
      and comment.member_read_at is null
    group by contract.id, contract.working_title
  ),
  member_work_requests as (
    select request.id, request.created_at
    from public.work_change_requests request
    where request.org_id = p_org_id
      and request.requested_by_rights_holder_id = p_rights_holder_id
      and request.status = 'pending'
  ),
  member_screenings as (
    select claim.id, claim.title, claim.created_at
    from public.screening_claims claim
    where claim.org_id = p_org_id
      and claim.profile_id = p_user_id
      and claim.status = 'pending'
  )
  select
    (select count(*) from missing_contract_works),
    (select count(*) from missing_work_contracts),
    (select count(*) from review_groups),
    (select count(*) from member_share_tasks),
    (select count(*) from unread_member_contracts),
    (select count(*) from member_work_requests),
    (select count(*) from member_screenings),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', preview.id,
        'caseId', preview.case_id,
        'title', preview.title
      ) order by preview.created_at desc)
      from (
        select * from member_share_tasks
        order by created_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'contractId', preview.id,
        'title', preview.working_title
      ) order by preview.latest_at desc)
      from (
        select * from unread_member_contracts
        order by latest_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', preview.id) order by preview.created_at desc)
      from (
        select * from member_work_requests
        order by created_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', preview.id,
        'title', preview.title
      ) order by preview.created_at desc)
      from (
        select * from member_screenings
        order by created_at desc
        limit least(greatest(p_preview_limit, 1), 20)
      ) preview
    ), '[]'::jsonb);
$$;

revoke all on function public.get_member_dashboard_task_overview(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_member_dashboard_task_overview(uuid, uuid, uuid, integer)
  to service_role;

-- Smalt grundlag til medlemsdashboardets løngraf. Det undgår de tunge
-- producentrelationer og store JSON-objekter i den generelle statistikfunktion.
create or replace function public.get_member_salary_facts(
  p_org_id uuid,
  p_include_drafts boolean default false
)
returns table (
  rights_holder_id uuid,
  period_year integer,
  production_type text,
  professional_start_year integer,
  weekly_salary numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with raw as (
    select
      fact.rights_holder_id,
      fact.period_year,
      fact.production_type,
      fact.professional_start_year,
      fact.contract_type,
      lower(btrim(coalesce(fact.extracted_data->>'salaryUnit', ''))) as salary_unit,
      case
        when btrim(coalesce(fact.extracted_data->>'salary', '')) ~ '^[0-9]+([.,][0-9]+)?$'
          then replace(btrim(fact.extracted_data->>'salary'), ',', '.')::numeric
        else null
      end as salary,
      case
        when btrim(coalesce(fact.extracted_data->>'personalSupplement', '')) ~ '^[0-9]+([.,][0-9]+)?$'
          then replace(btrim(fact.extracted_data->>'personalSupplement'), ',', '.')::numeric
        else 0
      end as personal_supplement,
      case
        when btrim(coalesce(fact.extracted_data->>'postProductionSupplement', '')) ~ '^[0-9]+([.,][0-9]+)?$'
          then replace(btrim(fact.extracted_data->>'postProductionSupplement'), ',', '.')::numeric
        else 0
      end as post_production_supplement
    from analytics.contract_facts fact
    join public.org_affiliations affiliation
      on affiliation.org_id = fact.org_id
     and affiliation.rights_holder_id = fact.rights_holder_id
     and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
     and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
    where fact.org_id = p_org_id
      and fact.statistics_allowed
      and fact.period_year is not null
      and fact.contract_type is distinct from 'leverandør'
      and (fact.contract_status = 'valideret' or p_include_drafts)
  )
  select
    raw.rights_holder_id,
    raw.period_year,
    raw.production_type,
    raw.professional_start_year,
    (
      case
        when raw.salary_unit in ('uge', 'ugeløn', 'week') then raw.salary
        when raw.salary_unit in ('dag', 'dagsløn', 'day') then raw.salary * 5
        when raw.salary_unit in ('måned', 'månedsløn', 'month') then raw.salary * 12 / 52
        else null
      end
      + raw.personal_supplement
      + raw.post_production_supplement
    ) as weekly_salary
  from raw
  where raw.salary > 0;
$$;

revoke all on function public.get_member_salary_facts(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.get_member_salary_facts(uuid, boolean)
  to service_role;

create index if not exists contracts_member_active_work_idx
  on public.contracts (org_id, rights_holder_id, work_id)
  where superseded_by_contract_id is null;

create index if not exists contracts_member_active_missing_work_idx
  on public.contracts (org_id, rights_holder_id, created_at desc)
  where superseded_by_contract_id is null and work_id is null;

create index if not exists work_requests_member_pending_idx
  on public.work_change_requests (org_id, requested_by_rights_holder_id, created_at desc)
  where status = 'pending';

create index if not exists work_request_comments_member_unread_idx
  on public.work_change_request_comments (request_id, created_at desc)
  where author_role = 'admin' and member_read_at is null;

create index if not exists contract_comments_member_unread_idx
  on public.contract_comments (contract_id, created_at desc)
  where author_role = 'admin' and member_read_at is null;

create index if not exists screening_claims_member_pending_idx
  on public.screening_claims (org_id, profile_id, created_at desc)
  where status = 'pending';

create index if not exists collaboration_reviews_member_pending_idx
  on public.member_work_collaboration_reviews (org_id, rights_holder_id, work_id)
  where status = 'pending';

create index if not exists series_scopes_member_pending_idx
  on public.member_series_episode_scopes (org_id, rights_holder_id, series_work_id, season_number)
  where status = 'pending';

create index if not exists share_participants_member_pending_idx
  on public.work_share_participants (org_id, rights_holder_id, created_at desc)
  where relationship_status = 'pending' and excluded_at is null;
