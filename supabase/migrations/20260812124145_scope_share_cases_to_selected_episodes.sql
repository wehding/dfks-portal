alter table public.work_share_cases
  add column episode_numbers integer[] not null default '{}'::integer[];

alter table public.work_share_cases
  add constraint work_share_cases_episode_numbers_positive
  check (0 < all (episode_numbers));

comment on column public.work_share_cases.episode_numbers is
  'De konkrete afsnit en sæsonsag omfatter. Tom liste betyder hele sæsonen eller et ikke-serieværk.';
