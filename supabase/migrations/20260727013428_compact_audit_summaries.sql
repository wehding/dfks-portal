-- Allow a trusted server action to replace many technical row events with one
-- product-facing semantic event. The mode header is deliberately ignored for
-- ordinary authenticated requests so clients cannot suppress their audit trail.

alter table public.audit_events drop constraint if exists audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'create','update','delete','archive','restore','validate','approve','merge','link','unlink',
  'invite','reset_link','export','download','import','sync','job','security_failure','retention'
));

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

  if is_service and headers->>'x-dfks-audit-mode' = 'summary' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

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
