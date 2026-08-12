begin;

select plan(2);

select is(
  (
    select routine.provolatile
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'private'
      and routine.proname = 'audit_sanitize_row'
      and pg_get_function_identity_arguments(routine.oid) = 'row_data jsonb'
  ),
  's'::"char",
  'audit_sanitize_row is STABLE'
);

select is(
  private.audit_sanitize_row(jsonb_build_object(
    'status', 'valideret',
    'email', 'person@example.com',
    'updated_at', now()
  )),
  jsonb_build_object(
    'email', jsonb_build_object('redacted', true),
    'status', 'valideret'
  ),
  'audit_sanitize_row still redacts sensitive and removes technical fields'
);

select * from finish();
rollback;
