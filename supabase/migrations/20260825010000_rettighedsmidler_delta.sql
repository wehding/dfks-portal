-- =============================================================================
-- Rettighedsmidler-delta
-- Rækkefølge: nye tabeller oprettes FØR alter table på eksisterende,
-- så FK-referencer altid peger på tabeller der allerede eksisterer.
-- =============================================================================

-- ── Hjælpefunktion ───────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Organisationsudvidelse ────────────────────────────────────────────────────

alter table organisations
  add column if not exists payout_threshold_minor bigint not null default 5000,
  add column if not exists payout_currency        text   not null default 'DKK';

-- ── rights_funds: tilføj manglende kolonner ───────────────────────────────────

alter table rights_funds
  add column if not exists description text,
  add column if not exists active      boolean not null default true,
  add column if not exists currency    text    not null default 'DKK',
  add column if not exists updated_at  timestamptz not null default now();

create index if not exists rights_funds_org_idx on rights_funds(org_id);

-- =============================================================================
-- TRIN 1: Opret nye tabeller i afhængighedsrækkefølge
-- =============================================================================

-- fund_policy_versions (afhænger af rights_funds)
create table if not exists fund_policy_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  fund_id         uuid not null references rights_funds(id) on delete cascade,
  version_label   text not null,
  effective_from  date not null,
  effective_to    date,
  created_by      uuid references auth.users(id),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists fund_policy_versions_fund_idx on fund_policy_versions(fund_id);

-- fund_policy_components (afhænger af fund_policy_versions)
create table if not exists fund_policy_components (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  policy_version_id uuid not null references fund_policy_versions(id) on delete cascade,
  component_type    text not null
    check (component_type in ('individual','collective','admin','reserve','other')),
  share_bps         int  not null check (share_bps >= 0 and share_bps <= 10000),
  description       text,
  created_at        timestamptz not null default now()
);

create index if not exists fund_policy_components_policy_idx on fund_policy_components(policy_version_id);

-- calculation_runs (afhænger af rights_funds + fund_policy_versions)
create table if not exists calculation_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  fund_id           uuid not null references rights_funds(id),
  period_label      text not null,
  status            text not null default 'draft'
    check (status in ('draft','active','review','booked','cancelled')),
  total_amount      bigint not null default 0,
  individual_amount bigint not null default 0,
  collective_amount bigint not null default 0,
  admin_fee_amount  bigint not null default 0,
  reserve_amount    bigint not null default 0,
  currency          text not null default 'DKK',
  policy_version_id uuid references fund_policy_versions(id),
  prepared_by       uuid references auth.users(id),
  approved_by       uuid references auth.users(id),
  booked_at         timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint calculation_runs_four_eyes
    check (prepared_by is null or approved_by is null or prepared_by != approved_by)
);

create trigger calculation_runs_updated_at
  before update on calculation_runs
  for each row execute function set_updated_at();

create index if not exists calculation_runs_org_idx    on calculation_runs(org_id);
create index if not exists calculation_runs_fund_idx   on calculation_runs(fund_id);
create index if not exists calculation_runs_status_idx on calculation_runs(status);

-- work_allocations (afhænger af calculation_runs)
create table if not exists work_allocations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  run_id            uuid not null references calculation_runs(id) on delete cascade,
  work_id           uuid references works(id),
  episode_id        uuid references episodes(id),
  allocation_amount bigint not null check (allocation_amount >= 0),
  currency          text not null default 'DKK',
  notes             text,
  created_at        timestamptz not null default now(),
  constraint work_allocations_work_or_episode
    check (work_id is not null or episode_id is not null)
);

create index if not exists work_allocations_run_idx  on work_allocations(run_id);
create index if not exists work_allocations_work_idx on work_allocations(work_id);

-- withheld_positions (afhænger af calculation_runs + work_allocations)
create table if not exists withheld_positions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organisations(id) on delete cascade,
  run_id             uuid not null references calculation_runs(id) on delete cascade,
  rights_holder_id   uuid not null references rettighedshavere(id),
  work_allocation_id uuid references work_allocations(id),
  amount             bigint not null check (amount >= 0),
  currency           text not null default 'DKK',
  reason             text not null,
  status             text not null default 'pending'
    check (status in ('pending','resolved','released','written_off')),
  resolution_notes   text,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create index if not exists withheld_positions_run_idx    on withheld_positions(run_id);
create index if not exists withheld_positions_holder_idx on withheld_positions(rights_holder_id);

-- undistributable_actions (afhænger af calculation_runs)
create table if not exists undistributable_actions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  run_id      uuid not null references calculation_runs(id),
  action_type text not null
    check (action_type in ('transfer_to_reserve','write_off','transfer_to_collective','other')),
  amount      bigint not null check (amount > 0),
  currency    text not null default 'DKK',
  destination text,
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists undistributable_actions_run_idx on undistributable_actions(run_id);

