alter table public.legal_document_acceptances
  add column if not exists document_version integer;

update public.legal_document_acceptances acceptance
set document_version = version.version
from public.legal_document_versions version
where acceptance.document_version_id = version.id
  and acceptance.document_version is null;

alter table public.legal_document_acceptances
  alter column document_version set not null,
  add constraint legal_document_acceptances_document_version_check
    check (document_version > 0);

comment on column public.legal_document_acceptances.document_version is
  'The accepted legal document version number, stored directly for audit/export in addition to document_version_id.';
