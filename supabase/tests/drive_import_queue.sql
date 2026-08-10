begin;
select plan(6);

create temporary table drive_import_fixture (run_id uuid, folder_id uuid, item_id uuid);

do $$
declare
  actor_id uuid := gen_random_uuid();
  org_id uuid;
  connection_id uuid;
  source_id uuid;
  batch_id uuid;
  run_id uuid;
  folder_id uuid;
  item_id uuid;
begin
  insert into auth.users(id,email,aud,role,created_at,updated_at)
    values (actor_id,'drive-import@example.invalid','authenticated','authenticated',now(),now());
  insert into public.organisations(name) values ('Drive import test') returning id into org_id;
  insert into public.import_connections(org_id,provider,display_name,credentials_encrypted,created_by,connection_kind)
    values (org_id,'google_drive','Test Drive','encrypted',actor_id,'organisation') returning id into connection_id;
  insert into public.import_sources(org_id,connection_id,import_type,provider_folder_id,display_name,auto_sync)
    values (org_id,connection_id,'contracts','root','Testmappe',false) returning id into source_id;
  insert into public.contract_import_batches(org_id,created_by,source,connection_id,status)
    values (org_id,actor_id,'google_drive',connection_id,'processing') returning id into batch_id;
  insert into public.drive_import_runs(org_id,connection_id,source_id,batch_id,connection_kind,started_by,root_folder_id)
    values (org_id,connection_id,source_id,batch_id,'organisation',actor_id,'root') returning id into run_id;
  insert into public.drive_import_folders(run_id,provider_folder_id) values (run_id,'root') returning id into folder_id;
  insert into public.drive_import_queue_items(run_id,provider_file_id,provider_revision,file_name)
    values (run_id,'file-1','rev-1','kontrakt.pdf') returning id into item_id;
  insert into drive_import_fixture values (run_id,folder_id,item_id);
end $$;

select is((select count(*) from public.claim_drive_import_folder((select run_id from drive_import_fixture))), 1::bigint, 'servicekontekst claimer én mappe');
select is((select status from public.drive_import_folders where id = (select folder_id from drive_import_fixture)), 'processing', 'mappen markeres som processing');
select is((select attempts from public.drive_import_folders where id = (select folder_id from drive_import_fixture)), 1, 'mappeclaim øger forsøg');
select is((select count(*) from public.claim_drive_import_item((select run_id from drive_import_fixture))), 1::bigint, 'servicekontekst claimer én fil');
select is((select status from public.drive_import_queue_items where id = (select item_id from drive_import_fixture)), 'processing', 'filen markeres som processing');
select ok(
  not has_function_privilege('authenticated','public.claim_drive_import_folder(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_drive_import_item(uuid)','EXECUTE'),
  'browserrollen kan ikke claime drevimport'
);

select * from finish();
rollback;
