-- Fjern den gamle overenskomst_satser-tabel.
-- Lønsatser er nu i agreement_wage_rules (+ agreement_pension_rules).
drop table if exists overenskomst_satser;
