-- Repair the eight member-confirmed co-editor reviews for Steen Johannessen
-- where the previous application path linked a known co-editor directly to the
-- work but did not create the corresponding work-share case. The UUID scopes
-- this data repair without storing a person's name or contact data in source.

create temporary table missing_member_share_cases on commit drop as
select
  review.id as review_id,
  review.org_id,
  review.rights_holder_id as reporting_rights_holder_id,
  review.reviewed_by_user_id,
  review.reviewed_at,
  review.work_id,
  work.season_number,
  work.episode_number,
  case
    when work.episode_number is not null then 'episode'
    when work.season_number is not null then 'season'
    else 'work'
  end as resolution_scope
from public.member_work_collaboration_reviews review
join public.works work on work.id = review.work_id
where review.rights_holder_id = 'b07a8e92-5b2f-4baa-9700-2b8b53f35090'::uuid
  and review.status = 'coeditors_reported'
  and review.work_share_case_id is null
  and exists (
    select 1
    from public.work_assignments other_assignment
    where other_assignment.org_id = review.org_id
      and other_assignment.work_id = review.work_id
      and other_assignment.rights_holder_id is not null
      and other_assignment.rights_holder_id <> review.rights_holder_id
      and (
        lower(coalesce(other_assignment.role, '')) like '%klip%'
        or lower(coalesce(other_assignment.role, '')) like '%edit%'
      )
      and not (lower(coalesce(other_assignment.role, '')) like any (array[
        '%b-klip%', '%b klip%', '%klippeassistent%', '%klipperassistent%',
        '%assistant editor%', '%assistant klipper%', '%trailer%', '%pilotklip%',
        '%pilot klip%', '%klippekonsulent%', '%supplerende klipper%'
      ]))
  )
  and not exists (
    select 1
    from public.work_share_cases existing_case
    where existing_case.org_id = review.org_id
      and existing_case.work_id = review.work_id
      and existing_case.season_number is not distinct from work.season_number
      and existing_case.episode_number is not distinct from work.episode_number
  );

insert into public.work_share_cases (
  org_id,
  work_id,
  season_number,
  episode_number,
  status,
  resolution_scope,
  created_by_user_id,
  created_at,
  updated_at
)
select
  target.org_id,
  target.work_id,
  target.season_number,
  target.episode_number,
  'awaiting_members',
  target.resolution_scope,
  target.reviewed_by_user_id,
  coalesce(target.reviewed_at, now()),
  now()
from missing_member_share_cases target
on conflict do nothing;

insert into public.work_share_participants (
  case_id,
  org_id,
  work_id,
  rights_holder_id,
  role,
  relationship_status,
  response_scope,
  proposed_percent,
  admin_seed_percent,
  invited_by_rights_holder_id,
  responded_at,
  source_tags,
  source_details,
  created_at,
  updated_at
)
select distinct on (share_case.id, assignment.rights_holder_id)
  share_case.id,
  target.org_id,
  target.work_id,
  assignment.rights_holder_id,
  assignment.role,
  case
    when assignment.rights_holder_id = target.reporting_rights_holder_id then 'confirmed'
    else 'pending'
  end,
  target.resolution_scope,
  case
    when assignment.rights_holder_id = target.reporting_rights_holder_id then assignment.share_percent
    else null
  end,
  case
    when assignment.rights_holder_id <> target.reporting_rights_holder_id then assignment.share_percent
    else null
  end,
  case
    when assignment.rights_holder_id <> target.reporting_rights_holder_id then target.reporting_rights_holder_id
    else null
  end,
  case
    when assignment.rights_holder_id = target.reporting_rights_holder_id then target.reviewed_at
    else null
  end,
  case
    when assignment.rights_holder_id = target.reporting_rights_holder_id then array['local']::text[]
    else array['member']::text[]
  end,
  case
    when assignment.rights_holder_id <> target.reporting_rights_holder_id
      then jsonb_build_object('reportedByRightsHolderId', target.reporting_rights_holder_id)
    else '{}'::jsonb
  end,
  coalesce(target.reviewed_at, now()),
  now()
from missing_member_share_cases target
join public.work_share_cases share_case
  on share_case.org_id = target.org_id
 and share_case.work_id = target.work_id
 and share_case.season_number is not distinct from target.season_number
 and share_case.episode_number is not distinct from target.episode_number
join public.work_assignments assignment
  on assignment.org_id = target.org_id
 and assignment.work_id = target.work_id
where assignment.rights_holder_id is not null
  and (
    lower(coalesce(assignment.role, '')) like '%klip%'
    or lower(coalesce(assignment.role, '')) like '%edit%'
  )
  and not (lower(coalesce(assignment.role, '')) like any (array[
    '%b-klip%', '%b klip%', '%klippeassistent%', '%klipperassistent%',
    '%assistant editor%', '%assistant klipper%', '%trailer%', '%pilotklip%',
    '%pilot klip%', '%klippekonsulent%', '%supplerende klipper%'
  ]))
order by share_case.id, assignment.rights_holder_id, assignment.created_at
on conflict (case_id, rights_holder_id) where rights_holder_id is not null do nothing;

update public.member_work_collaboration_reviews review
set
  work_share_case_id = share_case.id,
  updated_at = now()
from missing_member_share_cases target
join public.work_share_cases share_case
  on share_case.org_id = target.org_id
 and share_case.work_id = target.work_id
 and share_case.season_number is not distinct from target.season_number
 and share_case.episode_number is not distinct from target.episode_number
where review.id = target.review_id;

select public.append_audit_event_v2(
  p_action => 'create',
  p_entity_type => 'work_share_case_backfill',
  p_entity_id => '20260902223030',
  p_actor_type => 'system',
  p_actor_org_id => (select org_id from missing_member_share_cases limit 1),
  p_source => 'database',
  p_changes => '[]'::jsonb,
  p_metadata => jsonb_build_object(
    'reason', 'repair_known_coeditor_case_gap',
    'created_case_count', (select count(*) from missing_member_share_cases)
  ),
  p_target_member_uuid => 'b07a8e92-5b2f-4baa-9700-2b8b53f35090'::uuid,
  p_target_member_uuids => array(
    select distinct assignment.rights_holder_id
    from missing_member_share_cases target
    join public.work_assignments assignment
      on assignment.org_id = target.org_id
     and assignment.work_id = target.work_id
    where assignment.rights_holder_id is not null
  ),
  p_purpose_code => 'work_rights_distribution',
  p_legal_basis => 'gdpr_art_6_1_b',
  p_data_categories => array['work_data', 'rights_data'],
  p_system_component => 'migration.work_share_case_backfill',
  p_outcome => 'success',
  p_org_ids => array(select distinct org_id from missing_member_share_cases)
)
where exists (select 1 from missing_member_share_cases);
