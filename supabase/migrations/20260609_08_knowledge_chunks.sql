-- ============================================================
-- Modul 8: RAG-videnbase — knowledge_chunks + feedback
-- Google text-embedding-004 bruger 768 dimensioner
-- ============================================================

create extension if not exists vector;

-- Knowledge chunks: embeddings af sagserfaringer og juridiske noter
create table if not exists knowledge_chunks (
    id           uuid primary key default gen_random_uuid(),
    kilde_id     text not null unique,   -- UUID på source-rækken
    kilde_type   text not null,          -- 'sagserfaring' | 'juridisk-note'
    kilde_titel  text not null,
    tekst        text not null,
    org_id       uuid references organisations(id) on delete cascade,
    metadata     jsonb default '{}',
    embedding    vector(768),            -- Google text-embedding-004 = 768 dim
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists knowledge_chunks_embedding_idx
    on knowledge_chunks using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

create index if not exists knowledge_chunks_kilde_id_idx
    on knowledge_chunks (kilde_id);

alter table knowledge_chunks enable row level security;

grant select, insert, update, delete on knowledge_chunks to authenticated;
grant select, insert, update, delete on knowledge_chunks to service_role;

create policy "Admins kan administrere knowledge chunks"
    on knowledge_chunks for all to authenticated
    using (
        org_id is null
        or (auth.jwt()->'user_metadata'->>'role') in ('superadmin', 'admin', 'org-admin')
        or exists (select 1 from user_org_roles r where r.user_id = auth.uid() and r.org_id = knowledge_chunks.org_id)
    );

-- RPC: semantisk søgning med valgfrit org_id-filter
create or replace function match_knowledge_chunks(
    query_embedding vector(768),
    match_threshold float,
    match_count     int,
    p_org_id        uuid default null
)
returns table (
    kilde_id    text,
    kilde_titel text,
    tekst       text,
    metadata    jsonb,
    similaritet float
)
language sql stable as $$
    select
        kilde_id,
        kilde_titel,
        tekst,
        metadata,
        1 - (embedding <=> query_embedding) as similaritet
    from knowledge_chunks
    where
        1 - (embedding <=> query_embedding) > match_threshold
        and (p_org_id is null or org_id is null or org_id = p_org_id)
    order by embedding <=> query_embedding
    limit match_count;
$$;

-- Feedback på AI-fund i kontraktgennemgang
create table if not exists analysis_feedback (
    id                      uuid primary key default gen_random_uuid(),
    analyse_id              text not null,       -- session/gennemgang ID
    kontrakt_hash           text,                -- SHA-256 af kontrakttekst
    fund_id                 text not null,       -- unikt ID for dette fund
    fund_titel              text not null,
    fund_svaerhedsgrad      text not null,       -- 'kritisk' | 'advarsel' | 'info'
    fund_beskrivelse        text,
    godkendt                boolean not null,    -- true = korrekt, false = forkert
    korrektion_svaerhedsgrad text,
    korrektion_beskrivelse  text,
    skal_ignoreres          boolean default false,
    reviewet_af             text,
    org_id                  uuid references organisations(id) on delete cascade,
    created_at              timestamptz not null default now()
);

alter table analysis_feedback enable row level security;

grant select, insert, update, delete on analysis_feedback to authenticated;

create policy "Admins kan administrere feedback"
    on analysis_feedback for all to authenticated
    using (
        org_id is null
        or (auth.jwt()->'user_metadata'->>'role') in ('superadmin', 'admin', 'org-admin')
        or exists (select 1 from user_org_roles r where r.user_id = auth.uid() and r.org_id = analysis_feedback.org_id)
    );
