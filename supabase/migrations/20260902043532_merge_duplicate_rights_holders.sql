create or replace function public.merge_duplicate_rights_holders(
  p_primary_id uuid,
  p_duplicate_id uuid,
  p_actor_user_id uuid,
  p_actor_org_id uuid,
  p_actor_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  primary_holder public.rettighedshavere%rowtype;
  duplicate_holder public.rettighedshavere%rowtype;
  audit_id uuid;
  affected_org_ids uuid[];
begin
  if p_primary_id is null or p_duplicate_id is null or p_primary_id = p_duplicate_id then
    raise exception 'Vælg to forskellige rettighedshavere';
  end if;
  if p_actor_user_id is null or p_actor_org_id is null or p_actor_role <> 'superadmin' then
    raise exception 'Kun superadmin kan sammenlægge rettighedshavere';
  end if;
  if not exists (
    select 1 from public.user_org_roles
    where user_id = p_actor_user_id and org_id = p_actor_org_id and role = 'superadmin'
  ) then
    raise exception 'Superadminrollen kunne ikke verificeres';
  end if;

  -- Samme låserækkefølge forebygger deadlocks ved samtidige forsøg.
  perform 1
  from public.rettighedshavere
  where id in (p_primary_id, p_duplicate_id)
  order by id
  for update;

  select * into primary_holder from public.rettighedshavere where id = p_primary_id;
  select * into duplicate_holder from public.rettighedshavere where id = p_duplicate_id;
  if primary_holder.id is null or duplicate_holder.id is null then
    raise exception 'En af rettighedshaverne findes ikke';
  end if;
  if not exists (
    select 1
    from public.org_affiliations a
    join public.org_affiliations b on b.org_id = a.org_id
    where a.rights_holder_id = p_primary_id and b.rights_holder_id = p_duplicate_id
  ) then
    raise exception 'Profilerne deler ingen organisation og kan ikke sammenlægges automatisk';
  end if;

  if primary_holder.user_id is not null and duplicate_holder.user_id is not null
     and primary_holder.user_id <> duplicate_holder.user_id then
    raise exception 'Begge profiler har hver sin aktive loginkonto';
  end if;
  if nullif(primary_holder.cpr_no, '') is not null and nullif(duplicate_holder.cpr_no, '') is not null
     and primary_holder.cpr_no <> duplicate_holder.cpr_no then
    raise exception 'Profilerne har modstridende CPR-oplysninger';
  end if;
  if nullif(primary_holder.bank_account, '') is not null and nullif(duplicate_holder.bank_account, '') is not null
     and primary_holder.bank_account <> duplicate_holder.bank_account then
    raise exception 'Profilerne har modstridende bankoplysninger';
  end if;
  if primary_holder.dfi_person_id is not null and duplicate_holder.dfi_person_id is not null and primary_holder.dfi_person_id <> duplicate_holder.dfi_person_id
     or primary_holder.tmdb_person_id is not null and duplicate_holder.tmdb_person_id is not null and primary_holder.tmdb_person_id <> duplicate_holder.tmdb_person_id
     or nullif(primary_holder.wikidata_qid, '') is not null and nullif(duplicate_holder.wikidata_qid, '') is not null and primary_holder.wikidata_qid <> duplicate_holder.wikidata_qid
     or nullif(primary_holder.imdb_nm, '') is not null and nullif(duplicate_holder.imdb_nm, '') is not null and primary_holder.imdb_nm <> duplicate_holder.imdb_nm then
    raise exception 'Profilerne har modstridende eksterne person-id’er';
  end if;
  if exists (
    select 1
    from public.org_affiliations a
    join public.org_affiliations b on b.org_id = a.org_id
    where a.rights_holder_id = p_primary_id and b.rights_holder_id = p_duplicate_id
      and nullif(a.member_no, '') is not null and nullif(b.member_no, '') is not null and a.member_no <> b.member_no
  ) then raise exception 'Profilerne har modstridende medlemsnumre'; end if;
  if exists (select 1 from public.inheritance_relations where deceased_rights_holder_id in (p_primary_id,p_duplicate_id) or heir_rights_holder_id in (p_primary_id,p_duplicate_id)) then
    raise exception 'En profil indgår i en arvesag og skal afklares manuelt';
  end if;
  if exists (
    select 1 from public.payroll_recipient_references source
    join public.payroll_recipient_references target on target.org_id = source.org_id and target.provider = source.provider
    where source.rights_holder_id = p_duplicate_id and target.rights_holder_id = p_primary_id
  ) then raise exception 'Profilerne har modstridende lønmodtagerreferencer'; end if;
  if exists (
    select 1 from public.member_message_threads source
    join public.member_message_threads target on target.campaign_id = source.campaign_id and target.campaign_id is not null
    where source.rights_holder_id = p_duplicate_id and target.rights_holder_id = p_primary_id
  ) then raise exception 'Profilerne har parallelle kampagnetråde, som skal afklares manuelt'; end if;
  if exists (
    select 1 from public.member_work_collaboration_reviews source
    join public.member_work_collaboration_reviews target on target.org_id = source.org_id and target.work_id = source.work_id
    where source.rights_holder_id = p_duplicate_id and target.rights_holder_id = p_primary_id
  ) then raise exception 'Profilerne har konkurrerende medklippersvar'; end if;
  if exists (
    select 1 from public.work_share_participants source
    join public.work_share_participants target on target.case_id = source.case_id
    where source.rights_holder_id = p_duplicate_id and target.rights_holder_id = p_primary_id
  ) then raise exception 'Profilerne har konkurrerende arbejdsandelssvar'; end if;

  select coalesce(array_agg(distinct org_id order by org_id), '{}'::uuid[])
  into affected_org_ids
  from public.org_affiliations
  where rights_holder_id in (p_primary_id, p_duplicate_id);

  audit_id := public.append_audit_event_v2(
    p_action => 'merge',
    p_entity_type => 'rettighedshavere',
    p_entity_id => p_primary_id::text,
    p_entity_label => primary_holder.full_name,
    p_actor_user_id => p_actor_user_id,
    p_actor_role => p_actor_role,
    p_actor_type => 'user',
    p_actor_org_id => p_actor_org_id,
    p_source => 'admin',
    p_target_member_uuid => p_primary_id,
    p_target_member_uuids => array[p_primary_id,p_duplicate_id],
    p_purpose_code => 'member_administration',
    p_legal_basis => 'GDPR Art. 6(1)(c)/(f), Art. 9(2)(d)',
    p_data_categories => array['identity_data','contact_data','contract_data','union_membership_data'],
    p_system_component => 'admin.rights-holders.merge',
    p_org_ids => affected_org_ids,
    p_metadata => jsonb_build_object('merged_profile_count', 2)
  );
  if audit_id is null then raise exception 'Auditregistrering fejlede'; end if;

  -- Login og eksterne person-id'er er globalt unikke. Frigiv dublettens
  -- værdier, før de sættes på primærprofilen; de læste værdier ligger fortsat
  -- i duplicate_holder og hele forløbet rulles tilbage samlet ved fejl.
  update public.rettighedshavere set
    user_id = null,
    dfi_person_id = null,
    tmdb_person_id = null,
    wikidata_qid = null,
    imdb_nm = null
  where id = p_duplicate_id;

  -- Profiltriggeren genopbygger navneregisteret, når primærprofilens
  -- navnevarianter ændres. Fjern derfor dublettens claims først, så dens navn
  -- kan overføres uden at kollidere med den globale normaliserede nøgle.
  delete from public.rights_holder_name_claims
  where rights_holder_id = p_duplicate_id;

  update public.rettighedshavere set
    user_id = coalesce(primary_holder.user_id, duplicate_holder.user_id),
    email = coalesce(nullif(primary_holder.email, ''), duplicate_holder.email),
    phone = coalesce(nullif(primary_holder.phone, ''), duplicate_holder.phone),
    address = coalesce(nullif(primary_holder.address, ''), duplicate_holder.address),
    cpr_no = coalesce(nullif(primary_holder.cpr_no, ''), duplicate_holder.cpr_no),
    bank_account = coalesce(nullif(primary_holder.bank_account, ''), duplicate_holder.bank_account),
    dfi_person_id = coalesce(primary_holder.dfi_person_id, duplicate_holder.dfi_person_id),
    tmdb_person_id = coalesce(primary_holder.tmdb_person_id, duplicate_holder.tmdb_person_id),
    wikidata_qid = coalesce(nullif(primary_holder.wikidata_qid, ''), duplicate_holder.wikidata_qid),
    imdb_nm = coalesce(nullif(primary_holder.imdb_nm, ''), duplicate_holder.imdb_nm),
    invite_sent_at = greatest(primary_holder.invite_sent_at, duplicate_holder.invite_sent_at),
    onboarding_completed = primary_holder.onboarding_completed or duplicate_holder.onboarding_completed,
    onboarding_completed_at = greatest(primary_holder.onboarding_completed_at, duplicate_holder.onboarding_completed_at),
    alternative_names = (
      select coalesce(array_agg(distinct name order by name), '{}'::text[])
      from unnest(coalesce(primary_holder.alternative_names, '{}'::text[]) || coalesce(duplicate_holder.alternative_names, '{}'::text[]) || array[duplicate_holder.full_name]) name
      where nullif(btrim(name), '') is not null
    )
  where id = p_primary_id;

  insert into public.org_affiliations(org_id,rights_holder_id,is_member,member_no,valid_from,valid_to,statistics_participation,statistics_participation_source,statistics_participation_updated_at,statistics_participation_updated_by)
  select org_id,p_primary_id,is_member,member_no,valid_from,valid_to,statistics_participation,statistics_participation_source,statistics_participation_updated_at,statistics_participation_updated_by
  from public.org_affiliations where rights_holder_id = p_duplicate_id
  on conflict (org_id,rights_holder_id) do update set
    is_member = public.org_affiliations.is_member or excluded.is_member,
    member_no = coalesce(nullif(public.org_affiliations.member_no,''), excluded.member_no),
    valid_from = least(public.org_affiliations.valid_from, excluded.valid_from),
    valid_to = case when public.org_affiliations.valid_to is null or excluded.valid_to is null then null else greatest(public.org_affiliations.valid_to, excluded.valid_to) end,
    statistics_participation = public.org_affiliations.statistics_participation and excluded.statistics_participation;
  delete from public.org_affiliations where rights_holder_id = p_duplicate_id;

  delete from public.rights_holder_profession_types source using public.rights_holder_profession_types target
    where source.rights_holder_id=p_duplicate_id and target.rights_holder_id=p_primary_id and source.profession_type_id=target.profession_type_id;
  update public.rights_holder_profession_types set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.rights_holder_external_identities set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;

  update public.work_assignments target set share_percent=coalesce(target.share_percent,source.share_percent)
  from public.work_assignments source
  where source.rights_holder_id=p_duplicate_id and target.rights_holder_id=p_primary_id and target.work_id=source.work_id and target.role=source.role;
  delete from public.work_assignments source using public.work_assignments target
    where source.rights_holder_id=p_duplicate_id and target.rights_holder_id=p_primary_id and target.work_id=source.work_id and target.role=source.role;
  update public.work_assignments set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;

  update public.member_series_episode_scopes target set
    episode_numbers=(select coalesce(array_agg(distinct episode order by episode),'{}'::integer[]) from unnest(coalesce(target.episode_numbers,'{}'::integer[])||coalesce(source.episode_numbers,'{}'::integer[])) episode),
    covers_whole_season=target.covers_whole_season or source.covers_whole_season,
    status=case when target.status='pending' or source.status='pending' then 'pending' else target.status end,
    updated_at=greatest(target.updated_at,source.updated_at)
  from public.member_series_episode_scopes source
  where source.rights_holder_id=p_duplicate_id and target.rights_holder_id=p_primary_id and target.org_id=source.org_id and target.series_work_id=source.series_work_id and target.season_number=source.season_number;
  delete from public.member_series_episode_scopes source using public.member_series_episode_scopes target
    where source.rights_holder_id=p_duplicate_id and target.rights_holder_id=p_primary_id and target.org_id=source.org_id and target.series_work_id=source.series_work_id and target.season_number=source.season_number;
  update public.member_series_episode_scopes set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;

  delete from public.legal_document_acceptances source using public.legal_document_acceptances target
    where source.rights_holder_id=p_duplicate_id and target.rights_holder_id=p_primary_id and target.org_id=source.org_id and target.document_type=source.document_type and target.audience=source.audience and target.document_version_id=source.document_version_id;
  update public.legal_document_acceptances set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;

  update public.contracts set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.contract_episode_confirmations set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.contract_upload_intents set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.drive_import_runs set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.import_connections set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.import_oauth_attempts set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.member_message_threads set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.member_work_collaboration_reviews set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.notification_deliveries set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.onboarding_work_import_jobs set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.payouts set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.payroll_export_batch_items set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.payroll_recipient_references set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.rights_adjustments set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.rights_allocations set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.rights_claims set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.rights_notifications set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.settlement_items set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.settlements set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.work_change_requests set requested_by_rights_holder_id=p_primary_id where requested_by_rights_holder_id=p_duplicate_id;
  update public.work_share_participants set rights_holder_id=p_primary_id where rights_holder_id=p_duplicate_id;
  update public.work_share_participants set invited_by_rights_holder_id=p_primary_id where invited_by_rights_holder_id=p_duplicate_id;

  delete from public.rettighedshavere where id=p_duplicate_id;
  if not found then raise exception 'Dubletprofilen kunne ikke slettes'; end if;

  return jsonb_build_object('primaryId',p_primary_id,'removedId',p_duplicate_id,'auditEventId',audit_id);
end;
$$;

revoke all on function public.merge_duplicate_rights_holders(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.merge_duplicate_rights_holders(uuid,uuid,uuid,uuid,text) to service_role;
