-- Atomic contract-owner candidate creation and exact superadmin insight aggregates.
-- Both functions are server-only APIs. Browser roles retain no EXECUTE access.

create or replace function public.create_contract_owner_candidate(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  v_normalized_name text := public.normalize_rights_holder_name(p_full_name);
  candidate public.rettighedshavere%rowtype;
  candidate_created boolean := false;
  audit_id uuid;
begin
  if p_actor_user_id is null or p_org_id is null then
    raise exception 'Manglende aktør eller organisation' using errcode = '22023';
  end if;

  if p_actor_role not in ('superadmin', 'admin', 'org-admin') or not exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = p_actor_user_id
      and role_row.role = p_actor_role
      and (role_row.org_id = p_org_id or role_row.role = 'superadmin')
  ) then
    raise exception 'Ikke autoriseret til at oprette kontraktejer' using errcode = '42501';
  end if;

  if char_length(v_normalized_name) < 2 or char_length(v_normalized_name) > 200 then
    raise exception 'Navnet skal være mellem 2 og 200 tegn' using errcode = '22023';
  end if;

  -- The canonical-name claim is the idempotency boundary. A retry reuses the
  -- same active person instead of creating a duplicate.
  select holder.*
  into candidate
  from public.rights_holder_name_claims claim
  join public.rettighedshavere holder on holder.id = claim.rights_holder_id
  where claim.normalized_name = v_normalized_name
    and holder.archived_at is null
  limit 1
  for update of holder;

  if candidate.id is null then
    insert into public.rettighedshavere(full_name)
    values (btrim(p_full_name))
    returning * into candidate;
    candidate_created := true;
  end if;

  insert into public.org_affiliations(org_id, rights_holder_id, is_member)
  values (p_org_id, candidate.id, false)
  on conflict (org_id, rights_holder_id) do nothing;

  audit_id := public.append_audit_event_v2(
    p_action => case when candidate_created then 'create' else 'link' end,
    p_entity_type => 'rettighedshavere',
    p_entity_id => candidate.id::text,
    p_actor_user_id => p_actor_user_id,
    p_actor_role => p_actor_role,
    p_actor_type => 'user',
    p_actor_org_id => p_org_id,
    p_source => 'admin',
    p_target_member_uuid => candidate.id,
    p_target_member_uuids => array[candidate.id],
    p_purpose_code => 'contract_owner_verification',
    p_legal_basis => 'GDPR Art. 6(1)(b)/(f)',
    p_data_categories => array['identity_data'],
    p_system_component => 'admin.contract_ownership.create_owner_candidate',
    p_org_ids => array[p_org_id],
    p_metadata => jsonb_build_object('created', candidate_created)
  );

  if audit_id is null then
    raise exception 'Auditregistrering fejlede';
  end if;

  return jsonb_build_object(
    'id', candidate.id,
    'fullName', candidate.full_name,
    'created', candidate_created,
    'auditEventId', audit_id
  );
end;
$$;

revoke all on function public.create_contract_owner_candidate(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.create_contract_owner_candidate(uuid,uuid,text,text)
  to service_role;

create or replace function public.get_superadmin_insights_summary(
  p_actor_user_id uuid,
  p_from_24h timestamptz,
  p_from_7d timestamptz,
  p_from_30d timestamptz,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, private, pg_catalog
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.user_org_roles
    where user_id = p_actor_user_id and role = 'superadmin'
  ) then
    raise exception 'Kun superadmin kan hente systemindsigt' using errcode = '42501';
  end if;

  if p_from_24h is null or p_from_7d is null or p_from_30d is null
     or p_from_30d > p_from_7d or p_from_7d > p_from_24h then
    raise exception 'Ugyldigt tidsinterval' using errcode = '22023';
  end if;

  with scoped_events as materialized (
    select event.id, event.occurred_at, event.actor_user_id, event.actor_role,
           event.source, event.action
    from public.audit_events event
    where event.occurred_at >= p_from_30d
      and (
        p_org_id is null
        or exists (
          select 1 from public.audit_event_organisations scope
          where scope.event_id = event.id and scope.org_id = p_org_id
        )
      )
  ), action_counts as (
    select action, count(*)::bigint as count
    from scoped_events
    group by action
  )
  select jsonb_build_object(
    'activeUsers24h', count(distinct actor_user_id) filter (where occurred_at >= p_from_24h and actor_user_id is not null),
    'activeUsers7d', count(distinct actor_user_id) filter (where occurred_at >= p_from_7d and actor_user_id is not null),
    'activeUsers30d', count(distinct actor_user_id) filter (where actor_user_id is not null),
    'actionsLast30Days', count(*),
    'memberEvents', count(*) filter (where actor_role = 'member' or source = 'portal'),
    'adminEvents', count(*) filter (where not (actor_role = 'member' or source = 'portal')),
    'actionCounts', coalesce((select jsonb_object_agg(action, count) from action_counts), '{}'::jsonb),
    'totalMembers', (
      select count(distinct affiliation.rights_holder_id)
      from public.org_affiliations affiliation
      join public.rettighedshavere holder on holder.id = affiliation.rights_holder_id
      where affiliation.is_member = true
        and holder.archived_at is null
        and (affiliation.valid_from is null or affiliation.valid_from <= current_date)
        and (affiliation.valid_to is null or affiliation.valid_to >= current_date)
        and (p_org_id is null or affiliation.org_id = p_org_id)
    ),
    'totalAdmins', (
      select count(distinct role_row.user_id)
      from public.user_org_roles role_row
      where role_row.role in ('superadmin','admin','org-admin','jurist')
        and (p_org_id is null or role_row.org_id = p_org_id or role_row.role = 'superadmin')
    )
  ) into result
  from scoped_events;

  return result;
end;
$$;

revoke all on function public.get_superadmin_insights_summary(uuid,timestamptz,timestamptz,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.get_superadmin_insights_summary(uuid,timestamptz,timestamptz,timestamptz,uuid)
  to service_role;
