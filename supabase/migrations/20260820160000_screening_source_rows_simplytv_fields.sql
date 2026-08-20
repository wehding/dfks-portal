-- Udvider screening_source_rows med de resterende felter fra Simply.TV-
-- specifikationen (TASK-epg-sendedata-arkitektur.md), som ikke var med i
-- den første udvidelse (20260820150000).
--
-- episode_id er PRIMÆR MATCHINGNØGLE — stabilt indholds-ID, genbruges ved
-- genudsendelser af samme program. Adskilt fra "episode" (heltal,
-- afsnitsnummer), som allerede findes.

alter table public.screening_source_rows
  add column if not exists broadcast_time text,
  add column if not exists listing_id text,
  add column if not exists series_id text,
  add column if not exists episode_id text,
  add column if not exists original_title text,
  add column if not exists episode_title text,
  add column if not exists actors text,
  add column if not exists editorial_link text,
  add column if not exists broadcast_title text;

-- episode_id er den stabile nøgle til at genkende genudsendelser af samme
-- indhold — indeks til fremtidig opslag/deduplikering.
create index if not exists screening_source_rows_episode_id_idx
  on public.screening_source_rows (org_id, episode_id)
  where episode_id is not null;

-- NOTER TIL FREMTIDIG MATCHING MOD works (ingen matching-pipeline findes endnu):
--
-- 1. directors (text[] her) vs. works.director (ental tekstfelt). Bevidst
--    forskel — Simply.TV leverer Director1+Director2 som to separate felter,
--    men works har kun ét, enkelt instruktørfelt. Matching-koden skal
--    eksplicit afgøre, hvordan array'et forenes til ét felt (fx "første
--    instruktør", eller sammensæt med komma) — ikke en direkte 1:1-kobling.
--
-- 2. season/episode (heltal, allerede eksisterende felter på denne tabel,
--    ikke tilføjet i denne migration) vs. works.season_number/episode_number.
--    Navngivningen er bevidst IKKE ensrettet her — season/episode stammer
--    fra tabellens oprindelige skema og bruges allerede i den eksisterende
--    matching-funktion (findScreeningSourceMatch i app/actions/screenings.ts).
--    En omdøbning nu ville være en større, mere risikabel ændring end blot
--    at udvide skemaet. Fremtidig matching-kode skal kende den korrekte
--    sammenkobling (screening_source_rows.season ↔ works.season_number),
--    ikke forvente identisk navngivning.
--
-- 3. original_title (her, fra Simply.TV) er BEVIDST forskelligt fra
--    works.dfi_original_title (fra DFI) — de har forskellig kildeprovenens
--    og bør forblive adskilte felter, ikke slås sammen til ét.
