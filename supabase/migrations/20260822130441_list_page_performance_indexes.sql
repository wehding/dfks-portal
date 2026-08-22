-- Kontraktarkivet henter importstatus for den synlige side via org_id + contract_id
-- og vælger den nyeste registrering. Det delvise indeks holder både læse- og
-- skriveomkostningen nede ved kun at omfatte faktisk tilknyttede kontrakter.
create index if not exists contract_import_items_org_contract_created_idx
  on public.contract_import_items (org_id, contract_id, created_at desc)
  where contract_id is not null;
