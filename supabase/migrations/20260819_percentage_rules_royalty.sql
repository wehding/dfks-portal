-- Udvid agreement_percentage_rules til at understøtte royalty-regler:
-- 1. Tilføj 'royalty' til label_key-constraint
-- 2. Tilføj production_type-kolonne til per-produktionstype royalty-opslag

-- Drop og genskab label_key-constraint med royalty
alter table public.agreement_percentage_rules
  drop constraint if exists agreement_percentage_rules_label_key_check;

alter table public.agreement_percentage_rules
  add constraint agreement_percentage_rules_label_key_check
    check (label_key is null or label_key in ('beta_pulje', 'helligdagsbetaling', 'feriepenge', 'royalty'));

-- Tilføj production_type til royalty-regler (null = gælder alle produktionstyper)
alter table public.agreement_percentage_rules
  add column if not exists production_type text;
