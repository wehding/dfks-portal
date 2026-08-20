-- Production evidence controls for the C-579/21 audit trail.
-- Mutable operational state is kept separate from immutable evidence records.

alter table public.audit_control_settings drop constraint if exists audit_control_settings_siem_adapter_check;
alter table public.audit_control_settings add constraint audit_control_settings_siem_adapter_check
  check (siem_adapter in ('google_native','generic','splunk','sentinel','elastic'));
update public.audit_control_settings set siem_adapter = 'google_native' where singleton = true and siem_adapter = 'generic';

alter table public.audit_siem_receipts
  add column if not exists worm_bucket text,
  add column if not exists worm_object text,
  add column if not exists worm_generation text,
  add column if not exists worm_checksum_crc32c text,
  add column if not exists worm_created_at timestamptz,
  add column if not exists kms_key_version text,
  add column if not exists verified_at timestamptz,
  add column if not exists cloud_run_revision text;

alter table public.subject_access_exports
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists byte_size bigint,
  add column if not exists storage_generation text,
  add column if not exists deleted_at timestamptz,
  add column if not exists last_link_issued_at timestamptz;
alter table public.subject_access_exports
  add constraint subject_access_exports_storage_check check (
    (storage_bucket is null and storage_path is null)
    or (storage_bucket = 'subject-access-exports' and nullif(storage_path, '') is not null)
  ),
  add constraint subject_access_exports_size_check check (byte_size is null or byte_size >= 0);
create unique index if not exists subject_access_exports_storage_path_key
  on public.subject_access_exports(storage_bucket, storage_path)
  where storage_path is not null;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'subject-access-exports',
  'subject-access-exports',
  false,
  52428800,
  array['application/pdf','application/json','text/csv']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- There are intentionally no authenticated storage.objects policies for this
-- bucket. All access is brokered server-side through short-lived signed URLs.

create table public.audit_governance_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  decision_type text not null check (decision_type in ('retention_change','staff_unmasking')),
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','effected')),
  proposed_by uuid not null,
  proposer_role text not null check (proposer_role = 'jurist'),
  proposed_at timestamptz not null default now(),
  reason text not null check (char_length(trim(reason)) between 20 and 4000),
  legal_basis text not null check (char_length(trim(legal_basis)) between 3 and 500),
  retention_years integer check (retention_years between 1 and 30),
  subject_access_request_id uuid references public.subject_access_requests(id),
  date_from timestamptz,
  date_to timestamptz,
  approved_by uuid,
  approver_role text check (approver_role is null or approver_role = 'superadmin'),
  decided_at timestamptz,
  effected_at timestamptz,
  decision_hash text not null unique,
  approval_hash text unique,
  effect_hash text unique,
  check (date_to is null or date_from is null or date_to >= date_from),
  check (
    (decision_type = 'retention_change' and retention_years is not null and subject_access_request_id is null)
    or
    (decision_type = 'staff_unmasking' and retention_years is null and subject_access_request_id is not null)
  ),
  check (approved_by is null or approved_by <> proposed_by),
  check (
    (status = 'proposed' and approved_by is null and decided_at is null and effected_at is null)
    or (status in ('approved','rejected') and approved_by is not null and decided_at is not null and effected_at is null)
    or (status = 'effected' and approved_by is not null and decided_at is not null and effected_at is not null)
  )
);
create index audit_governance_decisions_status_idx on public.audit_governance_decisions(status, proposed_at desc);
create index audit_governance_decisions_sar_idx on public.audit_governance_decisions(subject_access_request_id)
  where subject_access_request_id is not null;
alter table public.audit_governance_decisions enable row level security;
revoke all on public.audit_governance_decisions from public, anon, authenticated, service_role;
grant select on public.audit_governance_decisions to service_role;

alter table public.subject_access_requests
  add column if not exists unmasking_decision_id uuid references public.audit_governance_decisions(id);

