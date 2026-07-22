alter table public.rettighedshavere
  add column if not exists email_transactional_enabled boolean not null default true,
  add column if not exists email_broadcast_enabled boolean not null default false;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  rights_holder_id uuid not null references public.rettighedshavere(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  category text not null check (category in ('transactional', 'broadcast')),
  entity_type text,
  entity_id uuid,
  to_email text,
  subject text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, event_key)
);

create index if not exists notification_deliveries_org_status_idx
  on public.notification_deliveries (org_id, status, created_at desc);

alter table public.notification_deliveries enable row level security;

create policy "Orgadmins kan se notifikationsleverancer"
  on public.notification_deliveries for select to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin', 'admin', 'org-admin']));

grant select on table public.notification_deliveries to authenticated;
grant all on table public.notification_deliveries to service_role;

comment on table public.notification_deliveries is
  'Idempotent revisionsspor for e-mailnotifikationer. Primære handlinger må ikke fejle ved mailfejl.';
