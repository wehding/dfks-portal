-- Sorterings-/godkendelsesbeslutninger (godkend/afvis, værktype) blev
-- tidligere KUN holdt i browserens midlertidige React-tilstand — aldrig
-- gemt nogen steder. Bekræftet af Martin: lukker man portalen og logger
-- ind igen, er alt arbejde tabt, og sortering skal startes forfra.
--
-- Tilføjer de manglende, persistente felter direkte på
-- screening_source_rows, så hver enkelt godkendelse/afvisning gemmes
-- løbende, i takt med den foretages — ikke først ved en samlet "gem"-handling.

alter table public.screening_source_rows
  add column if not exists sort_status text not null default 'pending'
    check (sort_status in ('pending', 'approved', 'rejected', 'flagged')),
  add column if not exists vaerk_type text,
  add column if not exists sorted_by text,
  add column if not exists sorted_at timestamptz;

create index if not exists screening_source_rows_sort_status_idx
  on public.screening_source_rows (org_id, batch_key, sort_status);
