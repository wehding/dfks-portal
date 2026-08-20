-- Tilføj fortolkningsnote til agreement_percentage_rules.
-- Bruges til at knytte juridisk fortolkning til en regel direkte i registeret,
-- så reviewer kan se den på valideringssiden uden at automatisere konklusionen.

alter table public.agreement_percentage_rules
  add column if not exists fortolkningsnote text;
