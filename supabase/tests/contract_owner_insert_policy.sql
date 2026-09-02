begin;

select plan(18);

create temporary table contract_owner_insert_fixture (
  org_a uuid not null,
  org_b uuid not null,
  jurist_user uuid not null,
  jurist_holder uuid not null,
  member_user uuid not null,
  member_holder uuid not null,
  cross_org_member_user uuid not null,
  cross_org_holder uuid not null,
  archived_member_user uuid not null,
  archived_holder uuid not null,
  spoof_user uuid not null,
  jurist_ownerless_contract uuid not null,
  jurist_owned_contract uuid not null,
  jurist_cross_org_contract uuid not null,
  member_contract uuid not null,
  forged_contract uuid not null,
  cross_org_contract uuid not null,
  archived_contract uuid not null
);

grant select on contract_owner_insert_fixture to authenticated;

do $$
declare
  org_a uuid := gen_random_uuid();
  org_b uuid := gen_random_uuid();
  jurist_user uuid := gen_random_uuid();
  member_user uuid := gen_random_uuid();
  cross_org_member_user uuid := gen_random_uuid();
  archived_member_user uuid := gen_random_uuid();
  spoof_user uuid := gen_random_uuid();
  jurist_holder uuid;
  member_holder uuid;
  cross_org_holder uuid;
  archived_holder uuid;
begin
  insert into public.organisations(id, name) values
    (org_a, 'Kontrakt-INSERT organisation A ' || org_a::text),
    (org_b, 'Kontrakt-INSERT organisation B ' || org_b::text);

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
  ) values
    (
      jurist_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      jurist_user || '@example.invalid', '', now(), now()
    ),
    (
      member_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      member_user || '@example.invalid', '', now(), now()
    ),
    (
      cross_org_member_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      cross_org_member_user || '@example.invalid', '', now(), now()
    ),
    (
      archived_member_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      archived_member_user || '@example.invalid', '', now(), now()
    ),
    (
      spoof_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      spoof_user || '@example.invalid', '', now(), now()
    );

  insert into public.user_org_roles(user_id, org_id, role)
  values (jurist_user, org_a, 'jurist');

  select id into jurist_holder
  from public.rettighedshavere where user_id = jurist_user;
  if jurist_holder is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (
      jurist_user,
      'Juristprofil ' || jurist_user::text,
      jurist_user || '@example.invalid'
    ) returning id into jurist_holder;
  end if;

  select id into member_holder
  from public.rettighedshavere where user_id = member_user;
  if member_holder is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (
      member_user,
      'Medlemsprofil ' || member_user::text,
      member_user || '@example.invalid'
    ) returning id into member_holder;
  end if;

  select id into cross_org_holder
  from public.rettighedshavere where user_id = cross_org_member_user;
  if cross_org_holder is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (
      cross_org_member_user,
      'Fremmed medlemsprofil ' || cross_org_member_user::text,
      cross_org_member_user || '@example.invalid'
    ) returning id into cross_org_holder;
  end if;

  select id into archived_holder
  from public.rettighedshavere where user_id = archived_member_user;
  if archived_holder is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (
      archived_member_user,
      'Arkiveret medlemsprofil ' || archived_member_user::text,
      archived_member_user || '@example.invalid'
    ) returning id into archived_holder;
  end if;
  update public.rettighedshavere
  set archived_at = now()
  where id = archived_holder;

  -- Juristens egen profil er aktiv i organisationen. Dermed beviser testen,
  -- at medarbejderrollen ikke kan glide over i medlemssporet ved INSERT.
  insert into public.org_affiliations(
    org_id, rights_holder_id, is_member, valid_from
  ) values
    (org_a, jurist_holder, true, current_date),
    (org_a, member_holder, true, current_date),
    (org_b, cross_org_holder, true, current_date),
    (org_a, archived_holder, true, current_date);

  insert into contract_owner_insert_fixture values (
    org_a,
    org_b,
    jurist_user,
    jurist_holder,
    member_user,
    member_holder,
    cross_org_member_user,
    cross_org_holder,
    archived_member_user,
    archived_holder,
    spoof_user,
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid()
  );
