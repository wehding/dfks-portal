-- Aftalelicensfiltre skal deles i organisationen og overleve browser-/URL-skift.
-- Globale Stamdataregler gemmes på organisationen. Den enkelte batch gemmer
-- lokale regler og fravalg af globale regler i sin egen konfiguration.
alter table public.organisations
  add column if not exists aftalelicens_filter_rules jsonb not null default '[]'::jsonb;

alter table public.aftalelicens_batches
  add column if not exists filter_config jsonb not null default
    '{"localRules":[],"disabledGlobalRuleIds":[]}'::jsonb;

comment on column public.organisations.aftalelicens_filter_rules is
  'Organisationsfælles aftalelicensfiltre oprettet i Stamdata.';

comment on column public.aftalelicens_batches.filter_config is
  'Batchlokale filtre samt ID-er på globale filtre, der er slået fra for denne batch.';
