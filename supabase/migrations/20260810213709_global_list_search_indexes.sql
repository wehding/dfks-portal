-- Understøtter søgning og filtrering i hele de centrale adminlister, før
-- paginering anvendes. pg_trgm gør også infix- og fuzzy-lignende ILIKE-søgning
-- effektiv på navn og titel.
create extension if not exists pg_trgm with schema extensions;

create index if not exists works_title_trgm_idx
  on public.works using gin (lower(title) extensions.gin_trgm_ops);
create index if not exists works_org_status_type_year_idx
  on public.works (org_id, status, type, year desc);
create index if not exists works_external_connections_idx
  on public.works (org_id, dfi_id, tmdb_id, imdb_id);

create index if not exists contracts_working_title_trgm_idx
  on public.contracts using gin (lower(coalesce(working_title, '')) extensions.gin_trgm_ops);
create index if not exists contracts_org_status_type_date_idx
  on public.contracts (org_id, status, type, contract_date desc);

create index if not exists rights_holders_full_name_trgm_idx
  on public.rettighedshavere using gin (lower(full_name) extensions.gin_trgm_ops);
create index if not exists rights_holders_email_trgm_idx
  on public.rettighedshavere using gin (lower(coalesce(email, '')) extensions.gin_trgm_ops);

create index if not exists employers_name_trgm_idx
  on public.employers using gin (lower(name) extensions.gin_trgm_ops);
