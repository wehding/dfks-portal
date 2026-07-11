alter table public.works
  add column if not exists imdb_id text,
  add column if not exists wikidata_id text;

create index if not exists works_org_imdb_id_idx
  on public.works(org_id, imdb_id) where imdb_id is not null;

create index if not exists works_org_wikidata_id_idx
  on public.works(org_id, wikidata_id) where wikidata_id is not null;

notify pgrst, 'reload schema';
