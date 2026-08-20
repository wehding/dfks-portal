-- works.distribution_type + distribution_type_source
-- Null = ukendt/ikke sat — behandles som "ukendt" i regel-logikken.
-- distribution_type_source='manual' er den eneste gyldige kilde nu;
-- 'ai_classified' tilføjes når automatisk klassifikation bygges.

alter table public.works
  add column if not exists distribution_type text
    check (distribution_type in ('biograf', 'streaming', 'broadcast')),
  add column if not exists distribution_type_source text
    check (distribution_type_source in ('manual'));

-- agreement_percentage_rules: valgfri distributions-betingelse parallelt med production_type.
-- Null = gælder alle distributionstyper (bagudkompatibelt).
alter table public.agreement_percentage_rules
  add column if not exists distribution_type text
    check (distribution_type in ('biograf', 'streaming', 'broadcast'));
