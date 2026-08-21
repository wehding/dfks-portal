begin;
select plan(6);

create temporary table editor_role_fixture (org_id uuid, holder_id uuid, work_id uuid, case_id uuid);

do $$
declare
  fixture_org uuid;
  fixture_holder uuid;
  fixture_work uuid;
  fixture_case uuid;
begin
  insert into public.organisations(name, terminology)
  values (
    'Dansk Filmklipperselskab test',
    '{"default_role_label":"Klipper","coeditor_word":"Medklipper","role_labels":["Klipper","B-klipper"]}'::jsonb
  ) returning id into fixture_org;
  insert into public.rettighedshavere(full_name,email)
  values ('Rolle Test', 'rolle-test@example.invalid') returning id into fixture_holder;
  insert into public.org_affiliations(org_id,rights_holder_id,is_member)
  values (fixture_org,fixture_holder,true);
  insert into public.works(org_id,title,type,status)
  values (fixture_org,'Rolleprøve','spillefilm','aktiv') returning id into fixture_work;
  insert into public.work_share_cases(org_id,work_id)
  values (fixture_org,fixture_work) returning id into fixture_case;
  insert into editor_role_fixture values (fixture_org,fixture_holder,fixture_work,fixture_case);
end
$$;

insert into public.work_assignments(org_id,work_id,rights_holder_id,role)
select org_id,work_id,holder_id,'Medklipper' from editor_role_fixture;

select is(
  (select role from public.work_assignments where work_id = (select work_id from editor_role_fixture)),
  'Klipper',
  'Medklipper normaliseres ved skrivning til work_assignments'
);

update public.work_assignments
set role = 'B-klipper'
where work_id = (select work_id from editor_role_fixture);

select is(
  (select role from public.work_assignments where work_id = (select work_id from editor_role_fixture)),
  'B-klipper',
  'særlige fagroller bevares'
);

insert into public.work_share_participants(case_id,org_id,work_id,rights_holder_id,role)
select case_id,org_id,work_id,holder_id,'Medklipper' from editor_role_fixture;

select is(
  (select role from public.work_share_participants where case_id = (select case_id from editor_role_fixture)),
  'Klipper',
  'Medklipper normaliseres i fordelingssager'
);

select ok(
  not has_function_privilege('authenticated','private.normalize_relative_work_role()','EXECUTE'),
  'browserbrugere kan ikke kalde normaliseringsfunktionen'
);

select ok(
  not has_table_privilege('authenticated','private.work_assignment_role_normalization_archive','SELECT'),
  'normaliseringsarkivet er ikke synligt for browserbrugere'
);

select is(
  (select count(*) from public.work_assignments where lower(trim(role)) = 'medklipper'),
  0::bigint,
  'relationsrollen Medklipper kan ikke genindføres'
);

select * from finish();
rollback;
