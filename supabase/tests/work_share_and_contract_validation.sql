begin;
select plan(17);

create temporary table share_contract_fixture (org_id uuid, actor_id uuid, contract_id uuid, holder_id uuid, work_id uuid);

do $$
declare
  fixture_org uuid;
  fixture_actor uuid := gen_random_uuid();
  fixture_contract uuid;
  fixture_holder uuid;
  fixture_work uuid;
begin
  insert into auth.users(id,email,aud,role,created_at,updated_at)
    values (fixture_actor,'share-contract-test@example.invalid','authenticated','authenticated',now(),now());
  insert into public.organisations(name) values ('Fordeling og kontraktstatus test') returning id into fixture_org;
  insert into public.user_org_roles(user_id,org_id,role) values (fixture_actor,fixture_org,'admin');
  insert into public.contracts(org_id,type,status,created_by,working_title)
    values (fixture_org,'produktion','kladde',fixture_actor,'Testkontrakt') returning id into fixture_contract;
  insert into public.rettighedshavere(user_id,full_name,email)
    values (fixture_actor,'Testklipper','share-contract-test@example.invalid') returning id into fixture_holder;
  insert into public.org_affiliations(org_id,rights_holder_id,is_member)
    values (fixture_org,fixture_holder,true);
  insert into public.works(org_id,title,type,status)
    values (fixture_org,'Gennemgangsværk','spillefilm','aktiv') returning id into fixture_work;
  insert into public.work_assignments(org_id,work_id,rights_holder_id,role)
    values (fixture_org,fixture_work,fixture_holder,'Klipper');
  insert into share_contract_fixture values (fixture_org,fixture_actor,fixture_contract,fixture_holder,fixture_work);
end $$;

select has_table('public','work_share_cases', 'fordelingssager findes');
select has_table('public','work_share_participants', 'fordelingsdeltagere findes');
select ok(not has_table_privilege('authenticated','public.work_share_cases','SELECT'), 'medlemmer kan ikke læse sagens øvrige data');
select ok(has_table_privilege('authenticated','public.work_share_participants','SELECT'), 'medlemmer kan læse deltagere gennem RLS');
select has_table('public','work_credit_evidence', 'eksterne klipperkilder gemmes i en serverbeskyttet tabel');
select ok(not has_table_privilege('authenticated','public.work_credit_evidence','SELECT'), 'browserrollen kan ikke læse eksterne klipperkilder');
select ok(not has_function_privilege('authenticated','public.resolve_work_share_case(uuid,uuid,uuid,numeric,jsonb,boolean)','EXECUTE'), 'browserrollen kan ikke godkende arbejdsandele');
select ok(has_function_privilege('service_role','public.resolve_work_share_case(uuid,uuid,uuid,numeric,jsonb,boolean)','EXECUTE'), 'kun serverrollen kan godkende arbejdsandele atomisk');
select has_column('public','organisations','member_work_invite_text', 'organisationen har en redigerbar medlemsskabelon');
select ok(not has_function_privilege('authenticated','public.validate_contracts_explicitly(uuid,uuid,uuid[])','EXECUTE'), 'browserrollen kan ikke validere kontrakter');
select has_table('public','member_work_collaboration_reviews', 'medklippergennemgange findes');
select ok(has_table_privilege('authenticated','public.member_work_collaboration_reviews','SELECT'), 'medlemmer kan læse egne gennemgange gennem RLS');
select is(
  (select status from public.member_work_collaboration_reviews where work_id = (select work_id from share_contract_fixture)),
  'pending',
  'ny værkstilknytning opretter pending medklippergennemgang'
);
select is(
  (select share_percent from public.work_assignments where work_id = (select work_id from share_contract_fixture)),
  null::numeric,
  'medklippergennemgangen sætter ikke automatisk 100 procent'
);
select throws_ok(
  format('update public.contracts set status = %L where id = %L', 'valideret', (select contract_id from share_contract_fixture)),
  'P0001',
  'Kontrakter skal valideres gennem den eksplicitte adminhandling',
  'direkte statusopdatering bliver afvist'
);
select throws_ok(
  format(
    'insert into public.contracts(org_id,type,status,working_title) values (%L,%L,%L,%L)',
    (select org_id from share_contract_fixture), 'produktion', 'valideret', 'Ulovlig import'
  ),
  'P0001',
  'Kontrakter skal valideres gennem den eksplicitte adminhandling',
  'en ny kontrakt kan ikke indsættes som valideret'
);
select is(
  public.validate_contracts_explicitly(
    (select actor_id from share_contract_fixture),
    (select org_id from share_contract_fixture),
    array[(select contract_id from share_contract_fixture)]
  ),
  1,
  'eksplicit adminvalidering ændrer kontrakten'
);

select * from finish();
rollback;
