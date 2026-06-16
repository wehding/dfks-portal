-- Tilføjer compliance_extract til contract_reviews
-- Gemmer trin 2-output (struktureret JSON) til debugging og deterministisk
-- verifikation af at alle required_clauses optræder i den færdige mail.

alter table contract_reviews
    add column if not exists compliance_extract jsonb null;

comment on column contract_reviews.compliance_extract is
    'Trin 2 compliance-udtræk: required_clauses, flagged_issues, risk_level, loan_calculation. Kun til intern brug/debugging — vises aldrig til член.';
