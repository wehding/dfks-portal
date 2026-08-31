-- Bevar hvem der indberettede en medklipper som en eksplicit kilde.
-- Selve sagsstatus ændres ikke; applikationen afgør, om sagen er handlingskrævende.
update public.work_share_participants participant
set source_tags = array(
      select distinct source
      from unnest(participant.source_tags || array['member']::text[]) source
      order by source
    ),
    source_details = participant.source_details || jsonb_build_object(
      'reportedByRightsHolderId', participant.invited_by_rights_holder_id
    ),
    updated_at = now()
where participant.invited_by_rights_holder_id is not null
  and not ('member' = any(participant.source_tags));

create or replace function public.get_navigation_badge_counts(
  p_org_id uuid,
  p_user_id uuid,
  p_rights_holder_id uuid default null
)
returns table (
  admin_contracts bigint,
  admin_contract_messages bigint,
  admin_works bigint,
  admin_work_messages bigint,
  admin_reviews bigint,
  admin_screenings bigint,
  member_work_messages bigint,
  member_work_review_todos bigint,
  member_contract_messages bigint,
  member_inbox_messages bigint
)
language sql stable security invoker set search_path = ''
as $$
  with member_review_groups as (
    select 'season:' || scope.series_work_id::text || ':' || scope.season_number::text as group_key
    from public.member_series_episode_scopes scope
    where p_rights_holder_id is not null and scope.org_id = p_org_id and scope.rights_holder_id = p_rights_holder_id and scope.status = 'pending'
    union
    select case when work.parent_work_id is not null and work.season_number is not null then 'season:' || work.parent_work_id::text || ':' || work.season_number::text else 'work:' || review.work_id::text end
    from public.member_work_collaboration_reviews review join public.works work on work.id = review.work_id
    where p_rights_holder_id is not null and review.org_id = p_org_id and review.rights_holder_id = p_rights_holder_id and review.status = 'pending'
  ), actionable_share_cases as (
    select share_case.*
    from public.work_share_cases share_case
    where share_case.org_id = p_org_id
      and share_case.status <> 'resolved'
      and (
        (select count(*) from public.work_share_participants participant where participant.case_id = share_case.id and participant.excluded_at is null) > 1
        or exists (
          select 1
          from public.work_share_participants participant
          where participant.case_id = share_case.id
            and participant.excluded_at is null
            and (
              participant.rights_holder_id is null
              or participant.invited_by_rights_holder_id is not null
              or (
                not ('local' = any(participant.source_tags))
                and (('dfi' = any(participant.source_tags)) or ('tmdb' = any(participant.source_tags)))
              )
            )
        )
      )
  ), admin_work_groups as (
    select 'request:' || request.id::text as group_key from public.work_change_requests request where request.org_id = p_org_id and request.status = 'pending'
    union
    select 'share:' || share_case.work_id::text || ':' || coalesce(share_case.season_number, 0)::text || ':' || coalesce(share_case.episode_number, 0)::text
    from actionable_share_cases share_case
    union
    select 'share:' || review.work_id::text || ':' || coalesce(work.season_number, 0)::text || ':' || coalesce(work.episode_number, 0)::text
    from public.member_work_collaboration_reviews review
    join public.works work on work.id = review.work_id
    where review.org_id = p_org_id and review.status = 'disputed'
  )
  select
    (select count(*) from public.contracts contract where contract.org_id = p_org_id and contract.status = 'kladde'),
    (select count(*) from public.contract_comments comment where comment.org_id = p_org_id and comment.author_role = 'member' and comment.admin_read_at is null),
    (select count(*) from admin_work_groups),
    (select count(*) from public.work_change_request_comments comment join public.work_change_requests request on request.id = comment.request_id where request.org_id = p_org_id and comment.author_role = 'member' and comment.admin_read_at is null),
    (select count(*) from public.contract_reviews review where review.org_id = p_org_id and review.status in ('afventer', 'behandling')),
    (select count(*) from public.screening_claims claim where claim.org_id = p_org_id and claim.status = 'pending'),
    (select count(*) from public.work_change_request_comments comment join public.work_change_requests request on request.id = comment.request_id where request.org_id = p_org_id and request.requested_by_user_id = p_user_id and comment.author_role = 'admin' and comment.member_read_at is null),
    (select count(*) from member_review_groups) + (
      select count(*)
      from public.work_share_participants participant
      join actionable_share_cases share_case on share_case.id = participant.case_id
      where p_rights_holder_id is not null
        and participant.org_id = p_org_id
        and participant.rights_holder_id = p_rights_holder_id
        and participant.relationship_status = 'pending'
        and participant.excluded_at is null
    ),
    (select count(*) from public.contract_comments comment join public.contracts contract on contract.id = comment.contract_id where p_rights_holder_id is not null and contract.org_id = p_org_id and contract.rights_holder_id = p_rights_holder_id and comment.author_role = 'admin' and comment.member_read_at is null),
    (select count(*) from public.member_message_participants participant join public.member_message_threads thread on thread.id = participant.thread_id join public.member_messages message on message.thread_id = thread.id where participant.user_id = p_user_id and thread.org_id = p_org_id and message.author_role = 'admin' and message.created_at > coalesce(participant.last_read_at, '-infinity'::timestamptz));
$$;

revoke all on function public.get_navigation_badge_counts(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_navigation_badge_counts(uuid, uuid, uuid) to service_role;
