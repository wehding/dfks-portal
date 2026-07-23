-- Run against a disposable or linked test database after applying migrations.
-- The script raises an exception if a fixed class of legacy security issue
-- returns. It does not mutate application data.

begin;

do $$
begin
  if exists (
    select 1 from (values
      ('notification_deliveries'),
      ('message_campaigns'),
      ('member_message_threads'),
      ('member_messages'),
      ('member_message_participants')
    ) expected(table_name)
    where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = expected.table_name and c.relrowsecurity
    )
  ) then
    raise exception 'RLS regression: a notification or inbox table is missing RLS';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'contract_ai_jobs_one_active_attachment'
  ) then
    raise exception 'Schema regression: active allonge-job uniqueness is missing';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ilike '%user_metadata%'
        or coalesce(with_check, '') ilike '%user_metadata%'
      )
  ) then
    raise exception 'RLS regression: user_metadata is used for authorization';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') in ('true', '(true)')
        or coalesce(with_check, '') in ('true', '(true)')
      )
  ) then
    raise exception 'RLS regression: unconditional policy found';
  end if;

  if exists (
    select 1
    from pg_class table_row
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relkind in ('r', 'p')
      and table_row.relrowsecurity
      and not exists (
        select 1
        from pg_policy policy_row
        where policy_row.polrelid = table_row.oid
      )
  ) then
    raise exception 'RLS regression: enabled table has no policy';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges privilege_row
    join pg_proc function_row on function_row.proname = privilege_row.routine_name
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.prosecdef
      and privilege_row.grantee in ('PUBLIC', 'anon', 'authenticated')
  ) then
    raise exception 'Function regression: exposed SECURITY DEFINER is executable';
  end if;

  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.proname = any(array[
        'auth_rights_holder_id',
        'is_org_admin',
        'match_knowledge_chunks',
        'match_learned_patterns',
        'update_contract_reviews_updated_at'
      ])
      and function_row.proconfig is null
  ) then
    raise exception 'Function regression: mutable search_path found';
  end if;

  if exists (
    select 1
    from pg_extension extension_row
    join pg_namespace namespace_row on namespace_row.oid = extension_row.extnamespace
    where extension_row.extname = 'vector'
      and namespace_row.nspname = 'public'
  ) then
    raise exception 'Extension regression: vector is installed in public';
  end if;
end $$;

-- Validate the actual authorization helpers with existing, database-owned
-- identities. No application rows are changed.
do $$
declare
  admin_user_id uuid;
  admin_org_id uuid;
  foreign_org_id uuid;
  member_user_id uuid;
  member_holder_id uuid;
begin
  select holder.user_id, holder.id
  into member_user_id, member_holder_id
  from public.rettighedshavere holder
  where holder.user_id is not null
    and not exists (
      select 1
      from public.user_org_roles role_row
      where role_row.user_id = holder.user_id
        and role_row.role in ('superadmin', 'admin', 'org-admin')
    )
  order by holder.created_at nulls last
  limit 1;

  if member_user_id is null then
    member_user_id := gen_random_uuid();
    insert into auth.users (id, email, aud, role, created_at, updated_at)
    values (member_user_id, 'rls-fixture-' || member_user_id::text || '@example.invalid', 'authenticated', 'authenticated', now(), now());
    insert into public.rettighedshavere (user_id, full_name, email)
    values (member_user_id, 'RLS testmedlem', 'rls-fixture-' || member_user_id::text || '@example.invalid')
    returning id into member_holder_id;
  end if;

  admin_user_id := member_user_id;

  insert into public.organisations (name)
  values ('RLS testorganisation A')
  returning id into admin_org_id;

  insert into public.organisations (name)
  values ('RLS testorganisation B')
  returning id into foreign_org_id;

  insert into public.user_org_roles (user_id, org_id, role)
  values (admin_user_id, admin_org_id, 'admin');

  perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id)::text, true);

  if not public.current_user_has_org_role(
    admin_org_id,
    array['superadmin','admin','org-admin']
  ) then
    raise exception 'RLS failure: own-organisation administrator was rejected';
  end if;

  if public.current_user_has_org_role(
    foreign_org_id,
    array['superadmin','admin','org-admin']
  ) then
    raise exception 'RLS failure: administrator crossed organisation boundary';
  end if;

  delete from public.user_org_roles
  where user_id = admin_user_id
    and org_id = admin_org_id
    and role = 'admin';

  perform set_config('request.jwt.claim.sub', member_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', member_user_id,
      'user_metadata', json_build_object('role', 'superadmin')
    )::text,
    true
  );

  if not public.current_user_owns_rights_holder(member_holder_id) then
    raise exception 'RLS failure: member could not access own rights-holder identity';
  end if;

  if public.current_user_has_any_role(array['superadmin','admin','org-admin']) then
    raise exception 'RLS failure: user_metadata elevated an ordinary member';
  end if;

  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'RLS failure: anon has access to private helper schema';
  end if;

  if not exists (
    select 1
    from pg_roles role_row
    where role_row.rolname = 'service_role'
      and role_row.rolbypassrls
  ) then
    raise exception 'RLS failure: service_role does not bypass RLS as expected';
  end if;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'employer_aliases',
    'employer_legal_entities',
    'work_organisations',
    'work_employers',
    'contract_employers',
    'employer_merge_audit'
  ] loop
    if not exists (
      select 1 from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = table_name
        and relation.relrowsecurity
    ) then
      raise exception 'RLS failure: %.% is missing or RLS is disabled', 'public', table_name;
    end if;
    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT') then
      raise exception 'RLS failure: anon can select public.%', table_name;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.employer_legal_entities', 'SELECT') then
    raise exception 'RLS failure: authenticated cannot read shared legal entities';
  end if;
  if has_function_privilege('authenticated', 'public.merge_canonical_employers(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'RLS failure: authenticated can execute canonical employer merge';
  end if;
end $$;

rollback;
