-- ============================================================
-- Modul 5: Værker + Episoder + Arbejdsfordeling
-- ============================================================

-- Værker (serier, film, dokumentarer osv.)
create table works (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references organisations(id) on delete restrict,
    employer_id         uuid references employers(id) on delete restrict,
    title               text not null,
    type                text not null default 'fiktion',
    -- Typer: 'fiktion', 'dokumentar', 'animation', 'serie', 'kort'
    year                integer,
    duration_minutes    integer,    -- kun for enkeltværker
    episode_count       integer,    -- forventet antal afsnit (serier)
    genre               text,
    status              text not null default 'aktiv',
    -- Status: 'aktiv', 'afsluttet', 'arkiveret'
    created_at          timestamptz not null default now()
);

-- Produktionsnumre per TV-station
-- Et værk kan have ét nummer fra DR, ét fra TV 2, osv.
create table work_production_numbers (
    id          uuid primary key default gen_random_uuid(),
    work_id     uuid not null references works(id) on delete cascade,
    tv_station  text not null,   -- fx 'DR', 'TV 2', 'HBO', 'Netflix'
    number      text not null,
    created_at  timestamptz not null default now(),
    unique (work_id, tv_station)
);

-- FK fra contracts til works (tilføjes nu da works-tabellen eksisterer)
alter table contracts
    add constraint contracts_work_id_fkey
    foreign key (work_id) references works(id) on delete restrict;

-- Episoder (afsnit i en serie)
create table episodes (
    id              uuid primary key default gen_random_uuid(),
    work_id         uuid not null references works(id) on delete cascade,
    episode_number  integer not null,
    title           text,
    duration_minutes integer,
    produktionsnr   text,   -- episodens eget produktionsnr. fra TV-stationen
    created_at      timestamptz not null default now(),
    unique (work_id, episode_number)
);

-- FK fra contract_episodes til episodes (tilføjes nu)
alter table contract_episodes
    add constraint contract_episodes_episode_id_fkey
    foreign key (episode_id) references episodes(id) on delete cascade;

-- Arbejdsfordeling: hvem arbejdede på hvad
-- episode_id = null → personen er tilknyttet hele værket
create table work_assignments (
    id              uuid primary key default gen_random_uuid(),
    work_id         uuid not null references works(id) on delete cascade,
    episode_id      uuid references episodes(id) on delete cascade,
    -- null = hele værket
    org_id          uuid not null references organisations(id) on delete restrict,
    rights_holder_id uuid references rettighedshavere(id) on delete set null,
    role            text not null,
    -- Roller: 'klipperansvarlig', 'assistent-klipperansvarlig', 'fotograf', 'instruktør', ...
    contract_id     uuid references contracts(id) on delete set null,
    created_at      timestamptz not null default now()
);

-- RLS
alter table works enable row level security;
alter table work_production_numbers enable row level security;
alter table episodes enable row level security;
alter table work_assignments enable row level security;

create policy "Brugere kan se egne orgs værker"
    on works for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = works.org_id
        )
    );

create policy "Admins kan administrere værker"
    on works for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = works.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

create policy "Brugere kan se produktionsnumre for egne orgs værker"
    on work_production_numbers for select
    to authenticated
    using (
        exists (
            select 1 from works w
            join user_org_roles r on r.org_id = w.org_id
            where w.id = work_production_numbers.work_id
              and r.user_id = auth.uid()
        )
    );

create policy "Brugere kan se episoder for egne orgs værker"
    on episodes for select
    to authenticated
    using (
        exists (
            select 1 from works w
            join user_org_roles r on r.org_id = w.org_id
            where w.id = episodes.work_id
              and r.user_id = auth.uid()
        )
    );

create policy "Brugere kan se arbejdsfordeling for egne orgs værker"
    on work_assignments for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = work_assignments.org_id
        )
    );

create policy "Admins kan administrere arbejdsfordeling"
    on work_assignments for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = work_assignments.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );
