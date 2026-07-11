-- ============================================================
-- Contract comments + read markers for message counters
-- ============================================================

alter table work_change_request_comments
    add column if not exists member_read_at timestamptz,
    add column if not exists admin_read_at timestamptz;

create index if not exists work_change_request_comments_member_unread_idx
    on work_change_request_comments (member_read_at, created_at desc)
    where author_role = 'admin';

create index if not exists work_change_request_comments_admin_unread_idx
    on work_change_request_comments (admin_read_at, created_at desc)
    where author_role = 'member';

create table if not exists contract_comments (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid not null references organisations(id) on delete restrict,
    contract_id     uuid not null references contracts(id) on delete cascade,
    author_user_id  uuid references auth.users(id) on delete set null,
    author_role     text not null,
    message         text not null,
    member_read_at  timestamptz,
    admin_read_at   timestamptz,
    created_at      timestamptz not null default now(),
    constraint contract_comments_role_check
        check (author_role in ('member', 'admin')),
    constraint contract_comments_message_check
        check (length(trim(message)) > 0)
);

create index if not exists contract_comments_contract_idx
    on contract_comments (contract_id, created_at);

create index if not exists contract_comments_org_role_unread_idx
    on contract_comments (org_id, author_role, created_at desc);

alter table contract_comments enable row level security;

-- Markering som læst (UPDATE af *_read_at) sker server-side via service_role,
-- så authenticated får IKKE update — ellers kunne en bruger ændre enhver kolonne
-- (fx message/author_role) på kommentarer de kan se. Insert beholdes med
-- author-check-policyen nedenfor som sikkerhedsnet.
grant select, insert on contract_comments to authenticated;
grant select, insert, update, delete on contract_comments to service_role;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'contract_comments'
          and policyname = 'Brugere og admins kan se kontraktkommentarer'
    ) then
        create policy "Brugere og admins kan se kontraktkommentarer"
            on contract_comments for select
            to authenticated
            using (
                exists (
                    select 1 from contracts c
                    where c.id = contract_comments.contract_id
                      and (
                        exists (
                            select 1 from rettighedshavere rh
                            where rh.id = c.rights_holder_id
                              and rh.user_id = (select auth.uid())
                        )
                        or exists (
                            select 1 from user_org_roles ur
                            where ur.user_id = (select auth.uid())
                              and ur.org_id = c.org_id
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
          and tablename = 'contract_comments'
          and policyname = 'Brugere og admins kan oprette kontraktkommentarer'
    ) then
        create policy "Brugere og admins kan oprette kontraktkommentarer"
            on contract_comments for insert
            to authenticated
            with check (
                author_user_id = (select auth.uid())
                and exists (
                    select 1 from contracts c
                    where c.id = contract_comments.contract_id
                      and c.org_id = contract_comments.org_id
                      and (
                        exists (
                            select 1 from rettighedshavere rh
                            where rh.id = c.rights_holder_id
                              and rh.user_id = (select auth.uid())
                              and contract_comments.author_role = 'member'
                        )
                        or exists (
                            select 1 from user_org_roles ur
                            where ur.user_id = (select auth.uid())
                              and ur.org_id = c.org_id
                              and ur.role in ('superadmin', 'admin', 'org-admin', 'jurist')
                              and contract_comments.author_role = 'admin'
                        )
                      )
                )
            );
    end if;
end $$;

-- Bemærk: ingen UPDATE-policy for authenticated. Markering af kommentarer som
-- læst (member_read_at/admin_read_at) sker udelukkende server-side via service_role
-- i markContractCommentsRead(), så authenticated skal ikke kunne UPDATE'e rækker.
