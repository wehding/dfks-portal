-- Rettighedshavere og organisationsopsætning.
-- Additive ændringer: arkivering, organisationsstyrede invitationstekster
-- og krypteret medlems-API-konfiguration pr. organisation.

alter table public.rettighedshavere
  add column if not exists archived_at timestamptz;

comment on column public.rettighedshavere.archived_at is
  'Blød sletning/arkivering. Arkiverede rettighedshavere skjules som standard i admin.';

create index if not exists rettighedshavere_archived_at_idx
  on public.rettighedshavere (archived_at)
  where archived_at is not null;

alter table public.organisations
  add column if not exists invite_email_text text,
  add column if not exists invite_reminder_text text;

comment on column public.organisations.invite_email_text is
  'Organisationens egen brødtekst til invitationsmails. Link og knap tilføjes af systemet.';

comment on column public.organisations.invite_reminder_text is
  'Organisationens egen brødtekst til rykkermails for allerede inviterede rettighedshavere.';

create table if not exists public.org_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null,
  base_url text,
  config_encrypted text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_integrations_provider_check check (provider in ('foreninglet')),
  constraint org_integrations_org_provider_key unique (org_id, provider)
);

comment on table public.org_integrations is
  'Krypteret konfiguration til organisationsspecifikke eksterne integrationer, fx medlems-API.';

comment on column public.org_integrations.config_encrypted is
  'Krypteret JSON med credentials/config. Må aldrig eksponeres client-side.';

alter table public.org_integrations enable row level security;

grant select, insert, update, delete on public.org_integrations to authenticated;
grant all on table public.org_integrations to service_role;

drop policy if exists "Orgadmins kan se integrationer" on public.org_integrations;
create policy "Orgadmins kan se integrationer"
on public.org_integrations
for select
to authenticated
using (
  public.current_user_has_org_role(org_id, array['superadmin', 'admin', 'org-admin'])
);

drop policy if exists "Orgadmins kan oprette integrationer" on public.org_integrations;
create policy "Orgadmins kan oprette integrationer"
on public.org_integrations
for insert
to authenticated
with check (
  public.current_user_has_org_role(org_id, array['superadmin', 'admin', 'org-admin'])
);

drop policy if exists "Orgadmins kan opdatere integrationer" on public.org_integrations;
create policy "Orgadmins kan opdatere integrationer"
on public.org_integrations
for update
to authenticated
using (
  public.current_user_has_org_role(org_id, array['superadmin', 'admin', 'org-admin'])
)
with check (
  public.current_user_has_org_role(org_id, array['superadmin', 'admin', 'org-admin'])
);

drop policy if exists "Orgadmins kan slette integrationer" on public.org_integrations;
create policy "Orgadmins kan slette integrationer"
on public.org_integrations
for delete
to authenticated
using (
  public.current_user_has_org_role(org_id, array['superadmin', 'admin', 'org-admin'])
);
