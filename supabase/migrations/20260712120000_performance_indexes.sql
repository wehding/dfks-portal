-- Performance-indeks til de tungeste liste-forespørgsler.
-- Ingen datamodel-ændring — kun hurtigere opslag/sortering.
-- Alle med "if not exists" så de er sikre at køre igen.

-- Kontrakter: "mine kontrakter, nyeste først" + admin-liste pr. org/status
create index if not exists contracts_rights_holder_created_idx
    on contracts (rights_holder_id, created_at desc);
create index if not exists contracts_org_created_idx
    on contracts (org_id, created_at desc);
create index if not exists contracts_org_status_created_idx
    on contracts (org_id, status, created_at desc);

-- Værker: admin-liste pr. org, nyeste først, samt filtrering på status
create index if not exists works_org_created_idx
    on works (org_id, created_at desc);
create index if not exists works_org_status_created_idx
    on works (org_id, status, created_at desc);

-- Værk-tildelinger: "mine værker" opslag pr. rettighedshaver.
-- (work_id er allerede dækket af det eksisterende unikke indeks
--  work_assignments_work_holder_role_uidx.)
create index if not exists work_assignments_rights_holder_created_idx
    on work_assignments (rights_holder_id, created_at desc);
