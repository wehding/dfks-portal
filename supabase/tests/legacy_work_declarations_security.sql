begin;

select plan(11);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.legacy_work_declarations'::regclass),
  'erklæringstabellen har RLS'
);
select ok(
  not has_table_privilege('anon', 'public.legacy_work_declarations', 'SELECT'),
  'anon kan ikke læse erklæringer'
);
select ok(
  not has_table_privilege('authenticated', 'public.legacy_work_declarations', 'INSERT'),
  'browserbrugere kan ikke skrive erklæringer direkte'
);
select ok(
  not has_table_privilege('service_role', 'public.legacy_work_declarations', 'UPDATE'),
  'selv serviceklienten skal bruge den afgrænsede ugyldiggørelsesfunktion'
);
select ok(
  has_function_privilege('service_role', 'public.accept_member_legacy_declarations(uuid,uuid,uuid,uuid[],uuid)', 'EXECUTE'),
  'service_role kan udføre valideret samlet accept'
);
select ok(
  not has_function_privilege('authenticated', 'public.accept_member_legacy_declarations(uuid,uuid,uuid,uuid[],uuid)', 'EXECUTE'),
  'authenticated kan ikke omgå serverhandlingen'
);
select ok(
  not has_function_privilege('anon', 'public.reject_member_legacy_declaration_task(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'anon kan ikke bestride en tilknytning'
);
select ok(
  not has_function_privilege('authenticated', 'public.invalidate_legacy_work_declaration(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'authenticated kan ikke ugyldiggøre erklæringer'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.accept_member_legacy_declarations(uuid,uuid,uuid,uuid[],uuid)'::regprocedure),
  true,
  'acceptfunktionen er security definer med intern ejerskabskontrol'
);
select is(
  (select coalesce(proconfig, array[]::text[]) @> array['search_path=""'] from pg_proc where oid = 'public.accept_member_legacy_declarations(uuid,uuid,uuid,uuid[],uuid)'::regprocedure),
  true,
  'acceptfunktionen har tomt search_path'
);
select ok(
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'legacy_work_declarations_active_unique'),
  'én aktiv erklæring pr. titel håndhæves i databasen'
);

select * from finish();
rollback;