-- search_publications (ingen FK til nye tabeller)
create table if not exists search_publications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  known_name      text not null,
  alias           text,
  work_titles     text[],
  period_label    text,
  description     text,
  withheld_amount bigint,
  currency        text not null default 'DKK',
  claim_deadline  date,
  status          text not null default 'draft'
    check (status in ('draft','published','responded','closed')),
  published_at    timestamptz,
  responded_at    timestamptz,
  closed_at       timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists search_publications_org_idx    on search_publications(org_id);
create index if not exists search_publications_status_idx on search_publications(status);

-- rights_admin_tasks (ingen FK til nye tabeller)
create table if not exists rights_admin_tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations(id) on delete cascade,
  task_type    text not null,
  subject_type text,
  subject_id   uuid,
  priority     text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status       text not null default 'open'
    check (status in ('open','in_progress','resolved','dismissed')),
  description  text,
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists rights_admin_tasks_org_idx    on rights_admin_tasks(org_id);
create index if not exists rights_admin_tasks_status_idx on rights_admin_tasks(status);

drop view if exists rights_notifications_admin_tasks;
create view rights_notifications_admin_tasks as
  select * from rights_admin_tasks;

-- =============================================================================
-- TRIN 2: Tilføj manglende kolonner på eksisterende tabeller
-- (calculation_runs og work_allocations eksisterer nu)
-- =============================================================================

-- reserve_entries
alter table reserve_entries
  add column if not exists run_id      uuid references calculation_runs(id) on delete cascade,
  add column if not exists entry_type  text,
  add column if not exists amount      bigint,
  add column if not exists currency    text not null default 'DKK',
  add column if not exists description text,
  add column if not exists created_by  uuid references auth.users(id),
  add column if not exists created_at  timestamptz not null default now();

-- rights_adjustments
alter table rights_adjustments
  add column if not exists org_id       uuid references organisations(id) on delete cascade,
  add column if not exists amount_delta bigint,
  add column if not exists reason       text,
  add column if not exists created_by   uuid references auth.users(id),
  add column if not exists created_at   timestamptz not null default now();

-- rights_allocations
alter table rights_allocations
  add column if not exists run_id             uuid references calculation_runs(id) on delete cascade,
  add column if not exists work_allocation_id uuid references work_allocations(id) on delete cascade,
  add column if not exists share_bps          int,
  add column if not exists individual_amount  bigint not null default 0,
  add column if not exists adjustment_total   bigint not null default 0,
  add column if not exists net_amount         bigint not null default 0,
  add column if not exists status             text not null default 'pending',
  add column if not exists blocked_reason     text,
  add column if not exists booked_at          timestamptz,
  add column if not exists currency           text not null default 'DKK',
  add column if not exists updated_at         timestamptz not null default now();

create index if not exists rights_allocations_run_idx    on rights_allocations(run_id);
create index if not exists rights_allocations_holder_idx on rights_allocations(rights_holder_id);

-- rights_claims
alter table rights_claims
  add column if not exists run_id       uuid references calculation_runs(id),
  add column if not exists claim_amount bigint,
  add column if not exists currency     text not null default 'DKK',
  add column if not exists claim_date   date not null default current_date,
  add column if not exists deadline     date,
  add column if not exists is_timely    boolean,
  add column if not exists review_notes text,
  add column if not exists reviewed_by  uuid references auth.users(id),
  add column if not exists reviewed_at  timestamptz,
  add column if not exists created_at   timestamptz not null default now();

-- rights_notifications
alter table rights_notifications
  add column if not exists event_type    text,
  add column if not exists subject_type  text,
  add column if not exists subject_id    uuid,
  add column if not exists channel       text not null default 'email',
  add column if not exists status        text not null default 'pending',
  add column if not exists scheduled_at  timestamptz not null default now(),
  add column if not exists sent_at       timestamptz,
  add column if not exists failed_at     timestamptz,
  add column if not exists failed_reason text,
  add column if not exists body_preview  text,
  add column if not exists created_at    timestamptz not null default now();

-- settlements
alter table settlements
  add column if not exists fund_id                uuid references rights_funds(id),
  add column if not exists label                  text,
  add column if not exists status                 text not null default 'draft',
  add column if not exists total_gross            bigint not null default 0,
  add column if not exists total_individual       bigint not null default 0,
  add column if not exists total_below_threshold  bigint not null default 0,
  add column if not exists total_payable          bigint not null default 0,
  add column if not exists currency               text not null default 'DKK',
  add column if not exists payout_threshold_minor bigint not null default 0,
  add column if not exists prepared_by            uuid references auth.users(id),
  add column if not exists approved_by            uuid references auth.users(id),
  add column if not exists paid_out_at            timestamptz,
  add column if not exists notes                  text,
  add column if not exists updated_at             timestamptz not null default now();

create index if not exists settlements_org_idx    on settlements(org_id);
create index if not exists settlements_fund_idx   on settlements(fund_id);
create index if not exists settlements_status_idx on settlements(status);

