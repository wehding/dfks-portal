begin;

select plan(7);

select has_table('analytics', 'contract_advice_review_facts', 'Rådgivningssagsfakta findes');
select has_table('analytics', 'contract_advice_issue_facts', 'Rådgivningsfund findes');
select has_table('analytics', 'contract_advice_version_comparisons', 'Versionssammenligninger findes');
select has_function('public', 'get_contract_advice_statistics_facts', array['uuid','integer','integer'], 'Sikker rådgivnings-RPC findes');
select ok(not has_table_privilege('anon', 'analytics.contract_advice_review_facts', 'SELECT'), 'Anon kan ikke læse rådgivningsfakta');
select ok(not has_table_privilege('authenticated', 'analytics.contract_advice_issue_facts', 'SELECT'), 'Browserbrugere kan ikke læse rådgivningsfund');
select ok(not has_function_privilege('authenticated', 'public.get_contract_advice_statistics_facts(uuid,integer,integer)', 'EXECUTE'), 'Authenticated kan ikke kalde server-RPC direkte');

select * from finish();
rollback;
