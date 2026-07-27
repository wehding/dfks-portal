create table public.work_identity_resolutions (
  work_id uuid primary key references public.works(id) on delete cascade,
  status text not null default 'unresolved'
    check (status in ('unresolved', 'matched', 'review_required', 'not_found', 'error')),
  input_fingerprint text not null,
  confidence smallint check (confidence between 0 and 100),
  candidates jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidates) = 'array'),
  sources text[] not null default '{}'::text[],
  last_attempted_at timestamptz,
  error_code text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.work_identity_resolutions is
  'Sikker status og kandidater fra den faelles eksterne vaerkidentitetsresolver. Komplette API-svar og API-noegler maa ikke gemmes.';

create index work_identity_resolutions_status_attempt_idx
  on public.work_identity_resolutions(status, last_attempted_at desc nulls last);

alter table public.work_identity_resolutions enable row level security;

revoke all on table public.work_identity_resolutions from anon;
revoke all on table public.work_identity_resolutions from authenticated;
grant select on table public.work_identity_resolutions to authenticated;
grant all on table public.work_identity_resolutions to service_role;

create policy "Superadmins kan se vaerkidentitetskontrol"
  on public.work_identity_resolutions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_org_roles role_row
      where role_row.user_id = (select auth.uid())
        and role_row.role = 'superadmin'
    )
  );
