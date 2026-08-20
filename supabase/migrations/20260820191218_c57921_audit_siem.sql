-- C-579/21 support: tamper-evident access logging, SIEM delivery and
-- data-subject access request (SAR) workflows. Audit payloads remain append-only;
-- mutable delivery/workflow state is deliberately stored in separate tables.

alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'create','update','delete','archive','restore','validate','approve','merge','link','unlink',
  'invite','reset_link','export','download','import','sync','job','security_failure','retention',
  'require_onboarding','cancel_onboarding','complete_onboarding',
  'read','search','ai_analysis','sar_export','siem_delivery','security_review'
));
alter table public.audit_events
  add column if not exists target_member_uuid uuid,
  add column if not exists purpose_code text,
  add column if not exists legal_basis text,
  add column if not exists data_categories text[] not null default '{}'::text[],
  add column if not exists ip_address inet,
  add column if not exists system_component text,
  add column if not exists outcome text not null default 'success',
  add column if not exists error_code text,
  add column if not exists schema_version smallint not null default 1,
  add column if not exists sequence_no bigint,
  add column if not exists previous_hash bytea,
  add column if not exists payload_hash bytea,
  add column if not exists chain_hash bytea;
alter table public.audit_events
  add constraint audit_events_purpose_code_length check (purpose_code is null or char_length(purpose_code) between 1 and 80),
  add constraint audit_events_system_component_length check (system_component is null or char_length(system_component) between 1 and 120),
  add constraint audit_events_outcome_check check (outcome in ('success','denied','failed','partial')),
  add constraint audit_events_schema_version_check check (schema_version between 1 and 100);
create index if not exists audit_events_target_member_occurred_idx
  on public.audit_events (target_member_uuid, occurred_at desc, id desc)
  where target_member_uuid is not null;
create index if not exists audit_events_purpose_occurred_idx
  on public.audit_events (purpose_code, occurred_at desc)
  where purpose_code is not null;
create index if not exists audit_events_component_occurred_idx
  on public.audit_events (system_component, occurred_at desc)
  where system_component is not null;
-- Best-effort member backfill. The column intentionally has no foreign key so
-- the audit trail survives later account/member deletion.
drop trigger if exists audit_events_immutable on public.audit_events;
update public.audit_events event
set target_member_uuid = private.audit_safe_uuid(event.entity_id)
where event.target_member_uuid is null
  and event.entity_type = 'rettighedshavere'
  and private.audit_safe_uuid(event.entity_id) is not null;
update public.audit_events event
set target_member_uuid = contract.rights_holder_id
from public.contracts contract
where event.target_member_uuid is null
  and event.entity_type = 'contracts'
  and private.audit_safe_uuid(event.entity_id) = contract.id
  and contract.rights_holder_id is not null;
create table if not exists private.audit_chain_state (
  singleton boolean primary key default true check (singleton),
  next_sequence bigint not null default 1,
  last_chain_hash bytea,
  updated_at timestamptz not null default now()
);
revoke all on private.audit_chain_state from public, anon, authenticated, service_role;
create or replace function private.audit_payload_digest(row_data jsonb)
returns bytea
language sql immutable
set search_path = extensions, pg_catalog
as $$
  select extensions.digest(
    convert_to((row_data - array['previous_hash','payload_hash','chain_hash'])::text, 'UTF8'),
    'sha256'
  );
$$;
revoke all on function private.audit_payload_digest(jsonb) from public, anon, authenticated, service_role;
do $$
declare
  event_row record;
  current_sequence bigint := 0;
  prior_hash bytea := null;
  current_payload bytea;
  current_chain bytea;
begin
  for event_row in
    select id from public.audit_events order by occurred_at, id
  loop
    current_sequence := current_sequence + 1;
    update public.audit_events
    set sequence_no = current_sequence, previous_hash = prior_hash
    where id = event_row.id;

    select private.audit_payload_digest(to_jsonb(event))
      into current_payload
      from public.audit_events event
      where event.id = event_row.id;
    current_chain := extensions.digest(coalesce(prior_hash, ''::bytea) || current_payload, 'sha256');

    update public.audit_events
    set payload_hash = current_payload, chain_hash = current_chain
    where id = event_row.id;
    prior_hash := current_chain;
  end loop;

  insert into private.audit_chain_state(singleton, next_sequence, last_chain_hash, updated_at)
  values (true, current_sequence + 1, prior_hash, now())
  on conflict (singleton) do update
  set next_sequence = excluded.next_sequence,
      last_chain_hash = excluded.last_chain_hash,
      updated_at = excluded.updated_at;
end $$;
alter table public.audit_events
  alter column sequence_no set not null,
  alter column payload_hash set not null,
  alter column chain_hash set not null;
create unique index if not exists audit_events_sequence_no_key on public.audit_events(sequence_no);
create unique index if not exists audit_events_chain_hash_key on public.audit_events(chain_hash);
create or replace function private.prepare_audit_event_integrity()
returns trigger
language plpgsql security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  chain_state private.audit_chain_state%rowtype;
begin
  select * into chain_state
  from private.audit_chain_state
  where singleton = true
  for update;

  if not found then
    raise exception 'Audit chain state is unavailable';
  end if;

  new.sequence_no := chain_state.next_sequence;
  new.previous_hash := chain_state.last_chain_hash;
  new.payload_hash := private.audit_payload_digest(to_jsonb(new));
  new.chain_hash := extensions.digest(
    coalesce(new.previous_hash, ''::bytea) || new.payload_hash,
    'sha256'
  );

  update private.audit_chain_state
  set next_sequence = chain_state.next_sequence + 1,
      last_chain_hash = new.chain_hash,
      updated_at = now()
  where singleton = true;
  return new;
end;
$$;
revoke all on function private.prepare_audit_event_integrity() from public, anon, authenticated, service_role;
drop trigger if exists audit_events_prepare_integrity on public.audit_events;
create trigger audit_events_prepare_integrity
before insert on public.audit_events
for each row execute function private.prepare_audit_event_integrity();
-- Delivery state is mutable and therefore separate from the audit record.
create table public.audit_siem_outbox (
  event_id uuid primary key references public.audit_events(id) on delete cascade,
  sequence_no bigint not null unique,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','dead_letter')),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  batch_id uuid,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_siem_outbox_delivery_idx
  on public.audit_siem_outbox (status, available_at, sequence_no);
alter table public.audit_siem_outbox enable row level security;
revoke all on public.audit_siem_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.audit_siem_outbox to service_role;
create or replace function private.enqueue_audit_event_for_siem()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.audit_siem_outbox(event_id, sequence_no)
  values (new.id, new.sequence_no)
  on conflict (event_id) do nothing;
  return new;
end;
$$;
revoke all on function private.enqueue_audit_event_for_siem() from public, anon, authenticated, service_role;
drop trigger if exists audit_events_enqueue_siem on public.audit_events;
create trigger audit_events_enqueue_siem
after insert on public.audit_events
for each row execute function private.enqueue_audit_event_for_siem();
insert into public.audit_siem_outbox(event_id, sequence_no, status)
select id, sequence_no, 'pending' from public.audit_events
on conflict (event_id) do nothing;
create table public.audit_siem_receipts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique,
  first_sequence bigint not null,
  last_sequence bigint not null,
  event_count integer not null check (event_count > 0),
  adapter text not null,
  destination_fingerprint text not null,
  key_id text not null,
  signature_algorithm text not null,
  envelope_hash text not null,
  remote_receipt_id text,
  delivered_at timestamptz not null default now()
);
create index audit_siem_receipts_delivered_idx on public.audit_siem_receipts(delivered_at desc);
alter table public.audit_siem_receipts enable row level security;
revoke all on public.audit_siem_receipts from public, anon, authenticated;
grant select, insert on public.audit_siem_receipts to service_role;
create table public.subject_access_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  target_member_uuid uuid not null,
  target_member_label text,
  date_from timestamptz,
  date_to timestamptz,
  data_categories text[] not null default '{}'::text[],
  status text not null default 'draft' check (status in ('draft','review','approved','rejected','generated','delivered','expired')),
  mask_staff_names boolean not null default true,
  balancing_reason text,
  created_by uuid not null,
  reviewed_by uuid,
  approved_by uuid,
  reviewed_at timestamptz,
  approved_at timestamptz,
  delivered_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_to is null or date_from is null or date_to >= date_from),
  check (mask_staff_names or (approved_by is not null and nullif(trim(balancing_reason), '') is not null))
);
create index subject_access_requests_org_created_idx
  on public.subject_access_requests(org_id, created_at desc);
