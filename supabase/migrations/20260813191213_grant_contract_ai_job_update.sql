-- Contract-workeren skal kunne afslutte og fejlmarkere jobs, efter den
-- privilegerede claim-funktion har reserveret dem. Browserroller får fortsat
-- ingen direkte skriveadgang til jobtabellen.
grant update on table public.contract_ai_jobs to service_role;
