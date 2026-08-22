-- Gem sorterings-/godkendelsesbeslutninger på de importerede visningsrækker,
-- så arbejdet overlever navigation, genindlæsning og login/logout.

alter table public.screening_source_rows
  add column if not exists sort_status text not null default 'pending'
    check (sort_status in ('pending', 'approved', 'rejected', 'flagged')),
  add column if not exists vaerk_type text,
  add column if not exists sorted_by text,
  add column if not exists sorted_at timestamptz;

create index if not exists screening_source_rows_sort_status_idx
  on public.screening_source_rows (org_id, batch_key, sort_status);
