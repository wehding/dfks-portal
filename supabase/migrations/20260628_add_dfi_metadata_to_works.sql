-- Tilføj dfi_metadata kolonne til works tabellen til udvidet DFI data
ALTER TABLE works ADD COLUMN IF NOT EXISTS dfi_metadata jsonb;