create index subject_access_requests_member_created_idx
  on public.subject_access_requests(target_member_uuid, created_at desc);
alter table public.subject_access_requests enable row level security;
revoke all on public.subject_access_requests from public, anon, authenticated;
grant select, insert, update on public.subject_access_requests to service_role;
create table public.subject_access_exports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.subject_access_requests(id) on delete cascade,
  format text not null check (format in ('json','csv','pdf')),
  content_hash text not null,
  row_count integer not null check (row_count >= 0),
  mask_staff_names boolean not null,
  generated_by uuid not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (request_id, format, content_hash)
);
create index subject_access_exports_expiry_idx on public.subject_access_exports(expires_at);
alter table public.subject_access_exports enable row level security;
revoke all on public.subject_access_exports from public, anon, authenticated;
grant select, insert on public.subject_access_exports to service_role;
create table public.audit_control_settings (
  singleton boolean primary key default true check (singleton),
  retention_years integer not null default 7 check (retention_years between 1 and 30),
  mask_staff_names_default boolean not null default true check (mask_staff_names_default),
  siem_enabled boolean not null default false,
  siem_adapter text not null default 'generic' check (siem_adapter in ('generic','splunk','sentinel','elastic')),
  siem_destination_label text,
  kms_key_id text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.audit_control_settings(singleton) values (true) on conflict do nothing;
alter table public.audit_control_settings enable row level security;
revoke all on public.audit_control_settings from public, anon, authenticated;
grant select, update on public.audit_control_settings to service_role;
create table public.audit_retention_certificates (
  id uuid primary key default gen_random_uuid(),
  first_sequence bigint not null,
  last_sequence bigint not null,
  event_count integer not null check (event_count > 0),
  first_chain_hash text not null,
  last_chain_hash text not null,
  certificate_hash text not null unique,
  retention_years integer not null,
  created_at timestamptz not null default now()
);
alter table public.audit_retention_certificates enable row level security;
revoke all on public.audit_retention_certificates from public, anon, authenticated;
grant select, insert on public.audit_retention_certificates to service_role;
create or replace function private.guard_audit_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_setting('dfks.audit_retention', true) = 'on' and tg_op = 'DELETE' then return old; end if;
  raise exception 'Audit records are append-only';
end;
$$;
create trigger audit_events_immutable before update or delete on public.audit_events
for each row execute function private.guard_audit_immutability();
create trigger audit_siem_receipts_immutable before update or delete on public.audit_siem_receipts
for each row execute function private.guard_audit_immutability();
create trigger audit_retention_certificates_immutable before update or delete on public.audit_retention_certificates
for each row execute function private.guard_audit_immutability();
-- Server-only append API. SECURITY DEFINER is required because service_role has
-- no direct INSERT privilege; execution is explicitly revoked from browser roles.
create or replace function public.append_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_entity_label text default null,
  p_actor_user_id uuid default null,
  p_actor_display_name text default null,
  p_actor_email text default null,
  p_actor_role text default null,
  p_actor_type text default 'system',
  p_actor_org_id uuid default null,
  p_source text default 'api',
  p_correlation_id uuid default null,
  p_request_id text default null,
  p_changes jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_missing_actor_context boolean default false,
  p_target_member_uuid uuid default null,
  p_purpose_code text default null,
  p_legal_basis text default null,
  p_data_categories text[] default '{}'::text[],
  p_ip_address inet default null,
  p_system_component text default null,
  p_outcome text default 'success',
  p_error_code text default null,
  p_org_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql security definer
set search_path = public, private, pg_catalog
as $$
declare
  created_event_id uuid;
  scope_org uuid;
begin
  insert into public.audit_events (
    action, entity_type, entity_id, entity_label, actor_user_id, actor_display_name,
    actor_email, actor_role, actor_type, actor_org_id, source, correlation_id,
    request_id, changes, metadata, missing_actor_context, target_member_uuid,
    purpose_code, legal_basis, data_categories, ip_address, system_component,
    outcome, error_code
  ) values (
    p_action, p_entity_type, p_entity_id, p_entity_label, p_actor_user_id, p_actor_display_name,
    p_actor_email, p_actor_role, p_actor_type, p_actor_org_id, p_source, p_correlation_id,
    p_request_id, p_changes, p_metadata, p_missing_actor_context, p_target_member_uuid,
    p_purpose_code, p_legal_basis, coalesce(p_data_categories, '{}'::text[]), p_ip_address,
    p_system_component, p_outcome, p_error_code
  ) returning id into created_event_id;

  foreach scope_org in array (
    select coalesce(array_agg(distinct value), '{}'::uuid[])
    from unnest(coalesce(p_org_ids, '{}'::uuid[]) || array[p_actor_org_id]) value
    where value is not null
  ) loop
    insert into public.audit_event_organisations(event_id, org_id)
    values (created_event_id, scope_org)
    on conflict do nothing;
  end loop;
  return created_event_id;
end;
$$;
revoke all on function public.append_audit_event(
  text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,
  uuid,text,text,text[],inet,text,text,text,uuid[]
) from public, anon, authenticated;
grant execute on function public.append_audit_event(
  text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,
  uuid,text,text,text[],inet,text,text,text,uuid[]
) to service_role;
revoke insert, update, delete on public.audit_events, public.audit_event_organisations from service_role;
create or replace function public.verify_audit_chain(p_from_sequence bigint default null, p_to_sequence bigint default null)
returns table(sequence_no bigint, event_id uuid, valid boolean)
language sql security definer
set search_path = public, private, extensions, pg_catalog
as $$
  with chained as (
    select event.*,
           to_jsonb(event) as row_data,
           lag(event.sequence_no) over (order by event.sequence_no) as prior_sequence_no,
           lag(event.chain_hash) over (order by event.sequence_no) as prior_chain_hash
    from public.audit_events event
  )
  select event.sequence_no,
         event.id,
         event.payload_hash = private.audit_payload_digest(event.row_data)
           and event.chain_hash = extensions.digest(coalesce(event.previous_hash, ''::bytea) || event.payload_hash, 'sha256')
           and case
             when event.prior_sequence_no is not null then
               event.sequence_no = event.prior_sequence_no + 1
               and event.previous_hash = event.prior_chain_hash
             else
               event.previous_hash is null
               or exists (
                 select 1
                 from public.audit_retention_certificates certificate
                 where certificate.last_sequence = event.sequence_no - 1
                   and certificate.last_chain_hash = encode(event.previous_hash, 'hex')
               )
           end as valid
  from chained event
  where (p_from_sequence is null or event.sequence_no >= p_from_sequence)
    and (p_to_sequence is null or event.sequence_no <= p_to_sequence)
  order by event.sequence_no;
$$;
revoke all on function public.verify_audit_chain(bigint,bigint) from public, anon, authenticated;
grant execute on function public.verify_audit_chain(bigint,bigint) to service_role;
create or replace function public.claim_audit_siem_batch(p_limit integer default 100)
returns table(event_id uuid, sequence_no bigint, event_payload jsonb, batch_id uuid)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  claimed_batch uuid := gen_random_uuid();
begin
  if p_limit < 1 or p_limit > 500 then raise exception 'Invalid SIEM batch size'; end if;
  update public.audit_siem_outbox
  set status = case when attempts >= 10 then 'dead_letter' else 'failed' end,
      available_at = now(),
      batch_id = null,
      last_error_code = 'stale_processing_claim',
      last_error_at = now(),
      updated_at = now()
  where status = 'processing'
    and claimed_at < now() - interval '15 minutes';

  return query
  with candidates as (
    select outbox.event_id
    from public.audit_siem_outbox outbox
    where outbox.status in ('pending','failed')
      and outbox.available_at <= now()
      and outbox.attempts < 10
    order by outbox.sequence_no
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.audit_siem_outbox outbox
    set status = 'processing',
        attempts = attempts + 1,
        claimed_at = now(),
        batch_id = claimed_batch,
        updated_at = now()
    from candidates
    where outbox.event_id = candidates.event_id
    returning outbox.event_id, outbox.sequence_no
  )
  select claimed.event_id,
         claimed.sequence_no,
         to_jsonb(event) - array['actor_display_name','actor_email','ip_address'],
         claimed_batch
  from claimed
  join public.audit_events event on event.id = claimed.event_id
  order by claimed.sequence_no;
end;
$$;
revoke all on function public.claim_audit_siem_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_audit_siem_batch(integer) to service_role;
create or replace function public.complete_audit_siem_batch(
  p_batch_id uuid,
  p_success boolean,
  p_error_code text default null,
  p_adapter text default null,
  p_destination_fingerprint text default null,
  p_key_id text default null,
  p_signature_algorithm text default null,
  p_envelope_hash text default null,
  p_remote_receipt_id text default null
)
returns integer
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  affected integer;
  first_sequence_value bigint;
  last_sequence_value bigint;
begin
  if p_success then
    if p_adapter is null or p_destination_fingerprint is null or p_key_id is null
       or p_signature_algorithm is null or p_envelope_hash is null then
      raise exception 'Successful SIEM delivery requires a complete receipt';
    end if;
    select min(sequence_no), max(sequence_no), count(*)::integer
    into first_sequence_value, last_sequence_value, affected
    from public.audit_siem_outbox where batch_id = p_batch_id and status = 'processing';
    if coalesce(affected, 0) = 0 then return 0; end if;
    insert into public.audit_siem_receipts(
      batch_id, first_sequence, last_sequence, event_count, adapter,
      destination_fingerprint, key_id, signature_algorithm, envelope_hash,
      remote_receipt_id
    ) values (
      p_batch_id, first_sequence_value, last_sequence_value, affected, p_adapter,
      p_destination_fingerprint, p_key_id, p_signature_algorithm, p_envelope_hash,
      p_remote_receipt_id
    ) on conflict (batch_id) do nothing;
    update public.audit_siem_outbox
    set status = 'delivered', delivered_at = now(), updated_at = now(), last_error_code = null
    where batch_id = p_batch_id and status = 'processing';
  else
    update public.audit_siem_outbox
    set status = case when attempts >= 10 then 'dead_letter' else 'failed' end,
        available_at = now() + make_interval(secs => least(3600, (power(2, least(attempts, 8)) * 15)::integer)),
        last_error_code = left(coalesce(p_error_code, 'delivery_failed'), 120),
        last_error_at = now(),
        updated_at = now()
    where batch_id = p_batch_id and status = 'processing';
    get diagnostics affected = row_count;
  end if;
  return affected;
end;
$$;
revoke all on function public.complete_audit_siem_batch(uuid,boolean,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.complete_audit_siem_batch(uuid,boolean,text,text,text,text,text,text,text) to service_role;
create or replace function public.register_subject_access_export(
  p_request_id uuid,
  p_format text,
  p_content_hash text,
  p_row_count integer,
  p_mask_staff_names boolean,
  p_generated_by uuid,
  p_expires_at timestamptz
)
returns uuid
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  export_id uuid;
  request_mask_staff_names boolean;
  request_status text;
begin
  if p_format not in ('json','csv','pdf') then raise exception 'Unsupported subject access export format'; end if;
  if p_row_count < 0 then raise exception 'Invalid subject access export row count'; end if;
  if p_generated_by is null then raise exception 'Export generator is required'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '48 hours' then
    raise exception 'Subject access export expiry must be within 48 hours';
  end if;

  select mask_staff_names, status
  into request_mask_staff_names, request_status
  from public.subject_access_requests
  where id = p_request_id
  for update;

  if not found or request_status not in ('approved','generated','delivered') then
    raise exception 'Subject access request is not exportable';
  end if;
  if p_mask_staff_names is distinct from request_mask_staff_names then
    raise exception 'Export masking must match the approved subject access request';
  end if;

  insert into public.subject_access_exports(
    request_id, format, content_hash, row_count, mask_staff_names,
    generated_by, expires_at
  ) values (
    p_request_id, p_format, p_content_hash, p_row_count, p_mask_staff_names,
    p_generated_by, p_expires_at
  )
  on conflict (request_id, format, content_hash) do update
  set expires_at = greatest(subject_access_exports.expires_at, excluded.expires_at)
  returning id into export_id;

  update public.subject_access_requests
  set status = case when status = 'delivered' then 'delivered' else 'generated' end,
      updated_at = now()
  where id = p_request_id;
  return export_id;
end;
$$;
revoke all on function public.register_subject_access_export(uuid,text,text,integer,boolean,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.register_subject_access_export(uuid,text,text,integer,boolean,uuid,timestamptz) to service_role;
create or replace function public.purge_expired_audit_events(
  retention interval default interval '7 years',
  batch_size integer default 10000
)
returns integer
language plpgsql security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  deleted_count integer;
  first_sequence_value bigint;
  last_sequence_value bigint;
  first_hash text;
  last_hash text;
  retention_years_value integer;
  certificate_payload text;
begin
  if retention < interval '1 year' then raise exception 'Audit retention cannot be shorter than one year'; end if;
  if batch_size < 1 or batch_size > 50000 then raise exception 'Invalid audit purge batch size'; end if;

  create temporary table audit_expired_batch on commit drop as
  select id, sequence_no, chain_hash
  from public.audit_events
  where occurred_at < now() - retention
  order by sequence_no
  limit batch_size;

  select min(sequence_no), max(sequence_no), count(*)::integer,
         encode((array_agg(chain_hash order by sequence_no))[1], 'hex'),
         encode((array_agg(chain_hash order by sequence_no desc))[1], 'hex')
  into first_sequence_value, last_sequence_value, deleted_count, first_hash, last_hash
  from audit_expired_batch;

  if coalesce(deleted_count, 0) = 0 then return 0; end if;
  retention_years_value := greatest(1, round(extract(epoch from retention) / 31557600)::integer);
  certificate_payload := concat_ws(':', first_sequence_value, last_sequence_value, deleted_count, first_hash, last_hash, retention_years_value);
  insert into public.audit_retention_certificates(
    first_sequence, last_sequence, event_count, first_chain_hash, last_chain_hash,
    certificate_hash, retention_years
  ) values (
    first_sequence_value, last_sequence_value, deleted_count, first_hash, last_hash,
    encode(extensions.digest(certificate_payload, 'sha256'), 'hex'), retention_years_value
  );

  perform set_config('dfks.audit_retention', 'on', true);
  delete from public.audit_events event
  using audit_expired_batch batch
  where event.id = batch.id;
  return deleted_count;
end;
$$;
revoke all on function public.purge_expired_audit_events(interval,integer) from public, anon, authenticated;
grant execute on function public.purge_expired_audit_events(interval,integer) to service_role;
comment on table public.audit_events is
  'Append-only and hash-chained audit trail for data access and business changes. Mutable SIEM/SAR workflow state is stored separately.';
comment on column public.audit_events.ip_address is
  'Trusted proxy-derived network address. Personal data; excluded from member exports by default.';
