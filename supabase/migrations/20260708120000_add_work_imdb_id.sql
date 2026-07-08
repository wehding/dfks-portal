-- Tilføj imdb_id til works. Hentes gratis via TMDB /external_ids —
-- IMDb's egne datasæt/API er kun ikke-kommercielle og bruges ikke.
alter table works
    add column if not exists imdb_id text;

comment on column works.imdb_id is
    'IMDb-id (fx tt1234567) hentet gratis via TMDB /external_ids.';

create index if not exists works_imdb_id_idx on works(imdb_id);
