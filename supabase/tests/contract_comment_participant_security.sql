begin;

select plan(24);

create temporary table contract_comment_participant_fixture (
  org_id uuid not null,
  admin_user uuid not null,
  merge_super_user uuid not null,
  merge_primary_holder uuid not null,
  member_a_user uuid not null,
  member_a_holder uuid not null,
  member_b_user uuid not null,
  member_b_holder uuid not null,
  contract_id uuid not null,
  episode_scope_id uuid not null,
  episode_confirmation_id uuid not null,
  original_comment_id uuid not null,
  new_comment_id uuid not null,
  historical_member_comment_id uuid not null,
  ambiguous_admin_comment_id uuid not null,
  ledger_admin_comment_id uuid not null
);
grant select on contract_comment_participant_fixture to authenticated;

do $$
declare
  test_org uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  merge_super_user uuid := gen_random_uuid();
  member_a_user uuid := gen_random_uuid();
  member_b_user uuid := gen_random_uuid();
  member_a_holder uuid;
  member_b_holder uuid;
  merge_primary_holder uuid;
  test_contract uuid;
  series_work uuid;
  episode_scope uuid;
  episode_confirmation uuid;
  original_comment uuid;
  historical_contract uuid;
  historical_member_comment uuid := gen_random_uuid();
  ambiguous_admin_comment uuid := gen_random_uuid();
  ledger_admin_comment uuid := gen_random_uuid();
  current_revision bigint;
