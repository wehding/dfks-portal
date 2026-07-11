-- ============================================================
-- Modul 2: Validering
-- ============================================================

create table contract_validations (
    id                              uuid primary key default gen_random_uuid(),
    contract_id                     uuid not null references contracts(id) on delete cascade,
    org_id                          uuid not null references organisations(id) on delete restrict,

    -- Økonomi
    holiday_pay_rate                numeric(5,2),   -- helligdagsbetaling i %
    beta_rate                       numeric(5,2),   -- BETA fond i %

    -- Klausuler
    has_credit_clause               boolean,        -- kreditering nævnt
    has_termination_clause          boolean,        -- opsigelsesklausul
    termination_days_editor         integer,        -- opsigelsesfrist klipperansvarlig (dage)
    termination_days_producer       integer,        -- opsigelsesfrist arbejdsgiver (dage)
    has_indemnification             boolean,        -- skadesløsholdelse
    has_overenskomst_incorporation  boolean,        -- overenskomstinkorporering (leverandør)

    notes                           text,

    validated_by                    uuid references auth.users(id),
    validated_at                    timestamptz,
    created_at                      timestamptz not null default now(),

    unique (contract_id)
);

-- RLS
alter table contract_validations enable row level security;

create policy "Brugere kan se egne orgs valideringer"
    on contract_validations for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_validations.org_id
        )
    );

create policy "Admins og jurister kan administrere valideringer"
    on contract_validations for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_validations.org_id
              and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
        )
    );
