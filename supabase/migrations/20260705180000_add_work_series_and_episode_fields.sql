-- Tilføj series og episode fields til works tabellen
alter table works
    add column if not exists parent_work_id uuid references works(id) on delete cascade,
    add column if not exists season_number integer,
    add column if not exists episode_number integer;

comment on column works.parent_work_id is
    'Forbinder et afsnit med det overordnede serie- eller sæsonværk.';

comment on column works.season_number is
    'Sæsonnummeret for dette specifikke afsnit.';

comment on column works.episode_number is
    'Afsnitsnummeret for dette specifikke afsnit.';

-- Opret index for at optimere opslag på afsnit under en serie
create index if not exists works_parent_work_idx on works(parent_work_id);

-- Opret unikt index for at forhindre duplikerede afsnit under samme serie
create unique index if not exists works_parent_season_episode_unique_idx
    on works(parent_work_id, season_number, episode_number)
    where parent_work_id is not null;
