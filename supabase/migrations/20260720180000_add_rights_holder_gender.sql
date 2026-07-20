alter table public.rettighedshavere
  add column if not exists gender text;

alter table public.rettighedshavere
  drop constraint if exists rettighedshavere_gender_check;

alter table public.rettighedshavere
  add constraint rettighedshavere_gender_check
  check (
    gender is null
    or gender in ('female', 'male', 'non_binary', 'other', 'prefer_not_to_say')
  );

comment on column public.rettighedshavere.gender is
  'Frivillig kønsoplysning til statistik.';
