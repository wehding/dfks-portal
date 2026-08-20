-- Tilføj 'svod' og 'copydan' til label_key-constraint i agreement_percentage_rules

alter table public.agreement_percentage_rules
  drop constraint if exists agreement_percentage_rules_label_key_check;

alter table public.agreement_percentage_rules
  add constraint agreement_percentage_rules_label_key_check
    check (label_key is null or label_key in ('beta_pulje', 'helligdagsbetaling', 'feriepenge', 'royalty', 'svod', 'copydan'));
