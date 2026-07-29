alter table public.organisations
  add column if not exists beta_test_mode boolean not null default false;

alter table public.works
  add column if not exists is_test_data boolean not null default false;

create index if not exists works_beta_test_cleanup_idx
  on public.works(org_id, is_test_data)
  where is_test_data = true;

comment on column public.works.is_test_data is
  'Skal sættes eksplicit. Betaværktøjet må aldrig foreslå andre værker til oprydning.';
