alter table public.rettighedshavere
  alter column dfi_person_id type bigint using dfi_person_id::bigint,
  add column if not exists tmdb_person_id bigint,
  add column if not exists wikidata_qid text,
  add column if not exists imdb_nm text;

alter table public.rettighedshavere
  drop constraint if exists rettighedshavere_wikidata_qid_format,
  add constraint rettighedshavere_wikidata_qid_format
    check (wikidata_qid is null or wikidata_qid ~ '^Q[0-9]+$') not valid,
  drop constraint if exists rettighedshavere_imdb_nm_format,
  add constraint rettighedshavere_imdb_nm_format
    check (imdb_nm is null or imdb_nm ~ '^nm[0-9]+$') not valid;

create unique index if not exists rettighedshavere_dfi_person_id_uidx on public.rettighedshavere(dfi_person_id) where dfi_person_id is not null;
create unique index if not exists rettighedshavere_tmdb_person_id_uidx on public.rettighedshavere(tmdb_person_id) where tmdb_person_id is not null;
create unique index if not exists rettighedshavere_wikidata_qid_uidx on public.rettighedshavere(wikidata_qid) where wikidata_qid is not null;
create unique index if not exists rettighedshavere_imdb_nm_uidx on public.rettighedshavere(imdb_nm) where imdb_nm is not null;

notify pgrst, 'reload schema';
