-- =============================================================================
-- Rettighedsmidler-modul (trin 1–9)
-- Tabeller: rights_funds, fund_policy_versions, fund_policy_components,
--           calculation_runs, work_allocations, rights_allocations,
--           rights_adjustments, withheld_positions,
--           reserve_entries, rights_claims, undistributable_actions,
--           search_publications, inheritance_relations,
--           settlements, settlement_items, payouts,
--           payroll_recipient_references, payroll_export_batches,
--           rights_notifications
-- Views:    rights_notifications_admin_tasks
-- =============================================================================

-- ── Hjælpefunktion: opdatér updated_at automatisk ────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Organisationsudvidelse: udbetalingstærskel ────────────────────────────────

alter table organisations
  add column if not exists payout_threshold_minor bigint not null default 5000,
  add column if not exists payout_currency        text   not null default 'DKK';

-- =============================================================================
-- 1. RETTIGHEDSKASSER OG FORDELINGSPOLITIK
-- =============================================================================

create table if not exists rights_funds (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  currency    text not null default 'DKK',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger rights_funds_updated_at
  before update on rights_funds
  for each row execute function set_updated_at();

create index if not exists rights_funds_org_idx on rights_funds(org_id);

-- Versionerede fordelingspolitikker pr. kasse
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

-- Komponenter pr. politikversion (individuel/kollektiv/admin m.fl.)
create table if not exists fund_policy_components (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organisations(id) on delete cascade,
  policy_version_id  uuid not null references fund_policy_versions(id) on delete cascade,
  component_type     text not null
    check (component_type in ('individual','collective','admin','reserve','other')),
  share_bps          int  not null check (share_bps >= 0 and share_bps <= 10000),
  description        text,
  created_at         timestamptz not null default now()
);

create index if not exists fund_policy_components_policy_idx on fund_policy_components(policy_version_id);

-- =============================================================================
-- 2. BEREGNINGSRUNDER
-- =============================================================================

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
  -- Fire-øjne: den der forbereder må ikke godkende
  constraint calculation_runs_four_eyes
    check (prepared_by is null or approved_by is null or prepared_by != approved_by)
);

create trigger calculation_runs_updated_at
  before update on calculation_runs
  for each row execute function set_updated_at();

create index if not exists calculation_runs_org_idx  on calculation_runs(org_id);
create index if not exists calculation_runs_fund_idx on calculation_runs(fund_id);
create index if not exists calculation_runs_status_idx on calculation_runs(status);

-- =============================================================================
-- 3. VÆRKSTILDELINGER OG INDIVIDUELLE TILDELINGER
-- =============================================================================

-- Tildelingsbeløb pr. værk/episode inden for én beregningsrunde
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

create index if not exists work_allocations_run_idx on work_allocations(run_id);
create index if not exists work_allocations_work_idx on work_allocations(work_id);

-- Individuelle tildelinger pr. rettighedshaver pr. værkstildeling
create table if not exists rights_allocations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  run_id              uuid not null references calculation_runs(id) on delete cascade,
  work_allocation_id  uuid not null references work_allocations(id) on delete cascade,
  rights_holder_id    uuid not null references rettighedshavere(id),
  share_bps           int  not null check (share_bps > 0 and share_bps <= 10000),
  individual_amount   bigint not null default 0,
  adjustment_total    bigint not null default 0,
  net_amount          bigint not null default 0,
  status              text not null default 'pending'
    check (status in ('pending','confirmed','withheld','paid')),
  blocked_reason      text,
  booked_at           timestamptz,
  currency            text not null default 'DKK',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger rights_allocations_updated_at
  before update on rights_allocations
  for each row execute function set_updated_at();

create index if not exists rights_allocations_run_idx     on rights_allocations(run_id);
create index if not exists rights_allocations_holder_idx  on rights_allocations(rights_holder_id);
create index if not exists rights_allocations_wa_idx      on rights_allocations(work_allocation_id);

-- Justeringer pr. tildeling (tillæg/fradrag med begrundelse)
create table if not exists rights_adjustments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations(id) on delete cascade,
  allocation_id uuid not null references rights_allocations(id) on delete cascade,
  amount_delta  bigint not null,   -- positiv = tillæg, negativ = fradrag
  reason        text not null,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create index if not exists rights_adjustments_allocation_idx on rights_adjustments(allocation_id);

