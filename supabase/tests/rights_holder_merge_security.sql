begin;

select plan(5);

select ok(
  has_function_privilege('service_role', 'public.merge_duplicate_rights_holders(uuid,uuid,uuid,uuid,text)', 'EXECUTE'),
  'service_role kan kalde den serverbeskyttede mergefunktion'
);
select ok(
  not has_function_privilege('anon', 'public.merge_duplicate_rights_holders(uuid,uuid,uuid,uuid,text)', 'EXECUTE'),
  'anon kan ikke sammenlægge rettighedshavere'
);
select ok(
  not has_function_privilege('authenticated', 'public.merge_duplicate_rights_holders(uuid,uuid,uuid,uuid,text)', 'EXECUTE'),
  'authenticated kan ikke kalde mergefunktionen direkte'
);
select is(
  (select prosecdef from pg_proc where oid='public.merge_duplicate_rights_holders(uuid,uuid,uuid,uuid,text)'::regprocedure),
  true,
  'den offentlige merge-wrapper er security definer og kalder kun den revokede interne funktion'
);

do $$
declare
  test_org uuid;
  super_role_org uuid;
  super_user uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  member_user uuid := gen_random_uuid();
  login_user_a uuid := gen_random_uuid();
  login_user_b uuid := gen_random_uuid();
  primary_holder uuid;
  duplicate_holder uuid;
  blocked_primary uuid;
  blocked_duplicate uuid;
  conflict_primary uuid;
  conflict_duplicate uuid;
  test_work uuid;
  test_contract uuid;
  merge_result jsonb;
