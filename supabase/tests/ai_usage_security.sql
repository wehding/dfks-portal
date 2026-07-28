begin;
select plan(6);

create temporary table ai_usage_fixture (admin_user uuid, super_user uuid, jurist_user uuid, org_a uuid, org_b uuid);
grant select on ai_usage_fixture to authenticated;

do $$
declare admin_id uuid := gen_random_uuid(); super_id uuid := gen_random_uuid(); jurist_id uuid := gen_random_uuid(); first_org uuid; second_org uuid;
begin
  insert into auth.users(id,email,aud,role,created_at,updated_at) values
    (admin_id,'ai-admin@example.invalid','authenticated','authenticated',now(),now()),
    (super_id,'ai-super@example.invalid','authenticated','authenticated',now(),now()),
    (jurist_id,'ai-jurist@example.invalid','authenticated','authenticated',now(),now());
  insert into public.organisations(name) values ('AI test A') returning id into first_org;
  insert into public.organisations(name) values ('AI test B') returning id into second_org;
  insert into public.user_org_roles(user_id,org_id,role) values
    (admin_id,first_org,'admin'), (super_id,first_org,'superadmin'), (jurist_id,first_org,'jurist');
  insert into public.ai_usage_events(org_id,use_case,stage,provider,model,status) values
    (first_org,'contract_extraction','extraction','anthropic','claude-sonnet-4-6','succeeded'),
    (second_org,'contract_advice','advice','anthropic','claude-sonnet-4-6','succeeded');
  insert into ai_usage_fixture values (admin_id,super_id,jurist_id,first_org,second_org);
end $$;

select set_config('request.jwt.claims', json_build_object('sub',(select admin_user from ai_usage_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select admin_user::text from ai_usage_fixture), true);
set local role authenticated;
select is((select count(*) from public.ai_usage_events), 1::bigint, 'admin ser kun egen organisations AI-forbrug');
select is((select count(*) from public.ai_runtime_settings), 2::bigint, 'admin kan se aktive globale modeller');
reset role;

select set_config('request.jwt.claims', json_build_object('sub',(select super_user from ai_usage_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select super_user::text from ai_usage_fixture), true);
set local role authenticated;
select is((select count(*) from public.ai_usage_events), 2::bigint, 'superadmin ser AI-forbrug på tværs af organisationer');
reset role;

select set_config('request.jwt.claims', json_build_object('sub',(select jurist_user from ai_usage_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select jurist_user::text from ai_usage_fixture), true);
set local role authenticated;
select is((select count(*) from public.ai_usage_events), 0::bigint, 'jurist kan ikke se AI-forbrug');
select is((select count(*) from public.ai_runtime_settings), 0::bigint, 'jurist kan ikke se modelindstillinger');
reset role;

select ok(
  not has_table_privilege('authenticated','public.ai_runtime_settings','INSERT')
  and not has_table_privilege('authenticated','public.ai_runtime_settings','UPDATE')
  and not has_table_privilege('authenticated','public.ai_usage_events','INSERT'),
  'authenticated har ingen direkte skriveadgang til AI-indstillinger eller forbrug'
);

select * from finish();
rollback;