-- settlement_items
alter table settlement_items
  add column if not exists settlement_id    uuid references settlements(id) on delete cascade,
  add column if not exists allocation_id    uuid references rights_allocations(id),
  add column if not exists rights_holder_id uuid references rettighedshavere(id),
  add column if not exists individual_net   bigint not null default 0,
  add column if not exists adjustment_total bigint not null default 0,
  add column if not exists payable_amount   bigint not null default 0,
  add column if not exists below_threshold  boolean not null default false,
  add column if not exists blocked_reason   text,
  add column if not exists currency         text not null default 'DKK',
  add column if not exists created_at       timestamptz not null default now();

-- payroll_export_batches
alter table payroll_export_batches
  add column if not exists settlement_id  uuid references settlements(id),
  add column if not exists export_system  text not null default 'datalon',
  add column if not exists exported_at    timestamptz not null default now(),
  add column if not exists exported_by    uuid references auth.users(id),
  add column if not exists row_count      int not null default 0,
  add column if not exists file_reference text,
  add column if not exists status         text not null default 'exported',
  add column if not exists created_at     timestamptz not null default now();

create index if not exists payroll_export_batches_settlement_idx on payroll_export_batches(settlement_id);

-- payouts
alter table payouts
  add column if not exists settlement_id    uuid references settlements(id) on delete cascade,
  add column if not exists rights_holder_id uuid references rettighedshavere(id),
  add column if not exists gross_amount     bigint not null default 0,
  add column if not exists net_amount       bigint not null default 0,
  add column if not exists currency         text not null default 'DKK',
  add column if not exists status           text not null default 'pending',
  add column if not exists payroll_batch_id uuid references payroll_export_batches(id),
  add column if not exists nem_konto_ref    text,
  add column if not exists processed_at     timestamptz,
  add column if not exists failed_reason    text,
  add column if not exists created_at       timestamptz not null default now();

-- payroll_recipient_references
alter table payroll_recipient_references
  add column if not exists system       text not null default 'datalon',
  add column if not exists recipient_id text,
  add column if not exists active       boolean not null default true,
  add column if not exists created_at   timestamptz not null default now();

-- inheritance_relations
alter table inheritance_relations
  add column if not exists heir_cpr_encrypted text,
  add column if not exists relation_type      text,
  add column if not exists verified           boolean not null default false,
  add column if not exists verified_at        timestamptz,
  add column if not exists verified_by        uuid references auth.users(id),
  add column if not exists notes              text,
  add column if not exists created_at         timestamptz not null default now();

-- =============================================================================
-- TRIN 3: RLS på nye tabeller
-- =============================================================================

alter table fund_policy_versions    enable row level security;
alter table fund_policy_components  enable row level security;
alter table calculation_runs        enable row level security;
alter table work_allocations        enable row level security;
alter table withheld_positions      enable row level security;
alter table undistributable_actions enable row level security;
alter table search_publications     enable row level security;
alter table rights_admin_tasks      enable row level security;

create or replace function current_user_org_id()
returns uuid language sql stable as $$
  select org_id from user_org_roles where user_id = auth.uid() limit 1;
$$;

create or replace function is_org_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from user_org_roles
    where user_id = auth.uid()
      and role in ('admin','org-admin','superadmin')
  );
$$;

do $$ declare tbl text; begin
  foreach tbl in array array[
    'fund_policy_versions','fund_policy_components',
    'calculation_runs','work_allocations',
    'withheld_positions','undistributable_actions',
    'search_publications','rights_admin_tasks'
  ] loop
    execute format('drop policy if exists %I_admin_all on %I', tbl, tbl);
    execute format(
      'create policy %I_admin_all on %I
         for all to authenticated
         using (org_id = current_user_org_id() and is_org_admin())
         with check (org_id = current_user_org_id() and is_org_admin())',
      tbl, tbl
    );
  end loop;
end $$;

-- Portalmedlemmer kan læse egne data
drop policy if exists rights_allocations_member_read on rights_allocations;
create policy rights_allocations_member_read on rights_allocations
  for select to authenticated
  using (rights_holder_id in (
    select id from rettighedshavere where user_id = auth.uid()
  ));

drop policy if exists settlement_items_member_read on settlement_items;
create policy settlement_items_member_read on settlement_items
  for select to authenticated
  using (rights_holder_id in (
    select id from rettighedshavere where user_id = auth.uid()
  ));

drop policy if exists payouts_member_read on payouts;
create policy payouts_member_read on payouts
  for select to authenticated
  using (rights_holder_id in (
    select id from rettighedshavere where user_id = auth.uid()
  ));

drop policy if exists rights_notifications_member_read on rights_notifications;
create policy rights_notifications_member_read on rights_notifications
  for select to authenticated
  using (
    channel = 'portal'
    and rights_holder_id in (
      select id from rettighedshavere where user_id = auth.uid()
    )
  );