begin
  insert into public.organisations(id, name)
  values (test_org, 'Kommentardeltagere ' || test_org::text);
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
  ) values
    (admin_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', admin_user || '@example.invalid', '', now(), now()),
    (merge_super_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', merge_super_user || '@example.invalid', '', now(), now()),
    (member_a_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', member_a_user || '@example.invalid', '', now(), now()),
    (member_b_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', member_b_user || '@example.invalid', '', now(), now());
  insert into public.user_org_roles(user_id, org_id, role)
  values
    (admin_user, test_org, 'admin'),
    (merge_super_user, test_org, 'superadmin');

  select id into member_a_holder from public.rettighedshavere where user_id = member_a_user;
  if member_a_holder is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (member_a_user, 'Kommentar A ' || member_a_user::text, member_a_user || '@example.invalid')
    returning id into member_a_holder;
  end if;
  select id into member_b_holder from public.rettighedshavere where user_id = member_b_user;
  if member_b_holder is null then
    insert into public.rettighedshavere(user_id, full_name, email)
    values (member_b_user, 'Kommentar B ' || member_b_user::text, member_b_user || '@example.invalid')
    returning id into member_b_holder;
  end if;
  insert into public.rettighedshavere(full_name, email)
  values ('Kommentar primær ' || gen_random_uuid(), gen_random_uuid() || '@example.invalid')
  returning id into merge_primary_holder;
  insert into public.org_affiliations(org_id, rights_holder_id, is_member, valid_from) values
    (test_org, member_a_holder, true, current_date),
    (test_org, member_b_holder, true, current_date),
    (test_org, merge_primary_holder, true, current_date);

  insert into public.works(org_id, title, type, status, season_count)
  values (test_org, 'Stabil episodeserie ' || gen_random_uuid(), 'tv-serie', 'godkendt', 1)
  returning id into series_work;
  insert into public.member_series_episode_scopes(
    org_id, rights_holder_id, series_work_id, season_number, status,
    episode_numbers, covers_whole_season, source, confirmed_at
  ) values (
    test_org, member_a_holder, series_work, 1, 'confirmed',
    array[1,2], false, 'contract_link', now()
  ) returning id into episode_scope;
  insert into public.contracts(
    org_id, rights_holder_id, type, status, working_title, work_id,
    season_number, episode_numbers, episode_scope_id
  )
  values (
    test_org, member_a_holder, 'a-løn', 'kladde', 'Stabil kommentartråd',
    series_work, 1, array[1,2], episode_scope
  )
  returning id into test_contract;
  insert into public.contract_episode_confirmations(
    contract_id, org_id, rights_holder_id, work_id, season_number,
    scope, episode_numbers, work_data_version, confirmed_by
  ) values (
    test_contract, test_org, member_a_holder, series_work, 1,
    'selected_episodes', array[1,2], 'participant-test-v1', member_a_user
  ) returning id into episode_confirmation;
  insert into public.contract_comments(
    org_id, contract_id, author_user_id, author_role, message
  ) values (
    test_org, test_contract, admin_user, 'admin', 'Deltagerbundet testbesked'
  ) returning id into original_comment;

  select revision into current_revision
  from public.contract_owner_verifications where contract_id = test_contract;
  perform public.review_contract_owner(
    test_contract, member_a_holder, current_revision, 'reassign', member_b_holder,
    'wrong_owner', admin_user, test_org, 'admin'
  );

  -- Recreate the exact migration-time state: the contract already points at B,
  -- while an older member comment was authored by A and historical admin replies
  -- have either exact notification provenance or no safe recipient evidence.
  insert into public.contracts(org_id, rights_holder_id, type, status, working_title)
  values (test_org, member_b_holder, 'a-løn', 'kladde', 'Historisk kommentarbackfill')
  returning id into historical_contract;
  execute 'alter table public.contract_comments disable trigger bind_contract_comment_participant';
  insert into public.contract_comments(
    id, org_id, contract_id, author_user_id, author_role, message, member_rights_holder_id
  ) values
    (historical_member_comment, test_org, historical_contract, member_a_user, 'member', 'Historisk medlem', null),
    (ambiguous_admin_comment, test_org, historical_contract, admin_user, 'admin', 'Uklar historisk admin', null),
    (ledger_admin_comment, test_org, historical_contract, admin_user, 'admin', 'Ledgerbundet historisk admin', null);
  insert into public.notification_deliveries(
    org_id, rights_holder_id, event_key, event_type, category,
    entity_type, entity_id, subject, status
  ) values (
    test_org, member_a_holder, 'contract-comment:' || ledger_admin_comment::text,
    'contract_comment', 'transactional', 'contract', historical_contract,
    'Historisk testleverance', 'sent'
  );
  perform private.backfill_contract_comment_participants();
  execute 'alter table public.contract_comments enable trigger bind_contract_comment_participant';

  insert into contract_comment_participant_fixture values (
    test_org, admin_user, merge_super_user, merge_primary_holder,
    member_a_user, member_a_holder,
    member_b_user, member_b_holder, test_contract, episode_scope,
    episode_confirmation, original_comment, gen_random_uuid(),
    historical_member_comment, ambiguous_admin_comment, ledger_admin_comment
  );
end;
$$;

select is(
  (select member_rights_holder_id from public.contract_comments
   where id = (select original_comment_id from contract_comment_participant_fixture)),
  (select member_a_holder from contract_comment_participant_fixture),
  'den eksisterende kommentar forbliver bundet til den oprindelige deltager'
);
select is(
  (select rights_holder_id from public.contracts
   where id = (select contract_id from contract_comment_participant_fixture)),
  (select member_b_holder from contract_comment_participant_fixture),
  'kontrakten kan samtidig være korrigeret til den nye ejer'
);
select ok(
  exists (
    select 1 from public.contracts
    where id = (select contract_id from contract_comment_participant_fixture)
      and season_number = 1
      and episode_scope_id is null
      and episode_numbers is null
  ),
  'ejerskiftet bevarer sæsonen men fjerner den tidligere ejers scope-pointer og afsnitsvalg'
);
select ok(
  exists (
    select 1 from public.member_series_episode_scopes
    where id = (select episode_scope_id from contract_comment_participant_fixture)
      and rights_holder_id = (select member_a_holder from contract_comment_participant_fixture)
      and status = 'confirmed'
      and episode_numbers = array[1,2]
  ),
  'den oprindelige deltagers sæsonvalg bevares som historisk medlemsdata'
);
select ok(
  exists (
    select 1 from public.contract_episode_confirmations
    where id = (select episode_confirmation_id from contract_comment_participant_fixture)
      and invalidated_at is not null
  ),
  'kontraktens tidligere afsnitsbekræftelse ugyldiggøres ved ejerskiftet'
);
select ok(
  not exists (
    select 1 from public.member_series_episode_scopes
    where org_id = (select org_id from contract_comment_participant_fixture)
      and rights_holder_id = (select member_b_holder from contract_comment_participant_fixture)
      and series_work_id = (
        select series_work_id from public.member_series_episode_scopes
        where id = (select episode_scope_id from contract_comment_participant_fixture)
      )
      and season_number = 1
      and status = 'confirmed'
  ),
  'den nye ejer får ikke automatisk en afsnitsbekræftelse og skal vælge selv'
);
select is(
  (select member_rights_holder_id from public.contract_comments
   where id = (select historical_member_comment_id from contract_comment_participant_fixture)),
  (select member_a_holder from contract_comment_participant_fixture),
  'historisk medlemskommentar bindes til den entydige forfatterprofil, ikke kontraktens nuværende ejer'
);
select is(
  (select member_rights_holder_id from public.contract_comments
   where id = (select ambiguous_admin_comment_id from contract_comment_participant_fixture)),
  null::uuid,
  'historisk adminsvar uden leverancelog forbliver ubundet og staff-only'
);
select is(
  (select member_rights_holder_id from public.contract_comments
   where id = (select ledger_admin_comment_id from contract_comment_participant_fixture)),
  (select member_a_holder from contract_comment_participant_fixture),
  'historisk adminsvar bindes kun til leveranceloggens eksakte modtager'
);

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select member_b_user from contract_comment_participant_fixture),
  'role', 'authenticated'
)::text, true);
select set_config('request.jwt.claim.sub', (select member_b_user::text from contract_comment_participant_fixture), true);
set local role authenticated;

select is(
  (select count(*)::integer from public.contract_comments
   where id = (select original_comment_id from contract_comment_participant_fixture)),
  0,
  'den nye ejer kan ikke læse den tidligere deltagers kommentar'
);
select is(
  (select count(*)::integer from public.contract_comments
   where id = (select historical_member_comment_id from contract_comment_participant_fixture)),
  0,
  'kontraktens nuværende ejer kan ikke læse den historiske A-kommentar efter fail-closed backfill'
);
select throws_ok(
  format(
    'insert into public.contract_comments(id,org_id,contract_id,author_user_id,author_role,message,member_rights_holder_id) values (%L,%L,%L,%L,%L,%L,%L)',
    (select new_comment_id from contract_comment_participant_fixture),
    (select org_id from contract_comment_participant_fixture),
    (select contract_id from contract_comment_participant_fixture),
    (select member_b_user from contract_comment_participant_fixture),
    'member', 'Forsøg på deltagerforfalskning',
    (select member_a_holder from contract_comment_participant_fixture)
  ),
  '42501',
  'Kontraktkommentarens deltager kan ikke vælges af klienten',
  'et medlem kan ikke forfalske kommentardeltageren'
);
select lives_ok(
  format(
    'insert into public.contract_comments(id,org_id,contract_id,author_user_id,author_role,message) values (%L,%L,%L,%L,%L,%L)',
    (select new_comment_id from contract_comment_participant_fixture),
    (select org_id from contract_comment_participant_fixture),
    (select contract_id from contract_comment_participant_fixture),
    (select member_b_user from contract_comment_participant_fixture),
    'member', 'Ny ejers egen kommentar'
  ),
  'den nye ejer kan oprette en kommentar uden at sende et deltager-id'
);
select is(
  (select member_rights_holder_id from public.contract_comments
   where id = (select new_comment_id from contract_comment_participant_fixture)),
  (select member_b_holder from contract_comment_participant_fixture),
  'servertriggeren binder automatisk den nye kommentar til den aktuelle ejer'
);

reset role;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select member_a_user from contract_comment_participant_fixture),
  'role', 'authenticated'
)::text, true);
select set_config('request.jwt.claim.sub', (select member_a_user::text from contract_comment_participant_fixture), true);
set local role authenticated;
select is(
  (select count(*)::integer from public.contract_comments
   where id = (select original_comment_id from contract_comment_participant_fixture)),
  1,
  'den oprindelige deltager kan fortsat læse sin kommentar efter ejerskiftet'
);

