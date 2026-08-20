-- Retter fejlen "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification" ved genimport (upsert).
--
-- Rodårsag: det oprindelige indeks (20260820190000) var et PARTIELT unikt
-- indeks (WHERE listing_id is not null). Postgres' ON CONFLICT (kolonner)
-- kan ikke pålideligt matche et partielt indeks via en simpel kolonneliste
-- — det kræver typisk at ON CONFLICT-klausulen selv gentager WHERE-
-- betingelsen, hvilket Supabase-klientens upsert({ onConflict: "..." })
-- ikke understøtter.
--
-- Løsning: en almindelig (ikke-partiel) UNIQUE CONSTRAINT opnår samme
-- praktiske effekt uden behov for WHERE-filteret — Postgres behandler i
-- forvejen NULL-værdier som forskellige fra hinanden i almindelige unikke
-- constraints (medmindre NULLS NOT DISTINCT eksplicit angives), så rækker
-- uden listing_id kan stadig sameksistere uden at kollidere med hinanden,
-- præcis som det partielle indeks tilsigtede.

drop index if exists public.screening_source_rows_org_source_listing_id_idx;

alter table public.screening_source_rows
  add constraint screening_source_rows_org_source_listing_id_key
  unique (org_id, source, listing_id);
