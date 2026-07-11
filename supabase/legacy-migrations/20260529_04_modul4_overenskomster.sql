-- ============================================================
-- Modul 4: Overenskomster + Juridiske noter
-- org_id = null betyder fælles for alle organisationer
-- ============================================================

-- Overenskomster og referencedokumenter
create table agreements (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid references organisations(id) on delete cascade,
    -- null = fælles (De4, FAF osv.), sat = fagspecifik
    title       text not null,
    doc_type    text not null default 'overenskomst',
    -- Typer: 'overenskomst', 'lønbilag', 'vejledning', 'skabelon'
    content_url text,
    is_primary  boolean not null default false,
    valid_from  date,
    valid_to    date,
    created_at  timestamptz not null default now()
);

-- Referencedokumenter (bruges i Section A i UI)
create table reference_docs (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid references organisations(id) on delete cascade,
    -- null = fælles
    title       text not null,
    url         text,
    doc_type    text not null default 'dokument',
    created_at  timestamptz not null default now()
);

-- Juridiske noteringer (bruges i Section C i UI og sendes til AI)
create table legal_notes (
    id                          uuid primary key default gen_random_uuid(),
    org_id                      uuid references organisations(id) on delete cascade,
    -- null = fælles
    scope                       text[] not null default '{}',
    -- Tom array = alle orgs, ellers liste af org_id som tekst
    title                       text not null,
    body                        text not null,
    priority                    text not null default 'orientering',
    -- Prioriteter: 'aktiv-indsats', 'altid-tjek', 'orientering'
    active                      boolean not null default true,
    exclude_for_overenskomst    text[] not null default '{}',
    -- Ekskluderes når overenskomst matcher (fx 'de4-fiktion')
    sort_order                  integer not null default 0,
    created_at                  timestamptz not null default now()
);

-- Historik over ændringer til juridiske noter
create table legal_note_history (
    id          uuid primary key default gen_random_uuid(),
    note_id     uuid not null references legal_notes(id) on delete cascade,
    changed_by  uuid references auth.users(id),
    org_id      uuid references organisations(id),
    old_value   jsonb not null,
    changed_at  timestamptz not null default now()
);

-- RLS
alter table agreements enable row level security;
alter table reference_docs enable row level security;
alter table legal_notes enable row level security;
alter table legal_note_history enable row level security;

-- Fælles dokumenter (org_id = null) er synlige for alle indloggede
-- Org-specifikke dokumenter kun for den relevante org
create policy "Alle kan se relevante overenskomster"
    on agreements for select
    to authenticated
    using (
        org_id is null
        or exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = agreements.org_id
        )
    );

create policy "Admins kan administrere overenskomster"
    on agreements for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

create policy "Alle kan se relevante referencedokumenter"
    on reference_docs for select
    to authenticated
    using (
        org_id is null
        or exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = reference_docs.org_id
        )
    );

create policy "Alle kan se relevante juridiske noter"
    on legal_notes for select
    to authenticated
    using (
        org_id is null
        or exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = legal_notes.org_id
        )
    );

create policy "Admins og jurister kan administrere juridiske noter"
    on legal_notes for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
        )
    );

create policy "Admins kan se historik"
    on legal_note_history for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );
