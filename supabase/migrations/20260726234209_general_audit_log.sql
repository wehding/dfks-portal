-- Product-facing, organisation-scoped audit trail.
-- Audit rows are append-only. Sensitive payloads are redacted before storage.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  action text not null check (action in (
    'create','update','delete','archive','restore','validate','approve','merge',
    'invite','reset_link','export','download','import','sync','job','security_failure','retention'
  )),
  entity_type text not null check (char_length(entity_type) between 1 and 100),
  entity_id text,
  entity_label text,
  actor_user_id uuid,
  actor_display_name text,
  actor_email text,
  actor_role text,
  actor_type text not null default 'system' check (actor_type in ('user','system','integration')),
  actor_org_id uuid,
  source text not null default 'api' check (source in ('portal','admin','api','cron','import','database')),
  correlation_id uuid,
  request_id text,
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  missing_actor_context boolean not null default false
);

create table if not exists public.audit_event_organisations (
  event_id uuid not null references public.audit_events(id) on delete cascade,
  org_id uuid not null,
  org_name text,
  occurred_at timestamptz not null,
  primary key (event_id, org_id)
);

create index if not exists audit_events_occurred_cursor_idx
  on public.audit_events (occurred_at desc, id desc);
create index if not exists audit_events_actor_occurred_idx
  on public.audit_events (actor_user_id, occurred_at desc) where actor_user_id is not null;
create index if not exists audit_events_entity_occurred_idx
  on public.audit_events (entity_type, entity_id, occurred_at desc);
create index if not exists audit_events_action_occurred_idx
  on public.audit_events (action, occurred_at desc);
create index if not exists audit_event_organisations_org_occurred_idx
  on public.audit_event_organisations (org_id, occurred_at desc, event_id desc);

alter table public.audit_events enable row level security;
alter table public.audit_event_organisations enable row level security;

revoke all on public.audit_events, public.audit_event_organisations from public, anon, authenticated;
grant select on public.audit_events, public.audit_event_organisations to authenticated;
grant all on public.audit_events, public.audit_event_organisations to service_role;

drop policy if exists "Audit scope organisations are visible to authorised admins" on public.audit_event_organisations;
create policy "Audit scope organisations are visible to authorised admins"
on public.audit_event_organisations for select to authenticated
using (
  public.current_user_has_any_role(array['superadmin'])
  or public.current_user_has_org_role(org_id, array['admin','org-admin'])
);

drop policy if exists "Audit events are visible to authorised admins" on public.audit_events;
create policy "Audit events are visible to authorised admins"
on public.audit_events for select to authenticated
using (
  public.current_user_has_any_role(array['superadmin'])
  or exists (
    select 1
    from public.audit_event_organisations scope
    where scope.event_id = audit_events.id
      and public.current_user_has_org_role(scope.org_id, array['admin','org-admin'])
  )
);

create or replace function private.audit_safe_uuid(value text)
returns uuid
language plpgsql immutable
set search_path = pg_catalog
as $$
begin
  if value is null or trim(value) = '' then return null; end if;
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.audit_request_json(setting_name text)
returns jsonb
language plpgsql stable
set search_path = pg_catalog
as $$
declare raw_value text;
begin
  raw_value := current_setting(setting_name, true);
  if raw_value is null or trim(raw_value) = '' then return '{}'::jsonb; end if;
  return raw_value::jsonb;
exception when others then
  return '{}'::jsonb;
end;
$$;

create or replace function private.audit_field_is_technical(field_name text)
returns boolean
language sql immutable
set search_path = pg_catalog
as $$
  select field_name = any(array[
    'updated_at','last_read_at','admin_read_at','member_read_at','last_seen_at',
    'retry_count','attempt_count','attempts','heartbeat_at','processed_at','cache_updated_at'
  ]);
$$;

create or replace function private.audit_field_is_sensitive(field_name text)
returns boolean
language sql immutable
set search_path = pg_catalog
as $$
  select lower(field_name) ~
    '(password|token|secret|api.?key|private.?key|cpr|bank|konto|account|encrypted|credential|invite|reset.?url|html|body|message|content|payload|extracted.?data|ai.?result|metadata|address|phone|email|note)';
$$;

create or replace function private.audit_sanitize_row(row_data jsonb)
returns jsonb
language plpgsql immutable
set search_path = pg_catalog
as $$
declare result jsonb := '{}'::jsonb; item record;
begin
  if row_data is null then return '{}'::jsonb; end if;
  for item in select key, value from jsonb_each(row_data)
  loop
    if private.audit_field_is_technical(item.key) then continue; end if;
    result := result || jsonb_build_object(
      item.key,
      case when private.audit_field_is_sensitive(item.key)
        then jsonb_build_object('redacted', true)
        else item.value
      end
    );
  end loop;
  return result;
end;
$$;

create or replace function private.audit_scope_org_ids(table_name text, row_data jsonb, actor_org uuid)
returns uuid[]
language plpgsql stable security definer
set search_path = public, private, auth, pg_catalog
as $$
declare
  scopes uuid[] := '{}'::uuid[];
  direct_org uuid;
  work_ref uuid;
  contract_ref uuid;
  employer_ref uuid;
  holder_ref uuid;
  organisation_ref uuid;
begin
  direct_org := private.audit_safe_uuid(row_data->>'org_id');
  if direct_org is not null then scopes := array_append(scopes, direct_org); end if;

  if table_name = 'organisations' then
    organisation_ref := private.audit_safe_uuid(row_data->>'id');
    if organisation_ref is not null then scopes := array_append(scopes, organisation_ref); end if;
  end if;

  work_ref := case when table_name = 'works'
    then private.audit_safe_uuid(row_data->>'id')
    else private.audit_safe_uuid(row_data->>'work_id') end;
  if work_ref is not null then
    select array_cat(scopes, coalesce(array_agg(distinct org_id), '{}'::uuid[]))
      into scopes from (
        select wo.org_id from public.work_organisations wo where wo.work_id = work_ref
        union
        select w.org_id from public.works w where w.id = work_ref and w.org_id is not null
      ) work_scopes;
  end if;

  contract_ref := case when table_name = 'contracts'
    then private.audit_safe_uuid(row_data->>'id')
    else private.audit_safe_uuid(row_data->>'contract_id') end;
  if contract_ref is not null then
    select array_cat(scopes, coalesce(array_agg(distinct org_id), '{}'::uuid[]))
      into scopes from public.contracts where id = contract_ref and org_id is not null;
  end if;

  employer_ref := case when table_name = 'employers'
    then private.audit_safe_uuid(row_data->>'id')
    else private.audit_safe_uuid(row_data->>'employer_id') end;
  if employer_ref is not null then
    select array_cat(scopes, coalesce(array_agg(distinct org_id), '{}'::uuid[]))
      into scopes from (
        select wo.org_id
        from public.work_employers we
        join public.work_organisations wo on wo.work_id = we.work_id
        where we.employer_id = employer_ref
        union
        select w.org_id
        from public.work_employers we join public.works w on w.id = we.work_id
        where we.employer_id = employer_ref and w.org_id is not null
        union
        select c.org_id
        from public.contract_employers ce join public.contracts c on c.id = ce.contract_id
        where ce.employer_id = employer_ref
      ) employer_scopes;
  end if;

  holder_ref := case when table_name = 'rettighedshavere'
    then private.audit_safe_uuid(row_data->>'id')
    else private.audit_safe_uuid(coalesce(row_data->>'rights_holder_id', row_data->>'rettighedshaver_id')) end;
  if holder_ref is not null then
    select array_cat(scopes, coalesce(array_agg(distinct org_id), '{}'::uuid[]))
      into scopes from public.org_affiliations where rights_holder_id = holder_ref;
  end if;

  if table_name in ('member_messages','member_message_participants') then
    select array_cat(scopes, coalesce(array_agg(distinct thread.org_id), '{}'::uuid[]))
      into scopes
      from public.member_message_threads thread
      where thread.id = private.audit_safe_uuid(row_data->>'thread_id');
  end if;

  if actor_org is not null then scopes := array_append(scopes, actor_org); end if;
  return array(select distinct value from unnest(scopes) value where value is not null);