end;
$$;

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'contracts'
      and policyname = 'Brugere og reviewstaff kan oprette sikre kontraktkladder'
      and cmd = 'INSERT'
  ),
  1,
  'kontrakter har præcis én målrettet INSERT-policy'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select jurist_user from contract_owner_insert_fixture),
    'role', 'authenticated'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  (select jurist_user::text from contract_owner_insert_fixture),
  true
);
set local role authenticated;

select lives_ok(
  format(
    'insert into public.contracts(id,org_id,rights_holder_id,type,status,working_title,created_by) values (%L,%L,null,%L,%L,%L,%L)',
    (select jurist_ownerless_contract from contract_owner_insert_fixture),
    (select org_a from contract_owner_insert_fixture),
    'a-løn', 'kladde', 'Ejerløs juristkladde',
    (select jurist_user from contract_owner_insert_fixture)
  ),
  'jurist kan oprette en ejerløs kontraktkladde i egen organisation'
);

select throws_ok(
  format(
    'insert into public.contracts(id,org_id,rights_holder_id,type,status,working_title,created_by) values (%L,%L,%L,%L,%L,%L,%L)',
    (select jurist_owned_contract from contract_owner_insert_fixture),
    (select org_a from contract_owner_insert_fixture),
    (select jurist_holder from contract_owner_insert_fixture),
    'a-løn', 'kladde', 'Ulovlig juristejer',
    (select jurist_user from contract_owner_insert_fixture)
  ),
  '42501',
  'new row violates row-level security policy for table "contracts"',
  'jurist kan ikke indsætte en kontrakt med ejer, heller ikke egen medlemsprofil'
);

select throws_ok(
  format(
    'insert into public.contracts(id,org_id,rights_holder_id,type,status,working_title,created_by) values (%L,%L,null,%L,%L,%L,%L)',
    (select jurist_cross_org_contract from contract_owner_insert_fixture),
    (select org_b from contract_owner_insert_fixture),
    'a-løn', 'kladde', 'Ulovlig fremmed juristkladde',
    (select jurist_user from contract_owner_insert_fixture)
  ),
  '42501',
  'new row violates row-level security policy for table "contracts"',
  'jurist kan ikke oprette en ejerløs kontrakt i en anden organisation'
);

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select member_user from contract_owner_insert_fixture),
    'role', 'authenticated'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  (select member_user::text from contract_owner_insert_fixture),
  true
);
set local role authenticated;

select lives_ok(
  format(
    'insert into public.contracts(id,org_id,rights_holder_id,type,status,working_title,created_by) values (%L,%L,%L,%L,%L,%L,%L)',
    (select member_contract from contract_owner_insert_fixture),
    (select org_a from contract_owner_insert_fixture),
    (select member_holder from contract_owner_insert_fixture),
    'a-løn', 'kladde', 'Egen medlemskladde',
    (select member_user from contract_owner_insert_fixture)
  ),
  'medlem kan oprette en kontraktkladde med egen aktive rettighedshaver'
);

select throws_ok(
  format(
    'insert into public.contracts(id,org_id,rights_holder_id,type,status,working_title,created_by) values (%L,%L,%L,%L,%L,%L,%L)',
    (select forged_contract from contract_owner_insert_fixture),
    (select org_a from contract_owner_insert_fixture),
    (select member_holder from contract_owner_insert_fixture),
    'a-løn', 'kladde', 'Forfalsket opretter',
    (select spoof_user from contract_owner_insert_fixture)
  ),
  '42501',
  'new row violates row-level security policy for table "contracts"',
  'medlem kan ikke forfalske created_by'
);

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select cross_org_member_user from contract_owner_insert_fixture),
    'role', 'authenticated'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  (select cross_org_member_user::text from contract_owner_insert_fixture),
  true
);
set local role authenticated;

select throws_ok(
  format(
    'insert into public.contracts(id,org_id,rights_holder_id,type,status,working_title,created_by) values (%L,%L,%L,%L,%L,%L,%L)',
    (select cross_org_contract from contract_owner_insert_fixture),
    (select org_a from contract_owner_insert_fixture),
    (select cross_org_holder from contract_owner_insert_fixture),
    'a-løn', 'kladde', 'Fremmed organisationsprofil',
    (select cross_org_member_user from contract_owner_insert_fixture)
  ),
  '42501',
  'new row violates row-level security policy for table "contracts"',
  'medlem kan ikke oprette kontrakt med egen profil i en anden organisation'
);

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select archived_member_user from contract_owner_insert_fixture),
    'role', 'authenticated'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  (select archived_member_user::text from contract_owner_insert_fixture),
  true
);
set local role authenticated;

