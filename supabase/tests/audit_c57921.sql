begin;
select plan(15);

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

alter table public.audit_events disable trigger audit_events_immutable;
update public.audit_events set entity_label = 'tampered for verification test' where id = (select event_id from c57921_fixture);
select is(
  (select count(*) from public.verify_audit_chain((select sequence_no from c57921_fixture), (select sequence_no from c57921_fixture)) where not valid),
  1::bigint,
  'database detects a modified event inside a bounded verification range'
);
update public.audit_events set entity_label = 'C-579/21 test' where id = (select event_id from c57921_fixture);
alter table public.audit_events enable trigger audit_events_immutable;

select ok(
  not has_function_privilege('anon', 'public.append_audit_event(text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,uuid,text,text,text[],inet,text,text,text,uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.append_audit_event(text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,uuid,text,text,text[],inet,text,text,text,uuid[])', 'EXECUTE'),
  'browser roles cannot call the privileged append function'
);

select ok(
  not has_function_privilege('anon', 'public.register_subject_access_export(uuid,text,text,integer,boolean,uuid,timestamptz,text,text,text,bigint,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.register_subject_access_export(uuid,text,text,integer,boolean,uuid,timestamptz,text,text,text,bigint,text)', 'EXECUTE'),
  'browser roles cannot register subject access exports'
);

select ok(
  not has_table_privilege('authenticated', 'public.subject_access_requests', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.audit_siem_outbox', 'SELECT,INSERT,UPDATE,DELETE'),
  'SAR workflow and SIEM delivery state are server-only'
);

do $$
declare
  request_id uuid := gen_random_uuid();
  generator_id uuid := gen_random_uuid();
  export_id uuid;
begin
  insert into public.subject_access_requests(
    id, org_id, target_member_uuid, status, mask_staff_names, created_by
  ) values (
    request_id, gen_random_uuid(), gen_random_uuid(), 'approved', true, generator_id
  );
  export_id := public.register_subject_access_export(
    request_id, 'json', repeat('a', 64), 1, true, generator_id, now() + interval '24 hours',
    'subject-access-exports', concat(gen_random_uuid(), '/test.json'), 'application/json', 123, 'object-version-test'
  );
  if export_id is null
    or not exists (select 1 from public.subject_access_exports where id = export_id and mask_staff_names)
    or not exists (select 1 from public.subject_access_requests where id = request_id and status = 'generated')
  then
    raise exception 'Atomic subject access export registration failed';
  end if;
end $$;
select pass('subject access export metadata and request status are registered atomically');

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

select ok(
  exists (select 1 from storage.buckets where id = 'subject-access-exports' and not public),
  'subject access exports use a private storage bucket'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_governance_decisions', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.audit_retention_signatures', 'SELECT,INSERT,UPDATE,DELETE'),
  'governance and KMS signature evidence are server-only'
);

do $$
declare proposal uuid; proposer uuid := gen_random_uuid(); blocked boolean := false;
begin
  proposal := public.propose_audit_governance_decision(
    null, 'retention_change', proposer, 'jurist',
    'Syv års retention er godkendt efter dokumenteret juridisk vurdering.',
    'GDPR Art. 5(2), 24 og 32', 7, null, null, null
  );
  begin
    perform public.decide_audit_governance_decision(proposal, true, proposer, 'superadmin');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'Same person bypassed four-eyes approval'; end if;
  perform public.decide_audit_governance_decision(proposal, true, gen_random_uuid(), 'superadmin');
  perform public.effect_audit_governance_decision(proposal);
  if not exists (
    select 1 from public.audit_governance_decisions
    where id = proposal
      and status = 'effected'
      and decision_hash is not null
      and approval_hash is not null
      and effect_hash is not null
  ) then
    raise exception 'Approved decision was not effected';
  end if;
end $$;
select pass('retention governance enforces four eyes before effectuation');

select ok(
  not has_table_privilege('service_role', 'public.audit_control_settings', 'UPDATE')
  and has_function_privilege('service_role', 'public.update_audit_delivery_settings(boolean,text,text,text,uuid)', 'EXECUTE'),
  'retention cannot be changed through direct service-role updates'
);

do $$
declare created_certificate_id uuid := gen_random_uuid();
begin
  insert into public.audit_retention_certificates(
    id,first_sequence,last_sequence,event_count,first_chain_hash,last_chain_hash,certificate_hash,retention_years
  ) values (created_certificate_id,900001,900001,1,repeat('1',64),repeat('2',64),encode(gen_random_bytes(32),'hex'),7);
  if not exists (select 1 from public.audit_retention_signature_queue queue where queue.certificate_id = created_certificate_id and status = 'pending') then
    raise exception 'Retention certificate was not queued for signing';
  end if;
end $$;
select pass('retention deletion certificates are queued for KMS signing');

select * from finish();
rollback;
