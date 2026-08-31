-- Del 1 audit lifecycle: attach one semantic audit event to every affected
-- member without duplicating the event itself. Member UUIDs intentionally have
-- no foreign key so the retained audit trail survives later member deletion.

create table public.audit_event_subjects (
  event_id uuid not null references public.audit_events(id) on delete restrict,
  target_member_uuid uuid not null,
  relationship_type text not null default 'subject',
  occurred_at timestamptz not null,
  org_id uuid,
  primary key (event_id, target_member_uuid),
  constraint audit_event_subjects_relationship_length
    check (char_length(relationship_type) between 1 and 40)
);

create index audit_event_subjects_member_occurred_idx
  on public.audit_event_subjects(target_member_uuid, occurred_at desc, event_id desc);
create index audit_event_subjects_org_occurred_idx
  on public.audit_event_subjects(org_id, occurred_at desc, event_id desc)
  where org_id is not null;

alter table public.audit_event_subjects enable row level security;
revoke all on public.audit_event_subjects from public, anon, authenticated, service_role;
grant select on public.audit_event_subjects to authenticated, service_role;

create policy "Audit subjects follow visible audit events"
on public.audit_event_subjects for select to authenticated
using (
  exists (
    select 1
    from public.audit_events event
    where event.id = audit_event_subjects.event_id
  )
);

create trigger audit_event_subjects_immutable
before update or delete on public.audit_event_subjects
for each row execute function private.guard_audit_immutability();

create or replace function private.capture_primary_audit_subject()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if new.target_member_uuid is not null then
    insert into public.audit_event_subjects(
      event_id, target_member_uuid, relationship_type, occurred_at, org_id
    ) values (
      new.id, new.target_member_uuid, 'primary', new.occurred_at, new.actor_org_id
    )
    on conflict (event_id, target_member_uuid) do nothing;
  end if;
  return new;
end;
$$;

create trigger audit_events_capture_primary_subject
after insert on public.audit_events
for each row execute function private.capture_primary_audit_subject();

insert into public.audit_event_subjects(
  event_id, target_member_uuid, relationship_type, occurred_at, org_id
)
select event.id, event.target_member_uuid, 'primary', event.occurred_at, event.actor_org_id
from public.audit_events event
where event.target_member_uuid is not null
on conflict (event_id, target_member_uuid) do nothing;

-- Version 2 remains compatible with the original append function, but accepts
-- all affected members. A controlled cap prevents accidental oversized arrays.
create or replace function public.append_audit_event_v2(
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
  p_target_member_uuids uuid[] default '{}'::uuid[],
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
  created_at timestamptz;
  member_uuid uuid;
  member_uuids uuid[];
  member_set_hash text;
begin
  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
    into member_uuids
  from unnest(coalesce(p_target_member_uuids, '{}'::uuid[]) || array[p_target_member_uuid]) value
  where value is not null;

  if cardinality(member_uuids) > 5000 then
    raise exception 'Too many audit subjects';
  end if;

  select case
    when cardinality(member_uuids) = 0 then null
    else encode(extensions.digest(array_to_string(member_uuids, ','), 'sha256'), 'hex')
  end into member_set_hash;

  created_event_id := public.append_audit_event(
    p_action, p_entity_type, p_entity_id, p_entity_label, p_actor_user_id,
    p_actor_display_name, p_actor_email, p_actor_role, p_actor_type,
    p_actor_org_id, p_source, p_correlation_id, p_request_id, p_changes,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'audit_subject_count', cardinality(member_uuids),
      'audit_subject_set_hash', member_set_hash
    ),
    p_missing_actor_context, coalesce(p_target_member_uuid, member_uuids[1]),
    p_purpose_code, p_legal_basis, p_data_categories, p_ip_address,
    p_system_component, p_outcome, p_error_code, p_org_ids
  );

  select event.occurred_at into created_at
  from public.audit_events event
  where event.id = created_event_id;

  foreach member_uuid in array member_uuids loop
    insert into public.audit_event_subjects(
      event_id, target_member_uuid, relationship_type, occurred_at, org_id
    ) values (
      created_event_id,
      member_uuid,
      case when member_uuid = coalesce(p_target_member_uuid, member_uuids[1]) then 'primary' else 'subject' end,
      created_at,
      p_actor_org_id
    )
    on conflict (event_id, target_member_uuid) do nothing;
  end loop;

  return created_event_id;
end;
$$;

revoke all on function public.append_audit_event_v2(
  text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,
  uuid,uuid[],text,text,text[],inet,text,text,text,uuid[]
) from public, anon, authenticated;
grant execute on function public.append_audit_event_v2(
  text,text,text,text,uuid,text,text,text,text,uuid,text,uuid,text,jsonb,jsonb,boolean,
  uuid,uuid[],text,text,text[],inet,text,text,text,uuid[]
) to service_role;

revoke insert, update, delete on public.audit_event_subjects from service_role;

create or replace function public.verify_audit_event_subjects(p_event_id uuid)
returns boolean
language sql security definer
set search_path = public, extensions, pg_catalog
as $$
  select coalesce(
    (
      select
        coalesce((event.metadata ->> 'audit_subject_count')::integer, 0) = count(subject.target_member_uuid)
        and (
          (count(subject.target_member_uuid) = 0 and event.metadata ->> 'audit_subject_set_hash' is null)
          or event.metadata ->> 'audit_subject_set_hash' = encode(
            extensions.digest(
              string_agg(subject.target_member_uuid::text, ',' order by subject.target_member_uuid),
              'sha256'
            ),
            'hex'
          )
        )
      from public.audit_events event
      left join public.audit_event_subjects subject on subject.event_id = event.id
      where event.id = p_event_id
      group by event.id
    ),
    false
  );
$$;

revoke all on function public.verify_audit_event_subjects(uuid) from public, anon, authenticated;
grant execute on function public.verify_audit_event_subjects(uuid) to service_role;
