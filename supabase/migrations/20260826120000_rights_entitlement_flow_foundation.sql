-- Fundament for autoritativ overførsel fra Visningsadmin og dokumentationssager.

alter table public.organisations
  add column if not exists rights_calculation_transfer_enabled boolean not null default false;

comment on column public.organisations.rights_calculation_transfer_enabled is
  'Organisationsspecifikt feature flag for autoritativ overførsel fra Visningsadmin til rettighedsrunder.';

-- Aftalelicens bruger historiske tekst-id''er (batch_<timestamp>). Den hidtidige
-- uuid-kolonne kunne derfor aldrig indeholde den faktiske kildereference.
alter table public.rights_calculation_runs
  alter column source_batch_id type text using source_batch_id::text;

alter table public.rights_calculation_runs
  add column if not exists preview_snapshot jsonb,
  add column if not exists source_transfer_key text,
  add column if not exists calculation_locked_at timestamptz;

create unique index if not exists rights_runs_source_batch_fund_uidx
  on public.rights_calculation_runs (org_id, source_batch_id, fund_id)
  where source_batch_id is not null;

alter table public.withheld_beneficiary_positions
  add column if not exists run_id uuid,
  add column if not exists rights_holder_id uuid,
  add column if not exists right_type text,
  add column if not exists withheld_reason text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists resolution_notes text,
  add column if not exists version_number integer not null default 1;

alter table public.rights_calculation_runs
  add constraint rights_calculation_runs_org_id_id_key unique (org_id, id);
alter table public.withheld_beneficiary_positions
  add constraint withheld_beneficiary_positions_org_id_id_key unique (org_id, id);
alter table public.works
  add constraint works_org_id_id_key unique (org_id, id);
alter table public.contracts
  add constraint contracts_org_id_id_key unique (org_id, id);

alter table public.withheld_beneficiary_positions
  drop constraint if exists withheld_positions_run_org_fkey;
alter table public.withheld_beneficiary_positions
  add constraint withheld_positions_run_org_fkey
  foreign key (org_id, run_id) references public.rights_calculation_runs (org_id, id) on delete restrict;

alter table public.withheld_beneficiary_positions
  drop constraint if exists withheld_positions_holder_org_fkey;
alter table public.withheld_beneficiary_positions
  add constraint withheld_positions_holder_org_fkey
  foreign key (org_id, rights_holder_id) references public.org_affiliations (org_id, rights_holder_id) on delete restrict;

alter table public.withheld_beneficiary_positions
  drop constraint if exists withheld_positions_resolved_by_fkey;
alter table public.withheld_beneficiary_positions
  add constraint withheld_positions_resolved_by_fkey
  foreign key (resolved_by) references auth.users (id);

create table if not exists public.rights_entitlement_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  rights_holder_id uuid not null,
  work_id uuid,
  episode_id uuid,
  withheld_position_id uuid not null,
  contract_id uuid,
  right_type text not null check (right_type in ('copydan', 'svod', 'royalty')),
  status text not null default 'missing_documentation' check (status in (
    'missing_documentation', 'submitted', 'under_review',
    'more_information_required', 'confirmed', 'rejected', 'administratively_closed'
  )),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_type text,
  resolution_reason text,
  financial_effect_type text check (financial_effect_type is null or financial_effect_type in (
    'none', 'release_to_rights_holder', 'reallocate_within_work',
    'return_to_run_pool', 'supplemental_allocation', 'hold_until_claim_deadline'
  )),
  resolution_revision_id uuid,
  resolution_adjustment_id uuid,
  version_number integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rights_entitlement_cases_position_uidx unique (org_id, withheld_position_id),
  constraint rights_entitlement_cases_holder_org_fkey foreign key (org_id, rights_holder_id)
    references public.org_affiliations(org_id, rights_holder_id) on delete restrict,
  constraint rights_entitlement_cases_work_org_fkey foreign key (org_id, work_id)
    references public.works(org_id, id) on delete restrict,
  constraint rights_entitlement_cases_position_org_fkey foreign key (org_id, withheld_position_id)
    references public.withheld_beneficiary_positions(org_id, id) on delete restrict,
  constraint rights_entitlement_cases_contract_org_fkey foreign key (org_id, contract_id)
    references public.contracts(org_id, id) on delete restrict,
  constraint rights_entitlement_cases_episode_fkey foreign key (episode_id)
    references public.episodes(id) on delete restrict,
  constraint rights_entitlement_cases_financial_reference_check check (
    not (resolution_revision_id is not null and resolution_adjustment_id is not null)
  )
);