end;
$$;

revoke all on function private.audit_safe_uuid(text), private.audit_request_json(text),
  private.audit_field_is_technical(text), private.audit_field_is_sensitive(text),
  private.audit_sanitize_row(jsonb), private.audit_scope_org_ids(text,jsonb,uuid) from public, anon, authenticated;

create or replace function private.snapshot_audit_organisation()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if new.org_name is null then
    select name into new.org_name from public.organisations where id = new.org_id;
  end if;
  if new.occurred_at is null then
    select occurred_at into new.occurred_at from public.audit_events where id = new.event_id;
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_audit_organisation() from public, anon, authenticated, service_role;

drop trigger if exists audit_event_organisations_snapshot on public.audit_event_organisations;
create trigger audit_event_organisations_snapshot before insert on public.audit_event_organisations
for each row execute function private.snapshot_audit_organisation();

create or replace function private.capture_audit_row_change()
returns trigger
language plpgsql security definer
set search_path = public, private, auth, pg_catalog
as $$
declare
  before_row jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end;
  after_row jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  effective_row jsonb := case when tg_op = 'DELETE' then before_row else after_row end;
  safe_before jsonb := private.audit_sanitize_row(before_row);
  safe_after jsonb := private.audit_sanitize_row(after_row);
  changed jsonb := '[]'::jsonb;
  field_name text;
  headers jsonb := private.audit_request_json('request.headers');
  jwt jsonb := coalesce(nullif(private.audit_request_json('request.jwt'), '{}'::jsonb), private.audit_request_json('request.jwt.claims'));
  jwt_role text;
  actor_id uuid;
  actor_org uuid;
  actor_role_value text;
  actor_name text;
  actor_email_value text;
  source_value text;
  correlation uuid;
  event_id uuid;
  org_ids uuid[];
  entity_identifier text;
  entity_label_value text;
  action_value text;
  is_service boolean;
