drop index if exists public.works_beta_test_cleanup_idx;

alter table public.works
  drop column if exists is_test_data;

alter table public.organisations
  drop column if exists beta_test_mode;
