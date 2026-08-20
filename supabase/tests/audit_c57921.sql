begin;
select plan(7);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_events' and column_name = 'target_member_uuid')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_events' and column_name = 'chain_hash'),
  'audit events contain member scope and tamper-evident integrity fields'
);

create temporary table c57921_fixture(event_id uuid, sequence_no bigint, chain_hash bytea);
do $$
declare inserted public.audit_events%rowtype;
begin
  insert into public.audit_events(action,entity_type,entity_label,source,purpose_code,system_component)
  values ('read','contracts','C-579/21 test','database','contract_case_management','test.audit')
  returning * into inserted;
  insert into c57921_fixture values (inserted.id, inserted.sequence_no, inserted.chain_hash);
end $$;

select ok(
  (select sequence_no > 0 and chain_hash is not null from c57921_fixture),
  'new audit event is assigned a sequence and chain hash'
);

select is(
  (select count(*) from public.audit_siem_outbox where event_id = (select event_id from c57921_fixture)),
  1::bigint,
  'audit event and SIEM outbox message are created together'
);

select is(
  (select count(*) from public.verify_audit_chain((select sequence_no from c57921_fixture), (select sequence_no from c57921_fixture)) where valid),
  1::bigint,
  'database verifies the event hash chain'
);

select ok(
  not has_function_privilege('anon', 'public.append_audit_event(text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,uuid,text,text,text[],inet,text,text,text,uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.append_audit_event(text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,uuid,text,text,text[],inet,text,text,text,uuid[])', 'EXECUTE'),
  'browser roles cannot call the privileged append function'
);

select ok(
  not has_table_privilege('authenticated', 'public.subject_access_requests', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.audit_siem_outbox', 'SELECT,INSERT,UPDATE,DELETE'),
  'SAR workflow and SIEM delivery state are server-only'
);

do $$
declare blocked boolean := false;
begin
  begin
    update public.audit_events set entity_label = 'tampered' where id = (select event_id from c57921_fixture);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Audit event could be modified'; end if;
end $$;
select pass('audit events remain append-only');

select * from finish();
rollback;