reset role;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select admin_user from contract_comment_participant_fixture),
  'role', 'authenticated'
)::text, true);
select set_config('request.jwt.claim.sub', (select admin_user::text from contract_comment_participant_fixture), true);
set local role authenticated;
select is(
  (select count(*)::integer from public.contract_comments
   where contract_id = (select contract_id from contract_comment_participant_fixture)),
  2,
  'reviewstaff kan se begge deltagerbundne kommentarer i egen organisation'
);

reset role;
select is(
  (
    select member_contract_messages::integer
    from public.get_navigation_badge_counts(
      (select org_id from contract_comment_participant_fixture),
      (select member_b_user from contract_comment_participant_fixture),
      (select member_b_holder from contract_comment_participant_fixture)
    )
  ),
  0,
  'den nye ejer arver ikke badge-tællingen fra den tidligere kommentartråd'
);
select is(
  (
    select member_contract_messages::integer
    from public.get_navigation_badge_counts(
      (select org_id from contract_comment_participant_fixture),
      (select member_a_user from contract_comment_participant_fixture),
      (select member_a_holder from contract_comment_participant_fixture)
    )
  ),
  2,
  'den oprindelige deltager beholder badge-tællingen for sine to dokumenterede kommentartråde'
);
select is(
  (
    select unread_contract_count::integer
    from public.get_member_dashboard_task_overview(
      (select org_id from contract_comment_participant_fixture),
      (select member_b_holder from contract_comment_participant_fixture),
      (select member_b_user from contract_comment_participant_fixture),
      5
    )
  ),
  0,
  'den nye ejer arver ikke dashboardopgaven fra den tidligere kommentartråd'
);
select is(
  (
    select unread_contract_count::integer
    from public.get_member_dashboard_task_overview(
      (select org_id from contract_comment_participant_fixture),
      (select member_a_holder from contract_comment_participant_fixture),
      (select member_a_user from contract_comment_participant_fixture),
      5
    )
  ),
  2,
  'den oprindelige deltager beholder dashboardopgaverne for sine to dokumenterede kommentartråde'
);

