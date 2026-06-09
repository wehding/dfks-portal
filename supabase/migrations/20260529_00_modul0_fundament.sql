-- ============================================================
-- Modul 0: Fundament
-- Organisationer og bruger-til-org roller
-- ============================================================

-- Organisationer (fagforeninger / faggrupper)
create table organisations (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    logo_url    text,
    features    text[] not null default '{}',
    -- Eksempler på features: 'kontrakter', 'validering', 'kontraktgennemgang',
    --   'overenskomster', 'udbetalinger', 'vaerker', 'streaming',
    --   'aftalelicens', 'statistik', 'stamdata', 'gennemsigtighed',
    --   'krediteringer', 'indbetalinger', 'brugere'
    created_at  timestamptz not null default now()
);

-- Bruger-til-org roller
-- En bruger kan have roller i flere organisationer
create table user_org_roles (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    org_id      uuid not null references organisations(id) on delete cascade,
    role        text not null,
    -- Roller: 'superadmin', 'admin', 'org-admin', 'jurist', 'viewer', 'member'
    created_at  timestamptz not null default now(),
    unique (user_id, org_id)
);

-- RLS
alter table organisations enable row level security;
alter table user_org_roles enable row level security;

-- Alle indloggede kan se organisationer
create policy "Alle kan se organisationer"
    on organisations for select
    to authenticated
    using (true);

-- Brugere kan se egne roller
create policy "Brugere kan se egne roller"
    on user_org_roles for select
    to authenticated
    using (user_id = auth.uid());

-- Kun superadmin og admin kan administrere roller (sættes via service role i første omgang)
create policy "Admins kan administrere roller"
    on user_org_roles for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = user_org_roles.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );
