-- Reparationsmigration: applikationskoden blev taget i brug, før migration
-- 20260823103000 var anvendt på den linkede database. Når kolonnen oprettes
-- første gang, bevares de fem standardfiltre fra den tidligere localStorage-
-- løsning. Eksisterende kolonner eller bevidst tomme regelsæt overskrives ikke.
alter table public.organisations
  add column if not exists aftalelicens_filter_rules jsonb not null default
    '[
      {"id":"fr1","name":"Sport","type":"title_keyword","value":"sport","active":true,"createdAt":"2024-01-01"},
      {"id":"fr2","name":"Nyheder","type":"title_keyword","value":"nyhed","active":true,"createdAt":"2024-01-01"},
      {"id":"fr3","name":"TV Avisen","type":"title_keyword","value":"tv avisen","active":true,"createdAt":"2024-01-01"},
      {"id":"fr4","name":"Sporten","type":"title_keyword","value":"sporten","active":true,"createdAt":"2024-01-01"},
      {"id":"fr5","name":"Vejret","type":"title_keyword","value":"vejret","active":true,"createdAt":"2024-01-01"}
    ]'::jsonb;

alter table public.aftalelicens_batches
  add column if not exists filter_config jsonb not null default
    '{"localRules":[],"disabledGlobalRuleIds":[]}'::jsonb;

comment on column public.organisations.aftalelicens_filter_rules is
  'Organisationsfælles aftalelicensfiltre oprettet i Stamdata.';

comment on column public.aftalelicens_batches.filter_config is
  'Batchlokale filtre samt ID-er på globale filtre, der er slået fra for denne batch.';
