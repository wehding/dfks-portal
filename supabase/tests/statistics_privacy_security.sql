begin;
select plan(12);

select ok(
  (select pg_get_constraintdef(oid) like '%statistics_minimum_group_size >= 3%'
   from pg_constraint where conname = 'organisations_statistics_minimum_group_size_check'),
  'Statistikgrænsen kan ikke sættes under tre'
);

select has_table('analytics', 'member_statistics_profiles', 'Privat statistikprofil findes');
select has_table('analytics', 'standardized_compensation_facts', 'Private standardiserede lønfakta findes');
select has_table('analytics', 'statistics_query_audit', 'Statistikdetaljer for forespørgselsfingeraftryk findes');
select has_column('analytics', 'statistics_query_audit', 'audit_event_id', 'Statistikdetaljer peger på den autoritative auditlog');

select ok(
  not has_schema_privilege('anon', 'analytics', 'USAGE'),
  'Anon har ikke adgang til analytics-schemaet'
);
select ok(
  not has_schema_privilege('authenticated', 'analytics', 'USAGE'),
  'Authenticated har ikke adgang til analytics-schemaet'
);
select ok(
  not has_table_privilege('authenticated', 'analytics.member_statistics_profiles', 'SELECT'),
  'Medlemsprofiler kan ikke læses fra browserrollen'
);
select ok(
  not has_table_privilege('authenticated', 'analytics.standardized_compensation_facts', 'SELECT'),
  'Lønfakta kan ikke læses fra browserrollen'
);
select ok(
  (select bool_and(relrowsecurity)
   from pg_class relation
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'analytics'
     and relation.relname in ('member_statistics_profiles', 'standardized_compensation_facts', 'statistics_reference_series', 'statistics_geography', 'statistics_query_audit')),
  'Alle nye private statistiktabeller har RLS som ekstra barriere'
);

select ok(
  not has_function_privilege('authenticated', 'public.record_statistics_query_audit(uuid,uuid,text,text,integer,jsonb,uuid)', 'EXECUTE'),
  'Browserrollen kan ikke skrive statistikdetaljer'
);
select ok(
  has_function_privilege('service_role', 'public.record_statistics_query_audit(uuid,uuid,text,text,integer,jsonb,uuid)', 'EXECUTE'),
  'Kun serverrollen kan skrive statistikdetaljer'
);

select * from finish();
rollback;
