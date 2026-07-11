-- Deterministic, data-free schema fingerprint for baseline verification.
-- Compare the output from --linked and --local.

with fingerprints as (
  select
    'columns'::text as category,
    table_schema || '.' || table_name || '.' || column_name || ':' ||
    data_type || ':' || coalesce(udt_schema, '') || '.' || coalesce(udt_name, '') || ':' ||
    is_nullable || ':' || coalesce(column_default, '') || ':' || ordinal_position::text as item
  from information_schema.columns
  where table_schema in ('public', 'private')

  union all

  select
    'constraints',
    namespace_row.nspname || '.' || table_row.relname || '.' || constraint_row.conname || ':' ||
    constraint_row.contype::text || ':' || pg_get_constraintdef(constraint_row.oid, true)
  from pg_constraint constraint_row
  join pg_class table_row on table_row.oid = constraint_row.conrelid
  join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
  where namespace_row.nspname in ('public', 'private')

  union all

  select
    'functions',
    namespace_row.nspname || '.' || function_row.proname || '(' ||
    pg_get_function_identity_arguments(function_row.oid) || '):' ||
    pg_get_function_result(function_row.oid) || ':' ||
    function_row.prosecdef::text || ':' || coalesce(array_to_string(function_row.proconfig, ','), '') || ':' ||
    regexp_replace(pg_get_functiondef(function_row.oid), E'\\s+', ' ', 'g')
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname in ('public', 'private')
    and function_row.prokind = 'f'

  union all

  select
    'indexes',
    schemaname || '.' || indexname || ':' || regexp_replace(indexdef, E'\\s+', ' ', 'g')
  from pg_indexes
  where schemaname in ('public', 'private')

  union all

  select
    'triggers',
    event_object_schema || '.' || event_object_table || '.' || trigger_name || ':' ||
    action_timing || ':' || event_manipulation || ':' ||
    regexp_replace(action_statement, E'\\s+', ' ', 'g')
  from information_schema.triggers
  where event_object_schema in ('public', 'private')

  union all

  select
    'rls_flags',
    namespace_row.nspname || '.' || table_row.relname || ':' ||
    table_row.relrowsecurity::text || ':' || table_row.relforcerowsecurity::text
  from pg_class table_row
  join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
  where namespace_row.nspname in ('public', 'private')
    and table_row.relkind in ('r', 'p')

  union all

  select
    'policies',
    schemaname || '.' || tablename || '.' || policyname || ':' || permissive || ':' ||
    array_to_string(roles, ',') || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
  from pg_policies
  where schemaname in ('public', 'private')

  union all

  select
    'table_grants',
    table_schema || '.' || table_name || ':' || grantee || ':' || privilege_type || ':' || is_grantable
  from information_schema.role_table_grants
  where table_schema in ('public', 'private')

  union all

  select
    'routine_grants',
    routine_schema || '.' || routine_name || ':' || grantee || ':' || privilege_type || ':' || is_grantable
  from information_schema.role_routine_grants
  where routine_schema in ('public', 'private')
)
select
  category,
  count(*) as item_count,
  md5(string_agg(item, E'\n' order by item)) as fingerprint
from fingerprints
group by category
order by category;
