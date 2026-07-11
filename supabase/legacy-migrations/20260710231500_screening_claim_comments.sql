-- ============================================================
-- Screening claim comments + read markers for message counters
-- ============================================================

create table if not exists screening_claims (
    id               uuid primary key default gen_random_uuid(),
    org_id           uuid not null references organisations(id) on delete cascade,
    profile_id       uuid not null references auth.users(id) on delete cascade,
    work_id          uuid not null references works(id) on delete restrict,
    broadcaster_id   uuid references broadcasters(id) on delete set null,
    title            text not null,
    channel          text not null,
    screening_date   date not null,
    season           integer,
    episode          integer,
    note             text,
    status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_by      uuid references auth.users(id) on delete set null,
    reviewed_at      timestamptz,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists screening_claims_member_idx on screening_claims(profile_id, created_at desc);
create index if not exists screening_claims_admin_idx on screening_claims(org_id, status, created_at desc);
create index if not exists screening_claims_work_idx on screening_claims(work_id, screening_date desc);

alter table screening_claims enable row level security;
grant select, insert on screening_claims to authenticated;
grant select, insert, update, delete on screening_claims to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='screening_claims' and policyname='Medlemmer kan se egne visningskrav') then
    create policy "Medlemmer kan se egne visningskrav" on screening_claims for select to authenticated using (profile_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='screening_claims' and policyname='Medlemmer kan oprette egne visningskrav') then
    create policy "Medlemmer kan oprette egne visningskrav" on screening_claims for insert to authenticated with check (
      profile_id = (select auth.uid()) and (
        exists (select 1 from user_org_roles r where r.user_id = (select auth.uid()) and r.org_id = screening_claims.org_id)
        or exists (select 1 from rettighedshavere rh where rh.user_id = (select auth.uid()) and rh.org_id = screening_claims.org_id)
      )
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='screening_claims' and policyname='Admins kan se visningskrav i egen organisation') then
    create policy "Admins kan se visningskrav i egen organisation" on screening_claims for select to authenticated using (exists (
      select 1 from user_org_roles r where r.user_id = (select auth.uid()) and r.org_id = screening_claims.org_id and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
    ));
  end if;
end $$;

create table if not exists screening_claim_comments (
    id              uuid primary key default gen_random_uuid(),
    claim_id        uuid not null references screening_claims(id) on delete cascade,
    author_user_id  uuid references auth.users(id) on delete set null,
    author_role     text not null,
    message         text not null,
    member_read_at  timestamptz,
    admin_read_at   timestamptz,
    created_at      timestamptz not null default now(),
    constraint screening_claim_comments_role_check
        check (author_role in ('member', 'admin')),
    constraint screening_claim_comments_message_check
        check (length(trim(message)) > 0)
);

create index if not exists screening_claim_comments_claim_idx
    on screening_claim_comments (claim_id, created_at);

alter table screening_claim_comments enable row level security;

grant select, insert on screening_claim_comments to authenticated;
grant select, insert, update, delete on screening_claim_comments to service_role;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'screening_claim_comments'
          and policyname = 'Brugere og admins kan se visningskommentarer'
    ) then
        create policy "Brugere og admins kan se visningskommentarer"
            on screening_claim_comments for select
            to authenticated
            using (
                exists (
                    select 1 from screening_claims sc
                    where sc.id = screening_claim_comments.claim_id
                      and (
                        sc.profile_id = (select auth.uid())
                        or exists (
                          select 1 from user_org_roles r where r.user_id = (select auth.uid())
                            and r.org_id = sc.org_id and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
                        )
                      )
                )
            );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'screening_claim_comments'
          and policyname = 'Brugere og admins kan oprette visningskommentarer'
    ) then
        create policy "Brugere og admins kan oprette visningskommentarer"
            on screening_claim_comments for insert
            to authenticated
            with check (
                author_user_id = (select auth.uid())
                and exists (
                    select 1 from screening_claims sc
                    where sc.id = screening_claim_comments.claim_id
                      and (
                        (sc.profile_id = (select auth.uid()) and screening_claim_comments.author_role = 'member')
                        or (screening_claim_comments.author_role = 'admin' and exists (
                          select 1 from user_org_roles r where r.user_id = (select auth.uid())
                            and r.org_id = sc.org_id and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
                        ))
                      )
                )
            );
    end if;
end $$;