select public.merge_duplicate_rights_holders(
  (select merge_primary_holder from contract_comment_participant_fixture),
  (select member_a_holder from contract_comment_participant_fixture),
  (select merge_super_user from contract_comment_participant_fixture),
  (select org_id from contract_comment_participant_fixture),
  'superadmin'
);
select is(
  (select member_rights_holder_id from public.contract_comments
   where id = (select original_comment_id from contract_comment_participant_fixture)),
  (select merge_primary_holder from contract_comment_participant_fixture),
  'en historisk kommentardeltager remappes til primærprofilen efter et senere profile merge'
);
select is(
  (select rights_holder_id from public.contracts
   where id = (select contract_id from contract_comment_participant_fixture)),
  (select member_b_holder from contract_comment_participant_fixture),
  'profile merge af den tidligere deltager ændrer ikke kontraktens nuværende ejer'
);

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select member_a_user from contract_comment_participant_fixture),
  'role', 'authenticated'
)::text, true);
select set_config('request.jwt.claim.sub', (select member_a_user::text from contract_comment_participant_fixture), true);
set local role authenticated;
select is(
  (select count(*)::integer from public.contract_comments
   where id = (select original_comment_id from contract_comment_participant_fixture)),
  1,
  'primærprofilen kan læse den sammenlagte profils historiske samtale'
);

reset role;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select member_b_user from contract_comment_participant_fixture),
  'role', 'authenticated'
)::text, true);
select set_config('request.jwt.claim.sub', (select member_b_user::text from contract_comment_participant_fixture), true);
set local role authenticated;
select is(
  (select count(*)::integer from public.contract_comments
   where id = (select original_comment_id from contract_comment_participant_fixture)),
  0,
  'kontraktens nuværende ejer får stadig ikke den tidligere deltagers historiske samtale'
);

reset role;
select * from finish();
rollback;
