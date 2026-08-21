-- Medklipper is a relative presentation label, not a persisted professional role.
-- Special credits (for example B-klipper) are intentionally left untouched.
create schema if not exists private;

create table if not exists private.work_assignment_role_normalization_archive (
  source_assignment_id uuid primary key,
  replacement_assignment_id uuid not null,
  source_row jsonb not null,
  archived_at timestamptz not null default now()
);

revoke all on table private.work_assignment_role_normalization_archive from public, anon, authenticated;

do $$
declare
  conflict_count integer;
  foreign_key_count integer;
  source_row public.work_assignments%rowtype;
  target_id uuid;
  default_role text;
begin
  -- The merge below is only safe while no other table references assignment IDs.
  -- Fail closed if a future schema introduces such a relation.
  select count(*) into foreign_key_count
  from pg_constraint
  where contype = 'f'
    and confrelid = 'public.work_assignments'::regclass;

  if foreign_key_count > 0 then
    raise exception
      'Medklipper-normalisering stoppet: work_assignments har % fremmednøglereference(r)',
      foreign_key_count;
  end if;

  -- Fail closed if duplicate candidates carry different meaningful relations.
  with defaults as (
    select org.id as org_id,
      case
        when nullif(trim(org.terminology ->> 'default_role_label'), '') is not null
          and lower(trim(org.terminology ->> 'default_role_label')) <> 'medklipper'
          then trim(org.terminology ->> 'default_role_label')
        when lower(org.name) like '%filmklip%' then 'Klipper'
        else 'Medskaber'
      end as default_role
    from public.organisations org
  ),
  candidates as (
    select assignment.*, defaults.default_role
    from public.work_assignments assignment
    join defaults on defaults.org_id = assignment.org_id
    where assignment.rights_holder_id is not null
      and (
        lower(trim(assignment.role)) = 'medklipper'
        or lower(trim(assignment.role)) = lower(defaults.default_role)
      )
  ),
  conflicts as (
    select org_id, work_id, rights_holder_id
    from candidates
    group by org_id, work_id, rights_holder_id
    having bool_or(lower(trim(role)) = 'medklipper')
      and count(*) > 1
      and (
        count(distinct episode_id) filter (where episode_id is not null) > 1
        or count(distinct contract_id) filter (where contract_id is not null) > 1
        or count(distinct share_percent) filter (where share_percent is not null) > 1
      )
  )
  select count(*) into conflict_count from conflicts;

  if conflict_count > 0 then
    raise exception
      'Medklipper-normalisering stoppet: % dubletgruppe(r) har modstridende relationer',
      conflict_count;
  end if;

  for source_row in
    select assignment.*
    from public.work_assignments assignment
    where lower(trim(assignment.role)) = 'medklipper'
    order by assignment.created_at, assignment.id
  loop
    select case
      when nullif(trim(org.terminology ->> 'default_role_label'), '') is not null
        and lower(trim(org.terminology ->> 'default_role_label')) <> 'medklipper'
        then trim(org.terminology ->> 'default_role_label')
      when lower(org.name) like '%filmklip%' then 'Klipper'
      else 'Medskaber'
    end
    into default_role
    from public.organisations org
    where org.id = source_row.org_id;

    default_role := coalesce(nullif(default_role, ''), 'Medskaber');
    target_id := null;

    if source_row.rights_holder_id is not null then
      select existing.id
      into target_id
      from public.work_assignments existing
      where existing.id <> source_row.id
        and existing.work_id = source_row.work_id
        and existing.rights_holder_id = source_row.rights_holder_id
        and lower(trim(existing.role)) = lower(default_role)
      order by existing.created_at, existing.id
      limit 1;
    end if;

    if target_id is null then
      update public.work_assignments
      set role = default_role
      where id = source_row.id;
    else
      update public.work_assignments target
      set episode_id = coalesce(target.episode_id, source_row.episode_id),
          contract_id = coalesce(target.contract_id, source_row.contract_id),
          share_percent = coalesce(target.share_percent, source_row.share_percent),
          created_at = least(target.created_at, source_row.created_at)
      where target.id = target_id;

      insert into private.work_assignment_role_normalization_archive (
        source_assignment_id,
        replacement_assignment_id,
        source_row
      ) values (
        source_row.id,
        target_id,
        to_jsonb(source_row)
      )
      on conflict (source_assignment_id) do nothing;

      delete from public.work_assignments
      where id = source_row.id;
    end if;
  end loop;
end
$$;

update public.work_share_participants participant
set role = case
  when nullif(trim(org.terminology ->> 'default_role_label'), '') is not null
    and lower(trim(org.terminology ->> 'default_role_label')) <> 'medklipper'
    then trim(org.terminology ->> 'default_role_label')
  when lower(org.name) like '%filmklip%' then 'Klipper'
  else 'Medskaber'
end,
updated_at = now()
from public.organisations org
where participant.org_id = org.id
  and lower(trim(participant.role)) = 'medklipper';

create or replace function private.normalize_relative_work_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  configured_default text;
  configured_coeditor text;
begin
  select
    case
      when nullif(trim(org.terminology ->> 'default_role_label'), '') is not null
        and lower(trim(org.terminology ->> 'default_role_label')) <> 'medklipper'
        then trim(org.terminology ->> 'default_role_label')
      when lower(org.name) like '%filmklip%' then 'Klipper'
      else 'Medskaber'
    end,
    coalesce(nullif(trim(org.terminology ->> 'coeditor_word'), ''), 'Medklipper')
  into configured_default, configured_coeditor
  from public.organisations org
  where org.id = new.org_id;

  if lower(trim(new.role)) = 'medklipper'
    or lower(trim(new.role)) = lower(configured_coeditor)
  then
    new.role := coalesce(nullif(configured_default, ''), 'Medskaber');
  end if;
  return new;
end
$$;

revoke all on function private.normalize_relative_work_role() from public, anon, authenticated;

drop trigger if exists normalize_relative_work_assignment_role on public.work_assignments;
create trigger normalize_relative_work_assignment_role
before insert or update of role, org_id on public.work_assignments
for each row execute function private.normalize_relative_work_role();

drop trigger if exists normalize_relative_share_participant_role on public.work_share_participants;
create trigger normalize_relative_share_participant_role
before insert or update of role, org_id on public.work_share_participants
for each row execute function private.normalize_relative_work_role();
