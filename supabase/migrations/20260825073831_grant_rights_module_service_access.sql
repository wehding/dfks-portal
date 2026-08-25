-- Stamdatafunktionerne tilgås gennem autoriserede server actions. RLS alene
-- giver ikke tabelrettigheder, så service_role får kun de operationer, som de
-- nuværende handlinger kræver. Browserrollerne får ingen yderligere grants.
grant select, insert, update on table public.rights_funds to service_role;
grant select, insert on table public.distribution_policies to service_role;
grant select, insert, update on table public.distribution_policy_versions to service_role;
grant select, insert on table public.distribution_policy_components to service_role;
