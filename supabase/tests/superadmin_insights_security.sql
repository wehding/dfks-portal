begin;

select plan(4);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_superadmin_insights_summary(uuid,timestamptz,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'service_role kan hente den server-side beregnede systemindsigt'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_superadmin_insights_summary(uuid,timestamptz,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'anon kan ikke hente systemindsigt'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_superadmin_insights_summary(uuid,timestamptz,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated kan ikke kalde systemindsigtsfunktionen direkte'
);

do $$
declare
  test_org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  super_user uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  own_holder uuid;
  other_holder uuid;
  summary jsonb;
begin
  insert into public.organisations(id,name) values
    (test_org, 'Insights test ' || test_org::text),
    (other_org, 'Insights anden org ' || other_org::text);
  insert into auth.users(id,email,aud,role,created_at,updated_at) values
    (super_user, super_user || '@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (admin_user, admin_user || '@example.invalid', 'authenticated', 'authenticated', now(), now());
  insert into public.user_org_roles(user_id,org_id,role) values
    (super_user,test_org,'superadmin'),
    (admin_user,test_org,'admin');
  insert into public.rettighedshavere(full_name) values
    ('Insights medlem ' || gen_random_uuid()) returning id into own_holder;
  insert into public.rettighedshavere(full_name) values
    ('Insights andet medlem ' || gen_random_uuid()) returning id into other_holder;
  insert into public.org_affiliations(org_id,rights_holder_id,is_member,valid_from) values
    (test_org,own_holder,true,current_date),
    (other_org,other_holder,true,current_date);

  summary := public.get_superadmin_insights_summary(
    super_user,
    now() - interval '1 day',
    now() - interval '7 days',
    now() - interval '30 days',
    test_org
  );
  if (summary->>'totalMembers')::integer <> 1 then
    raise exception 'Organisationsfilteret gav forkert medlemstal';
  end if;

  begin
    perform public.get_superadmin_insights_summary(
      admin_user,
      now() - interval '1 day',
      now() - interval '7 days',
      now() - interval '30 days',
      test_org
    );
    raise exception 'Almindelig admin blev tilladt';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select pass('systemindsigt er superadmin-begrænset og organisationsafgrænset');
select * from finish();
rollback;
