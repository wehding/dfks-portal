-- ============================================================
-- Modul 7: case_learnings — sagserfaringer fra kontraktgennemgang
-- ============================================================

create table if not exists case_learnings (
    id           uuid primary key default gen_random_uuid(),
    org_id       uuid references organisations(id) on delete cascade,
    kontrakttype text not null default 'alle',
    -- 'a-loen' | 'leverandoer' | 'alle'
    titel        text not null,
    regel        text not null,
    added_at     timestamptz not null default now(),
    created_at   timestamptz not null default now()
);

alter table case_learnings enable row level security;

-- Grants
grant select, insert, update, delete on case_learnings to authenticated;

-- RLS: admins kan se og redigere
do $$ begin
    if not exists (
        select 1 from pg_policies
        where tablename = 'case_learnings'
          and policyname = 'Admins kan administrere sagserfaringer'
    ) then
        execute $p$
            create policy "Admins kan administrere sagserfaringer"
                on case_learnings for all
                to authenticated
                using (
                    org_id is null
                    or (auth.jwt()->'user_metadata'->>'role') in ('superadmin', 'admin', 'org-admin')
                    or exists (
                        select 1 from user_org_roles r
                        where r.user_id = auth.uid()
                          and r.org_id = case_learnings.org_id
                    )
                )
        $p$;
    end if;
end $$;
