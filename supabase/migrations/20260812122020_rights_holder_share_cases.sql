create table public.work_share_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  season_number integer check (season_number is null or season_number > 0),
  episode_number integer check (episode_number is null or episode_number > 0),
  status text not null default 'awaiting_members'
    check (status in ('awaiting_members', 'awaiting_admin', 'resolved', 'reopened')),
  resolution_scope text not null default 'work'
    check (resolution_scope in ('work', 'season', 'episode')),
  reserve_percent numeric(6,3) not null default 0
    check (reserve_percent >= 0 and reserve_percent <= 100),
  resolution_history jsonb not null default '[]'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index work_share_cases_scope_uidx on public.work_share_cases (
  org_id, work_id, coalesce(season_number, 0), coalesce(episode_number, 0)
);
create index work_share_cases_org_status_idx on public.work_share_cases (org_id, status, updated_at desc);

create table public.work_share_participants (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.work_share_cases(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  rights_holder_id uuid references public.rettighedshavere(id) on delete cascade,
  proposed_name text,
  role text not null default 'Klipper',
  relationship_status text not null default 'pending'
    check (relationship_status in ('pending', 'confirmed', 'declined', 'pending_match')),
  response_scope text check (response_scope is null or response_scope in ('work', 'season', 'episode')),
  proposed_percent numeric(6,3) check (proposed_percent is null or (proposed_percent >= 0 and proposed_percent <= 100)),
  admin_seed_percent numeric(6,3) check (admin_seed_percent is null or (admin_seed_percent >= 0 and admin_seed_percent <= 100)),
  final_percent numeric(6,3) check (final_percent is null or (final_percent >= 0 and final_percent <= 100)),
  invited_by_rights_holder_id uuid references public.rettighedshavere(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_share_participant_identity_check check (
    rights_holder_id is not null or length(trim(coalesce(proposed_name, ''))) > 0
  )
);

create unique index work_share_participants_holder_uidx
  on public.work_share_participants (case_id, rights_holder_id)
  where rights_holder_id is not null;
create index work_share_participants_holder_status_idx
  on public.work_share_participants (rights_holder_id, relationship_status, updated_at desc)
  where rights_holder_id is not null;
create index work_share_participants_case_idx on public.work_share_participants (case_id, created_at);

comment on table public.work_share_cases is
  'Afstemning af rettighedshaveres arbejdsandele pr. værk, sæson eller afsnit. Foreløbige medlemssvar offentliggøres ikke.';
comment on column public.work_share_cases.reserve_percent is
  'Andel reserveret af admin til fremtidige krav; kendte slutandele plus reserve skal være 100 procent.';
comment on column public.work_share_participants.admin_seed_percent is
  'Eksisterende historisk andel til adminens udgangspunkt; er ikke et medlemssvar.';
comment on column public.work_share_participants.final_percent is
  'Offentliggøres først, når sagen er afsluttet og kopieres derefter til work_assignments.share_percent.';

alter table public.work_share_cases enable row level security;
alter table public.work_share_participants enable row level security;
revoke all on public.work_share_cases from public, anon, authenticated;
revoke all on public.work_share_participants from public, anon, authenticated;
grant select on public.work_share_participants to authenticated;
grant all on public.work_share_cases to service_role;
grant all on public.work_share_participants to service_role;

create policy "Members read own share tasks"
  on public.work_share_participants for select to authenticated
  using (rights_holder_id is not null and public.current_user_is_member_owner(rights_holder_id));

create policy "Admins read organisation share participants"
  on public.work_share_participants for select to authenticated
  using (public.current_user_can_admin_org(org_id));

-- Eksisterende flermandsværker får opgaver uden mail. En gammel share_percent
-- er kun et administrativt udgangspunkt og registreres ikke som medlemssvar.
with multi_holder_works as (
  select assignment.org_id, assignment.work_id
  from public.work_assignments assignment
  where assignment.rights_holder_id is not null
  group by assignment.org_id, assignment.work_id
  having count(distinct assignment.rights_holder_id) > 1
), inserted_cases as (
  insert into public.work_share_cases (org_id, work_id, season_number, episode_number, status, resolution_scope)
  select multi.org_id, multi.work_id, work.season_number, work.episode_number, 'awaiting_members',
    case when work.episode_number is not null then 'episode'
         when work.season_number is not null then 'season'
         else 'work' end
  from multi_holder_works multi
  join public.works work on work.id = multi.work_id
  on conflict do nothing
  returning id, org_id, work_id
)
insert into public.work_share_participants (
  case_id, org_id, work_id, rights_holder_id, role, relationship_status, admin_seed_percent
)
select share_case.id, assignment.org_id, assignment.work_id, assignment.rights_holder_id,
  assignment.role, 'pending', assignment.share_percent
from public.work_share_cases share_case
join multi_holder_works multi on multi.org_id = share_case.org_id and multi.work_id = share_case.work_id
join public.work_assignments assignment
  on assignment.org_id = multi.org_id and assignment.work_id = multi.work_id
where assignment.rights_holder_id is not null
on conflict (case_id, rights_holder_id) where rights_holder_id is not null do nothing;

-- Kun denne server-only funktion må ændre en kontrakt fra en ikke-valideret
-- status til valideret. Import- og AI-workers rammer triggeren, hvis de forsøger.
create or replace function public.validate_contracts_explicitly(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_contract_ids uuid[]
) returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  changed_count integer;
begin
  if not exists (
    select 1 from public.user_org_roles role_row
    where role_row.user_id = p_actor_user_id
      and (role_row.org_id = p_org_id or role_row.role = 'superadmin')
      and role_row.role in ('superadmin', 'admin', 'org-admin', 'jurist')
  ) then
    raise exception 'Ikke autoriseret til kontraktvalidering';
  end if;
  perform set_config('app.explicit_contract_validation', 'on', true);
  update public.contracts
  set status = 'valideret'
  where org_id = p_org_id and id = any(p_contract_ids) and status <> 'valideret';
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.validate_contracts_explicitly(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.validate_contracts_explicitly(uuid, uuid, uuid[]) to service_role;

create or replace function private.guard_contract_validation_transition()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if new.status = 'valideret'
     and old.status is distinct from 'valideret'
     and coalesce(current_setting('app.explicit_contract_validation', true), '') <> 'on' then
    raise exception 'Kontrakter skal valideres gennem den eksplicitte adminhandling';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_contract_validation_transition on public.contracts;
create trigger guard_contract_validation_transition
before update of status on public.contracts
for each row execute function private.guard_contract_validation_transition();
