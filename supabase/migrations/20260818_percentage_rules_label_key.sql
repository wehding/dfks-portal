-- Tilføj label_key til agreement_percentage_rules.
-- Bruges til at garantere at byggAbsolutteRegler()'s nøgleordssøgning
-- finder 'feriepenge', 'beta' og 'helligdag' uanset den frie label-tekst.

alter table public.agreement_percentage_rules
  add column if not exists label_key text,
  add constraint agreement_percentage_rules_label_key_check
    check (label_key is null or label_key in ('beta_pulje', 'helligdagsbetaling', 'feriepenge'));
