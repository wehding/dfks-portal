-- Dublet-beskyttelse ved genimport af samme kildefil (fx en admin, der ved
-- en fejl uploader den samme Simply.TV-eksport to gange). listing_id er
-- Simply.TVs egen, dokumenterede "unik nøgle pr. udsendelse" (se
-- TASK-epg-sendedata-arkitektur.md) — det naturlige grundlag for
-- dublet-beskyttelse, når det er tilgængeligt.
--
-- Partiel unik-indeks (kun hvor listing_id IKKE er null) — rækker uden
-- listing_id (fra kilder der ikke leverer det) er IKKE beskyttet af denne
-- constraint og kan stadig dubleres. Det er en bevidst afgrænsning, ikke en
-- fuld løsning for alle kilder.

create unique index if not exists screening_source_rows_org_source_listing_id_idx
  on public.screening_source_rows (org_id, source, listing_id)
  where listing_id is not null;
