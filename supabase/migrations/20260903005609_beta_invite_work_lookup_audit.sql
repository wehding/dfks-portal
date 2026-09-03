-- Extend the atomic beta-status + invitation audit event with a strictly
-- allow-listed work lookup summary. No titles, names, queries or external IDs
-- are accepted or persisted.
drop function if exists public.set_beta_tester_status(uuid,uuid,uuid,text,boolean,date,date,boolean,text);

create function public.set_beta_tester_status(
  p_org_id uuid,
  p_rights_holder_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_enabled boolean,
  p_period_start date default null,
  p_period_end date default null,
  p_email_delivered boolean default false,
  p_link_type text default null,
  p_work_lookup jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  event_id uuid;
  safe_work_lookup jsonb;
begin
  if not public.current_user_has_org_role(p_org_id, array['superadmin','admin','org-admin'])
     and not exists (
       select 1 from public.user_org_roles
       where user_id = p_actor_user_id and org_id = p_org_id and role in ('superadmin','admin','org-admin')
     ) then
    raise exception 'Not authorized to manage beta testers';
  end if;
  if p_enabled and (p_period_start is null or p_period_end is null or p_period_end <= p_period_start or p_period_end > p_period_start + 365) then
    raise exception 'Invalid beta test period';
  end if;
  if not exists(select 1 from public.org_affiliations where org_id = p_org_id and rights_holder_id = p_rights_holder_id) then
    raise exception 'Rights holder is not affiliated with organisation';
  end if;

  safe_work_lookup := jsonb_build_object(
    'localWorks', greatest(0, least(1000, coalesce((p_work_lookup->>'localWorks')::integer, 0))),
    'externalWorks', greatest(0, least(1000, coalesce((p_work_lookup->>'externalWorks')::integer, 0))),
    'totalWorks', greatest(0, least(1000, coalesce((p_work_lookup->>'totalWorks')::integer, 0))),
    'dfiStatus', case when p_work_lookup->>'dfiStatus' in ('ok','none','ambiguous','unavailable') then p_work_lookup->>'dfiStatus' else 'none' end,
    'tmdbStatus', case when p_work_lookup->>'tmdbStatus' in ('ok','none','ambiguous','unavailable') then p_work_lookup->>'tmdbStatus' else 'none' end
  );

  update public.org_affiliations
  set beta_tester_since = case when p_enabled then coalesce(beta_tester_since, now()) else null end,
      beta_designated_by_user_id = case when p_enabled then p_actor_user_id else null end,
      beta_last_period_start_date = case when p_enabled then p_period_start else beta_last_period_start_date end,
      beta_last_period_end_date = case when p_enabled then p_period_end else beta_last_period_end_date end,
      beta_last_invite_sent_at = case when p_enabled and p_email_delivered then now() else beta_last_invite_sent_at end
  where org_id = p_org_id and rights_holder_id = p_rights_holder_id;

  event_id := public.append_audit_event_v2(
    p_action => case when p_enabled then 'invite' else 'update' end,
    p_entity_type => 'org_affiliations',
    p_entity_id => p_rights_holder_id::text,
    p_entity_label => case when p_enabled then 'Betatester' else 'Betatesterstatus fjernet' end,
    p_actor_user_id => p_actor_user_id,
    p_actor_role => p_actor_role,
    p_actor_type => 'user',
    p_actor_org_id => p_org_id,
    p_source => 'admin',
    p_metadata => jsonb_build_object(
      'invitationType', 'beta',
      'deliveryState', case when not p_enabled then 'not_applicable' when p_email_delivered then 'sent' else 'link_created_mail_failed' end,
      'emailDelivered', p_email_delivered,
      'linkType', p_link_type,
      'betaTester', p_enabled,
      'workLookup', safe_work_lookup
    ),
    p_target_member_uuid => p_rights_holder_id,
    p_target_member_uuids => array[p_rights_holder_id],
    p_purpose_code => 'beta_program_administration',
    p_legal_basis => 'GDPR Art. 6(1)(f), Art. 9(2)(d)',
    p_data_categories => array['identity_data','contact_data','work_data','union_membership_data'],
    p_system_component => 'admin.beta-test.status',
    p_outcome => case when p_enabled and not p_email_delivered then 'partial' else 'success' end,
    p_error_code => case when p_enabled and not p_email_delivered then 'email_delivery_failed' else null end,
    p_org_ids => array[p_org_id]
  );
  return event_id;
end;
$$;

revoke all on function public.set_beta_tester_status(uuid,uuid,uuid,text,boolean,date,date,boolean,text,jsonb) from public, anon, authenticated;
grant execute on function public.set_beta_tester_status(uuid,uuid,uuid,text,boolean,date,date,boolean,text,jsonb) to service_role;
