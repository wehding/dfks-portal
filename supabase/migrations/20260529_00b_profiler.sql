-- ============================================================
-- Modul 0b: Rettighedshavere + Org-tilknytning
--
-- Adskiller to ting:
--   rettighedshavere  — personer der kan modtage udbetalinger
--   org_affiliations  — tilknytning til en org (medlem/ikke-medlem)
--
-- En rettighedshaver behøver ikke portallogin.
-- En portalbruger (auth.users) er typisk også rettighedshaver.
-- En person kan være tilknyttet flere organisationer.
-- ============================================================

create table rettighedshavere (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid unique references auth.users(id) on delete set null,
    -- null = ingen portallogin; sat = personen kan logge ind
    full_name   text not null,
    email       text,
    phone       text,
    address     text,
    cpr_no      text,
    -- CPR bruges til SKAT-indberetning ved udbetalinger
    -- Overvej kryptering via pgcrypto inden go-live med rigtige data
    -- bank_account tilføjes i modul 6 (udbetalinger)
    created_at  timestamptz not null default now()
);

-- Tilknytning til organisation (medlem eller ikke-medlem)
create table org_affiliations (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references organisations(id) on delete cascade,
    rights_holder_id    uuid not null references rettighedshavere(id) on delete cascade,
    is_member           boolean not null default false,
    member_no           text,
    -- Kun relevant når is_member = true
    valid_from          date,
    valid_to            date,
    -- null = aktiv tilknytning; dato = udmeldt/afsluttet
    created_at          timestamptz not null default now(),
    unique (org_id, rights_holder_id)
);

-- Trigger: opret rettighedshaver automatisk ved ny Auth-bruger
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into rettighedshavere (user_id, full_name, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', ''),
        new.email
    );
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure handle_new_user();

-- RLS
alter table rettighedshavere enable row level security;
alter table org_affiliations enable row level security;

-- Rettighedshavere kan se og redigere egne data
create policy "Rettighedshaver kan se og redigere egne data"
    on rettighedshavere for all
    to authenticated
    using (user_id = auth.uid());

-- Admins kan se alle rettighedshavere tilknyttet deres org
create policy "Admins kan se rettighedshavere i egen org"
    on rettighedshavere for select
    to authenticated
    using (
        exists (
            select 1 from org_affiliations a
            join user_org_roles r on r.org_id = a.org_id
            where a.rights_holder_id = rettighedshavere.id
              and r.user_id = auth.uid()
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

-- Admins kan oprette og redigere rettighedshavere i deres org
create policy "Admins kan administrere rettighedshavere i egen org"
    on rettighedshavere for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

-- Admins kan se tilknytninger i deres org
create policy "Admins kan se org_affiliations i egen org"
    on org_affiliations for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = org_affiliations.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

-- Admins kan oprette, redigere og skifte medlemsstatus
create policy "Admins kan administrere org_affiliations i egen org"
    on org_affiliations for all
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = org_affiliations.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

-- Rettighedshavere kan se egne tilknytninger
create policy "Rettighedshaver kan se egne tilknytninger"
    on org_affiliations for select
    to authenticated
    using (
        exists (
            select 1 from rettighedshavere rh
            where rh.id = org_affiliations.rights_holder_id
              and rh.user_id = auth.uid()
        )
    );