begin
  jwt_role := jwt->>'role';
  is_service := coalesce(jwt_role = 'service_role', false);
  if is_service then
    actor_id := private.audit_safe_uuid(headers->>'x-dfks-actor-id');
    actor_org := private.audit_safe_uuid(headers->>'x-dfks-actor-org-id');
    actor_role_value := nullif(headers->>'x-dfks-actor-role', '');
    source_value := coalesce(nullif(headers->>'x-dfks-audit-source',''), 'api');
    correlation := private.audit_safe_uuid(headers->>'x-dfks-correlation-id');
  else
    actor_id := auth.uid();
    source_value := case when headers->>'x-dfks-audit-source' = 'portal' then 'portal' else 'admin' end;
  end if;
  if source_value not in ('portal','admin','api','cron','import','database') then source_value := 'api'; end if;

  org_ids := private.audit_scope_org_ids(tg_table_name, effective_row, actor_org);
  if actor_org is null and cardinality(org_ids) > 0 then actor_org := org_ids[1]; end if;

  if actor_id is not null then
    select coalesce(rh.full_name, usr.email), usr.email
      into actor_name, actor_email_value
      from auth.users usr
      left join public.rettighedshavere rh on rh.user_id = usr.id
      where usr.id = actor_id
      limit 1;
    if actor_role_value is null then
      select role into actor_role_value
      from public.user_org_roles
      where user_id = actor_id and (actor_org is null or org_id = actor_org)
      order by case role when 'superadmin' then 5 when 'admin' then 4 when 'org-admin' then 3 when 'jurist' then 2 when 'viewer' then 1 else 0 end desc
      limit 1;
    end if;
  end if;

  for field_name in
    select distinct key from (
      select jsonb_object_keys(safe_before) key
      union all select jsonb_object_keys(safe_after) key
    ) fields
  loop
    if coalesce(safe_before->field_name, 'null'::jsonb) is distinct from coalesce(safe_after->field_name, 'null'::jsonb) then
      changed := changed || jsonb_build_array(jsonb_build_object(
        'field', field_name,
        'old', coalesce(safe_before->field_name, 'null'::jsonb),
        'new', coalesce(safe_after->field_name, 'null'::jsonb),
        'redacted', private.audit_field_is_sensitive(field_name)
      ));
    end if;
  end loop;

  if tg_op = 'UPDATE' and jsonb_array_length(changed) = 0 then return new; end if;

  entity_identifier := coalesce(
    effective_row->>'id', effective_row->>'contract_id', effective_row->>'work_id',
    effective_row->>'rights_holder_id', effective_row->>'user_id', effective_row->>'thread_id'
  );
  entity_label_value := coalesce(
    nullif(effective_row->>'title',''), nullif(effective_row->>'name',''),
    nullif(effective_row->>'full_name',''), entity_identifier
  );

  action_value := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;
  if tg_op = 'UPDATE' then
    if before_row->>'status' is distinct from after_row->>'status'
      and after_row->>'status' = 'valideret' then action_value := 'validate';
    elsif before_row->>'status' is distinct from after_row->>'status'
      and after_row->>'status' in ('godkendt','approved') then action_value := 'approve';
    elsif (before_row->>'archived_at') is null and (after_row->>'archived_at') is not null
      or (before_row->>'status' is distinct from after_row->>'status' and after_row->>'status' in ('arkiveret','archived')) then action_value := 'archive';
    elsif (before_row->>'archived_at') is not null and (after_row->>'archived_at') is null
      or (before_row->>'status' in ('arkiveret','archived') and after_row->>'status' not in ('arkiveret','archived')) then action_value := 'restore';
    end if;
  end if;

  insert into public.audit_events (
    action, entity_type, entity_id, entity_label, actor_user_id, actor_display_name,
    actor_email, actor_role, actor_type, actor_org_id, source, correlation_id,
    request_id, changes, metadata, missing_actor_context
  ) values (
    action_value,
    tg_table_name, entity_identifier, entity_label_value, actor_id, actor_name,
    actor_email_value, actor_role_value,
    case when actor_id is not null then 'user' when source_value in ('cron','import') then 'integration' else 'system' end,
    actor_org, source_value, correlation, headers->>'x-request-id', changed,
    jsonb_build_object('operation', lower(tg_op), 'table', tg_table_name),
    is_service and actor_id is null
  ) returning id into event_id;

  insert into public.audit_event_organisations(event_id, org_id)
    select event_id, scope_org from unnest(org_ids) scope_org on conflict do nothing;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.capture_audit_row_change() from public, anon, authenticated, service_role;

-- Append-only guard. Retention can only opt in transaction-locally through the
-- restricted purge function below.
create or replace function private.guard_audit_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_setting('dfks.audit_retention', true) = 'on' and tg_op = 'DELETE' then return old; end if;
  raise exception 'Audit events are append-only';
end;
$$;
revoke all on function private.guard_audit_immutability() from public, anon, authenticated, service_role;

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable before update or delete on public.audit_events
for each row execute function private.guard_audit_immutability();
drop trigger if exists audit_event_organisations_immutable on public.audit_event_organisations;
create trigger audit_event_organisations_immutable before update or delete on public.audit_event_organisations
for each row execute function private.guard_audit_immutability();

