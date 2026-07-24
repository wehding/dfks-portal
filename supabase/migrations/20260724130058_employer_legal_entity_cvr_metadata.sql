alter table public.employer_legal_entities
  add column if not exists contact_email text,
  add column if not exists website text,
  add column if not exists industry_code text,
  add column if not exists industry_description text,
  add column if not exists company_type text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

comment on column public.employer_legal_entities.source_metadata is
  'Kildeafgrænset virksomhedsmetadata, fx apiCVR-status og seneste opslagstidspunkt.';
