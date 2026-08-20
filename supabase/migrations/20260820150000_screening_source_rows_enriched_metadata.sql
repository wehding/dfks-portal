-- Udvider screening_source_rows med berigende metadata fra EPG-kilder som Simply.TV.
-- Navngivning bevidst matchet mod works-tabellen (production_countries, production_companies,
-- genre, description, imdb_id) for at gøre fremtidig værk-matching lettere.
-- Alle felter er valgfrie — kun titel/kanal/dato er påkrævet for selve importen.

alter table public.screening_source_rows
  add column if not exists production_countries text[],
  add column if not exists directors text[],
  add column if not exists genre text,
  add column if not exists category text,
  add column if not exists description text,
  add column if not exists production_companies text[],
  add column if not exists imdb_id text;
