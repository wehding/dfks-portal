-- Job-koe til AI-aflaesning af kontrakter.
-- Kontraktens egen status forbliver "kladde"; denne tabel styrer kun AI-behandling.

create table if not exists contract_ai_jobs (
    id              uuid primary key default gen_random_uuid(),
    contract_id     uuid not null references contracts(id) on delete cascade,
    org_id          uuid not null references organisations(id) on delete restrict,
    status          text not null default 'queued',
    -- status: queued, processing, done, error
    priority        integer not null default 100,
    attempts        integer not null default 0,
    error_message   text,
    masked_text     text,
    started_at      timestamptz,
    completed_at    timestamptz,
    created_by      uuid references auth.users(id),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint contract_ai_jobs_status_check check (status in ('queued', 'processing', 'done', 'error'))
);

create index if not exists contract_ai_jobs_org_status_idx
    on contract_ai_jobs (org_id, status, priority, created_at);

create index if not exists contract_ai_jobs_contract_idx
    on contract_ai_jobs (contract_id);

create or replace function claim_next_contract_ai_job(
    p_job_id uuid default null,
    p_org_id uuid default null
)
returns table (
    id uuid,
    contract_id uuid,
    org_id uuid,
    attempts integer,
    pdf_url text
)
language sql
security definer
set search_path = public
as $$
    with picked as (
        select j.id
        from contract_ai_jobs j
        join contracts c on c.id = j.contract_id
        where j.status in ('queued', 'error')
          and (p_job_id is null or j.id = p_job_id)
          and (p_org_id is null or j.org_id = p_org_id)
        order by j.priority asc, j.created_at asc
        limit 1
        for update skip locked
    ),
    updated as (
        update contract_ai_jobs j
        set status = 'processing',
            attempts = j.attempts + 1,
            started_at = now(),
            updated_at = now(),
            error_message = null
        from picked
        where j.id = picked.id
        returning j.id, j.contract_id, j.org_id, j.attempts
    )
    select u.id, u.contract_id, u.org_id, u.attempts, c.pdf_url
    from updated u
    join contracts c on c.id = u.contract_id;
$$;

revoke all on function claim_next_contract_ai_job(uuid, uuid) from public;
grant execute on function claim_next_contract_ai_job(uuid, uuid) to service_role;

alter table contract_ai_jobs enable row level security;

create policy "Admins kan se AI-jobs for egne orgs"
    on contract_ai_jobs for select
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_ai_jobs.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

create policy "Admins kan oprette AI-jobs for egne orgs"
    on contract_ai_jobs for insert
    to authenticated
    with check (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_ai_jobs.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );

create policy "Admins kan opdatere AI-jobs for egne orgs"
    on contract_ai_jobs for update
    to authenticated
    using (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_ai_jobs.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    )
    with check (
        exists (
            select 1 from user_org_roles r
            where r.user_id = auth.uid()
              and r.org_id = contract_ai_jobs.org_id
              and r.role in ('superadmin', 'admin', 'org-admin')
        )
    );
