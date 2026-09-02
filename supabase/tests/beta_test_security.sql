begin;

select plan(10);

select has_column('public', 'organisations', 'beta_default_duration_days', 'organisationen har standardvarighed for betatest');
select has_column('public', 'org_affiliations', 'beta_tester_since', 'affiliationen har organisationsafgrænset betateststatus');
select has_column('public', 'org_affiliations', 'beta_last_period_end_date', 'seneste informative slutdato gemmes');
select col_default_is('public', 'organisations', 'beta_default_duration_days', '10', 'standardvarigheden er ti dage');
select ok(
  exists(select 1 from pg_constraint where conname = 'organisations_beta_default_duration_days_check'),
  'varigheden er begrænset af en databaseconstraint'
);
select ok(
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'org_affiliations_beta_testers_idx'),
  'betatesterlisten har et organisationsindeks'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'org_affiliations' and cmd = 'UPDATE' and roles @> array['authenticated']::name[]),
  'eksisterende organisationsafgrænset update-RLS beskytter betafelterne'
);
select ok(
  not exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname ilike '%beta%expire%'),
  'ingen databasefunktion udløber betatesterstatus automatisk'
);
select ok(
  has_function_privilege('service_role', 'public.set_beta_tester_status(uuid,uuid,uuid,text,boolean,date,date,boolean,text)', 'EXECUTE'),
  'service role kan anvende den atomiske status- og auditfunktion'
);
select ok(
  not has_function_privilege('authenticated', 'public.set_beta_tester_status(uuid,uuid,uuid,text,boolean,date,date,boolean,text)', 'EXECUTE'),
  'browserroller kan ikke kalde den privilegerede betafunktion direkte'
);

select * from finish();
rollback;