-- Tilbageholdte tildelinger (kræver manuel afklaring)
create table if not exists withheld_positions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  run_id              uuid not null references calculation_runs(id) on delete cascade,
  rights_holder_id    uuid not null references rettighedshavere(id),
  work_allocation_id  uuid references work_allocations(id),
  amount              bigint not null check (amount >= 0),
  currency            text not null default 'DKK',
  reason              text not null,
  status              text not null default 'pending'
    check (status in ('pending','resolved','released','written_off')),
  resolution_notes    text,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

create index if not exists withheld_positions_run_idx    on withheld_positions(run_id);
create index if not exists withheld_positions_holder_idx on withheld_positions(rights_holder_id);

-- =============================================================================
-- 4. HENSÆTTELSER, KRAV OG UDISTRIBUEREDE MIDLER
-- =============================================================================

create table if not exists reserve_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  run_id      uuid not null references calculation_runs(id) on delete cascade,
  entry_type  text not null
    check (entry_type in ('reserve','release','transfer','admin_fee','write_off')),
  amount      bigint not null,
  currency    text not null default 'DKK',
  description text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists reserve_entries_run_idx on reserve_entries(run_id);

create table if not exists rights_claims (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  fund_id          uuid references rights_funds(id),
  run_id           uuid references calculation_runs(id),
  rights_holder_id uuid not null references rettighedshavere(id),
  claim_amount     bigint not null check (claim_amount > 0),
  currency         text not null default 'DKK',
  status           text not null default 'pending'
    check (status in ('pending','approved','rejected','withdrawn')),
  claim_date       date not null default current_date,
  deadline         date,
  is_timely        boolean,   -- beregnet ved indsendelse ift. deadline
  notes            text,
  review_notes     text,
  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists rights_claims_org_idx    on rights_claims(org_id);
create index if not exists rights_claims_holder_idx on rights_claims(rights_holder_id);
create index if not exists rights_claims_status_idx on rights_claims(status);

create table if not exists undistributable_actions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations(id) on delete cascade,
  run_id       uuid not null references calculation_runs(id),
  action_type  text not null
    check (action_type in ('transfer_to_reserve','write_off','transfer_to_collective','other')),
  amount       bigint not null check (amount > 0),
  currency     text not null default 'DKK',
  destination  text,
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists undistributable_actions_run_idx on undistributable_actions(run_id);

-- =============================================================================
-- 5. EFTERLYSNINGER OG ARVINGEPROFILER
-- =============================================================================

create table if not exists search_publications (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  known_name       text not null,
  alias            text,
  work_titles      text[],
  period_label     text,
  description      text,
  withheld_amount  bigint,
  currency         text not null default 'DKK',
  claim_deadline   date,
  status           text not null default 'draft'
    check (status in ('draft','published','responded','closed')),
  published_at     timestamptz,
  responded_at     timestamptz,
  closed_at        timestamptz,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

create index if not exists search_publications_org_idx    on search_publications(org_id);
create index if not exists search_publications_status_idx on search_publications(status);

-- Arvingeforhold — CPR krypteret, aldrig eksponeret til klient
create table if not exists inheritance_relations (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organisations(id) on delete cascade,
  original_rights_holder_id uuid not null references rettighedshavere(id),
  heir_rights_holder_id     uuid not null references rettighedshavere(id),
  heir_cpr_encrypted        text,   -- krypteret via lib/encryption.ts, aldrig returneret til klient
  relation_type             text not null
    check (relation_type in ('spouse','child','parent','sibling','other')),
  verified                  boolean not null default false,
  verified_at               timestamptz,
  verified_by               uuid references auth.users(id),
  notes                     text,
  created_at                timestamptz not null default now(),
  constraint inheritance_relations_no_self
    check (original_rights_holder_id != heir_rights_holder_id)
);

create index if not exists inheritance_relations_original_idx on inheritance_relations(original_rights_holder_id);
create index if not exists inheritance_relations_heir_idx     on inheritance_relations(heir_rights_holder_id);

-- =============================================================================
-- 6. AFREGNINGER OG UDBETALINGER
-- =============================================================================

create table if not exists settlements (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  fund_id               uuid not null references rights_funds(id),
  label                 text not null,
  status                text not null default 'draft'
    check (status in ('draft','prepared','approved','paid_out','cancelled')),
  total_gross           bigint not null default 0,
  total_individual      bigint not null default 0,
  total_below_threshold bigint not null default 0,
  total_payable         bigint not null default 0,
  currency              text not null default 'DKK',
  payout_threshold_minor bigint not null default 0,
  prepared_by           uuid references auth.users(id),
  approved_by           uuid references auth.users(id),
  paid_out_at           timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint settlements_four_eyes
    check (prepared_by is null or approved_by is null or prepared_by != approved_by)
);

create trigger settlements_updated_at
  before update on settlements
  for each row execute function set_updated_at();

create index if not exists settlements_org_idx    on settlements(org_id);
create index if not exists settlements_fund_idx   on settlements(fund_id);
create index if not exists settlements_status_idx on settlements(status);

-- Poster pr. rettighedshaver pr. afregning
create table if not exists settlement_items (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  settlement_id    uuid not null references settlements(id) on delete cascade,
  allocation_id    uuid references rights_allocations(id),
  rights_holder_id uuid not null references rettighedshavere(id),
  individual_net   bigint not null default 0,
  adjustment_total bigint not null default 0,
  payable_amount   bigint not null default 0,
  below_threshold  boolean not null default false,
  blocked_reason   text,
  currency         text not null default 'DKK',
  created_at       timestamptz not null default now(),
  unique (settlement_id, rights_holder_id)   -- én post pr. rettighedshaver pr. afregning
);

create index if not exists settlement_items_settlement_idx    on settlement_items(settlement_id);
create index if not exists settlement_items_rights_holder_idx on settlement_items(rights_holder_id);

-- Udbetalingsposter (ét pr. rettighedshaver pr. afregning)
create table if not exists payouts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  settlement_id    uuid not null references settlements(id) on delete cascade,
  rights_holder_id uuid not null references rettighedshavere(id),
  gross_amount     bigint not null check (gross_amount >= 0),
  net_amount       bigint not null check (net_amount >= 0),
  currency         text not null default 'DKK',
  status           text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  payroll_batch_id uuid,  -- FK til payroll_export_batches sættes efter
  nem_konto_ref    text,
  processed_at     timestamptz,
  failed_reason    text,
  created_at       timestamptz not null default now(),
  unique (settlement_id, rights_holder_id)
);

create index if not exists payouts_settlement_idx    on payouts(settlement_id);
create index if not exists payouts_rights_holder_idx on payouts(rights_holder_id);
create index if not exists payouts_status_idx        on payouts(status);

-- Lønsystem-referencer (DataLøn/Zenegy modtager-IDs)
create table if not exists payroll_recipient_references (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  rights_holder_id uuid not null references rettighedshavere(id),
  system           text not null,       -- "datalon", "zenegy" osv.
  recipient_id     text not null,       -- ekstern ID i lønsystemet
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (org_id, rights_holder_id, system)   -- én aktiv reference pr. system
);

create index if not exists payroll_recipient_references_holder_idx on payroll_recipient_references(rights_holder_id);

-- Eksportbatches (logbog over genererede lønfiler)
create table if not exists payroll_export_batches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisations(id) on delete cascade,
  settlement_id  uuid not null references settlements(id),
  export_system  text not null,
  exported_at    timestamptz not null default now(),
  exported_by    uuid references auth.users(id),
  row_count      int not null default 0,
  file_reference text,
  status         text not null default 'exported'
    check (status in ('pending','exported','error')),
  created_at     timestamptz not null default now()
);

