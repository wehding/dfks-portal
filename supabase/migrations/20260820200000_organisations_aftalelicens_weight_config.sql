-- Aftalelicens-modulets vægt-konfiguration lå tidligere i browserens localStorage
-- (dfks_vaerkvaegte, dfks_vaegt_extra, dfks_hensaettelser_pct, dfks_sociale_pct) —
-- nu en rigtig, org-specifik JSONB-kolonne i organisations-tabellen.
-- Fordel: konfigurationen er delt på tværs af browsere/brugere, overlever
-- cache-ryd, og kan versioneres i migrationshistorikken.

alter table public.organisations
  add column if not exists aftalelicens_weight_config jsonb;

comment on column public.organisations.aftalelicens_weight_config is
  'Aftalelicens-modulets vægt- og hensættelseskonfiguration (erstatter localStorage dfks_vaerkvaegte/dfks_vaegt_extra/dfks_hensaettelser_pct/dfks_sociale_pct). Struktur: { weights: Record<VaerkType,number>, extra: AftalelicensVaegtExtra, reservePercent: number, socialPercent: number }';
