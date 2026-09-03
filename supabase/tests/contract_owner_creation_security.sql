begin;

select plan(4);

select ok(
  has_function_privilege('service_role', 'public.create_contract_owner_candidate(uuid,uuid,text,text)', 'EXECUTE'),
  'service_role kan kalde den atomiske oprettelsesfunktion'
);
select ok(
  not has_function_privilege('anon', 'public.create_contract_owner_candidate(uuid,uuid,text,text)', 'EXECUTE'),
  'anon kan ikke oprette kontraktejere'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_contract_owner_candidate(uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated kan ikke kalde oprettelsesfunktionen direkte'
);

do $$
declare
  test_org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  result_one jsonb;
  result_two jsonb;
  candidate_id uuid;
  audit_id uuid;
begin
  insert into public.organisations(id,name) values
    (test_org, 'Kontraktejeroprettelse ' || test_org::text),
    (other_org, 'Fremmed organisation ' || other_org::text);
  insert into auth.users(id,email,aud,role,created_at,updated_at)
  values(admin_user, admin_user || '@example.invalid', 'authenticated', 'authenticated', now(), now());
  insert into public.user_org_roles(user_id,org_id,role) values(admin_user,test_org,'admin');

  result_one := public.create_contract_owner_candidate(test_org,admin_user,'admin','Atomisk Kandidat ' || test_org::text);
  result_two := public.create_contract_owner_candidate(test_org,admin_user,'admin','  Atomisk   Kandidat ' || test_org::text || '  ');
  candidate_id := (result_one->>'id')::uuid;
  audit_id := (result_one->>'auditEventId')::uuid;

  if result_one->>'created' <> 'true'
     or result_two->>'created' <> 'false'
     or result_two->>'id' <> candidate_id::text then
    raise exception 'Genforsøg genbrugte ikke den samme profil';
  end if;
  if (select count(*) from public.rettighedshavere where id=candidate_id) <> 1
     or (select count(*) from public.org_affiliations where org_id=test_org and rights_holder_id=candidate_id) <> 1 then
    raise exception 'Profil og organisationstilknytning blev ikke oprettet præcis én gang';
  end if;
  if not exists(select 1 from public.audit_event_subjects where event_id=audit_id and target_member_uuid=candidate_id)
     or not exists(select 1 from public.audit_event_organisations where event_id=audit_id and org_id=test_org) then
    raise exception 'Audit mangler medlem eller organisation';
  end if;

  begin
    perform public.create_contract_owner_candidate(other_org,admin_user,'admin','Afvist Kandidat ' || other_org::text);
    raise exception 'Uautoriseret oprettelse blev tilladt';
  exception when insufficient_privilege then
    null;
  end;
  if exists(select 1 from public.rights_holder_name_claims where normalized_name=public.normalize_rights_holder_name('Afvist Kandidat ' || other_org::text)) then
    raise exception 'Afvist oprettelse efterlod data';
  end if;
end;
$$;

select pass('oprettelse, genforsøg, audit og afvisning er atomiske');
select * from finish();
rollback;
