-- ============================================================
-- Modul 6: Member onboarding — tilføjer kolonner til works og
-- rettighedshavere til brug ved DFI/TMDB-import og onboarding
-- ============================================================

-- Tilføj DFI/TMDB/metadata-kolonner til works
alter table works
    add column if not exists dfi_id         text,
    add column if not exists tmdb_id        integer,
    add column if not exists description    text,
    add column if not exists poster_url     text;

-- Tilføj onboarding + bank + statistik til rettighedshavere
alter table rettighedshavere
    add column if not exists bank_account           text,
    add column if not exists onboarding_completed   boolean not null default false,
    add column if not exists dfi_person_id          integer,
    add column if not exists opt_out_statistics     boolean not null default false;

-- Members kan se og redigere egne rettighedshavere
create policy if not exists "Bruger kan se eget rettighedshaver-objekt"
    on rettighedshavere for select
    to authenticated
    using (user_id = auth.uid());

create policy if not exists "Bruger kan opdatere eget rettighedshaver-objekt"
    on rettighedshavere for update
    to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- Members kan oprette nye værker (DFI-import under onboarding)
create policy if not exists "Authenticated kan oprette værker via DFI-import"
    on works for insert
    to authenticated
    with check (true);

-- Members kan se og redigere egne work_assignments
create policy if not exists "Bruger kan se egne work_assignments"
    on work_assignments for select
    to authenticated
    using (
        exists (
            select 1 from rettighedshavere rh
            where rh.id = work_assignments.rights_holder_id
              and rh.user_id = auth.uid()
        )
    );

create policy if not exists "Bruger kan oprette egne work_assignments"
    on work_assignments for insert
    to authenticated
    with check (
        exists (
            select 1 from rettighedshavere rh
            where rh.id = work_assignments.rights_holder_id
              and rh.user_id = auth.uid()
        )
    );
