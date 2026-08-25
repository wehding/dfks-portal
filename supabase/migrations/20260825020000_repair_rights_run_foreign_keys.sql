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

-- Hærd de ældre hjælpefunktioner mod schema-shadowing.
create or replace function public.current_user_org_id()
returns uuid
language sql
stable
set search_path to ''
as $function$
  select org_id
  from public.user_org_roles
  where user_id = auth.uid()
  limit 1;
$function$;

create or replace function public.is_org_admin()
returns boolean
language sql
stable
set search_path to ''
as $function$
  select exists (
    select 1
    from public.user_org_roles
    where user_id = auth.uid()
      and role in ('admin', 'org-admin', 'superadmin')
  );
$function$;