do $$
declare table_name text; trigger_name text;
begin
  foreach table_name in array array[
    'organisations','org_integrations','user_org_roles','org_affiliations','dfks_members',
    'rettighedshavere','rights_holder_external_identities','works','work_organisations',
    'work_assignments','work_employers','work_distributions','work_production_numbers',
    'work_external_ids','work_change_requests','contracts','contract_episodes',
    'contract_validations','contract_reviews','contract_attachments','contract_employers','contract_comments',
    'screening_claims','screening_claim_comments','work_change_request_comments','employers','employer_aliases','employer_legal_entities',
    'employer_external_ids','employer_registries','producer_association_memberships',
    'broadcasters','message_campaigns','member_message_threads','member_messages',
    'member_message_participants','agreements','overenskomst_satser','legal_notes','reference_docs'
  ]
  loop
    if to_regclass('public.' || table_name) is null then continue; end if;
    trigger_name := 'audit_' || table_name || '_changes';
    execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.capture_audit_row_change()',
      trigger_name, table_name
    );
  end loop;
end $$;

-- Best-effort historical import from the three existing specialist audit trails.
insert into public.audit_events (
  occurred_at, action, entity_type, entity_id, actor_user_id, actor_type, actor_org_id,
  source, changes, metadata, missing_actor_context
)
select created_at, 'delete', 'message_thread', coalesce(message_id::text, thread_id::text),
  admin_user_id, case when admin_user_id is null then 'system' else 'user' end, org_id,
  'database', '[]'::jsonb,
  jsonb_build_object('legacy_table','admin_message_deletion_audit','legacy_id',id,'action',action,'deleted_count',deleted_count),
  admin_user_id is null
from public.admin_message_deletion_audit;

insert into public.audit_events (
  occurred_at, action, entity_type, entity_id, actor_user_id, actor_type, actor_org_id,
  source, changes, metadata, missing_actor_context
)
select changed_at, 'update', 'legal_notes', note_id::text, changed_by,
  case when changed_by is null then 'system' else 'user' end, org_id, 'database',
  jsonb_build_array(jsonb_build_object('field','note','old',jsonb_build_object('redacted',true),'new',jsonb_build_object('redacted',true),'redacted',true)),
  jsonb_build_object('legacy_table','legal_note_history','legacy_id',id), changed_by is null
from public.legal_note_history;

insert into public.audit_events (
  occurred_at, action, entity_type, entity_id, actor_user_id, actor_type,
  source, changes, metadata, missing_actor_context
)
select merged_at, 'merge', 'employers', target_employer_id::text, merged_by,
  case when merged_by is null then 'system' else 'user' end, 'database', '[]'::jsonb,
  jsonb_build_object('legacy_table','employer_merge_audit','legacy_id',id,'source_employer_id',source_employer_id),
  merged_by is null
from public.employer_merge_audit;

-- Attach imported events to organisation snapshots where the legacy table had
-- an explicit org. Global producer merges stay superadmin-only.
insert into public.audit_event_organisations(event_id, org_id, occurred_at)
select event.id, event.actor_org_id, event.occurred_at
from public.audit_events event
where event.actor_org_id is not null
on conflict do nothing;

create or replace function public.purge_expired_audit_events(
  retention interval default interval '7 years',
  batch_size integer default 10000
)
returns integer
language plpgsql security definer
set search_path = public, private, pg_catalog
as $$
declare deleted_count integer;
begin
  if retention < interval '1 year' then raise exception 'Audit retention cannot be shorter than one year'; end if;
  if batch_size < 1 or batch_size > 50000 then raise exception 'Invalid audit purge batch size'; end if;
  perform set_config('dfks.audit_retention', 'on', true);
  delete from public.audit_events
  where id in (
    select id from public.audit_events
    where occurred_at < now() - retention
    order by occurred_at asc
    limit batch_size
  );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.purge_expired_audit_events(interval,integer) from public, anon, authenticated;
grant execute on function public.purge_expired_audit_events(interval,integer) to service_role;

comment on table public.audit_events is
  'Append-only, redacted business audit trail. Login/logout remains in Supabase Auth audit logs.';
