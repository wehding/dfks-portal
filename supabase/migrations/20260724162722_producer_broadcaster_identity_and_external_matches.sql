-- A canonical producer may itself be a broadcaster/streamer. That identity is
-- inherited by every work linked to the producer; it is not a generic
-- producer-to-many-broadcasters association.
alter table public.employers
  add column if not exists broadcaster_id uuid references public.broadcasters(id) on delete set null;

do $$
begin
  if exists (
    select dfi_company_id from public.employers
    where dfi_company_id is not null and merged_into_id is null
    group by dfi_company_id having count(*) > 1
  ) then
    raise exception 'Duplicate DFI company ids must be resolved before migration';
  end if;
end $$;

create unique index if not exists employers_unique_dfi_company_id
  on public.employers (dfi_company_id)
  where dfi_company_id is not null and merged_into_id is null;

create unique index if not exists employers_unique_broadcaster_identity
  on public.employers (broadcaster_id)
  where broadcaster_id is not null and merged_into_id is null;

comment on column public.employers.broadcaster_id is
  'When set, the canonical producer is the same entity as this broadcaster/streamer.';

-- Stable external company identities make DFI/TMDB imports deterministic after
-- an initial exact, fuzzy or admin-approved match.
create table if not exists public.employer_external_ids (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  source text not null check (source in ('dfi', 'tmdb', 'cvr', 'other')),
  external_id text not null check (length(trim(external_id)) between 1 and 200),
  external_name text,
  match_method text not null default 'admin'
    check (match_method in ('external_id', 'cvr', 'exact_name', 'fuzzy_name', 'admin')),
  match_score integer check (match_score is null or match_score between 0 and 120),
  approved boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employer_external_ids_source_unique
  on public.employer_external_ids (source, external_id);
create index if not exists employer_external_ids_employer_idx
  on public.employer_external_ids (employer_id, source);

alter table public.employer_external_ids enable row level security;

drop policy if exists "Admins read employer external ids" on public.employer_external_ids;
create policy "Admins read employer external ids" on public.employer_external_ids
  for select to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']));
drop policy if exists "Admins manage employer external ids" on public.employer_external_ids;
create policy "Admins manage employer external ids" on public.employer_external_ids
  for all to authenticated
  using (public.current_user_has_any_role(array['superadmin','admin','org-admin']))
  with check (public.current_user_has_any_role(array['superadmin','admin','org-admin']));

revoke all on public.employer_external_ids from anon;
grant select, insert, update, delete on public.employer_external_ids to authenticated;
grant all on public.employer_external_ids to service_role;

alter table public.work_distributions
  add column if not exists source text not null default 'manual',
  add column if not exists inherited_from_employer_id uuid references public.employers(id) on delete cascade;

alter table public.work_distributions
  drop constraint if exists work_distributions_source_check;
alter table public.work_distributions
  add constraint work_distributions_source_check
  check (source in ('manual', 'producer', 'import'));

create unique index if not exists work_distributions_unique_producer_inheritance
  on public.work_distributions (work_id, org_id, inherited_from_employer_id, broadcaster_id)
  where source = 'producer' and inherited_from_employer_id is not null and broadcaster_id is not null;

comment on column public.work_distributions.inherited_from_employer_id is
  'Producer identity that requires this broadcaster relation. Null for manual/imported rows.';

create or replace function public.sync_work_producer_broadcasters(target_work_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Remove only stale inherited data. Manual and imported distributions are
  -- deliberately outside this cleanup.
  delete from public.work_distributions distribution
  where distribution.work_id = target_work_id
    and distribution.source = 'producer'
    and not exists (
      select 1
      from public.work_employers relation
      join public.employers employer on employer.id = relation.employer_id
      where relation.work_id = target_work_id
        and relation.employer_id = distribution.inherited_from_employer_id
        and employer.broadcaster_id = distribution.broadcaster_id
    );

  insert into public.work_distributions (
    org_id, work_id, broadcaster_id, broadcaster_name, distribution_type,
    source, inherited_from_employer_id
  )
  select distinct
    organisation.org_id,
    relation.work_id,
    employer.broadcaster_id,
    null,
    case when broadcaster.content_type in ('tv', 'streaming', 'both')
      then broadcaster.content_type else 'both' end,
    'producer',
    employer.id
  from public.work_employers relation
  join public.employers employer on employer.id = relation.employer_id
  join public.broadcasters broadcaster on broadcaster.id = employer.broadcaster_id
  join (
    select work_id, org_id from public.work_organisations
    union
    select id as work_id, org_id from public.works
  ) organisation on organisation.work_id = relation.work_id
  where relation.work_id = target_work_id
    and employer.broadcaster_id is not null
  on conflict do nothing;
end;
$$;

revoke execute on function public.sync_work_producer_broadcasters(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_work_producer_broadcasters(uuid) to service_role;

create or replace function public.sync_work_producer_broadcasters_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.sync_work_producer_broadcasters(coalesce(new.work_id, old.work_id));
  if tg_op = 'UPDATE' and old.work_id is distinct from new.work_id then
    perform public.sync_work_producer_broadcasters(old.work_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.sync_work_producer_broadcasters_trigger()
  from public, anon, authenticated;

drop trigger if exists work_employers_sync_broadcaster on public.work_employers;
create trigger work_employers_sync_broadcaster
after insert or update or delete on public.work_employers
for each row execute function public.sync_work_producer_broadcasters_trigger();

drop trigger if exists work_organisations_sync_broadcaster on public.work_organisations;
create trigger work_organisations_sync_broadcaster
after insert or update or delete on public.work_organisations
for each row execute function public.sync_work_producer_broadcasters_trigger();

drop trigger if exists work_distributions_preserve_producer_identity on public.work_distributions;
create trigger work_distributions_preserve_producer_identity
after update or delete on public.work_distributions
for each row execute function public.sync_work_producer_broadcasters_trigger();

create or replace function public.sync_employer_broadcaster_change_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  linked_work_id uuid;
begin
  if old.broadcaster_id is not distinct from new.broadcaster_id then
    return new;
  end if;
  for linked_work_id in
    select distinct work_id from public.work_employers where employer_id = new.id
  loop
    perform public.sync_work_producer_broadcasters(linked_work_id);
  end loop;
  return new;
end;
$$;

revoke execute on function public.sync_employer_broadcaster_change_trigger()
  from public, anon, authenticated;

drop trigger if exists employers_sync_broadcaster_identity on public.employers;
create trigger employers_sync_broadcaster_identity
after update of broadcaster_id on public.employers
for each row execute function public.sync_employer_broadcaster_change_trigger();

-- Backfill works for producers that have already been identified before this
-- migration is deployed again in another environment.
do $$
declare
  linked_work_id uuid;
begin
  for linked_work_id in
    select distinct relation.work_id
    from public.work_employers relation
    join public.employers employer on employer.id = relation.employer_id
    where employer.broadcaster_id is not null
  loop
    perform public.sync_work_producer_broadcasters(linked_work_id);
  end loop;
end $$;
