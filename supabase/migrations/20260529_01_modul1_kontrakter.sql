-- ============================================================
-- Modul 1: Kontrakter + Arbejdsgivere
-- ============================================================

-- Arbejdsgivere (produktionsselskaber, forlag, musikselskaber osv.)
create table employers (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,
    cvr             text,
    address         text,
    contact_name    text,
    contact_email   text,
    contact_phone   text,
    created_at      timestamptz not null default now()
);

-- Arbejdsgiverforeninger (ProF, FDA osv.)
-- En arbejdsgiver kan være medlem af flere foreninger
create table employer_registries (
    id                  uuid primary key default gen_random_uuid(),
    employer_id         uuid not null references employers(id) on delete cascade,
    association_name    text not null,  -- fx 'ProF', 'FDA'
    valid_from          date,
    valid_to            date,
    created_at          timestamptz not null default now()
);

-- Kontrakter
create table contracts (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid not null references organisations(id) on delete restrict,
    employer_id     uuid references employers(id) on delete restrict,
    work_id         uuid,  -- FK til works tilføjes i modul 5
    rights_holder_id uuid references rettighedshavere(id) on delete restrict,
    type            text not null,
    -- Typer: 'a-løn', 'leverandør'
    overenskomst    text,
    -- Værdier: 'de4-fiktion', 'de4-dokumentar', 'faf', 'faf-dokumentar', null
    status          text not null default 'kladde',
    -- Status: 'kladde', 'valideret', 'arkiveret'
    pdf_url         text,
    contract_date   date,
    start_date      date,
    end_date        date,
    created_by      uuid references auth.users(id),
    created_at      timestamptz not null default now()
);

-- Allonger og bilag til kontrakter
create table contract_attachments (
    id              uuid primary key default gen_random_uuid(),
    contract_id     uuid not null references contracts(id) on delete cascade,
    org_id          uuid not null references organisations(id) on delete restrict,
    type            text not null default 'allonge',
    -- Typer: 'allonge', 'bilag', 'andet'
    title           text,
    pdf_url         text,
    created_by      uuid references auth.users(id),
    created_at      timestamptz not null default now()
);

-- Episodedækning for kontrakter (udfyldes kun når kontrakten dækker specifikke afsnit)
-- Ingen rækker = kontrakten dækker hele værket
create table contract_episodes (
    contract_id     uuid not null references contracts(id) on delete cascade,
    episode_id      uuid not null,  -- FK til episodes tilføjes i modul 5
    primary key (contract_id, episode_id)
);

-- RLS
alter table employers enable row level security;
alter table employer_registries enable row level security;
alter table contracts enable row level security;
alter table contract_attachments enable row level security;
alter table contract_episodes enable row level security;

-- Alle indloggede kan se arbejdsgivere (delt stamdata)
create policy "Alle kan se arbejdsgivere"
    on employers for select
    to authenticated
    using (true);

create policy "Alle kan se arbejdsgiverforeninger"
    on employer_registries for select
    to authenticated
    using (true);

-- Admins kan oprette/redigere arbejdsgivere
create policy "Admins kan redigere arbejdsgivere"
    on employers for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

-- Kontrakter er scoped til org
create policy "Brugere kan se egne orgs kontrakter"
    on contracts for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contracts.org_id
        )
    );

create policy "Admins kan administrere kontrakter"
    on contracts for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contracts.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

-- Bilag følger samme adgang som kontrakter
create policy "Brugere kan se egne orgs bilag"
    on contract_attachments for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_attachments.org_id
        )
    );

create policy "Admins kan administrere bilag"
    on contract_attachments for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_attachments.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );
