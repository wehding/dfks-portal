-- Controlled, superadmin-approved one-off replay of historical AI-extracted
-- owner names. The ledger contains identifiers, hashes, scores and categorical
-- signals only; names and contract text stay in their existing protected data.

create table public.contract_owner_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  status text not null default 'previewing' check (status in (
    'previewing', 'preview_ready', 'approved', 'applying', 'completed',
    'completed_with_exceptions', 'cancelled'
  )),
  match_version text not null check (char_length(match_version) between 1 and 100),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  approved_manifest_sha256 text check (
    approved_manifest_sha256 is null or approved_manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  summary_counts jsonb not null default '{}'::jsonb check (
    jsonb_typeof(summary_counts) = 'object' and octet_length(summary_counts::text) <= 4096
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  previewed_at timestamptz,
  approved_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint contract_owner_backfill_run_approval_check check (
    (approved_by is null and approved_at is null and approved_manifest_sha256 is null)
    or (approved_by is not null and approved_at is not null and approved_manifest_sha256 is not null)
  )
);

create table public.contract_owner_backfill_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.contract_owner_backfill_runs(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  org_id uuid not null references public.organisations(id) on delete restrict,
  expected_rights_holder_id uuid references public.rettighedshavere(id) on delete restrict,
  proposed_rights_holder_id uuid references public.rettighedshavere(id) on delete restrict,
  expected_verification_revision bigint not null check (expected_verification_revision > 0),
  expected_work_id uuid references public.works(id) on delete restrict,
  source_name_sha256 text not null check (source_name_sha256 ~ '^[0-9a-f]{64}$'),
  match_score integer check (match_score is null or match_score between 0 and 100),
  match_signals text[] not null default '{}'::text[] check (cardinality(match_signals) <= 20),
  disposition text not null check (disposition in (
    'same_owner', 'fill_missing_owner', 'replace_owner', 'unresolved'
  )),
  selected boolean not null default false,
  status text not null default 'previewed' check (status in (
    'previewed', 'pending', 'applying', 'applied', 'stale', 'failed', 'excluded', 'unresolved'
  )),
  previous_contract_status text not null,
  invalidated_episode_confirmation_count integer not null default 0 check (invalidated_episode_confirmation_count >= 0),
  audit_event_id uuid references public.audit_events(id) on delete restrict,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,80}$'),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, contract_id),
  constraint contract_owner_backfill_item_selection_check check (
    not selected or (proposed_rights_holder_id is not null and disposition <> 'unresolved')
  )
);

comment on table public.contract_owner_backfill_runs is
  'Server-only immutable approval ledger for a controlled historical owner backfill. Contains no names or contract text.';
comment on table public.contract_owner_backfill_items is
  'Hashed, identifier-only owner proposals. Raw extracted names must never be copied into this table.';

create index contract_owner_backfill_runs_org_created_idx
  on public.contract_owner_backfill_runs(org_id, created_at desc);
create index contract_owner_backfill_items_run_status_idx
  on public.contract_owner_backfill_items(run_id, status, contract_id);
create index contract_owner_backfill_items_org_contract_idx
  on public.contract_owner_backfill_items(org_id, contract_id);

alter table public.contract_owner_backfill_runs enable row level security;
alter table public.contract_owner_backfill_items enable row level security;
revoke all on public.contract_owner_backfill_runs from public, anon, authenticated;
revoke all on public.contract_owner_backfill_items from public, anon, authenticated;
grant select, insert, update on public.contract_owner_backfill_runs to service_role;
grant select, insert, update on public.contract_owner_backfill_items to service_role;

create or replace function private.is_verified_superadmin(
  p_actor_user_id uuid,
  p_actor_org_id uuid
) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_org_roles role_row
    where role_row.user_id = p_actor_user_id
      and role_row.role = 'superadmin'
      and role_row.org_id = p_actor_org_id
  );
$$;
revoke all on function private.is_verified_superadmin(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.is_verified_superadmin(uuid, uuid) to service_role;

create or replace function private.normalized_owner_source_hash(p_value text)
returns text
language sql immutable strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      lower(regexp_replace(btrim(p_value), '[[:space:]]+', ' ', 'g')),
      'sha256'
    ),
    'hex'
  );
$$;
revoke all on function private.normalized_owner_source_hash(text)
  from public, anon, authenticated;
grant execute on function private.normalized_owner_source_hash(text) to service_role;

create or replace function private.contract_owner_backfill_manifest(p_run_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', item.contract_id::text, coalesce(item.expected_rights_holder_id::text, ''),
      coalesce(item.proposed_rights_holder_id::text, ''), item.expected_verification_revision::text,
      coalesce(item.expected_work_id::text, ''), item.source_name_sha256,
      coalesce(item.match_score::text, ''), array_to_string(item.match_signals, ','),
      item.disposition, item.selected::text, item.previous_contract_status),
    E'\n' order by item.contract_id
  ), ''), 'sha256'), 'hex')
  from public.contract_owner_backfill_items item where item.run_id = p_run_id;
$$;
revoke all on function private.contract_owner_backfill_manifest(uuid)
  from public, anon, authenticated;
grant execute on function private.contract_owner_backfill_manifest(uuid) to service_role;

create or replace function public.finalize_contract_owner_backfill_preview(
  p_run_id uuid,
  p_summary_counts jsonb,
  p_actor_user_id uuid,
  p_actor_org_id uuid
) returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  locked_run public.contract_owner_backfill_runs%rowtype;
  item_count integer;
  audit_subjects uuid[];
  created_audit_id uuid;
  calculated_manifest_sha256 text;
begin
  if p_run_id is null or jsonb_typeof(p_summary_counts) <> 'object'
    or octet_length(p_summary_counts::text) > 4096
    or not private.is_verified_superadmin(p_actor_user_id, p_actor_org_id) then
    raise exception 'Ugyldig eller ikke autoriseret forhåndsvisning' using errcode = '42501';
  end if;

  select * into locked_run from public.contract_owner_backfill_runs
  where id = p_run_id for update;
  if locked_run.id is null or locked_run.org_id <> p_actor_org_id
    or locked_run.created_by <> p_actor_user_id or locked_run.status <> 'previewing' then
    raise exception 'Forhåndsvisningen kan ikke færdiggøres' using errcode = '40001';
  end if;

  select count(*)::integer into item_count
  from public.contract_owner_backfill_items item
  where item.run_id = locked_run.id and item.org_id = locked_run.org_id;
  if item_count = 0 or item_count <> coalesce((p_summary_counts ->> 'total')::integer, -1) then
    raise exception 'Forhåndsvisningens optælling stemmer ikke' using errcode = '40001';
  end if;
  calculated_manifest_sha256 := private.contract_owner_backfill_manifest(locked_run.id);

  select coalesce(array_agg(distinct subject_id order by subject_id), '{}'::uuid[])
  into audit_subjects
  from (
    select expected_rights_holder_id as subject_id
    from public.contract_owner_backfill_items where run_id = locked_run.id
    union
    select proposed_rights_holder_id
    from public.contract_owner_backfill_items where run_id = locked_run.id
  ) subjects where subject_id is not null;

  created_audit_id := public.append_audit_event_v2(
    p_action => 'create',
    p_entity_type => 'contract_owner_backfill_run',
    p_entity_id => locked_run.id::text,
    p_actor_user_id => p_actor_user_id,
    p_actor_role => 'superadmin',
    p_actor_type => 'user',
    p_actor_org_id => locked_run.org_id,
    p_source => 'admin',
    p_target_member_uuids => audit_subjects,
    p_purpose_code => 'contract_owner_data_quality',
    p_legal_basis => 'GDPR Art. 6(1)(c)/(f), Art. 9(2)(d)',
    p_data_categories => array['identity_data', 'contract_data', 'union_membership_data', 'ai_analysis'],
    p_system_component => 'admin.contract-owner-backfill.preview',
    p_org_ids => array[locked_run.org_id],
    p_metadata => jsonb_build_object('manifest_sha256', calculated_manifest_sha256, 'counts', p_summary_counts)
  );
  if created_audit_id is null then raise exception 'Auditregistrering fejlede'; end if;

  update public.contract_owner_backfill_runs
  set status = 'preview_ready', manifest_sha256 = calculated_manifest_sha256,
      summary_counts = p_summary_counts, previewed_at = now(), updated_at = now(), revision = revision + 1
  where id = locked_run.id;
  return jsonb_build_object('runId', locked_run.id, 'status', 'preview_ready', 'manifestSha256', calculated_manifest_sha256);
end;
$$;

create or replace function public.set_contract_owner_backfill_selection(
  p_run_id uuid,
  p_contract_id uuid,
  p_selected boolean,
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_actor_org_id uuid
) returns bigint
language plpgsql security invoker
set search_path = ''
as $$
declare next_revision bigint;
begin
  if not private.is_verified_superadmin(p_actor_user_id, p_actor_org_id) then
    raise exception 'Kun superadmin kan ændre kørslen' using errcode = '42501';
  end if;
  update public.contract_owner_backfill_items item
  set selected = p_selected,
      status = case when p_selected then 'previewed' else 'excluded' end,
      updated_at = now()
  from public.contract_owner_backfill_runs run
  where run.id = p_run_id and run.id = item.run_id
    and run.org_id = p_actor_org_id and run.status = 'preview_ready'
    and run.revision = p_expected_revision and item.contract_id = p_contract_id
    and item.disposition <> 'unresolved' and item.proposed_rights_holder_id is not null;
  if not found then raise exception 'Kørslen er ændret eller elementet kan ikke vælges' using errcode = '40001'; end if;
  update public.contract_owner_backfill_runs
  set revision = revision + 1,
      manifest_sha256 = private.contract_owner_backfill_manifest(p_run_id),
      updated_at = now() where id = p_run_id
  returning revision into next_revision;
  return next_revision;
end;
$$;

create or replace function public.approve_contract_owner_backfill_run(
  p_run_id uuid,
  p_expected_manifest_sha256 text,
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_actor_org_id uuid
) returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  locked_run public.contract_owner_backfill_runs%rowtype;
  selected_count integer;
  audit_subjects uuid[];
  approval_audit_id uuid;
begin
  if not private.is_verified_superadmin(p_actor_user_id, p_actor_org_id) then
    raise exception 'Kun superadmin kan godkende kørslen' using errcode = '42501';
  end if;
  select * into locked_run from public.contract_owner_backfill_runs where id = p_run_id for update;
  if locked_run.id is null or locked_run.org_id <> p_actor_org_id
    or locked_run.status <> 'preview_ready' or locked_run.revision <> p_expected_revision
    or locked_run.manifest_sha256 is distinct from p_expected_manifest_sha256
    or locked_run.manifest_sha256 is distinct from private.contract_owner_backfill_manifest(locked_run.id) then
    raise exception 'Kørselsgrundlaget er ændret. Opret en ny forhåndsvisning' using errcode = '40001';
  end if;

  select count(*)::integer into selected_count from public.contract_owner_backfill_items
  where run_id = locked_run.id and selected;
  if selected_count < 1 then raise exception 'Vælg mindst ét ejerforslag' using errcode = '22023'; end if;

  select coalesce(array_agg(distinct subject_id order by subject_id), '{}'::uuid[])
  into audit_subjects
  from (
    select expected_rights_holder_id as subject_id from public.contract_owner_backfill_items
      where run_id = locked_run.id and selected
    union
    select proposed_rights_holder_id from public.contract_owner_backfill_items
      where run_id = locked_run.id and selected
  ) subjects where subject_id is not null;

  approval_audit_id := public.append_audit_event_v2(
    p_action => 'update', p_entity_type => 'contract_owner_backfill_run',
    p_entity_id => locked_run.id::text, p_actor_user_id => p_actor_user_id,
    p_actor_role => 'superadmin', p_actor_type => 'user', p_actor_org_id => locked_run.org_id,
    p_source => 'admin', p_target_member_uuids => audit_subjects,
    p_purpose_code => 'contract_owner_data_quality',
    p_legal_basis => 'GDPR Art. 6(1)(c)/(f), Art. 9(2)(d)',
    p_data_categories => array['identity_data', 'contract_data', 'union_membership_data', 'ai_analysis'],
    p_system_component => 'admin.contract-owner-backfill.approve',
    p_org_ids => array[locked_run.org_id],
    p_metadata => jsonb_build_object(
      'manifest_sha256', locked_run.manifest_sha256,
      'selected_count', selected_count,
      'approval_scope', 'single_immutable_run'
    )
  );
  if approval_audit_id is null then raise exception 'Auditregistrering fejlede'; end if;

  update public.contract_owner_backfill_items
  set status = case when selected then 'pending' when disposition = 'unresolved' then 'unresolved' else 'excluded' end,
      updated_at = now()
  where run_id = locked_run.id;
  update public.contract_owner_backfill_runs
  set status = 'approved', approved_manifest_sha256 = manifest_sha256,
      approved_by = p_actor_user_id, approved_at = now(), updated_at = now(), revision = revision + 1
  where id = locked_run.id;
  return jsonb_build_object('runId', locked_run.id, 'status', 'approved', 'selectedCount', selected_count);
