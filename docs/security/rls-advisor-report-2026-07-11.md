# RLS- og Advisor-slutrapport — 11. juli 2026

## Resultat

Alle identificerede RLS-fejl og databasefunktionsadvarsler er rettet på den tilknyttede Supabase-database.

Rettet:

- Autorisation baseret på `user_metadata`.
- Ubetingede `true`-policies for almindelige brugere.
- Overlappende permissive policies på de gennemgåede tabeller.
- RLS-aktiverede tabeller uden policies.
- Eksponerede `SECURITY DEFINER`-funktioner.
- Funktioner uden fast `search_path`.
- `vector`-udvidelsen i `public`; den ligger nu i `extensions`.
- Lokal/ekstern versionskonflikt for `work_change_requests`; begge bruger nu `20260627203946`.
- Den uanvendte og erstattede migration `20260711051153_secure_core_portal_rls.sql` er fjernet.

## Verifikation

- `supabase/tests/rls_security_assertions.sql` består mod den tilknyttede database.
- Testen dækker almindeligt medlem, midlertidig organisationsadmin, fremmed organisation, manipuleret `user_metadata`, anonym adgang og `service_role`.
- Midlertidige organisationer og roller oprettes i en transaktion og rulles tilbage.
- Semantisk søgning blev kontrolleret efter flytning af `vector`.
- Browserkontrol gennemført for Mine værker, Tilføj værk, Mine kontrakter, Mine visninger, Min profil, Værksadministration og Kontraktadministration.
- Der blev ikke observeret RLS-, PostgREST- eller schema-cache-fejl i browseren.

## Advisor-resultat

Security Advisor returnerer kun:

- `auth_leaked_password_protection` — WARN.

Dette er en Supabase Auth-projektindstilling og ikke en databasepolicy. Den kan aktiveres under Authentication → Attack Protection, når en Supabase Dashboard-administrator er logget ind.

## Migrationshistorik

Migrationshistorikken er baselinet og afstemt:

- Aktiv lokal og ekstern version: `20260711172350_production_baseline_20260711.sql`.
- De tidligere migrationsfiler ligger i `supabase/legacy-migrations` som revisionshistorik.
- Den tidligere eksterne historik med statement-hashes er gemt under `supabase/baseline`.
- Et normalt `supabase db push --linked --dry-run` returnerer `Remote database is up to date`.
- Historikændringen ændrede ikke produktionsschema eller data.

Baselinen blev anvendt på en tom lokal Supabase-database. Fingerprints for kolonner, constraints, funktioner, indeks, triggers, RLS-flags, policies og grants var identiske med produktionen.
