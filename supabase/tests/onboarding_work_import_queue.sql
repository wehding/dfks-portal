begin;
select plan(6);

create temporary table onboarding_import_fixture (
  owner_user uuid,
  other_user uuid,
  owner_job uuid,
  other_job uuid
);
grant select on onboarding_import_fixture to authenticated;

do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  org_id uuid;
  owner_holder uuid;
  other_holder uuid;
  first_job uuid;
  second_job uuid;
begin
  insert into auth.users(id,email,aud,role,created_at,updated_at) values
    (owner_id,'onboarding-owner@example.invalid','authenticated','authenticated',now(),now()),
    (other_id,'onboarding-other@example.invalid','authenticated','authenticated',now(),now());
  insert into public.organisations(name) values ('Onboarding import test') returning id into org_id;
  insert into public.rettighedshavere(user_id,full_name) values
    (owner_id,'Onboarding ejer') returning id into owner_holder;
  insert into public.rettighedshavere(user_id,full_name) values
    (other_id,'Anden onboarding ejer') returning id into other_holder;
  insert into public.onboarding_work_import_jobs(user_id,rights_holder_id,org_id,total_items)
    values (owner_id,owner_holder,org_id,1) returning id into first_job;
  insert into public.onboarding_work_import_jobs(user_id,rights_holder_id,org_id,total_items)
    values (other_id,other_holder,org_id,1) returning id into second_job;
  insert into public.onboarding_work_import_items(job_id,item_key,position,title,payload) values
    (first_job,'owner-item',0,'Eget værk','{"id":"dfi-1"}'::jsonb),
    (second_job,'other-item',0,'Andet værk','{"id":"dfi-2"}'::jsonb);
  insert into onboarding_import_fixture values (owner_id,other_id,first_job,second_job);
end $$;

select set_config('request.jwt.claims', json_build_object('sub',(select owner_user from onboarding_import_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select owner_user::text from onboarding_import_fixture), true);
set local role authenticated;
select is((select count(*) from public.onboarding_work_import_jobs), 1::bigint, 'medlem ser kun eget importjob');
select is((select count(*) from public.onboarding_work_import_items), 1::bigint, 'medlem ser kun egne importelementer');
select ok(
  not has_table_privilege('authenticated','public.onboarding_work_import_jobs','INSERT')
  and not has_table_privilege('authenticated','public.onboarding_work_import_jobs','UPDATE')
  and not has_table_privilege('authenticated','public.onboarding_work_import_items','INSERT'),
  'authenticated har ingen direkte skriveadgang til køen'
);
select ok(
  not has_function_privilege('authenticated','public.claim_onboarding_work_import_item(uuid)','EXECUTE'),
  'authenticated kan ikke claime importarbejde'
);
reset role;

select is(
  (select count(*) from public.claim_onboarding_work_import_item((select owner_job from onboarding_import_fixture))),
  1::bigint,
  'servicekonteksten kan claime præcis ét element'
);
select is(
  (select attempts from public.onboarding_work_import_items where job_id = (select owner_job from onboarding_import_fixture)),
  1,
  'claim øger forsøgstælleren én gang'
);

select * from finish();
rollback;
