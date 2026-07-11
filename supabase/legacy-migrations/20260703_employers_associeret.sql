-- Tilføjer associeret-kolonne til employers
-- Associerede ProF-medlemmer er ikke overenskomstbundet

alter table employers
    add column if not exists associeret boolean not null default false;

comment on column employers.associeret is
    'Associeret medlem af Producentforeningen — ikke overenskomstbundet';
