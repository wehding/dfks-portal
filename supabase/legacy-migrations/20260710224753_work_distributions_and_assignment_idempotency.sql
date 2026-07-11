-- Idempotente værktilknytninger: behold ældste række før unik beskyttelse.
delete from public.work_assignments duplicate
using public.work_assignments keeper
where duplicate.work_id = keeper.work_id
  and duplicate.rights_holder_id = keeper.rights_holder_id
  and duplicate.role = keeper.role
  and duplicate.created_at > keeper.created_at;

create unique index if not exists work_assignments_work_holder_role_uidx
  on public.work_assignments (work_id, rights_holder_id, role)
  where rights_holder_id is not null;

create table if not exists public.work_distributions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  broadcaster_id uuid references public.broadcasters(id) on delete set null,
  broadcaster_name text,
  distribution_type text not null default 'both',
  valid_from_year integer,
  valid_to_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_distributions_name_check check (broadcaster_id is not null or length(trim(broadcaster_name)) > 0),
  constraint work_distributions_type_check check (distribution_type in ('tv', 'streaming', 'both')),
  constraint work_distributions_year_check check (
    (valid_from_year is null or valid_from_year between 1888 and 2200)
    and (valid_to_year is null or valid_to_year between 1888 and 2200)
    and (valid_from_year is null or valid_to_year is null or valid_to_year >= valid_from_year)
  )
);

create index if not exists work_distributions_work_idx on public.work_distributions(work_id);
create index if not exists work_distributions_org_idx on public.work_distributions(org_id);
create unique index if not exists work_distributions_unique_period_idx
  on public.work_distributions (
    work_id,
    coalesce(broadcaster_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(lower(trim(broadcaster_name)), ''),
    distribution_type,
    coalesce(valid_from_year, 0),
    coalesce(valid_to_year, 0)
  );

insert into public.work_distributions (org_id, work_id, broadcaster_id, broadcaster_name)
select w.org_id, pn.work_id, b.id, case when b.id is null then pn.tv_station else null end
from public.work_production_numbers pn
join public.works w on w.id = pn.work_id
left join public.broadcasters b on lower(b.name) = lower(pn.tv_station)
where pn.number = 'broadcast/stream'
on conflict do nothing;

alter table public.work_distributions enable row level security;
grant select on public.work_distributions to authenticated;
grant select, insert, update, delete on public.work_distributions to service_role;

create policy "Brugere kan se distribution for egne orgs"
  on public.work_distributions for select
  to authenticated
  using (exists (
    select 1 from public.user_org_roles r
    where r.user_id = (select auth.uid()) and r.org_id = work_distributions.org_id
  ));

create policy "Admins kan administrere distribution for egne orgs"
  on public.work_distributions for all
  to authenticated
  using (exists (
    select 1 from public.user_org_roles r
    where r.user_id = (select auth.uid())
      and r.org_id = work_distributions.org_id
      and r.role in ('admin', 'org-admin', 'superadmin')
  ))
  with check (exists (
    select 1 from public.user_org_roles r
    where r.user_id = (select auth.uid())
      and r.org_id = work_distributions.org_id
      and r.role in ('admin', 'org-admin', 'superadmin')
  ));

notify pgrst, 'reload schema';
