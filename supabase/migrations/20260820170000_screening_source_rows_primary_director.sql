-- Bro-felt til works.director (ental tekstfelt, ikke array) — indtil en
-- eventuel fremtidig opgradering af works.director til array besluttes.
-- Se ARKITEKTUR-works-director-array.md for baggrund og åbne spørgsmål.
--
-- directors (text[], tilføjet i 20260820160000) bevares uændret som den
-- fulde, rige kilde — primary_director er kun en afledt bekvemmeligheds-
-- kolonne (directors[0]) til simpel matching, ikke en erstatning.

alter table public.screening_source_rows
  add column if not exists primary_director text;