begin
  insert into auth.users(id,email,aud,role,created_at,updated_at) values
    (super_user,'merge-super@example.invalid','authenticated','authenticated',now(),now()),
    (admin_user,'merge-admin@example.invalid','authenticated','authenticated',now(),now()),
    (member_user,'merge-member@example.invalid','authenticated','authenticated',now(),now()),
    (login_user_a,'merge-login-a@example.invalid','authenticated','authenticated',now(),now()),
    (login_user_b,'merge-login-b@example.invalid','authenticated','authenticated',now(),now());
  insert into public.organisations(name) values ('Merge testorganisation') returning id into test_org;
  insert into public.organisations(name) values ('Global superadmin rolleorganisation') returning id into super_role_org;
  insert into public.user_org_roles(user_id,org_id,role) values
    (super_user,super_role_org,'superadmin'),(admin_user,test_org,'admin');

  insert into public.rettighedshavere(full_name,email,alternative_names)
  values('Primær testperson','primary@example.invalid','{}') returning id into primary_holder;
  insert into public.rettighedshavere(full_name,email,alternative_names,user_id,dfi_person_id,tmdb_person_id,wikidata_qid,imdb_nm)
  values('Dublet testperson','duplicate@example.invalid','{}',member_user,990000001,990000002,'Q990000003','nm9900004') returning id into duplicate_holder;
  insert into public.org_affiliations(org_id,rights_holder_id,is_member) values
    (test_org,primary_holder,true),(test_org,duplicate_holder,true);
  insert into public.works(org_id,title,type,status) values(test_org,'Merge testværk','film','godkendt') returning id into test_work;
  insert into public.work_assignments(org_id,work_id,rights_holder_id,role) values(test_org,test_work,duplicate_holder,'Klipper');
  insert into public.contracts(org_id,rights_holder_id,type,status,working_title) values(test_org,duplicate_holder,'A-løn','kladde','Merge testkontrakt') returning id into test_contract;
  update public.contract_owner_verifications
  set evidence_subject_rights_holder_id=duplicate_holder
  where contract_id=test_contract;
  insert into public.contract_comments(org_id,contract_id,author_user_id,author_role,message)
  values(test_org,test_contract,member_user,'member','Mergeparticipant');

  merge_result := public.merge_duplicate_rights_holders(primary_holder,duplicate_holder,super_user,test_org,'superadmin');
  if merge_result->>'primaryId' <> primary_holder::text then raise exception 'Forkert primær profil'; end if;
  if exists(select 1 from public.rettighedshavere where id=duplicate_holder) then raise exception 'Dubletprofilen blev ikke slettet'; end if;
  if not exists(select 1 from public.contracts where id=test_contract and rights_holder_id=primary_holder) then raise exception 'Kontrakten blev ikke flyttet'; end if;
  if not exists(
    select 1 from public.contract_owner_verifications
    where contract_id=test_contract
      and assigned_rights_holder_id=primary_holder
      and evidence_subject_rights_holder_id=primary_holder
      and assignment_origin='profile_merge'
      and reason_code='profile_merged'
  ) then raise exception 'Ejerskabskontrollen blev ikke flyttet atomisk'; end if;
  if exists(
    select 1 from public.contract_owner_provenance
    where contract_id=test_contract and rights_holder_id=duplicate_holder
  ) or not exists(
    select 1 from public.contract_owner_provenance
    where contract_id=test_contract
      and rights_holder_id=primary_holder
      and origin='profile_merge'
  ) then raise exception 'Ejerskabsproveniensen blev ikke flyttet atomisk'; end if;
  if not exists(select 1 from public.work_assignments where work_id=test_work and rights_holder_id=primary_holder) then raise exception 'Værktilknytningen blev ikke flyttet'; end if;
  if not exists(select 1 from public.contract_comments where contract_id=test_contract and member_rights_holder_id=primary_holder) then raise exception 'Kommentardeltageren blev ikke flyttet ved profilsammenlægning'; end if;
  if not exists(select 1 from public.rettighedshavere where id=primary_holder and user_id=member_user and dfi_person_id=990000001 and tmdb_person_id=990000002 and wikidata_qid='Q990000003' and imdb_nm='nm9900004') then raise exception 'Login eller eksterne person-id’er blev ikke flyttet'; end if;
  if (select count(*) from public.audit_event_subjects where event_id=(merge_result->>'auditEventId')::uuid and target_member_uuid in (primary_holder,duplicate_holder)) <> 2 then raise exception 'Audit mangler begge profiler'; end if;
  if not exists (
    select 1 from public.audit_event_organisations
    where event_id=(merge_result->>'auditEventId')::uuid and org_id=test_org
  ) then raise exception 'Merge-audit mangler målorganisationen'; end if;

  insert into public.rettighedshavere(full_name,email)
  values('Blokeret primær','blocked-primary@example.invalid') returning id into blocked_primary;
  insert into public.rettighedshavere(full_name,email)
  values('Blokeret dublet','blocked-duplicate@example.invalid') returning id into blocked_duplicate;
  insert into public.org_affiliations(org_id,rights_holder_id,is_member) values
    (test_org,blocked_primary,false),(test_org,blocked_duplicate,false);
  begin
    perform public.merge_duplicate_rights_holders(blocked_primary,blocked_duplicate,admin_user,test_org,'admin');
    raise exception 'Admin blev fejlagtigt tilladt';
  exception when others then
    if sqlerrm='Admin blev fejlagtigt tilladt' then raise; end if;
  end;
  if (select count(*) from public.rettighedshavere where id in (blocked_primary,blocked_duplicate)) <> 2 then raise exception 'Afvist merge ændrede data'; end if;

  insert into public.rettighedshavere(full_name,email,user_id)
  values('Loginprofil A','merge-login-a@example.invalid',login_user_a) returning id into conflict_primary;
  insert into public.rettighedshavere(full_name,email,user_id)
  values('Loginprofil B','merge-login-b@example.invalid',login_user_b) returning id into conflict_duplicate;
  insert into public.org_affiliations(org_id,rights_holder_id,is_member) values
    (test_org,conflict_primary,true),(test_org,conflict_duplicate,true);
  begin
    perform public.merge_duplicate_rights_holders(conflict_primary,conflict_duplicate,super_user,test_org,'superadmin');
    raise exception 'To loginbrugere blev fejlagtigt sammenlagt';
  exception when others then
    if sqlerrm='To loginbrugere blev fejlagtigt sammenlagt' then raise; end if;
  end;
  if (select count(*) from public.rettighedshavere where id in (conflict_primary,conflict_duplicate)) <> 2 then raise exception 'Login-konflikt ændrede data'; end if;
end;
$$;

select pass('superadmin-merge er atomisk, auditeret og afviser admin samt to loginbrugere uden ændringer');
select * from finish();
rollback;
