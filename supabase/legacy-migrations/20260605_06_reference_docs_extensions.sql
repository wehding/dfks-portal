-- ============================================================
-- Modul 6: Udvid reference_docs til at understøtte
--          Supabase Storage upload + AI-tekstekstration
-- ============================================================

-- Nye kolonner på reference_docs
alter table reference_docs
    add column if not exists doc_subtype  text,
    -- Specifik UI-type: 'Fiktion-overenskomst', 'Lønskema (fiktion)', 'Reference' osv.
    add column if not exists owner        text not null default 'de4',
    -- 'de4' eller 'anden-fagforening'
    add column if not exists content_text text,
    -- Ekstraheret tekst — bruges direkte i AI-systempromt
    add column if not exists file_name    text,
    -- Originalt filnavn (til visning + download)
    add column if not exists archived     boolean not null default false;
    -- true = arkiveret, vises ikke i aktiv liste

-- Supabase Storage bucket til referencedokumenter
-- Kør dette i Supabase SQL Editor (kræver service_role):
-- insert into storage.buckets (id, name, public)
--     values ('documents', 'documents', false)
--     on conflict (id) do nothing;

-- Manglende INSERT/UPDATE/DELETE policy på reference_docs
-- (kun SELECT var defineret i modul 4)
do $$ begin
    if not exists (
        select 1 from pg_policies
        where tablename = 'reference_docs'
          and policyname = 'Admins kan administrere referencedokumenter'
    ) then
        execute $p$
            create policy "Admins kan administrere referencedokumenter"
                on reference_docs for all
                to authenticated
                using (
                    exists (
                        select 1 from user_org_roles r
                        where r.user_id = auth.uid()
                          and r.role in ('superadmin', 'admin', 'org-admin')
                    )
                )
        $p$;
    end if;
end $$;

-- Storage policies for 'documents' bucket
-- (kræver at bucket eksisterer)
-- Kør i Supabase SQL Editor:
-- create policy "Authenticated users can upload documents"
--     on storage.objects for insert
--     to authenticated
--     with check (bucket_id = 'documents');
--
-- create policy "Authenticated users can read documents"
--     on storage.objects for select
--     to authenticated
--     using (bucket_id = 'documents');
--
-- create policy "Authenticated users can delete documents"
--     on storage.objects for delete
--     to authenticated
--     using (bucket_id = 'documents');