create table public.audit_retention_signature_queue (
  certificate_id uuid primary key references public.audit_retention_certificates(id),
  status text not null default 'pending' check (status in ('pending','processing','signed','failed','dead_letter')),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);
alter table public.audit_retention_signature_queue enable row level security;
revoke all on public.audit_retention_signature_queue from public, anon, authenticated;
grant select, insert, update on public.audit_retention_signature_queue to service_role;

create table public.audit_retention_signatures (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null unique references public.audit_retention_certificates(id),
  certificate_hash text not null,
  signature text not null,
  signature_algorithm text not null,
  kms_key_version text not null,
  public_key_reference text not null,
  worm_bucket text not null,
  worm_object text not null,
  worm_generation text not null,
  worm_checksum_crc32c text,
  signed_at timestamptz not null default now()
);
alter table public.audit_retention_signatures enable row level security;
revoke all on public.audit_retention_signatures from public, anon, authenticated;
grant select, insert on public.audit_retention_signatures to service_role;

create table public.audit_worker_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (run_type in ('delivery','verification','retention_signing')),
  status text not null check (status in ('success','failed','partial')),
  cloud_run_service text,
  cloud_run_revision text,
  image_digest text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  completed_at timestamptz not null default now()
);
create index audit_worker_runs_type_completed_idx on public.audit_worker_runs(run_type, completed_at desc);
alter table public.audit_worker_runs enable row level security;
revoke all on public.audit_worker_runs from public, anon, authenticated;
grant select, insert on public.audit_worker_runs to service_role;

create trigger audit_governance_decisions_immutable
before update or delete on public.audit_governance_decisions
for each row execute function private.guard_audit_immutability();
create trigger audit_retention_signatures_immutable
before update or delete on public.audit_retention_signatures
for each row execute function private.guard_audit_immutability();
create trigger audit_worker_runs_immutable
before update or delete on public.audit_worker_runs
for each row execute function private.guard_audit_immutability();

