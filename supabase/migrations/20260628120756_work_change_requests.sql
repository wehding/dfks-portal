-- ============================================================
-- Work data correction requests + comment thread
-- ============================================================

create table if not exists work_change_requests (
    id                              uuid primary key default gen_random_uuid(),
    org_id                          uuid not null references organisations(id) on delete restrict,
    work_id                         uuid not null references works(id) on delete cascade,
    requested_by_user_id            uuid references auth.users(id) on delete set null,
    requested_by_rights_holder_id   uuid references rettighedshavere(id) on delete set null,
    source                          text not null default 'manual',
    old_data                        jsonb not null default '{}'::jsonb,
    proposed_data                   jsonb not null default '{}'::jsonb,
    status                          text not null default 'pending',
    reviewed_by_user_id             uuid references auth.users(id) on delete set null,
    reviewed_at                     timestamptz,
    admin_comment                   text,
    created_at                      timestamptz not null default now(),
    constraint work_change_requests_status_check
        check (status in ('pending', 'approved', 'rejected')),
    constraint work_change_requests_source_check
        check (length(trim(source)) > 0)
);

create table if not exists work_change_request_comments (
    id                  uuid primary key default gen_random_uuid(),
    request_id          uuid not null references work_change_requests(id) on delete cascade,
    author_user_id      uuid references auth.users(id) on delete set null,
    author_role         text not null,
    message             text not null,
    created_at          timestamptz not null default now(),
    constraint work_change_request_comments_role_check
        check (author_role in ('member', 'admin')),
    constraint work_change_request_comments_message_check
        check (length(trim(message)) > 0)
);

create index if not exists work_change_requests_work_status_idx
    on work_change_requests (work_id, status, created_at desc);

create index if not exists work_change_requests_org_status_idx
    on work_change_requests (org_id, status, created_at desc);

create index if not exists work_change_request_comments_request_idx
    on work_change_request_comments (request_id, created_at);

alter table work_change_requests enable row level security;
alter table work_change_request_comments enable row level security;

grant select, insert, update on work_change_requests to authenticated;
grant select, insert on work_change_request_comments to authenticated;
grant select, insert, update, delete on work_change_requests to service_role;
grant select, insert, update, delete on work_change_request_comments to service_role;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_change_requests'
          and policyname = 'Brugere kan se egne værkændringsanmodninger'
    ) then
        create policy "Brugere kan se egne værkændringsanmodninger"
            on work_change_requests for select
            to authenticated
            using (
                requested_by_user_id = (select auth.uid())
                or exists (
                    select 1 from user_org_roles r
                    where r.user_id = (select auth.uid())
                      and r.org_id = work_change_requests.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
                )
            );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_change_requests'
          and policyname = 'Brugere kan oprette egne værkændringsanmodninger'
    ) then
        create policy "Brugere kan oprette egne værkændringsanmodninger"
            on work_change_requests for insert
            to authenticated
            with check (
                requested_by_user_id = (select auth.uid())
                and exists (
                    select 1 from rettighedshavere rh
                    where rh.id = requested_by_rights_holder_id
                      and rh.user_id = (select auth.uid())
                )
            );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_change_requests'
          and policyname = 'Admins kan behandle værkændringsanmodninger'
    ) then
        create policy "Admins kan behandle værkændringsanmodninger"
            on work_change_requests for update
            to authenticated
            using (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = (select auth.uid())
                      and r.org_id = work_change_requests.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
                )
            )
            with check (
                exists (
                    select 1 from user_org_roles r
                    where r.user_id = (select auth.uid())
                      and r.org_id = work_change_requests.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin', 'jurist')
                )
            );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'work_change_request_comments'
          and policyname = 'Brugere og admins kan se ændringskommentarer'
    ) then
        create policy "Brugere og admins kan se ændringskommentarer"
            on work_change_request_comments for select
            to authenticated
            using (
                exists (
                    select 1 from work_change_requests r
                    where r.id = work_change_request_comments.request_id
                      and (
                        r.requested_by_user_id = (select auth.uid())
                        or exists (
                            select 1 from user_org_roles ur
                            where ur.user_id = (select auth.uid())
                              and ur.org_id = r.org_id
                              and ur.role in ('superadmin', 'admin', 'org-admin', 'jurist')
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
          and tablename = 'work_change_request_comments'
          and policyname = 'Brugere og admins kan oprette ændringskommentarer'
    ) then
        create policy "Brugere og admins kan oprette ændringskommentarer"
            on work_change_request_comments for insert
            to authenticated
            with check (
                author_user_id = (select auth.uid())
                and exists (
                    select 1 from work_change_requests r
                    where r.id = work_change_request_comments.request_id
                      and (
                        r.requested_by_user_id = (select auth.uid())
                        or exists (
                            select 1 from user_org_roles ur
                            where ur.user_id = (select auth.uid())
                              and ur.org_id = r.org_id
                              and ur.role in ('superadmin', 'admin', 'org-admin', 'jurist')
                        )
                      )
                )
            );
    end if;
end $$;
