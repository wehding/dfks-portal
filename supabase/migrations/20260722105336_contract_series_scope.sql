alter table public.contracts
  add column if not exists season_number integer,
  add column if not exists episode_numbers integer[];

alter table public.contracts
  drop constraint if exists contracts_season_number_positive,
  add constraint contracts_season_number_positive
    check (season_number is null or season_number > 0);

comment on column public.contracts.season_number is
  'Sæsonnummer når work_id peger på seriens parent-værk.';
comment on column public.contracts.episode_numbers is
  'Null eller tom betyder hele sæsonen; ellers gælder kontrakten kun de angivne afsnit.';

create index if not exists contracts_series_scope_idx
  on public.contracts (work_id, season_number)
  where season_number is not null;
