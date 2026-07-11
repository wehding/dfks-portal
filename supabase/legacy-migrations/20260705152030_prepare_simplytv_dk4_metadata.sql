-- Gør værksdatabasen klar til at modtage DK4/SimplyTV-data uden at
-- duplikere de felter, der allerede findes på works.
--
-- Fælles værksfelter fra DFI og SimplyTV/DK4:
-- - Title / OriginalTitle / DK4 Title lander i works.title via importlogik.
-- - ProductionYear / Year of Production lander i works.year.
-- - LengthInMin / Duration lander i works.duration_minutes, når duration er
--   værkslængde. Sendeflade-duration gemmes separat i work_airings.
-- - Genre / Genres lander i works.genre.
-- - Description / ShortDescription / DK4 Description lander i works.description.
-- - ProductionCountries / Country1/Country2 lander i works.production_countries.
-- - ProductionCompanies / Company of production 1-3 lander i works.production_companies.
--
-- Felter vi bevidst ikke modellerer fra DK4-feedet:
-- actors/skuespillere, broadcast language, title language/original title language,
-- advisories og style-of-language.

alter table works
    add column if not exists alternative_titles text[] not null default '{}',
    add column if not exists production_countries text[] not null default '{}',
    add column if not exists production_companies text[] not null default '{}';

comment on column works.alternative_titles is
    'Alternative titler fra fx DFI AltTitle og evt. importkilder. Ikke en erstatning for works.title.';
comment on column works.production_countries is
    'Normaliseret liste over produktionslande fra DFI ProductionCountries eller DK4 Country1/Country2.';
comment on column works.production_companies is
    'Normaliseret liste over produktionsselskaber fra DFI ProductionCompanies eller DK4 Company of production-felter.';

create table if not exists work_external_ids (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references organisations(id) on delete cascade,
    work_id             uuid references works(id) on delete cascade,
    source              text not null,
    external_id_type    text not null,
    external_id         text not null,
    created_at          timestamptz not null default now(),
    unique (source, external_id_type, external_id)
);

comment on table work_external_ids is
    'Eksterne værk-id’er fra kilder som DFI, TMDB og SimplyTV/DK4. Listing-id’er for konkrete udsendelser ligger i work_airings.';
comment on column work_external_ids.source is
    'Eksempel: dfi, tmdb, simplytv, dk4.';
comment on column work_external_ids.external_id_type is
    'Eksempel: film_id, program_id, series_id, season_id, episode_id.';

create index if not exists work_external_ids_work_idx
    on work_external_ids(work_id);
create index if not exists work_external_ids_org_source_idx
    on work_external_ids(org_id, source);

create table if not exists work_airings (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references organisations(id) on delete cascade,
    work_id             uuid references works(id) on delete set null,
    broadcaster_id      uuid references broadcasters(id) on delete set null,
    source              text not null default 'simplytv',
    channel             text,
    channel_name        text,
    broadcast_start_at  timestamptz,
    broadcast_date      date,
    broadcast_time      time,
    duration_minutes    integer,
    listing_id          text,
    series_id           text,
    season_id           text,
    episode_id          text,
    editorial_url       text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (source, listing_id)
);

alter table work_airings
    add column if not exists broadcaster_id uuid references broadcasters(id) on delete set null;

comment on table work_airings is
    'Sendeflade-/EPG-data fra SimplyTV/DK4. Disse felter er airing-data, ikke grundlæggende værksmetadata.';
comment on column work_airings.broadcaster_id is
    'Kobling fra SimplyTV/DK4 Channel/Channel Name til portalens broadcaster/streamer-register. channel/channel_name bevares som rå importværdi.';
comment on column work_airings.duration_minutes is
    'Sendefladens varighed. Importlogik kan kun kopiere til works.duration_minutes, hvis værkets varighed mangler og værdien er vurderet som værkslængde.';
comment on column work_airings.listing_id is
    'SimplyTV/DK4 Listing Id for den konkrete udsendelse.';

create index if not exists work_airings_work_idx
    on work_airings(work_id);
create index if not exists work_airings_broadcaster_idx
    on work_airings(broadcaster_id);
create index if not exists work_airings_org_channel_date_idx
    on work_airings(org_id, channel, broadcast_date);
create index if not exists work_airings_source_series_idx
    on work_airings(source, series_id);
create index if not exists work_airings_source_episode_idx
    on work_airings(source, episode_id);

alter table work_external_ids enable row level security;
alter table work_airings enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_external_ids'
          and policyname = 'Brugere kan se eksterne værk-ider for egne orgs'
    ) then
        create policy "Brugere kan se eksterne værk-ider for egne orgs"
            on work_external_ids for select
            to authenticated
            using (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = work_external_ids.org_id
                )
            );
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_external_ids'
          and policyname = 'Admins kan administrere eksterne værk-ider'
    ) then
        create policy "Admins kan administrere eksterne værk-ider"
            on work_external_ids for all
            to authenticated
            using (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = work_external_ids.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin')
                )
            )
            with check (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = work_external_ids.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin')
                )
            );
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_airings'
          and policyname = 'Brugere kan se udsendelser for egne orgs'
    ) then
        create policy "Brugere kan se udsendelser for egne orgs"
            on work_airings for select
            to authenticated
            using (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = work_airings.org_id
                )
            );
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_airings'
          and policyname = 'Admins kan administrere udsendelser'
    ) then
        create policy "Admins kan administrere udsendelser"
            on work_airings for all
            to authenticated
            using (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = work_airings.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin')
                )
            )
            with check (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = work_airings.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin')
                )
            );
    end if;
end $$;

grant select on table public.work_external_ids to authenticated;
grant select on table public.work_airings to authenticated;
grant all on table public.work_external_ids to service_role;
grant all on table public.work_airings to service_role;
