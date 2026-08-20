-- Lag 4: layout_data på contracts (ikke contract_validations)
-- Layout er en filegenskab — beregnes én gang ved første åbning,
-- genbruges ved reanalyse uden at genparsere PDF/DOCX.
alter table public.contracts
    add column if not exists layout_data jsonb;
