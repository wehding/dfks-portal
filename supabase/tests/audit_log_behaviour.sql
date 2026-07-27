begin;
select plan(6);

create temporary table audit_test_fixture (
  admin_user uuid,
  super_user uuid,
  jurist_user uuid,
  spoof_user uuid,
  org_a uuid,
  org_b uuid,
  event_a uuid,
  event_b uuid,
  contract_id uuid
);
grant select on audit_test_fixture to authenticated;

do $$
declare
  admin_id uuid := gen_random_uuid();
  super_id uuid := gen_random_uuid();
  jurist_id uuid := gen_random_uuid();
  spoof_id uuid := gen_random_uuid();
  first_org uuid;
  second_org uuid;
  first_event uuid;
  second_event uuid;
  test_contract uuid;
begin
  insert into auth.users(id,email,aud,role,created_at,updated_at) values
    (admin_id, 'audit-admin@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (super_id, 'audit-super@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (jurist_id, 'audit-jurist@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (spoof_id, 'audit-spoof@example.invalid', 'authenticated', 'authenticated', now(), now());
  insert into public.organisations(name) values ('Audit test A') returning id into first_org;
  insert into public.organisations(name) values ('Audit test B') returning id into second_org;
  insert into public.user_org_roles(user_id,org_id,role) values
    (admin_id, first_org, 'admin'),
    (super_id, first_org, 'superadmin'),
    (jurist_id, first_org, 'jurist');
  insert into public.contracts(org_id,type,status)
  values (first_org,'test','kladde') returning id into test_contract;
  insert into public.audit_events(action,entity_type,entity_label,source) values
    ('create','audit_test','Hændelse A','database') returning id into first_event;
  insert into public.audit_events(action,entity_type,entity_label,source) values
    ('create','audit_test','Hændelse B','database') returning id into second_event;
  insert into public.audit_event_organisations(event_id,org_id) values
    (first_event,first_org), (second_event,second_org);
  insert into audit_test_fixture values
    (admin_id,super_id,jurist_id,spoof_id,first_org,second_org,first_event,second_event,test_contract);
end $$;

select set_config('request.jwt.claims', json_build_object('sub',(select admin_user from audit_test_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select admin_user::text from audit_test_fixture), true);
set local role authenticated;
select is(
  (select count(*) from public.audit_events where id in (select event_a from audit_test_fixture union all select event_b from audit_test_fixture)),
  1::bigint,
  'admin ser kun egen organisations audit-event'
);
select is(
  (select count(*) from public.audit_events where id = (select event_b from audit_test_fixture)),
  0::bigint,
  'admin kan ikke se en anden organisations event'
);
reset role;

select set_config('request.jwt.claims', json_build_object('sub',(select super_user from audit_test_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select super_user::text from audit_test_fixture), true);
set local role authenticated;
select is(
  (select count(*) from public.audit_events where id in (select event_a from audit_test_fixture union all select event_b from audit_test_fixture)),
  2::bigint,
  'superadmin ser audit-events på tværs af organisationer'
);
reset role;

select set_config('request.jwt.claims', json_build_object('sub',(select jurist_user from audit_test_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select jurist_user::text from audit_test_fixture), true);
set local role authenticated;
select is(
  (select count(*) from public.audit_events where id in (select event_a from audit_test_fixture union all select event_b from audit_test_fixture)),
  0::bigint,
  'jurist har ikke adgang til auditloggen'
);
reset role;

select set_config('request.jwt.claims', json_build_object('sub',(select admin_user from audit_test_fixture),'role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select admin_user::text from audit_test_fixture), true);
select set_config('request.headers', json_build_object('x-dfks-actor-id',(select spoof_user from audit_test_fixture),'x-dfks-audit-source','portal')::text, true);
set local role authenticated;
update public.contracts set status = 'valideret' where id = (select contract_id from audit_test_fixture);
select is(
  (select actor_user_id from public.audit_events where entity_type = 'contracts' and entity_id = (select contract_id::text from audit_test_fixture) and action = 'validate' order by occurred_at desc limit 1),
  (select admin_user from audit_test_fixture),
  'autentificeret klient kan ikke spoofe service-role aktøren'
);
reset role;

do $$
declare old_event uuid;
begin
  insert into public.audit_events(occurred_at,action,entity_type,source)
  values (now() - interval '8 years','create','retention_test','database') returning id into old_event;
  perform public.purge_expired_audit_events(interval '7 years', 10000);
  if exists (select 1 from public.audit_events where id = old_event) then
    raise exception 'Retention did not delete expired event';
  end if;
end $$;
select pass('syvårs-retention sletter udløbne events gennem den begrænsede funktion');

select * from finish();
rollback;
