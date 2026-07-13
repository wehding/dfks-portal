-- Fælles værkskatalog (Del 2d).
--
-- Værker (film/serier/afsnit) må gerne deles på tværs af faggrupper, så samme
-- film ikke oprettes igen og igen. PERSONDATA og KONTRAKTER forbliver strengt
-- org-isolerede via deres egne RLS-policies (rettighedshavere, contracts,
-- contract_attachments, contract_comments, work_assignments, work_change_requests) —
-- dem rører vi IKKE her.
--
-- works indeholder KUN værks-metadata (titel, år, sæson/afsnit, tmdb/imdb/wikidata/dfi-id,
-- plakat), ingen personoplysninger. Derfor er det sikkert at lade alle autentificerede
-- brugere LÆSE katalog­et. Oprettelse/redigering/sletning forbliver begrænset til
-- org-admins (uændret — masters baseline satte allerede de policies).
--
-- Bemærk: RLS-adfærd kan ikke verificeres her (ingen DB-adgang i miljøet) —
-- kør migrationen i staging og bekræft murene (se plan Del 2d / verifikation)
-- FØR den tages i produktion.

-- Tilføj en additiv, permissiv SELECT-policy. Postgres OR'er flere permissive
-- SELECT-policies, så den eksisterende org-scopede policy bevares (harmløs).
drop policy if exists "Faelles vaerkskatalog kan laeses" on works;
create policy "Faelles vaerkskatalog kan laeses"
    on works for select
    to authenticated
    using (true);

-- Samme for afsnittenes produktionsnumre (ren metadata, ingen persondata),
-- så et delt værk kan vises komplet på tværs.
drop policy if exists "Faelles produktionsnumre kan laeses" on work_production_numbers;
create policy "Faelles produktionsnumre kan laeses"
    on work_production_numbers for select
    to authenticated
    using (true);