end;
$$;

-- Apply one selected item atomically. The already deployed review function is
-- deliberately reused, so validation reopening, episode invalidation, owner
-- guards and per-contract semantic audit cannot drift from manual review.
create or replace function public.apply_contract_owner_backfill_item(
  p_run_id uuid,
  p_actor_user_id uuid,
  p_actor_org_id uuid
) returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  locked_run public.contract_owner_backfill_runs%rowtype;
  locked_item public.contract_owner_backfill_items%rowtype;
  current_contract public.contracts%rowtype;
  current_verification public.contract_owner_verifications%rowtype;
  current_source_hash text;
  review_result jsonb;
begin
  if not private.is_verified_superadmin(p_actor_user_id, p_actor_org_id) then
    raise exception 'Kun superadmin kan anvende kørslen' using errcode = '42501';
  end if;
  select * into locked_run from public.contract_owner_backfill_runs where id = p_run_id for update;
  if locked_run.id is null or locked_run.org_id <> p_actor_org_id
    or locked_run.status not in ('approved', 'applying')
    or locked_run.approved_by <> p_actor_user_id
    or locked_run.approved_manifest_sha256 is distinct from locked_run.manifest_sha256 then
    raise exception 'Kørslen er ikke godkendt til anvendelse' using errcode = '42501';
  end if;
  update public.contract_owner_backfill_runs set status = 'applying', updated_at = now()
  where id = locked_run.id and status = 'approved';

  select * into locked_item
  from public.contract_owner_backfill_items
  where run_id = locked_run.id and status = 'pending'
  order by contract_id
  for update skip locked limit 1;

  if locked_item.id is null then
    update public.contract_owner_backfill_runs run
    set status = case when exists (
          select 1 from public.contract_owner_backfill_items item
          where item.run_id = run.id and item.status in ('stale', 'failed')
        ) then 'completed_with_exceptions' else 'completed' end,
        completed_at = now(), updated_at = now(), revision = revision + 1
    where run.id = locked_run.id and not exists (
      select 1 from public.contract_owner_backfill_items item
      where item.run_id = run.id and item.status in ('pending', 'applying')
    );
    return jsonb_build_object('empty', true);
  end if;

  update public.contract_owner_backfill_items set status = 'applying', updated_at = now()
  where id = locked_item.id;
  select * into current_contract from public.contracts where id = locked_item.contract_id for update;
  select * into current_verification from public.contract_owner_verifications
    where contract_id = locked_item.contract_id for update;
  select private.normalized_owner_source_hash(validation.extracted_data ->> 'rightsHolderName')
  into current_source_hash
  from public.contract_validations validation
  where validation.contract_id = locked_item.contract_id and validation.org_id = locked_item.org_id;

  if current_contract.id is null or current_contract.org_id <> locked_item.org_id
    or current_contract.rights_holder_id is distinct from locked_item.expected_rights_holder_id
    or current_contract.work_id is distinct from locked_item.expected_work_id
    or current_verification.revision <> locked_item.expected_verification_revision
    or current_source_hash is distinct from locked_item.source_name_sha256 then
    update public.contract_owner_backfill_items
    set status = 'stale', error_code = 'source_or_owner_changed', updated_at = now()
    where id = locked_item.id;
    return jsonb_build_object('empty', false, 'itemId', locked_item.id, 'status', 'stale');
  end if;

  insert into public.contract_owner_provenance(
    contract_id, org_id, rights_holder_id, origin, authenticated_user_id,
    source_record_type, source_record_id
  ) values (
    locked_item.contract_id, locked_item.org_id, locked_item.proposed_rights_holder_id,
    'ai_suggestion', p_actor_user_id, 'owner_backfill_item', locked_item.id
  ) on conflict do nothing;

  review_result := public.review_contract_owner(
    p_contract_id => locked_item.contract_id,
    p_expected_rights_holder_id => locked_item.expected_rights_holder_id,
    p_expected_revision => locked_item.expected_verification_revision,
    p_decision => case when locked_item.disposition = 'same_owner' then 'confirm' else 'reassign' end,
    p_new_rights_holder_id => locked_item.proposed_rights_holder_id,
    p_reason_code => case
      when locked_item.disposition = 'same_owner' then 'bulk_confirmed_existing_owner'
      else 'admin_verified_correction'
    end,
    p_actor_user_id => p_actor_user_id,
    p_actor_org_id => locked_item.org_id,
    p_actor_role => 'superadmin'
  );

  update public.contract_owner_backfill_items
  set status = 'applied', audit_event_id = nullif(review_result ->> 'auditEventId', '')::uuid,
      invalidated_episode_confirmation_count = case when disposition = 'same_owner' then 0 else (
        select count(*)::integer from public.contract_episode_confirmations confirmation
        where confirmation.contract_id = locked_item.contract_id and confirmation.invalidated_at is not null
      ) end,
      applied_at = now(), updated_at = now()
  where id = locked_item.id;
  return jsonb_build_object('empty', false, 'itemId', locked_item.id, 'contractId', locked_item.contract_id, 'status', 'applied');
