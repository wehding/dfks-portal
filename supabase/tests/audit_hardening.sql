begin;

select plan(1);

do $$
declare
  first_result record;
  second_result record;
begin
  if has_function_privilege('anon', 'public.consume_api_rate_limit(text,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.consume_api_rate_limit(text,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_contracts_atomic(uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_contracts_atomic(uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.match_learned_patterns(extensions.vector,double precision,integer,uuid)', 'EXECUTE') then
    raise exception 'Hardening regression: a server-only function is browser-accessible';
  end if;

  if has_table_privilege('anon', 'private.api_rate_limits', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'private.api_rate_limits', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Hardening regression: rate-limit counters are browser-accessible';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learned_patterns' and column_name = 'org_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'overenskomst_uploads' and column_name = 'org_id'
  ) then
    raise exception 'Hardening regression: organisation scope is missing';
  end if;

  select * into first_result
  from public.consume_api_rate_limit('test', repeat('a', 64), 1, 60);
  select * into second_result
  from public.consume_api_rate_limit('test', repeat('a', 64), 1, 60);
  if not first_result.allowed or second_result.allowed or second_result.retry_after_seconds < 1 then
    raise exception 'Hardening regression: persistent rate limiting is not atomic';
  end if;
end $$;

select pass('Audit hardening is organisation-scoped and server-only');
select * from finish();

rollback;