create or replace function public.propose_audit_governance_decision(
  p_org_id uuid,
  p_decision_type text,
  p_proposed_by uuid,
  p_proposer_role text,
  p_reason text,
  p_legal_basis text,
  p_retention_years integer default null,
  p_subject_access_request_id uuid default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns uuid
language plpgsql security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  created_id uuid := gen_random_uuid();
  proposed_time timestamptz := clock_timestamp();
  calculated_hash text;
begin
  if p_proposer_role <> 'jurist' then raise exception 'Only a jurist can propose a governance decision'; end if;
  calculated_hash := encode(extensions.digest(concat_ws(':', created_id, p_org_id, p_decision_type,
    p_proposed_by, p_reason, p_legal_basis, p_retention_years, p_subject_access_request_id,
    p_date_from, p_date_to, proposed_time), 'sha256'), 'hex');
  insert into public.audit_governance_decisions(
    id, org_id, decision_type, proposed_by, proposer_role, reason, legal_basis,
    retention_years, subject_access_request_id, date_from, date_to, proposed_at, decision_hash
  ) values (
    created_id, p_org_id, p_decision_type, p_proposed_by, p_proposer_role, trim(p_reason),
    trim(p_legal_basis), p_retention_years, p_subject_access_request_id, p_date_from,
    p_date_to, proposed_time, calculated_hash
  );
  return created_id;
end;
$$;
revoke all on function public.propose_audit_governance_decision(uuid,text,uuid,text,text,text,integer,uuid,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.propose_audit_governance_decision(uuid,text,uuid,text,text,text,integer,uuid,timestamptz,timestamptz)
  to service_role;

-- Replace trigger guard with an explicit transition flag. This avoids DDL in
-- governance functions and still blocks every direct update/delete.
create or replace function private.guard_governance_immutability()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_setting('dfks.audit_governance_transition', true) = 'on' and tg_op = 'UPDATE' then return new; end if;
  raise exception 'Governance decisions are append-only outside controlled transitions';
end;
$$;
drop trigger audit_governance_decisions_immutable on public.audit_governance_decisions;
create trigger audit_governance_decisions_immutable before update or delete on public.audit_governance_decisions
for each row execute function private.guard_governance_immutability();

create or replace function public.decide_audit_governance_decision(
  p_decision_id uuid, p_approved boolean, p_approved_by uuid, p_approver_role text
)
returns public.audit_governance_decisions
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  current_decision public.audit_governance_decisions%rowtype;
  decided public.audit_governance_decisions%rowtype;
  decision_time timestamptz := clock_timestamp();
  final_status text;
begin
  if p_approver_role <> 'superadmin' then raise exception 'Only a superadmin can decide a governance proposal'; end if;
  select * into current_decision from public.audit_governance_decisions where id = p_decision_id for update;
  if not found then raise exception 'Governance decision not found'; end if;
  if current_decision.status <> 'proposed' then raise exception 'Governance decision has already been decided'; end if;
  if current_decision.proposed_by = p_approved_by then raise exception 'Four-eyes approval requires another user'; end if;
  final_status := case when p_approved then 'approved' else 'rejected' end;
  perform set_config('dfks.audit_governance_transition', 'on', true);
  update public.audit_governance_decisions set
    status = final_status,
    approved_by = p_approved_by,
    approver_role = p_approver_role,
    decided_at = decision_time,
    approval_hash = encode(extensions.digest(concat_ws(':', current_decision.decision_hash,
      final_status, p_approved_by, p_approver_role, decision_time), 'sha256'), 'hex')
  where id = p_decision_id returning * into decided;
  perform set_config('dfks.audit_governance_transition', 'off', true);
  return decided;
end;
$$;
revoke all on function public.decide_audit_governance_decision(uuid,boolean,uuid,text) from public, anon, authenticated;
grant execute on function public.decide_audit_governance_decision(uuid,boolean,uuid,text) to service_role;

create or replace function public.effect_audit_governance_decision(p_decision_id uuid)
returns public.audit_governance_decisions
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  current_decision public.audit_governance_decisions%rowtype;
  effected public.audit_governance_decisions%rowtype;
  effect_time timestamptz := clock_timestamp();
begin
  select * into current_decision from public.audit_governance_decisions where id = p_decision_id for update;
  if not found or current_decision.status <> 'approved' then raise exception 'Decision is not approved'; end if;
  if current_decision.decision_type = 'retention_change' then
    update public.audit_control_settings set retention_years = current_decision.retention_years,
      updated_by = current_decision.approved_by, updated_at = now() where singleton = true;
  else
    update public.subject_access_requests set mask_staff_names = false,
      balancing_reason = current_decision.reason, unmasking_decision_id = current_decision.id,
      updated_at = now() where id = current_decision.subject_access_request_id;
  end if;
  perform set_config('dfks.audit_governance_transition', 'on', true);
  update public.audit_governance_decisions set
    status = 'effected',
    effected_at = effect_time,
    effect_hash = encode(extensions.digest(concat_ws(':', current_decision.approval_hash,
      'effected', effect_time), 'sha256'), 'hex')
  where id = p_decision_id returning * into effected;
  perform set_config('dfks.audit_governance_transition', 'off', true);
  return effected;
end;
$$;
revoke all on function public.effect_audit_governance_decision(uuid) from public, anon, authenticated;
grant execute on function public.effect_audit_governance_decision(uuid) to service_role;

drop function if exists public.register_subject_access_export(uuid,text,text,integer,boolean,uuid,timestamptz);

create or replace function public.register_subject_access_export(
  p_request_id uuid,
  p_format text,
  p_content_hash text,
  p_row_count integer,
  p_mask_staff_names boolean,
  p_generated_by uuid,
  p_expires_at timestamptz,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_storage_generation text default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare export_id uuid; request_row public.subject_access_requests%rowtype;
begin
  if p_format not in ('json','csv','pdf') then raise exception 'Unsupported subject access export format'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '25 hours' then raise exception 'Export expiry must be within 25 hours'; end if;
  if p_storage_bucket <> 'subject-access-exports' or nullif(trim(p_storage_path), '') is null then raise exception 'Invalid export storage'; end if;
  select * into request_row from public.subject_access_requests where id = p_request_id for update;
  if not found or request_row.status not in ('approved','generated','delivered') then raise exception 'Subject access request is not exportable'; end if;
  if p_mask_staff_names is distinct from request_row.mask_staff_names then raise exception 'Export masking must match request'; end if;
  if not p_mask_staff_names and not exists (
    select 1 from public.audit_governance_decisions d
    where d.id = request_row.unmasking_decision_id and d.status = 'effected'
      and d.decision_type = 'staff_unmasking'
  ) then raise exception 'Unmasked export requires an effected four-eyes decision'; end if;
  insert into public.subject_access_exports(
    request_id, format, content_hash, row_count, mask_staff_names, generated_by,
    expires_at, storage_bucket, storage_path, mime_type, byte_size, storage_generation
  ) values (
    p_request_id, p_format, p_content_hash, p_row_count, p_mask_staff_names, p_generated_by,
    p_expires_at, p_storage_bucket, p_storage_path, p_mime_type, p_byte_size, p_storage_generation
  ) on conflict (request_id, format, content_hash) do update set
    expires_at = excluded.expires_at,
    storage_bucket = excluded.storage_bucket,
    storage_path = excluded.storage_path,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size,
    storage_generation = excluded.storage_generation,
    deleted_at = null
  returning id into export_id;
  update public.subject_access_requests set status = case when status = 'delivered' then status else 'generated' end,
    expires_at = p_expires_at, updated_at = now() where id = p_request_id;
  return export_id;
end;
$$;
revoke all on function public.register_subject_access_export(uuid,text,text,integer,boolean,uuid,timestamptz,text,text,text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.register_subject_access_export(uuid,text,text,integer,boolean,uuid,timestamptz,text,text,text,bigint,text)
  to service_role;

create or replace function private.enqueue_retention_certificate_signature()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  insert into public.audit_retention_signature_queue(certificate_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.enqueue_retention_certificate_signature() from public, anon, authenticated, service_role;
create trigger audit_retention_certificate_enqueue_signature
after insert on public.audit_retention_certificates for each row
execute function private.enqueue_retention_certificate_signature();

create or replace function public.record_audit_worker_run(
  p_run_type text, p_status text, p_started_at timestamptz, p_details jsonb default '{}'::jsonb,
  p_cloud_run_service text default null, p_cloud_run_revision text default null, p_image_digest text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare created_id uuid;
begin
  insert into public.audit_worker_runs(run_type,status,started_at,details,cloud_run_service,cloud_run_revision,image_digest)
  values (p_run_type,p_status,p_started_at,coalesce(p_details,'{}'::jsonb),p_cloud_run_service,p_cloud_run_revision,p_image_digest)
  returning id into created_id;
  return created_id;
end;
$$;
revoke all on function public.record_audit_worker_run(text,text,timestamptz,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.record_audit_worker_run(text,text,timestamptz,jsonb,text,text,text) to service_role;

drop function if exists public.complete_audit_siem_batch(uuid,boolean,text,text,text,text,text,text,text);

create or replace function public.complete_audit_siem_batch(
  p_batch_id uuid,
  p_success boolean,
  p_error_code text default null,
  p_adapter text default null,
  p_destination_fingerprint text default null,
  p_key_id text default null,
  p_signature_algorithm text default null,
  p_envelope_hash text default null,
  p_remote_receipt_id text default null,
  p_worm_bucket text default null,
  p_worm_object text default null,
  p_worm_generation text default null,
  p_worm_checksum_crc32c text default null,
  p_worm_created_at timestamptz default null,
  p_cloud_run_revision text default null
)
returns integer
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare affected integer; first_value bigint; last_value bigint;
begin
  if p_success then
    if p_adapter is null or p_destination_fingerprint is null or p_key_id is null
       or p_signature_algorithm is null or p_envelope_hash is null then
      raise exception 'Successful delivery requires a complete receipt';
    end if;
    if p_adapter = 'google_native' and (
      p_worm_bucket is null or p_worm_object is null or p_worm_generation is null or p_worm_created_at is null
    ) then raise exception 'Google-native delivery requires a WORM receipt'; end if;
    select min(sequence_no), max(sequence_no), count(*)::integer into first_value, last_value, affected
    from public.audit_siem_outbox where batch_id = p_batch_id and status = 'processing';
    if coalesce(affected, 0) = 0 then return 0; end if;
    insert into public.audit_siem_receipts(
      batch_id, first_sequence, last_sequence, event_count, adapter,
      destination_fingerprint, key_id, signature_algorithm, envelope_hash,
      remote_receipt_id, worm_bucket, worm_object, worm_generation,
      worm_checksum_crc32c, worm_created_at, kms_key_version, cloud_run_revision
    ) values (
      p_batch_id, first_value, last_value, affected, p_adapter,
      p_destination_fingerprint, p_key_id, p_signature_algorithm, p_envelope_hash,
      p_remote_receipt_id, p_worm_bucket, p_worm_object, p_worm_generation,
      p_worm_checksum_crc32c, p_worm_created_at, p_key_id, p_cloud_run_revision
    ) on conflict (batch_id) do nothing;
    update public.audit_siem_outbox set status = 'delivered', delivered_at = now(),
      updated_at = now(), last_error_code = null
    where batch_id = p_batch_id and status = 'processing';
  else
    update public.audit_siem_outbox set
      status = case when attempts >= 10 then 'dead_letter' else 'failed' end,
      available_at = now() + make_interval(secs => least(3600, (power(2, least(attempts, 8)) * 15)::integer)),
      last_error_code = left(coalesce(p_error_code, 'delivery_failed'), 120),
      last_error_at = now(), updated_at = now()
    where batch_id = p_batch_id and status = 'processing';
    get diagnostics affected = row_count;
  end if;
  return affected;
end;
$$;
revoke all on function public.complete_audit_siem_batch(uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.complete_audit_siem_batch(uuid,boolean,text,text,text,text,text,text,text,text,text,text,text,timestamptz,text)
  to service_role;

create or replace function public.claim_audit_retention_certificate()
returns table(certificate_id uuid, certificate_payload jsonb)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  update public.audit_retention_signature_queue set
    status = case when attempts >= 10 then 'dead_letter' else 'failed' end,
    available_at = now(), claimed_at = null, last_error_code = 'stale_processing_claim', updated_at = now()
  where status = 'processing' and claimed_at < now() - interval '15 minutes';
  return query
  with candidate as (
    select queue.certificate_id from public.audit_retention_signature_queue queue
    where queue.status in ('pending','failed') and queue.available_at <= now() and queue.attempts < 10
    order by queue.available_at for update skip locked limit 1
  ), claimed as (
    update public.audit_retention_signature_queue queue set status = 'processing',
      attempts = attempts + 1, claimed_at = now(), updated_at = now()
    from candidate where queue.certificate_id = candidate.certificate_id
    returning queue.certificate_id
  )
  select certificate.id, to_jsonb(certificate)
  from claimed join public.audit_retention_certificates certificate on certificate.id = claimed.certificate_id;
end;
$$;
revoke all on function public.claim_audit_retention_certificate() from public, anon, authenticated;
grant execute on function public.claim_audit_retention_certificate() to service_role;

create or replace function public.complete_audit_retention_signature(
  p_certificate_id uuid, p_success boolean, p_error_code text default null,
  p_signature text default null, p_signature_algorithm text default null,
  p_kms_key_version text default null, p_public_key_reference text default null,
  p_worm_bucket text default null, p_worm_object text default null,
  p_worm_generation text default null, p_worm_checksum_crc32c text default null
)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare certificate_hash_value text;
begin
  if p_success then
    if p_signature is null or p_kms_key_version is null or p_worm_generation is null then
      raise exception 'Signed retention evidence is incomplete';
    end if;
    select certificate_hash into certificate_hash_value from public.audit_retention_certificates where id = p_certificate_id;
    insert into public.audit_retention_signatures(
      certificate_id, certificate_hash, signature, signature_algorithm, kms_key_version,
      public_key_reference, worm_bucket, worm_object, worm_generation, worm_checksum_crc32c
    ) values (
      p_certificate_id, certificate_hash_value, p_signature, p_signature_algorithm,
      p_kms_key_version, p_public_key_reference, p_worm_bucket, p_worm_object,
      p_worm_generation, p_worm_checksum_crc32c
    ) on conflict (certificate_id) do nothing;
    update public.audit_retention_signature_queue set status = 'signed', last_error_code = null, updated_at = now()
    where certificate_id = p_certificate_id and status = 'processing';
  else
    update public.audit_retention_signature_queue set
      status = case when attempts >= 10 then 'dead_letter' else 'failed' end,
      available_at = now() + make_interval(secs => least(3600, (power(2, least(attempts, 8)) * 15)::integer)),
      last_error_code = left(coalesce(p_error_code, 'signing_failed'), 120), updated_at = now()
    where certificate_id = p_certificate_id and status = 'processing';
  end if;
  return found;
end;
$$;
revoke all on function public.complete_audit_retention_signature(uuid,boolean,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.complete_audit_retention_signature(uuid,boolean,text,text,text,text,text,text,text,text,text)
  to service_role;

create or replace function public.update_audit_delivery_settings(
  p_siem_enabled boolean, p_siem_adapter text, p_destination_label text, p_kms_key_id text, p_updated_by uuid
)
returns public.audit_control_settings
language plpgsql security definer set search_path = public, pg_catalog as $$
declare updated public.audit_control_settings%rowtype;
begin
  if p_siem_adapter not in ('google_native','generic','splunk','sentinel','elastic') then raise exception 'Unsupported adapter'; end if;
  if p_siem_enabled and (nullif(trim(p_destination_label), '') is null or nullif(trim(p_kms_key_id), '') is null) then
    raise exception 'Enabled delivery requires destination and KMS key';
  end if;
  update public.audit_control_settings set siem_enabled = p_siem_enabled, siem_adapter = p_siem_adapter,
    siem_destination_label = nullif(trim(p_destination_label), ''), kms_key_id = nullif(trim(p_kms_key_id), ''),
    updated_by = p_updated_by, updated_at = now()
  where singleton = true returning * into updated;
  return updated;
end;
$$;
revoke all on function public.update_audit_delivery_settings(boolean,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.update_audit_delivery_settings(boolean,text,text,text,uuid) to service_role;
revoke update on public.audit_control_settings from service_role;

create or replace function public.purge_expired_audit_events(
  retention interval default interval '7 years', batch_size integer default 10000
)
returns integer
language plpgsql security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  expired_ids uuid[];
  first_sequence_value bigint; last_sequence_value bigint; deleted_count integer;
  first_hash text; last_hash text; retention_years_value integer; certificate_payload text;
begin
  if retention < interval '1 year' then raise exception 'Audit retention cannot be shorter than one year'; end if;
  if batch_size < 1 or batch_size > 50000 then raise exception 'Invalid audit purge batch size'; end if;
  select array_agg(id order by sequence_no), min(sequence_no), max(sequence_no), count(*)::integer,
    encode((array_agg(chain_hash order by sequence_no))[1], 'hex'),
    encode((array_agg(chain_hash order by sequence_no desc))[1], 'hex')
  into expired_ids, first_sequence_value, last_sequence_value, deleted_count, first_hash, last_hash
  from (
    select id, sequence_no, chain_hash from public.audit_events
    where occurred_at < now() - retention order by sequence_no limit batch_size
  ) expired;
  if coalesce(deleted_count, 0) = 0 then return 0; end if;
  retention_years_value := greatest(1, round(extract(epoch from retention) / 31557600)::integer);
  certificate_payload := concat_ws(':', first_sequence_value, last_sequence_value, deleted_count, first_hash, last_hash, retention_years_value);
  insert into public.audit_retention_certificates(
    first_sequence,last_sequence,event_count,first_chain_hash,last_chain_hash,certificate_hash,retention_years
  ) values (
    first_sequence_value,last_sequence_value,deleted_count,first_hash,last_hash,
    encode(extensions.digest(certificate_payload, 'sha256'), 'hex'),retention_years_value
  );
  perform set_config('dfks.audit_retention', 'on', true);
  delete from public.audit_events where id = any(expired_ids);
  perform set_config('dfks.audit_retention', 'off', true);
  return deleted_count;
end;
$$;
revoke all on function public.purge_expired_audit_events(interval,integer) from public, anon, authenticated;
grant execute on function public.purge_expired_audit_events(interval,integer) to service_role;

-- The service role may update export lifecycle metadata, but browser roles have
-- no table access and can never list or fetch bucket objects directly.
grant update on public.subject_access_exports to service_role;

comment on table public.audit_governance_decisions is 'Four-eyes retention and staff-unmasking decisions with immutable evidence hashes.';
comment on table public.audit_retention_signatures is 'Immutable KMS signatures and WORM receipts for retention deletion certificates.';
comment on table public.audit_worker_runs is 'Append-only operational evidence for Cloud Run delivery, signing and verification runs.';

-- The atomic onboarding function was added after an earlier repair and
-- accidentally restored a reference to a column that does not exist. Keep the
-- operation service-role-only while making the schema lintable again.
create or replace function public.complete_member_onboarding(
  actor_user_id uuid,
  target_rights_holder_id uuid,
  target_org_id uuid,
  login_email text,
  phone_value text,
  address_value text,
  encrypted_cpr text,
  encrypted_bank_account text,
  gender_value text,
  participates boolean,
  start_year integer,
  primary_profession_id uuid,
  secondary_profession_ids uuid[],
  work_mode text,
  work_region_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_user_id is null
     or target_rights_holder_id is null
     or target_org_id is null
     or not exists (
       select 1
       from public.rettighedshavere holder
       join public.org_affiliations affiliation
         on affiliation.rights_holder_id = holder.id
        and affiliation.org_id = target_org_id
       where holder.id = target_rights_holder_id
         and holder.user_id = actor_user_id
     ) then
    return false;
  end if;

  update public.rettighedshavere
  set email = login_email,
      phone = nullif(phone_value, ''),
      address = nullif(address_value, ''),
      cpr_no = nullif(encrypted_cpr, ''),
      bank_account = nullif(encrypted_bank_account, ''),
      gender = nullif(gender_value, ''),
      onboarding_completed = true,
      onboarding_completed_at = now(),
      onboarding_required_at = null
  where id = target_rights_holder_id
    and user_id = actor_user_id;

  if not found then return false; end if;

  if not private.update_member_statistics_profile(
    target_rights_holder_id,
    target_org_id,
    actor_user_id,
    participates,
    start_year,
    primary_profession_id,
    coalesce(secondary_profession_ids, '{}'::uuid[]),
    work_mode,
    work_region_code
  ) then
    raise exception 'statistics profile rejected';
  end if;

  return true;
end;
$$;
revoke all on function public.complete_member_onboarding(
  uuid, uuid, uuid, text, text, text, text, text, text,
  boolean, integer, uuid, uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.complete_member_onboarding(
  uuid, uuid, uuid, text, text, text, text, text, text,
  boolean, integer, uuid, uuid[], text, text
) to service_role;