create index if not exists payroll_export_batches_settlement_idx on payroll_export_batches(settlement_id);

-- Tilføj FK fra payouts til payroll_export_batches nu da begge tabeller eksisterer
alter table payouts
  add constraint payouts_payroll_batch_fk
  foreign key (payroll_batch_id) references payroll_export_batches(id);

-- =============================================================================
-- 7. NOTIFIKATIONER
-- =============================================================================

create table if not exists rights_notifications (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  rights_holder_id  uuid references rettighedshavere(id),
  event_type        text not null
    check (event_type in (
      'allocation_created','allocation_withheld',
      'claim_deadline_approaching','claim_deadline_passed',
      'settlement_approved','payout_completed',
      'search_publication_published','manual'
    )),
  subject_type      text,    -- "run", "settlement", "claim" osv.
  subject_id        uuid,
  channel           text not null
    check (channel in ('email','portal','sms')),
  status            text not null default 'pending'
    check (status in ('pending','sent','failed','cancelled')),
  scheduled_at      timestamptz not null default now(),
  sent_at           timestamptz,
  failed_at         timestamptz,
  failed_reason     text,
  body_preview      text,
  -- Idempotency: forhindrer dobbelt-notifikation for samme hændelse pr. modtager pr. kanal
  idempotency_key   text generated always as (
    org_id::text || ':' ||
    coalesce(rights_holder_id::text, 'org') || ':' ||
    event_type || ':' ||
    coalesce(subject_type, '') || ':' ||
    coalesce(subject_id::text, '') || ':' ||
    channel
  ) stored,
  created_at        timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists rights_notifications_org_idx    on rights_notifications(org_id);
create index if not exists rights_notifications_holder_idx on rights_notifications(rights_holder_id);
create index if not exists rights_notifications_status_idx on rights_notifications(status);

-- Admin-opgavekø: åbne handlingspunkter der kræver menneskelig opfølgning.
-- Genereres af databasen (via trigger eller manuelt insert fra app-lag).
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

-- View som server actions læser via "rights_notifications_admin_tasks"
create or replace view rights_notifications_admin_tasks as
  select * from rights_admin_tasks;

-- =============================================================================
-- 8. RLS-POLITIKKER
-- =============================================================================

-- Aktivér RLS på alle tabeller
alter table rights_funds                   enable row level security;
alter table fund_policy_versions           enable row level security;
alter table fund_policy_components         enable row level security;
alter table calculation_runs               enable row level security;
alter table work_allocations               enable row level security;
alter table rights_allocations             enable row level security;
alter table rights_adjustments             enable row level security;
alter table withheld_positions             enable row level security;
alter table reserve_entries                enable row level security;
alter table rights_claims                  enable row level security;
alter table undistributable_actions        enable row level security;
alter table search_publications            enable row level security;
alter table inheritance_relations          enable row level security;
alter table settlements                    enable row level security;
alter table settlement_items               enable row level security;
alter table payouts                        enable row level security;
alter table payroll_recipient_references   enable row level security;
alter table payroll_export_batches         enable row level security;
alter table rights_notifications           enable row level security;
alter table rights_admin_tasks             enable row level security;

-- Hjælpefunktion: returnerer org_id for den aktuelle bruger
create or replace function current_user_org_id()
returns uuid language sql stable as $$
  select org_id
  from user_org_roles
  where user_id = auth.uid()
  limit 1;
$$;

-- Hjælpefunktion: returnerer true hvis aktuel bruger er admin i sin org
create or replace function is_org_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from user_org_roles
    where user_id = auth.uid()
      and role in ('admin','org-admin','superadmin')
  );
