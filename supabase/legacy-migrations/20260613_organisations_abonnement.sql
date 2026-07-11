-- ============================================================
-- Organisationer — abonnement og moduladgang
-- Tilføjer kolonner til eksisterende organisations-tabel
-- ============================================================

alter table organisations
    add column if not exists updated_at    timestamptz not null default now(),
    add column if not exists cvr           text unique,
    add column if not exists contact_name  text,
    add column if not exists contact_email text,
    add column if not exists plan          text not null default 'basis',
    add column if not exists max_users     int not null default 5,
    add column if not exists module_contracts  boolean not null default false,
    add column if not exists module_streaming  boolean not null default false,
    add column if not exists module_archive    boolean not null default false,
    add column if not exists active        boolean not null default true;

-- Upsert eksisterende DFKS-org med korrekte værdier
insert into organisations (
    id, name, cvr, contact_name, contact_email,
    plan, max_users,
    module_contracts, module_streaming, module_archive,
    active
)
values (
    '3dfcad23-03ce-4de0-82f2-6566dfcd88a5',
    'DFKS',
    '00000000',
    'Martin Wehding',
    'martin@wehding.dk',
    'enterprise',
    -1,
    true,
    true,
    true,
    true
)
on conflict (id) do update set
    cvr           = excluded.cvr,
    contact_name  = excluded.contact_name,
    contact_email = excluded.contact_email,
    plan          = excluded.plan,
    max_users     = excluded.max_users,
    module_contracts  = excluded.module_contracts,
    module_streaming  = excluded.module_streaming,
    module_archive    = excluded.module_archive,
    active        = excluded.active,
    updated_at    = now();

-- unique(user_id, org_id) i user_org_roles forhindrer multi-rolle.
-- Fjern constraint så en bruger kan have flere roller i samme org.
alter table user_org_roles
    drop constraint if exists user_org_roles_user_id_org_id_key;

-- Ny unik constraint: én post per (user, org, role) i stedet
alter table user_org_roles
    add constraint user_org_roles_user_org_role_key
    unique (user_id, org_id, role);

-- RLS: admins kan se og redigere alle organisationer
create policy "Superadmin kan administrere organisationer"
    on organisations for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.role = 'superadmin'
        )
    )
    with check (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.role = 'superadmin'
        )
    );
