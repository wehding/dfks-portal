-- Retter fejlen 'permission denied for table aftalelicens_batches' (Postgres
-- 42501) ved import — bekræftet direkte fra Vercels serverlog:
--
--   Fejl ved oprettelse af aftalelicens-batch: {
--     code: '42501',
--     hint: 'Grant the required privileges to the current role with:
--            GRANT INSERT ON public.aftalelicens_batches TO service_role;',
--     message: 'permission denied for table aftalelicens_batches'
--   }
--
-- Al server-kode (createServiceClient()) bruger service_role — RLS-politikken
-- på tabellen omgås korrekt af service_role, men det er en SEPARAT ting fra
-- egentlige tabel-tilladelser (GRANT), som service_role IKKE automatisk får
-- for en nyoprettet tabel i dette projekt. Den oprindelige migration
-- (20260820180000) manglede denne eksplicitte tildeling.

grant select, insert, update, delete on public.aftalelicens_batches to service_role;
grant select, insert, update, delete on public.aftalelicens_batches to authenticated;
