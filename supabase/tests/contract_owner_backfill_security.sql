begin;
select plan(12);

select has_table('public', 'contract_owner_backfill_runs', 'Backfill run ledger exists');
select has_table('public', 'contract_owner_backfill_items', 'Backfill item ledger exists');
select ok((select relrowsecurity from pg_class where oid = 'public.contract_owner_backfill_runs'::regclass), 'Run ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.contract_owner_backfill_items'::regclass), 'Item ledger has RLS');

select ok(
  not has_table_privilege('anon', 'public.contract_owner_backfill_runs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.contract_owner_backfill_runs', 'SELECT'),
  'Browser roles cannot read runs'
);
select ok(
  not has_table_privilege('anon', 'public.contract_owner_backfill_items', 'SELECT')
  and not has_table_privilege('authenticated', 'public.contract_owner_backfill_items', 'SELECT'),
  'Browser roles cannot read items'
);
select ok(
  not has_table_privilege('anon', 'public.contract_owner_backfill_runs', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.contract_owner_backfill_runs', 'INSERT,UPDATE,DELETE'),
  'Browser roles cannot mutate runs'
);
select ok(
  not has_table_privilege('anon', 'public.contract_owner_backfill_items', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.contract_owner_backfill_items', 'INSERT,UPDATE,DELETE'),
  'Browser roles cannot mutate items'
);
select ok(
  not has_function_privilege('anon', 'public.approve_contract_owner_backfill_run(uuid,text,bigint,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.approve_contract_owner_backfill_run(uuid,text,bigint,uuid,uuid)', 'EXECUTE'),
  'Browser roles cannot approve a run'
);
select ok(
  not has_function_privilege('anon', 'public.apply_contract_owner_backfill_item(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_contract_owner_backfill_item(uuid,uuid,uuid)', 'EXECUTE'),
  'Browser roles cannot apply a run'
);
select ok(
  has_function_privilege('service_role', 'public.approve_contract_owner_backfill_run(uuid,text,bigint,uuid,uuid)', 'EXECUTE'),
  'Service role receives approval execution'
);
select ok(
  has_function_privilege('service_role', 'public.apply_contract_owner_backfill_item(uuid,uuid,uuid)', 'EXECUTE'),
  'Service role receives apply execution'
);

select * from finish();
rollback;
