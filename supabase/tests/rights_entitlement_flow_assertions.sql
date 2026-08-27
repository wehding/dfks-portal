-- Skema- og sikkerhedsassertions for rettighedsforbeholdsflowet.
do $$
begin
  if to_regclass('public.rights_entitlement_cases') is null then
    raise exception 'rights_entitlement_cases mangler';
  end if;
  if to_regclass('public.rights_entitlement_evidence') is null then
    raise exception 'rights_entitlement_evidence mangler';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'rights_runs_source_batch_fund_uidx'
      and indexdef ilike '%org_id%source_batch_id%fund_id%'
  ) then raise exception 'Idempotensindeks for batchoverførsel mangler'; end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rights_entitlement_cases'::regclass
      and conname = 'rights_entitlement_cases_position_uidx'
  ) then raise exception 'Én sag pr. tilbageholdt position håndhæves ikke'; end if;
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'create_rights_run_from_aftalelicens'
  ) then raise exception 'Atomisk batchoverførsel mangler'; end if;
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'distribute_rights_work_allocation'
  ) then raise exception 'Atomisk personfordeling mangler'; end if;
  if not (
    select relrowsecurity from pg_class
    where oid = 'public.rights_entitlement_cases'::regclass
  ) then raise exception 'RLS mangler på rettighedssager'; end if;
  if not (
    select relrowsecurity from pg_class
    where oid = 'public.rights_entitlement_evidence'::regclass
  ) then raise exception 'RLS mangler på rettighedsdokumentation'; end if;
end;
$$;

-- Authenticated må ikke kunne kalde de økonomiske service-RPC'er direkte.
do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.create_rights_run_from_aftalelicens(uuid,text,uuid,uuid,text,bigint,jsonb,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  ) then raise exception 'authenticated har uberettiget adgang til batch-RPC'; end if;
  if has_function_privilege(
    'authenticated',
    'public.distribute_rights_work_allocation(uuid,uuid,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ) then raise exception 'authenticated har uberettiget adgang til fordelings-RPC'; end if;
end;
$$;

