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
  if has_function_privilege(
    'authenticated',
    'public.finish_contract_document_job_v6(uuid,uuid,text,text,text,jsonb,boolean,integer,integer,integer,integer,integer,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Browserrollen må ikke afslutte dokumentjobs';
  end if;
end $$;

select pass('Word-visnings-PDF har særskilt skema og service-only completion');
select * from finish();

rollback;