$$;

-- Makro til at oprette standard admin-politikker på en tabel
-- (SELECT/INSERT/UPDATE/DELETE kun for admins i egen org)
do $$ declare tbl text; begin
  foreach tbl in array array[
    'rights_funds','fund_policy_versions','fund_policy_components',
    'calculation_runs','work_allocations','rights_allocations',
    'rights_adjustments','withheld_positions',
    'reserve_entries','rights_claims','undistributable_actions',
    'search_publications','inheritance_relations',
    'settlements','settlement_items','payouts',
    'payroll_recipient_references','payroll_export_batches',
    'rights_notifications','rights_admin_tasks'
  ] loop
    execute format(
      'create policy %I_admin_all on %I
         for all to authenticated
         using (org_id = current_user_org_id() and is_org_admin())
         with check (org_id = current_user_org_id() and is_org_admin())',
      tbl, tbl
    );
  end loop;
end $$;

-- Rettighedshavere kan se egne tildelinger (portal-visning)
create policy rights_allocations_member_read on rights_allocations
  for select to authenticated
  using (
    rights_holder_id in (
      select id from rettighedshavere
      where user_id = auth.uid()
    )
  );

create policy settlement_items_member_read on settlement_items
  for select to authenticated
  using (
    rights_holder_id in (
      select id from rettighedshavere
      where user_id = auth.uid()
    )
  );

create policy payouts_member_read on payouts
  for select to authenticated
  using (
    rights_holder_id in (
      select id from rettighedshavere
      where user_id = auth.uid()
    )
  );

create policy rights_notifications_member_read on rights_notifications
  for select to authenticated
  using (
    channel = 'portal'
    and rights_holder_id in (
      select id from rettighedshavere
      where user_id = auth.uid()
    )
  );

create policy rights_claims_member_read on rights_claims
  for select to authenticated
  using (
    rights_holder_id in (
      select id from rettighedshavere
      where user_id = auth.uid()
    )
  );