select throws_ok(
  format(
    'insert into public.contracts(id,org_id,rights_holder_id,type,status,working_title,created_by) values (%L,%L,%L,%L,%L,%L,%L)',
    (select archived_contract from contract_owner_insert_fixture),
    (select org_a from contract_owner_insert_fixture),
    (select archived_holder from contract_owner_insert_fixture),
    'a-løn', 'kladde', 'Arkiveret medlemsprofil',
    (select archived_member_user from contract_owner_insert_fixture)
  ),
  '42501',
  'new row violates row-level security policy for table "contracts"',
  'medlem kan ikke oprette kontrakt med en arkiveret rettighedshaver'
);

reset role;

select is(
  (
    select status
    from public.contract_owner_verifications
    where contract_id = (
      select jurist_ownerless_contract from contract_owner_insert_fixture
    )
  ),
  'pending',
  'ejerløs juristkladde seedes som pending'
);
select is(
  (
    select assignment_origin
    from public.contract_owner_verifications
    where contract_id = (
      select jurist_ownerless_contract from contract_owner_insert_fixture
    )
  ),
  'unknown',
  'ejerløs juristkladde seedes med ukendt oprindelse'
);
select ok(
  exists (
    select 1
    from public.contract_owner_verifications
    where contract_id = (
      select jurist_ownerless_contract from contract_owner_insert_fixture
    )
      and assigned_rights_holder_id is null
      and proposed_rights_holder_id is null
      and reviewed_by is null
      and reviewed_at is null
  ),
  'ejerløs juristkladde får ingen falsk ejer eller kontrolgodkendelse'
);
select is(
  (
    select count(*)::integer
    from public.contract_owner_provenance
    where contract_id = (
      select jurist_ownerless_contract from contract_owner_insert_fixture
    )
  ),
  0,
  'ejerløs juristkladde får ingen falsk ejerskabsproveniens'
);

select is(
  (
    select status
    from public.contract_owner_verifications
    where contract_id = (select member_contract from contract_owner_insert_fixture)
  ),
  'pending',
  'direkte medlemskladde seedes som pending'
);
select is(
  (
    select assignment_origin
    from public.contract_owner_verifications
    where contract_id = (select member_contract from contract_owner_insert_fixture)
  ),
  'unknown',
  'direkte medlemskladde seedes med ukendt oprindelse'
);
select ok(
  exists (
    select 1
    from public.contract_owner_verifications
    where contract_id = (select member_contract from contract_owner_insert_fixture)
      and assigned_rights_holder_id = (
        select member_holder from contract_owner_insert_fixture
      )
      and proposed_rights_holder_id is null
      and reviewed_by is null
      and reviewed_at is null
  ),
  'direkte medlemskladde får den aktuelle ejer uden falsk kontrolgodkendelse'
);
select is(
  (
    select count(*)::integer
    from public.contract_owner_provenance
    where contract_id = (select member_contract from contract_owner_insert_fixture)
      and rights_holder_id = (select member_holder from contract_owner_insert_fixture)
      and origin = 'unknown'
  ),
  1,
  'direkte medlemskladde får kun ukendt seed-proveniens'
);
select is(
  (
    select count(*)::integer
    from public.contract_owner_provenance
    where contract_id = (select member_contract from contract_owner_insert_fixture)
      and origin in ('authenticated_member_upload', 'authenticated_member_drive')
  ),
  0,
  'direkte INSERT udgiver sig ikke for et verificeret uploadflow'
);

select is(
  (
    select count(*)::integer
    from public.contracts
    where id in (
      select jurist_owned_contract from contract_owner_insert_fixture
      union all select jurist_cross_org_contract from contract_owner_insert_fixture
      union all select forged_contract from contract_owner_insert_fixture
      union all select cross_org_contract from contract_owner_insert_fixture
      union all select archived_contract from contract_owner_insert_fixture
    )
  ),
  0,
  'alle afviste INSERT-forsøg er rullet helt tilbage'
);

select * from finish();
rollback;
