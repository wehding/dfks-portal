begin;

select plan(11);

select has_table('public', 'observability_events', 'observability_events findes');
select has_table('public', 'performance_test_results', 'performance_test_results findes');
select has_table('public', 'observability_source_status', 'observability_source_status findes');

select ok(not has_table_privilege('anon', 'public.observability_events', 'SELECT'), 'anon kan ikke læse telemetry');
select ok(not has_table_privilege('authenticated', 'public.observability_events', 'SELECT'), 'authenticated kan ikke læse telemetry');
select ok(not has_table_privilege('anon', 'public.performance_test_results', 'SELECT'), 'anon kan ikke læse performance-resultater');
select ok(not has_table_privilege('authenticated', 'public.performance_test_results', 'SELECT'), 'authenticated kan ikke læse performance-resultater');
select ok(has_table_privilege('service_role', 'public.observability_events', 'INSERT'), 'service_role kan indlæse telemetry');
select ok(has_table_privilege('service_role', 'public.performance_test_results', 'INSERT'), 'service_role kan indlæse performance-resultater');
select ok(not has_function_privilege('authenticated', 'public.cleanup_observability_events(timestamptz)', 'EXECUTE'), 'browserroller kan ikke køre retention');
select ok(has_function_privilege('service_role', 'public.cleanup_observability_events(timestamptz)', 'EXECUTE'), 'service_role kan køre retention');

select * from finish();
rollback;
