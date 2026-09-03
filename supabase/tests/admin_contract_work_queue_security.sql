begin;

select plan(10);

select has_table('public', 'admin_contract_work_queues', 'arbejdskøer har en særskilt tabel');
select has_table('public', 'admin_contract_work_queue_items', 'arbejdskøernes kontrakter har en særskilt tabel');
select ok((select relrowsecurity from pg_class where oid = 'public.admin_contract_work_queues'::regclass), 'RLS er aktiv på køerne');
select ok((select relrowsecurity from pg_class where oid = 'public.admin_contract_work_queue_items'::regclass), 'RLS er aktiv på køelementerne');
select ok(not has_table_privilege('anon', 'public.admin_contract_work_queues', 'SELECT'), 'anon kan ikke læse køer');
select ok(not has_table_privilege('authenticated', 'public.admin_contract_work_queues', 'SELECT'), 'browserbrugere kan ikke læse køer direkte');
select ok(not has_table_privilege('authenticated', 'public.admin_contract_work_queue_items', 'SELECT'), 'browserbrugere kan ikke læse køelementer direkte');
select ok(has_table_privilege('service_role', 'public.admin_contract_work_queues', 'SELECT'), 'service-laget kan læse køer');
select ok(has_table_privilege('service_role', 'public.admin_contract_work_queue_items', 'INSERT'), 'service-laget kan oprette køelementer');
select is((select count(*)::integer from pg_trigger where tgrelid = 'public.contract_owner_backfill_runs'::regclass and tgname = 'guard_single_contract_owner_backfill_run' and not tgisinternal), 1, 'engangskørslen kan ikke oprettes igen');

select * from finish();
rollback;
