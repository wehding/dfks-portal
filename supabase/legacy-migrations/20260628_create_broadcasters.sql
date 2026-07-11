create table if not exists broadcasters (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid references organisations(id) on delete cascade,
    name            text not null,
    slug            text not null,
    logo_source_url text not null,
    logo_path       text not null,
    content_type    text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists broadcasters_org_name_idx on broadcasters(org_id, name);
create unique index if not exists broadcasters_unique_name_idx on broadcasters(name);
create unique index if not exists broadcasters_unique_slug_idx on broadcasters(slug);
create unique index if not exists broadcasters_unique_org_name_idx
    on broadcasters (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create unique index if not exists broadcasters_unique_org_slug_idx
    on broadcasters (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

alter table broadcasters enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'broadcasters'
          and policyname = 'Brugere kan se broadcastere for egne orgs'
    ) then
        create policy "Brugere kan se broadcastere for egne orgs"
            on broadcasters for select
            to authenticated
            using (
                org_id is null
                or exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = broadcasters.org_id
                )
            );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'broadcasters'
          and policyname = 'Admins kan administrere broadcastere'
    ) then
        create policy "Admins kan administrere broadcastere"
            on broadcasters for all
            to authenticated
            using (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.role in ('superadmin', 'admin', 'org-admin')
                      and (broadcasters.org_id is null or r.org_id = broadcasters.org_id)
                )
            )
            with check (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = auth.uid()
                      and r.role in ('superadmin', 'admin', 'org-admin')
                      and (broadcasters.org_id is null or r.org_id = broadcasters.org_id)
                )
            );
end if;
end $$;

insert into broadcasters (org_id, name, slug, logo_source_url, logo_path, content_type)
values
    (null, 'DR1', 'dr1', 'https://commons.wikimedia.org/wiki/Special:FilePath/DR1-Logo.svg', '/assets/logos/dr1.svg', 'image/svg+xml'),
    (null, 'DR2', 'dr2', 'https://commons.wikimedia.org/wiki/Special:FilePath/DR2-Logo_(D%C3%A4nemark).svg', '/assets/logos/dr2.svg', 'image/svg+xml'),
    (null, 'TV 2', 'tv-2', 'https://www.google.com/s2/favicons?domain=tv2.dk&sz=128', '/assets/logos/tv-2.png', 'image/png'),
    (null, 'TV 3', 'tv-3', 'https://commons.wikimedia.org/wiki/Special:FilePath/TV3_logo.svg', '/assets/logos/tv-3.svg', 'image/svg+xml'),
    (null, 'SVT', 'svt', 'https://www.google.com/s2/favicons?domain=svt.se&sz=128', '/assets/logos/svt.png', 'image/png'),
    (null, 'NRK', 'nrk', 'https://www.google.com/s2/favicons?domain=nrk.no&sz=128', '/assets/logos/nrk.png', 'image/png'),
    (null, 'ARD', 'ard', 'https://www.google.com/s2/favicons?domain=ard.de&sz=128', '/assets/logos/ard.png', 'image/png'),
    (null, 'ZDF', 'zdf', 'https://www.google.com/s2/favicons?domain=zdf.de&sz=128', '/assets/logos/zdf.png', 'image/png'),
    (null, 'HBO', 'hbo', 'https://www.google.com/s2/favicons?domain=hbo.com&sz=128', '/assets/logos/hbo.png', 'image/png'),
    (null, 'Netflix', 'netflix', 'https://www.google.com/s2/favicons?domain=netflix.com&sz=128', '/assets/logos/netflix.png', 'image/png'),
    (null, 'TV2 Play', 'tv2-play', 'https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_Play_Logo.png', '/assets/logos/tv2-play.png', 'image/png'),
    (null, 'Amazon Prime', 'amazon-prime', 'https://www.google.com/s2/favicons?domain=primevideo.com&sz=128', '/assets/logos/amazon-prime.png', 'image/png'),
    (null, 'DR Ramasjang', 'dr-ramasjang', 'https://commons.wikimedia.org/wiki/Special:FilePath/DR_Ramasjang_Logo_2020.svg', '/assets/logos/dr-ramasjang.svg', 'image/svg+xml'),
    (null, 'TV 2 Charlie', 'tv-2-charlie', 'https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_Charlie_2023.svg', '/assets/logos/tv-2-charlie.svg', 'image/svg+xml'),
    (null, 'TV 2 News', 'tv-2-news', 'https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_News_2023.svg', '/assets/logos/tv-2-news.svg', 'image/svg+xml'),
    (null, 'TV3+', 'tv3-plus', 'https://commons.wikimedia.org/wiki/Special:FilePath/TV3%2B_logo.svg', '/assets/logos/tv3-plus.svg', 'image/svg+xml'),
    (null, 'Kanal 4', 'kanal-4', 'https://commons.wikimedia.org/wiki/Special:FilePath/Kanal_4_Logo_2024.svg', '/assets/logos/kanal-4.svg', 'image/svg+xml'),
    (null, 'Kanal 5', 'kanal-5', 'https://commons.wikimedia.org/wiki/Special:FilePath/Kanal_5_%26_TV5_Logo_2024.svg', '/assets/logos/kanal-5.svg', 'image/svg+xml')
on conflict (slug) do update set
    name = excluded.name,
    logo_source_url = excluded.logo_source_url,
    logo_path = excluded.logo_path,
    content_type = excluded.content_type,
    updated_at = now();
