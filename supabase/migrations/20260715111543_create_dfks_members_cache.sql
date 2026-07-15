-- Cache the organisation's member-system records so admins can preview and
-- import them as rights holders. This table previously existed only in a
-- legacy migration and was therefore missing from deployed environments.
create table if not exists public.dfks_members (
    id uuid primary key default gen_random_uuid(),
    org_id uuid references public.organisations(id) on delete cascade,
    foreninglet_id text not null,
    display_id text,
    first_name text,
    last_name text,
    full_name text not null,
    email text,
    status text not null default 'active',
    raw jsonb,
    synced_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (org_id, foreninglet_id)
);

create index if not exists dfks_members_org_status_idx
    on public.dfks_members(org_id, status);

create index if not exists dfks_members_org_full_name_idx
    on public.dfks_members(org_id, lower(full_name));

alter table public.dfks_members enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'dfks_members'
          and policyname = 'Admins kan se DFKS medlemslisten'
    ) then
        create policy "Admins kan se DFKS medlemslisten"
            on public.dfks_members for select
            to authenticated
            using (
                exists (
                    select 1
                    from public.user_org_roles r
                    where r.user_id = auth.uid()
                      and r.org_id = dfks_members.org_id
                      and r.role in ('superadmin', 'admin', 'org-admin')
                )
            );
    end if;
end $$;

grant select on table public.dfks_members to authenticated;
grant all on table public.dfks_members to service_role;