exception when others then
  if locked_item.id is not null then
    update public.contract_owner_backfill_items
    set status = case when sqlstate in ('40001', '23503', '23514') then 'stale' else 'failed' end,
        error_code = case when sqlstate in ('40001', '23503', '23514') then 'concurrent_change' else 'apply_failed' end,
        updated_at = now()
    where id = locked_item.id;
    return jsonb_build_object('empty', false, 'itemId', locked_item.id,
      'status', case when sqlstate in ('40001', '23503', '23514') then 'stale' else 'failed' end);
  end if;
  raise;
end;
$$;

revoke all on function public.finalize_contract_owner_backfill_preview(uuid,jsonb,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.set_contract_owner_backfill_selection(uuid,uuid,boolean,bigint,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.approve_contract_owner_backfill_run(uuid,text,bigint,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.apply_contract_owner_backfill_item(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_contract_owner_backfill_preview(uuid,jsonb,uuid,uuid) to service_role;
grant execute on function public.set_contract_owner_backfill_selection(uuid,uuid,boolean,bigint,uuid,uuid) to service_role;
grant execute on function public.approve_contract_owner_backfill_run(uuid,text,bigint,uuid,uuid) to service_role;
grant execute on function public.apply_contract_owner_backfill_item(uuid,uuid,uuid) to service_role;
