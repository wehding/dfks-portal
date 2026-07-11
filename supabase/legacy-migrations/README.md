# Arkiverede migrationer

Disse migrationsfiler blev erstattet af den aktive produktionsbaseline den 11. juli 2026.

- Filerne bevares som revisionshistorik og må ikke køres med `supabase db push`.
- Den aktive baseline ligger i `supabase/migrations`.
- Produktionsschemaet før baseline ligger i `supabase/baseline/production-schema-20260711.sql`.
- Den tidligere eksterne historik og hashes ligger i `remote-migration-history-before-baseline.json`.
- Baseline blev anvendt på en tom lokal Supabase-database og sammenlignet med produktionen via `supabase/tests/schema_fingerprint.sql`.
