-- CHECK constraints are evaluated as the role performing the write. The
-- allowlisted validator intentionally calls private helpers that runtime roles
-- must not be able to execute directly, so run this narrow, immutable wrapper
-- with the migration owner's privileges. Its empty search_path and JSON-only
-- input keep the privilege boundary closed.
alter function private.contract_document_review_details_valid(jsonb)
  security definer;

revoke all on function private.contract_document_review_details_valid(jsonb)
  from public, anon, authenticated;
grant execute on function private.contract_document_review_details_valid(jsonb)
  to service_role;

-- The implementation already has SET search_path = ''. Assert the invariant
-- here so a later function replacement cannot silently weaken the definer.
do $$
declare
  function_config text[];
begin
  select proconfig into function_config
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname = 'contract_document_review_details_valid'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_details jsonb';

  if function_config is null
    or not ('search_path=""' = any(function_config)) then
    raise exception 'review detail validator must keep an empty search_path';
  end if;
end;
$$;
