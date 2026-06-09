-- ============================================================
-- Modul 3: Kontraktgennemgang (AI)
-- ============================================================

create table contract_reviews (
    id              uuid primary key default gen_random_uuid(),
    contract_id     uuid references contracts(id) on delete set null,
    org_id          uuid not null references organisations(id) on delete restrict,

    -- Medlemsoplysninger (kan udfyldes manuelt, uafhængigt af contract_id)
    member_name     text,
    member_email    text,

    -- AI-resultat gemt som JSONB (hele ReviewResult-strukturen)
    ai_result       jsonb not null,

    reviewed_by     uuid references auth.users(id),
    reviewed_at     timestamptz not null default now()
);

-- RLS
alter table contract_reviews enable row level security;

create policy "Brugere kan se egne orgs gennemgange"
    on contract_reviews for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_reviews.org_id
        )
    );

create policy "Admins og jurister kan administrere gennemgange"
    on contract_reviews for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_reviews.org_id
              and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
        )
    );
