-- Udvid contract_validations med de felter valideringssiden bruger
alter table contract_validations
  add column if not exists extracted_data           jsonb,
  add column if not exists bruger_redigerede_felter text[];
