begin;

select plan(1);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contracts'
      and column_name = 'original_view_pdf_url' and data_type = 'text'
  ) then
    raise exception 'contracts.original_view_pdf_url mangler';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contract_document_jobs'
      and column_name = 'original_view_storage_path' and data_type = 'text'
  ) then
    raise exception 'contract_document_jobs.original_view_storage_path mangler';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'finish_contract_document_job_v9'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'Browserrollen må ikke afslutte dokumentjobs';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'finish_contract_document_job_v9'
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception 'Service-rollen skal kunne afslutte version 9-dokumentjobs';
  end if;
end $$;

select pass('Word-visnings-PDF har særskilt skema og service-only completion');
select * from finish();

rollback;
