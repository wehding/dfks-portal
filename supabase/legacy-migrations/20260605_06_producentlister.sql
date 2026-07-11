-- ============================================================
-- Modul 6: Producentlister
-- Udvider employers med website + indeks på employer_registries
-- employer_registries bruges som gruppemedlemskab:
--   association_name = gruppenavn (fx 'ProF Fiktion')
--   valid_to IS NULL  = aktivt medlem
--   valid_to IS NOT NULL = udmeldt (historik bevares)
-- ============================================================

alter table employers
    add column if not exists website text;

-- Hurtigere opslag
create index if not exists idx_employer_registries_assoc
    on employer_registries(association_name);

create index if not exists idx_employer_registries_active
    on employer_registries(employer_id, association_name)
    where valid_to is null;

-- Unikt aktivt medlemskab per (employer, association)
-- (tillader genindmeldelse ved at sætte valid_to og indsætte ny række)
create unique index if not exists uq_employer_registry_active
    on employer_registries(employer_id, association_name)
    where valid_to is null;
