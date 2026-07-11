# Databasebaseline — 11. juli 2026

## Formål

De oprindelige migrationsfiler brugte både kolliderende korte versionsnumre og nyere 14-cifrede versioner. Baselineforløbet samler den faktiske produktionsstruktur i én testet startmigration uden at ændre produktionsdata.

## Artefakter

- Aktiv migration: `supabase/migrations/20260711172350_production_baseline_20260711.sql`
- Produktionssnapshot: `supabase/baseline/production-schema-20260711.sql`
- Tidligere migrationshistorik: `supabase/baseline/remote-migration-history-before-baseline.json`
- Arkiverede SQL-filer: `supabase/legacy-migrations`
- Sammenligning: `supabase/tests/schema_fingerprint.sql`
- RLS-test: `supabase/tests/rls_security_assertions.sql`

## Test på tom database

Baselinen blev kørt på en ny lokal Supabase-database via Docker Desktop. Det første rådump blev afvist, fordi det indeholdt Supabase-administrerede funktioner fra `extensions`. Den endelige baseline indeholder derfor kun `public` og `private` samt en eksplicit deklaration af `vector` i `extensions`.

## Fingerprints

| Kategori | Antal | Fingerprint |
|---|---:|---|
| Kolonner | 425 | `5d7efe7303859027b3c8787593ff0709` |
| Constraints | 143 | `c9e922ee023b55d7e0e91fb4ee5be779` |
| Funktioner | 24 | `500f32a31efa093b240dffdfd2829b43` |
| Indeks | 105 | `e44df227f18674f381030ba3d82b249d` |
| Policies | 109 | `7bbdfb23c85698757b42814a9189a00b` |
| RLS-flags | 36 | `51116a38619d471a5ed742b80ef47371` |
| Funktionsgrants | 64 | `0930895554876d09eaa4969dc1f1639a` |
| Tabelgrants | 819 | `6fde7a7fb48710507d892cbd78b6f4c8` |
| Triggers | 1 | `b29621f1544d3314472d70a964f927dc` |

Alle værdier var identiske lokalt og eksternt.

## Fremtidig arbejdsgang

1. Opret nye migrationer med `supabase migration new <navn>`.
2. Brug altid 14-cifrede versionsnumre genereret af CLI'en.
3. Kør `supabase db reset` mod den lokale testdatabase.
4. Kør schemafingerprint og relevante RLS-tests.
5. Kør Advisor før push.
6. Kontrollér `supabase db push --linked --dry-run` før anvendelse.