alter table public.rights_entitlement_cases
  add constraint rights_entitlement_cases_org_id_id_key unique (org_id, id);

create table if not exists public.rights_entitlement_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  case_id uuid not null,
  contract_id uuid,
  attachment_type text not null,
  storage_path text not null,
  original_filename text not null,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  validation_id uuid references public.contract_validations(id) on delete set null,
  evidence_snapshot jsonb,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  constraint rights_entitlement_evidence_case_org_fkey foreign key (org_id, case_id)
    references public.rights_entitlement_cases(org_id, id) on delete cascade,
  constraint rights_entitlement_evidence_contract_org_fkey foreign key (org_id, contract_id)
    references public.contracts(org_id, id) on delete restrict
);

alter table public.member_message_threads
  add column if not exists context_type text,
  add column if not exists rights_entitlement_case_id uuid;

alter table public.member_message_threads
  drop constraint if exists member_message_threads_entitlement_case_org_fkey;
alter table public.member_message_threads
  add constraint member_message_threads_entitlement_case_org_fkey
  foreign key (org_id, rights_entitlement_case_id)
  references public.rights_entitlement_cases(org_id, id) on delete restrict;

create unique index if not exists member_threads_entitlement_case_holder_uidx
  on public.member_message_threads (org_id, rights_entitlement_case_id, rights_holder_id)
  where rights_entitlement_case_id is not null;

create index if not exists rights_entitlement_cases_org_status_idx
  on public.rights_entitlement_cases (org_id, status, updated_at desc);
create index if not exists rights_entitlement_evidence_case_idx
  on public.rights_entitlement_evidence (org_id, case_id, uploaded_at);

alter table public.rights_entitlement_cases enable row level security;
alter table public.rights_entitlement_evidence enable row level security;

create policy "Rettighedssager kan læses af part og orgadmin"
  on public.rights_entitlement_cases for select to authenticated
  using (
    public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin'])
    or public.current_user_owns_rights_holder(rights_holder_id)
  );
create policy "Orgadmins administrerer rettighedssager"
  on public.rights_entitlement_cases for all to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
  with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

create policy "Rettighedsdokumentation kan læses af part og orgadmin"
  on public.rights_entitlement_evidence for select to authenticated
  using (exists (
    select 1 from public.rights_entitlement_cases c
    where c.id = case_id and c.org_id = org_id and (
      public.current_user_has_org_role(c.org_id, array['superadmin','admin','org-admin'])
      or public.current_user_owns_rights_holder(c.rights_holder_id)
    )
  ));
create policy "Rettighedshavere kan indsende dokumentation"
  on public.rights_entitlement_evidence for insert to authenticated
  with check (exists (
    select 1 from public.rights_entitlement_cases c
    where c.id = case_id and c.org_id = org_id
      and public.current_user_owns_rights_holder(c.rights_holder_id)
  ));
create policy "Orgadmins administrerer rettighedsdokumentation"
  on public.rights_entitlement_evidence for all to authenticated
  using (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']))
  with check (public.current_user_has_org_role(org_id, array['superadmin','admin','org-admin']));

grant select, insert, update on public.rights_entitlement_cases to authenticated;
grant select, insert on public.rights_entitlement_evidence to authenticated;
grant all on public.rights_entitlement_cases, public.rights_entitlement_evidence to service_role;

-- Atomisk og idempotent oprettelse af runde og værkbeløb. Alle økonomiske
-- værdier er beregnet og valideret i serverlaget; funktionen genvaliderer
-- organisationsgrænser, kilderækker og summer inden skrivning.
create or replace function public.create_rights_run_from_aftalelicens(
  p_org_id uuid,
  p_batch_id text,
  p_fund_id uuid,
  p_policy_version_id uuid,
  p_period_label text,
  p_gross_amount bigint,
  p_run_totals jsonb,
  p_weight_snapshot jsonb,
  p_preview_snapshot jsonb,
  p_work_rows jsonb,
  p_prepared_by uuid
)
returns table(run_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_run_id uuid;
  v_currency character(3);
  v_row_count integer;
  v_source_count integer;
  v_sum_gross bigint;
  v_sum_individual bigint;
begin
  if p_gross_amount < 0 or jsonb_typeof(p_work_rows) <> 'array' then
    raise exception 'Ugyldigt beregningsgrundlag';
  end if;

  perform 1 from public.aftalelicens_batches b
    where b.id = p_batch_id and b.org_id = p_org_id
    for update;
  if not found then raise exception 'Kildebatch findes ikke i organisationen'; end if;

  select f.currency into v_currency
  from public.rights_funds f
  where f.id = p_fund_id and f.org_id = p_org_id and f.active;
  if v_currency is null then raise exception 'Aktiv rettighedskasse findes ikke i organisationen'; end if;

  perform 1
  from public.distribution_policy_versions pv
  join public.distribution_policies p on p.id = pv.policy_id and p.org_id = pv.org_id
  where pv.id = p_policy_version_id and pv.org_id = p_org_id
    and pv.status = 'active' and p.fund_id = p_fund_id;
  if not found then raise exception 'Aktiv fordelingspolitik passer ikke til rettighedskassen'; end if;

  select r.id into v_run_id
  from public.rights_calculation_runs r
  where r.org_id = p_org_id and r.source_batch_id = p_batch_id and r.fund_id = p_fund_id;
  if v_run_id is not null then
    return query select v_run_id, false;
    return;
  end if;

  select count(*) into v_row_count from jsonb_array_elements(p_work_rows);
  select count(distinct s.id) into v_source_count
  from jsonb_array_elements(p_work_rows) row_data
  join public.screening_source_rows s
    on s.id = (row_data->>'source_row_id')::uuid
   and s.org_id = p_org_id and s.batch_key = p_batch_id;
  if v_row_count = 0 or v_source_count <> v_row_count then
    raise exception 'En eller flere kilderækker tilhører ikke batchen og organisationen';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_work_rows) row_data
    left join public.works w on w.id = (row_data->>'work_id')::uuid and w.org_id = p_org_id
    where w.id is null
  ) then raise exception 'Alle overførte rækker skal være matchet med et værk i organisationen'; end if;

  select coalesce(sum((row_data->>'gross_share')::bigint), 0),
         coalesce(sum((row_data->>'individual_net')::bigint), 0)
    into v_sum_gross, v_sum_individual
  from jsonb_array_elements(p_work_rows) row_data;
  if v_sum_gross <> p_gross_amount
     or v_sum_individual <> (p_run_totals->>'individual_amount')::bigint then
    raise exception 'Værkbeløbene afstemmer ikke til rundens totaler';
  end if;

  insert into public.rights_calculation_runs (
    org_id, fund_id, policy_version_id, source_batch_id, source_batch_ref,
    period_label, currency, gross_amount, admin_amount, distribution_basis,
    claim_reserve_amount, sku_direct_amount, sku_from_reserve_amount,
    statutory_collective_amount, net_claim_reserve_amount, individual_amount,
    weight_config_snapshot, preview_snapshot, source_transfer_key,
    calculation_locked_at, status, prepared_by
  ) values (
    p_org_id, p_fund_id, p_policy_version_id, p_batch_id, p_batch_id,
    p_period_label, v_currency, p_gross_amount,
    (p_run_totals->>'admin_amount')::bigint,
    (p_run_totals->>'distribution_basis')::bigint,
    (p_run_totals->>'claim_reserve_amount')::bigint,
    (p_run_totals->>'sku_direct_amount')::bigint,
    (p_run_totals->>'sku_from_reserve_amount')::bigint,
    (p_run_totals->>'statutory_collective_amount')::bigint,
    (p_run_totals->>'net_claim_reserve_amount')::bigint,
    (p_run_totals->>'individual_amount')::bigint,
    p_weight_snapshot, p_preview_snapshot,
    p_org_id::text || '|' || p_batch_id || '|' || p_fund_id::text,
    now(), 'calculated', p_prepared_by
  ) returning id into v_run_id;

  insert into public.rights_work_allocations (
    org_id, run_id, work_id, episode_id, source_row_id, source_ref,
    usage_date, usage_year, claim_period_start, claim_deadline,
    eligible_for_undistributable_at, is_rebroadcast, points, pool_share_bps,
    currency, gross_share, admin_share, claim_reserve_share, sku_direct_share,
    sku_from_reserve_share, statutory_collective_share, net_claim_reserve_share,
    individual_net, status
  )
  select p_org_id, v_run_id, (j->>'work_id')::uuid,
    nullif(j->>'episode_id', '')::uuid, (j->>'source_row_id')::uuid,
    j->>'source_ref', nullif(j->>'usage_date', '')::date,
    (j->>'usage_year')::integer, ((j->>'usage_year') || '-12-31')::date,
    (((j->>'usage_year')::integer + 3)::text || '-12-31')::date,
    (((j->>'usage_year')::integer + 4)::text || '-01-01')::date,
    coalesce((j->>'is_rebroadcast')::boolean, false), (j->>'points')::numeric,
    (j->>'pool_share_bps')::integer, v_currency,
    (j->>'gross_share')::bigint, (j->>'admin_share')::bigint,
    (j->>'claim_reserve_share')::bigint, (j->>'sku_direct_share')::bigint,
    (j->>'sku_from_reserve_share')::bigint, (j->>'statutory_collective_share')::bigint,
    (j->>'net_claim_reserve_share')::bigint, (j->>'individual_net')::bigint,
    'pending'
  from jsonb_array_elements(p_work_rows) j;

  update public.distribution_policy_versions
    set used_in_calculation = true where id = p_policy_version_id and org_id = p_org_id;
  update public.aftalelicens_batches
    set status = 'completed' where id = p_batch_id and org_id = p_org_id;

  return query select v_run_id, true;
exception when unique_violation then
  select r.id into v_run_id from public.rights_calculation_runs r
    where r.org_id = p_org_id and r.source_batch_id = p_batch_id and r.fund_id = p_fund_id;
  if v_run_id is null then raise; end if;
  return query select v_run_id, false;
end;
$function$;

revoke all on function public.create_rights_run_from_aftalelicens(
  uuid, text, uuid, uuid, text, bigint, jsonb, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.create_rights_run_from_aftalelicens(
  uuid, text, uuid, uuid, text, bigint, jsonb, jsonb, jsonb, jsonb, uuid
) to service_role;

-- Opretter dokumenterede tildelinger og tilbageholdte positioner i samme
-- transaktion. Serverlaget leverer largest-remainder-fordelte heltalsbeløb;
-- databasen afstemmer alle komponenter mod værkbeløbet før skrivning.
create or replace function public.distribute_rights_work_allocation(
  p_org_id uuid,
  p_run_id uuid,
  p_work_allocation_id uuid,
  p_right_type text,
  p_items jsonb,
  p_actor uuid
)
returns table(allocation_count integer, withheld_count integer)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_work public.rights_work_allocations%rowtype;
  v_item jsonb;
  v_position_id uuid;
  v_case_id uuid;
  v_allocations integer := 0;
  v_withheld integer := 0;
begin
  if p_right_type not in ('copydan', 'svod', 'royalty')
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Ugyldig rettighedsfordeling';
  end if;

  select wa.* into v_work
  from public.rights_work_allocations wa
  where wa.id = p_work_allocation_id and wa.org_id = p_org_id and wa.run_id = p_run_id
  for update;
  if not found then raise exception 'Værkbeløbet findes ikke i organisationen og runden'; end if;

  if exists (select 1 from public.rights_allocations a where a.org_id = p_org_id and a.work_allocation_id = p_work_allocation_id)
     or exists (select 1 from public.withheld_beneficiary_positions w where w.org_id = p_org_id and w.work_allocation_id = p_work_allocation_id) then
    raise exception 'Værkbeløbet er allerede personfordelt';
  end if;

  if (select sum((j->>'share_bps')::integer) from jsonb_array_elements(p_items) j) <> 10000
     or (select sum((j->>'gross_share')::bigint) from jsonb_array_elements(p_items) j) <> v_work.gross_share
     or (select sum((j->>'admin_share')::bigint) from jsonb_array_elements(p_items) j) <> v_work.admin_share
     or (select sum((j->>'claim_reserve_share')::bigint) from jsonb_array_elements(p_items) j) <> v_work.claim_reserve_share
     or (select sum((j->>'sku_direct_share')::bigint) from jsonb_array_elements(p_items) j) <> v_work.sku_direct_share
     or (select sum((j->>'sku_from_reserve_share')::bigint) from jsonb_array_elements(p_items) j) <> v_work.sku_from_reserve_share
     or (select sum((j->>'statutory_collective_share')::bigint) from jsonb_array_elements(p_items) j) <> v_work.statutory_collective_share
     or (select sum((j->>'net_amount')::bigint) from jsonb_array_elements(p_items) j) <> v_work.individual_net then
    raise exception 'Personfordelingen afstemmer ikke til værkbeløbet';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform 1 from public.org_affiliations affiliation
      where affiliation.org_id = p_org_id
        and affiliation.rights_holder_id = (v_item->>'rights_holder_id')::uuid;
    if not found then raise exception 'Rettighedshaver tilhører ikke organisationen'; end if;

    if coalesce((v_item->>'documented')::boolean, false) then
      insert into public.rights_allocations (
        org_id, run_id, work_allocation_id, rights_holder_id,
        distribution_key_scope, distribution_key_snapshot, share_percent,
        role_code, currency, gross_share, admin_share, claim_reserve_share,
        sku_direct_share, sku_from_reserve_share, statutory_collective_share,
        net_amount, share_bps, individual_amount, status, blocked_reason
      ) values (
        p_org_id, p_run_id, p_work_allocation_id, (v_item->>'rights_holder_id')::uuid,
        coalesce(v_item->>'distribution_key_scope', 'work'),
        coalesce(v_item->'distribution_key_snapshot', '{}'::jsonb),
        (v_item->>'share_bps')::numeric / 100,
        v_item->>'role_code', v_work.currency,
        (v_item->>'gross_share')::bigint, (v_item->>'admin_share')::bigint,
        (v_item->>'claim_reserve_share')::bigint, (v_item->>'sku_direct_share')::bigint,
        (v_item->>'sku_from_reserve_share')::bigint,
        (v_item->>'statutory_collective_share')::bigint,
        (v_item->>'net_amount')::bigint, (v_item->>'share_bps')::integer,
        (v_item->>'net_amount')::bigint, 'pending', null
      );
      v_allocations := v_allocations + 1;
    else
      insert into public.withheld_beneficiary_positions (
        org_id, run_id, work_allocation_id, rights_holder_id, right_type,
        position_scope, share_percent, currency, withheld_amount, remaining_amount,
        reason, withheld_reason, reason_note, status, created_by
      ) values (
        p_org_id, p_run_id, p_work_allocation_id, (v_item->>'rights_holder_id')::uuid,
        p_right_type, coalesce(v_item->>'distribution_key_scope', 'work'),
        (v_item->>'share_bps')::numeric / 100, v_work.currency,
        (v_item->>'net_amount')::bigint, (v_item->>'net_amount')::bigint,
        'other', 'missing_documentation',
        'Dokumentation for rettighedsforbehold mangler', 'active', p_actor
      ) returning id into v_position_id;

      insert into public.rights_entitlement_cases (
        org_id, rights_holder_id, work_id, episode_id, withheld_position_id,
        contract_id, right_type, status
      ) values (
        p_org_id, (v_item->>'rights_holder_id')::uuid, v_work.work_id, v_work.episode_id,
        v_position_id, nullif(v_item->>'contract_id', '')::uuid,
        p_right_type, 'missing_documentation'
      ) returning id into v_case_id;

      insert into public.rights_notifications (
        org_id, rights_holder_id, event_type, subject_type, subject_id, channel,
        subject_line, body_text, body_preview
      ) values
        (p_org_id, (v_item->>'rights_holder_id')::uuid, 'documentation_missing',
         'rights_entitlement_case', v_case_id, 'portal',
         'Dokumentation for rettighedsforbehold mangler',
         'Åbn din rettighedssag i portalen for at se værket og indsende dokumentation.',
         'Dokumentation mangler på en mulig rettighedsposition.'),
        (p_org_id, (v_item->>'rights_holder_id')::uuid, 'documentation_missing',
         'rights_entitlement_case', v_case_id, 'email',
         'Dokumentation for rettighedsforbehold mangler',
         'Log ind i portalen for at se sagen og indsende dokumentation.',
         'Dokumentation mangler på en mulig rettighedsposition.')
      on conflict (idempotency_key) do nothing;
      v_withheld := v_withheld + 1;
    end if;
  end loop;

  update public.rights_work_allocations
    set status = case
      when v_withheld = 0 then 'distributed'
      when v_allocations = 0 then 'fully_withheld'
      else 'partially_withheld'
    end
  where id = p_work_allocation_id and org_id = p_org_id;

  return query select v_allocations, v_withheld;
end;
$function$;

revoke all on function public.distribute_rights_work_allocation(uuid, uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.distribute_rights_work_allocation(uuid, uuid, uuid, text, jsonb, uuid)
  to service_role;

-- Kobl de nye og berørte økonomiobjekter på det eksisterende append-only,
-- redigerede auditspor. Funktionen blev introduceret af general audit-migrationen.
do $audit$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'rights_calculation_runs', 'rights_work_allocations', 'rights_allocations',
    'withheld_beneficiary_positions', 'rights_entitlement_cases',
    'rights_entitlement_evidence', 'rights_notifications'
  ] loop
    trigger_name := 'audit_' || table_name || '_changes';
    execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.capture_audit_row_change()',
      trigger_name, table_name
    );
  end loop;
end;
$audit$;
