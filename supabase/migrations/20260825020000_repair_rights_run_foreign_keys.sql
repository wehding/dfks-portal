-- Ret run_id-referencer, som delta-migrationen fejlagtigt bandt til den
-- parallelle legacy-tabel calculation_runs. Applikationen opretter og bruger
-- kørsler i rights_calculation_runs.

alter table public.rights_allocations
  drop constraint if exists rights_allocations_run_id_fkey;

alter table public.rights_allocations
  add constraint rights_allocations_run_id_fkey
  foreign key (run_id)
  references public.rights_calculation_runs(id)
  on delete cascade;

alter table public.rights_claims
  drop constraint if exists rights_claims_run_id_fkey;

alter table public.rights_claims
  add constraint rights_claims_run_id_fkey
  foreign key (run_id)
  references public.rights_calculation_runs(id);
