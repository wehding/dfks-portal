-- =============================================================================
-- Rettighedsmidler: autoritativ baseline fra produktionsskemaet
-- Opretter samme tabeller, constraints, indeks og RLS på en frisk database.
-- CREATE/ALTER-operationerne er idempotente af hensyn til eksisterende miljøer.
-- =============================================================================

alter table public.organisations
  add column if not exists payout_threshold_minor bigint not null default 50000,
  add column if not exists payout_currency character(3) not null default 'DKK';

CREATE OR REPLACE FUNCTION public.current_user_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select org_id from user_org_roles where user_id = auth.uid() limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from user_org_roles
    where user_id = auth.uid()
      and role in ('admin','org-admin','superadmin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_org_admin(check_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.current_user_has_org_role(
    check_org_id,
    array['superadmin','admin','org-admin']
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create table if not exists public."distribution_policies" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "fund_id" uuid not null,
  "name" text not null,
  "valid_from" date not null,
  "valid_to" date,
  "claim_period_years" integer default 3 not null,
  "claim_period_start_rule" text default 'end_of_usage_year'::text not null,
  "undistributable_treatment" text default 'redistribute_by_work'::text not null,
  "approval_body" text,
  "approved_at" timestamp with time zone,
  "approval_ref" text,
  "four_eyes_required" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."distribution_policy_components" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "policy_version_id" uuid not null,
  "component_type" text not null,
  "sort_order" integer not null,
  "rate_bps" integer not null,
  "calculation_basis" text not null,
  "is_statutory_collective" boolean default false not null,
  "label" text,
  "description" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."distribution_policy_versions" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "policy_id" uuid not null,
  "version_number" integer not null,
  "status" text default 'draft'::text not null,
  "admin_rate_bps" integer not null,
  "snapshot_components" jsonb default '[]'::jsonb not null,
  "prepared_by" uuid,
  "approved_by" uuid,
  "activated_at" timestamp with time zone,
  "used_in_calculation" boolean default false not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."inheritance_relations" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "deceased_rights_holder_id" uuid not null,
  "heir_rights_holder_id" uuid not null,
  "share_percent" numeric(8,5) not null,
  "relation_type" text not null,
  "documentation_ref" text,
  "status" text default 'pending'::text not null,
  "prepared_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "heir_cpr_encrypted" text,
  "verified" boolean default false not null,
  "verified_at" timestamp with time zone,
  "verified_by" uuid,
  "notes" text
);

create table if not exists public."payouts" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "settlement_id" uuid not null,
  "currency" character(3) not null,
  "net_amount" bigint not null,
  "status" text default 'pending'::text not null,
  "export_generated_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "paid_confirmed_at" timestamp with time zone,
  "paid_confirmed_by" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "rights_holder_id" uuid,
  "gross_amount" bigint default 0 not null,
  "payroll_batch_id" uuid,
  "nem_konto_ref" text,
  "processed_at" timestamp with time zone,
  "failed_reason" text
);

create table if not exists public."payroll_export_batch_items" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "batch_id" uuid not null,
  "payout_id" uuid not null,
  "rights_holder_id" uuid not null,
  "currency" character(3) not null,
  "net_amount" bigint not null,
  "status" text default 'included'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."payroll_export_batches" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "export_format" text default 'datalon_import_file'::text not null,
  "status" text default 'generated'::text not null,
  "generated_at" timestamp with time zone default now() not null,
  "submitted_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "generated_by" uuid,
  "submitted_by" uuid,
  "approved_by" uuid,
  "row_count" integer default 0 not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "settlement_id" uuid,
  "export_system" text default 'datalon'::text not null,
  "exported_at" timestamp with time zone default now() not null,
  "exported_by" uuid,
  "file_reference" text
);

create table if not exists public."payroll_recipient_references" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "rights_holder_id" uuid not null,
  "provider" text default 'datalon'::text not null,
  "encrypted_payload" text not null,
  "payload_version" integer default 1 not null,
  "income_type" text default 'b_income'::text not null,
  "active" boolean default true not null,
  "created_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "system" text default 'datalon'::text not null,
  "recipient_id" text
);

create table if not exists public."reserve_entries" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "fund_id" uuid not null,
  "run_id" uuid,
  "entry_type" text not null,
  "currency" character(3) not null,
  "amount" bigint not null,
  "claim_id" uuid,
  "related_ref" text,
  "prepared_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "description" text,
  "created_by" uuid
);

create table if not exists public."rights_adjustments" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "original_allocation_id" uuid not null,
  "rights_holder_id" uuid not null,
  "adjustment_type" text not null,
  "currency" character(3) not null,
  "amount" bigint not null,
  "reason" text not null,
  "approved_by" uuid,
  "prepared_by" uuid,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "amount_delta" bigint,
  "created_by" uuid
);

create table if not exists public."rights_admin_tasks" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "task_type" text not null,
  "subject_type" text,
  "subject_id" uuid,
  "priority" text default 'normal'::text not null,
  "status" text default 'open'::text not null,
  "description" text,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."rights_allocations" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "work_allocation_id" uuid not null,
  "rights_holder_id" uuid not null,
  "distribution_key_scope" text not null,
  "distribution_key_snapshot" jsonb not null,
  "share_percent" numeric(8,5) not null,
  "role_code" text,
  "currency" character(3) not null,
  "gross_share" bigint not null,
  "admin_share" bigint not null,
  "claim_reserve_share" bigint not null,
  "sku_direct_share" bigint not null,
  "sku_from_reserve_share" bigint not null,
  "statutory_collective_share" bigint default 0 not null,
  "net_amount" bigint not null,
  "status" text default 'pending'::text not null,
  "available_at" timestamp with time zone default now() not null,
  "booked_at" timestamp with time zone,
  "booked_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "run_id" uuid,
  "share_bps" integer,
  "individual_amount" bigint default 0 not null,
  "adjustment_total" bigint default 0 not null,
  "blocked_reason" text,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."rights_calculation_runs" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "fund_id" uuid not null,
  "policy_version_id" uuid not null,
  "source_batch_id" uuid,
  "source_batch_ref" text,
  "period_label" text not null,
  "period_from" date,
  "period_to" date,
  "currency" character(3) not null,
  "gross_amount" bigint not null,
  "admin_amount" bigint not null,
  "distribution_basis" bigint not null,
  "claim_reserve_amount" bigint not null,
  "sku_direct_amount" bigint not null,
  "sku_from_reserve_amount" bigint not null,
  "statutory_collective_amount" bigint default 0 not null,
  "net_claim_reserve_amount" bigint not null,
  "individual_amount" bigint not null,
  "weight_config_snapshot" jsonb,
  "status" text default 'draft'::text not null,
  "version_number" integer default 1 not null,
  "prepared_by" uuid,
  "approved_by" uuid,
  "booked_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."rights_claims" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "withheld_position_id" uuid,
  "fund_id" uuid,
  "rights_holder_id" uuid not null,
  "claim_type" text not null,
  "claim_ref" text,
  "claim_note" text,
  "currency" character(3) not null,
  "claimed_amount" bigint not null,
  "approved_amount" bigint,
  "claim_deadline" date not null,
  "submitted_at" timestamp with time zone default now() not null,
  "is_timely" boolean default false not null,
  "blocks_undistributable" boolean default false not null,
  "status" text default 'submitted'::text not null,
  "prepared_by" uuid,
  "approved_by" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "run_id" uuid,
  "claim_amount" bigint,
  "claim_date" date default CURRENT_DATE not null,
  "deadline" date,
  "review_notes" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone
);

create table if not exists public."rights_funds" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "code" text not null,
  "name" text not null,
  "rights_category" text not null,
  "exploitation_type" text not null,
  "calculation_method" text not null,
  "currency" character(3) not null,
  "allowed_roles" text[] default '{}'::text[] not null,
  "allowed_groups" text[] default '{}'::text[] not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "description" text
);

create table if not exists public."rights_holder_search_publications" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "channel" text not null,
  "public_url" text,
  "publication_date" date not null,
  "text_snapshot" text not null,
  "covered_work_allocation_ids" uuid[] default '{}'::uuid[] not null,
  "covered_withheld_position_ids" uuid[] default '{}'::uuid[] not null,
  "next_publication_date" date,
  "unpublished_at" timestamp with time zone,
  "unpublished_by" uuid,
  "unpublish_reason" text,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."rights_notifications" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "rights_holder_id" uuid not null,
  "event_type" text not null,
  "subject_type" text not null,
  "subject_id" uuid not null,
  "channel" text default 'email'::text not null,
  "idempotency_key" text generated always as ((((((((((((org_id)::text || '|'::text) || event_type) || '|'::text) || subject_type) || '|'::text) || (subject_id)::text) || '|'::text) || (rights_holder_id)::text) || '|'::text) || channel)) stored not null,
  "status" text default 'pending'::text not null,
  "attempt_count" integer default 0 not null,
  "last_attempted_at" timestamp with time zone,
  "last_error" text,
  "sent_at" timestamp with time zone,
  "subject_line" text,
  "body_text" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "scheduled_at" timestamp with time zone default now() not null,
  "failed_at" timestamp with time zone,
  "failed_reason" text,
  "body_preview" text
);

create table if not exists public."rights_work_allocations" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "run_id" uuid not null,
  "work_id" uuid,
  "episode_id" uuid,
  "source_row_id" uuid,
  "source_ref" text,
  "usage_date" date,
  "usage_year" integer not null,
  "claim_period_start" date not null,
  "claim_deadline" date not null,
  "eligible_for_undistributable_at" date not null,
  "is_rebroadcast" boolean default false not null,
  "points" numeric(18,6),
  "pool_share_bps" integer,
  "currency" character(3) not null,
  "gross_share" bigint not null,
  "admin_share" bigint not null,
  "claim_reserve_share" bigint not null,
  "sku_direct_share" bigint not null,
  "sku_from_reserve_share" bigint not null,
  "statutory_collective_share" bigint default 0 not null,
  "net_claim_reserve_share" bigint not null,
  "individual_net" bigint not null,
  "status" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."settlement_items" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "settlement_id" uuid not null,
  "allocation_id" uuid not null,
  "fund_id" uuid not null,
  "currency" character(3) not null,
  "net_amount" bigint not null,
  "created_at" timestamp with time zone default now() not null,
  "rights_holder_id" uuid,
  "individual_net" bigint default 0 not null,
  "adjustment_total" bigint default 0 not null,
  "payable_amount" bigint default 0 not null,
  "below_threshold" boolean default false not null,
  "blocked_reason" text
);

create table if not exists public."settlements" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "rights_holder_id" uuid not null,
  "cutoff_at" timestamp with time zone not null,
  "currency" character(3) not null,
  "gross_amount" bigint not null,
  "net_amount" bigint not null,
  "status" text default 'draft'::text not null,
  "prepared_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "paid_confirmed_at" timestamp with time zone,
  "paid_confirmed_by" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "fund_id" uuid,
  "label" text,
  "total_gross" bigint default 0 not null,
  "total_individual" bigint default 0 not null,
  "total_below_threshold" bigint default 0 not null,
  "total_payable" bigint default 0 not null,
  "payout_threshold_minor" bigint default 0 not null,
  "paid_out_at" timestamp with time zone
);

create table if not exists public."undistributable_fund_actions" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "fund_id" uuid not null,
  "run_id" uuid not null,
  "treatment" text not null,
  "currency" character(3) not null,
  "total_amount" bigint not null,
  "open_claims_verified_at" timestamp with time zone,
  "status" text default 'draft'::text not null,
  "prepared_by" uuid,
  "approved_by" uuid,
  "executed_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."withheld_beneficiary_positions" (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "work_allocation_id" uuid not null,
  "position_scope" text not null,
  "share_percent" numeric(8,5) not null,
  "currency" character(3) not null,
  "withheld_amount" bigint not null,
  "remaining_amount" bigint not null,
  "reason" text not null,
  "reason_note" text,
  "status" text default 'active'::text not null,
  "created_by" uuid,
  "approved_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

do $migration$
declare
  item record;
begin
  for item in
    select * from (values
      ('distribution_policies', 'distribution_policies_claim_period_start_rule_check', $constraint$CHECK (claim_period_start_rule = ANY (ARRAY['end_of_usage_year'::text, 'end_of_calculation_year'::text, 'fixed_date'::text]))$constraint$),
      ('distribution_policies', 'distribution_policies_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('distribution_policies', 'distribution_policies_org_id_fund_id_fkey', $constraint$FOREIGN KEY (org_id, fund_id) REFERENCES rights_funds(org_id, id)$constraint$),
      ('distribution_policies', 'distribution_policies_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('distribution_policies', 'distribution_policies_undistributable_treatment_check', $constraint$CHECK (undistributable_treatment = ANY (ARRAY['redistribute_by_work'::text, 'transfer_to_collective'::text, 'individual_redistribution'::text, 'manual_decision'::text]))$constraint$),
      ('distribution_policy_components', 'distribution_policy_components_calculation_basis_check', $constraint$CHECK (calculation_basis = ANY (ARRAY['GROSS'::text, 'AFTER_ADMIN'::text, 'ORIGINAL_CLAIM_RESERVE'::text, 'REMAINING_INDIVIDUAL'::text]))$constraint$),
      ('distribution_policy_components', 'distribution_policy_components_component_type_check', $constraint$CHECK (component_type = ANY (ARRAY['CLAIM_RESERVE'::text, 'SKU_DIRECT'::text, 'SKU_FROM_RESERVE'::text, 'STATUTORY_COLLECTIVE_SHARE'::text]))$constraint$),
      ('distribution_policy_components', 'distribution_policy_components_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('distribution_policy_components', 'distribution_policy_components_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('distribution_policy_components', 'distribution_policy_components_policy_version_id_fkey', $constraint$FOREIGN KEY (policy_version_id) REFERENCES distribution_policy_versions(id) ON DELETE RESTRICT$constraint$),
      ('distribution_policy_components', 'distribution_policy_components_policy_version_id_sort_order_key', $constraint$UNIQUE (policy_version_id, sort_order)$constraint$),
      ('distribution_policy_components', 'distribution_policy_components_rate_bps_check', $constraint$CHECK (rate_bps >= 0 AND rate_bps <= 10000)$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_admin_rate_bps_check', $constraint$CHECK (admin_rate_bps >= 0 AND admin_rate_bps <= 10000)$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_policy_id_fkey', $constraint$FOREIGN KEY (policy_id) REFERENCES distribution_policies(id) ON DELETE RESTRICT$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_policy_id_version_number_key', $constraint$UNIQUE (policy_id, version_number)$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('distribution_policy_versions', 'distribution_policy_versions_status_check', $constraint$CHECK (status = ANY (ARRAY['draft'::text, 'preview'::text, 'active'::text, 'superseded'::text, 'archived'::text]))$constraint$),
      ('distribution_policy_versions', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('inheritance_relations', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('inheritance_relations', 'inheritance_relations_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('inheritance_relations', 'inheritance_relations_deceased_rights_holder_id_fkey', $constraint$FOREIGN KEY (deceased_rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('inheritance_relations', 'inheritance_relations_heir_rights_holder_id_fkey', $constraint$FOREIGN KEY (heir_rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('inheritance_relations', 'inheritance_relations_org_id_deceased_rights_holder_id_heir_key', $constraint$UNIQUE (org_id, deceased_rights_holder_id, heir_rights_holder_id)$constraint$),
      ('inheritance_relations', 'inheritance_relations_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('inheritance_relations', 'inheritance_relations_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('inheritance_relations', 'inheritance_relations_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('inheritance_relations', 'inheritance_relations_relation_type_check', $constraint$CHECK (relation_type = ANY (ARRAY['spouse'::text, 'child'::text, 'parent'::text, 'sibling'::text, 'legal_heir'::text, 'other'::text]))$constraint$),
      ('inheritance_relations', 'inheritance_relations_share_percent_check', $constraint$CHECK (share_percent > 0::numeric AND share_percent <= 100::numeric)$constraint$),
      ('inheritance_relations', 'inheritance_relations_status_check', $constraint$CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'superseded'::text]))$constraint$),
      ('inheritance_relations', 'inheritance_relations_verified_by_fkey', $constraint$FOREIGN KEY (verified_by) REFERENCES auth.users(id)$constraint$),
      ('inheritance_relations', 'no_self_inheritance', $constraint$CHECK (deceased_rights_holder_id <> heir_rights_holder_id)$constraint$),
      ('payouts', 'payouts_net_amount_check', $constraint$CHECK (net_amount >= 0)$constraint$),
      ('payouts', 'payouts_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('payouts', 'payouts_paid_confirmed_by_fkey', $constraint$FOREIGN KEY (paid_confirmed_by) REFERENCES auth.users(id)$constraint$),
      ('payouts', 'payouts_payroll_batch_id_fkey', $constraint$FOREIGN KEY (payroll_batch_id) REFERENCES payroll_export_batches(id)$constraint$),
      ('payouts', 'payouts_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('payouts', 'payouts_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id)$constraint$),
      ('payouts', 'payouts_settlement_id_fkey', $constraint$FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE RESTRICT$constraint$),
      ('payouts', 'payouts_settlement_id_key', $constraint$UNIQUE (settlement_id)$constraint$),
      ('payouts', 'payouts_status_check', $constraint$CHECK (status = ANY (ARRAY['pending'::text, 'export_generated'::text, 'submitted'::text, 'payroll_processed'::text, 'paid'::text, 'failed'::text, 'cancelled'::text]))$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_batch_id_fkey', $constraint$FOREIGN KEY (batch_id) REFERENCES payroll_export_batches(id) ON DELETE RESTRICT$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_batch_id_payout_id_key', $constraint$UNIQUE (batch_id, payout_id)$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_net_amount_check', $constraint$CHECK (net_amount >= 0)$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_payout_id_fkey', $constraint$FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE RESTRICT$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('payroll_export_batch_items', 'payroll_export_batch_items_status_check', $constraint$CHECK (status = ANY (ARRAY['included'::text, 'submitted'::text, 'confirmed'::text, 'failed'::text]))$constraint$),
      ('payroll_export_batches', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR generated_by <> approved_by)$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_export_format_check', $constraint$CHECK (export_format = ANY (ARRAY['datalon_import_file'::text, 'other'::text]))$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_exported_by_fkey', $constraint$FOREIGN KEY (exported_by) REFERENCES auth.users(id)$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_generated_by_fkey', $constraint$FOREIGN KEY (generated_by) REFERENCES auth.users(id)$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_settlement_id_fkey', $constraint$FOREIGN KEY (settlement_id) REFERENCES settlements(id)$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_status_check', $constraint$CHECK (status = ANY (ARRAY['generated'::text, 'submitted'::text, 'confirmed'::text, 'failed'::text]))$constraint$),
      ('payroll_export_batches', 'payroll_export_batches_submitted_by_fkey', $constraint$FOREIGN KEY (submitted_by) REFERENCES auth.users(id)$constraint$),
      ('payroll_recipient_references', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR created_by <> approved_by)$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_created_by_fkey', $constraint$FOREIGN KEY (created_by) REFERENCES auth.users(id)$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_income_type_check', $constraint$CHECK (income_type = ANY (ARRAY['b_income'::text, 'other'::text]))$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_org_id_rights_holder_id_provid_key', $constraint$UNIQUE (org_id, rights_holder_id, provider)$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_provider_check', $constraint$CHECK (provider = ANY (ARRAY['datalon'::text, 'other'::text]))$constraint$),
      ('payroll_recipient_references', 'payroll_recipient_references_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('reserve_entries', 'four_eyes', $constraint$CHECK ((entry_type <> ALL (ARRAY['claim_approved'::text, 'undistributable_treatment'::text, 'adjustment'::text])) OR approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('reserve_entries', 'reserve_entries_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('reserve_entries', 'reserve_entries_created_by_fkey', $constraint$FOREIGN KEY (created_by) REFERENCES auth.users(id)$constraint$),
      ('reserve_entries', 'reserve_entries_entry_type_check', $constraint$CHECK (entry_type = ANY (ARRAY['initial_reserve'::text, 'sku_from_reserve'::text, 'claim_approved'::text, 'claim_reversed'::text, 'position_transfer_in'::text, 'undistributable_treatment'::text, 'adjustment'::text]))$constraint$),
      ('reserve_entries', 'reserve_entries_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('reserve_entries', 'reserve_entries_org_id_fund_id_fkey', $constraint$FOREIGN KEY (org_id, fund_id) REFERENCES rights_funds(org_id, id)$constraint$),
      ('reserve_entries', 'reserve_entries_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('reserve_entries', 'reserve_entries_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('reserve_entries', 'reserve_entries_run_id_fkey', $constraint$FOREIGN KEY (run_id) REFERENCES rights_calculation_runs(id) ON DELETE RESTRICT$constraint$),
      ('rights_adjustments', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('rights_adjustments', 'rights_adjustments_adjustment_type_check', $constraint$CHECK (adjustment_type = ANY (ARRAY['positive_correction'::text, 'reserve_reclaim'::text]))$constraint$),
      ('rights_adjustments', 'rights_adjustments_amount_check', $constraint$CHECK (amount > 0)$constraint$),
      ('rights_adjustments', 'rights_adjustments_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('rights_adjustments', 'rights_adjustments_created_by_fkey', $constraint$FOREIGN KEY (created_by) REFERENCES auth.users(id)$constraint$),
      ('rights_adjustments', 'rights_adjustments_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_adjustments', 'rights_adjustments_original_allocation_id_fkey', $constraint$FOREIGN KEY (original_allocation_id) REFERENCES rights_allocations(id) ON DELETE RESTRICT$constraint$),
      ('rights_adjustments', 'rights_adjustments_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_adjustments', 'rights_adjustments_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('rights_adjustments', 'rights_adjustments_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('rights_admin_tasks', 'rights_admin_tasks_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE$constraint$),
      ('rights_admin_tasks', 'rights_admin_tasks_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_admin_tasks', 'rights_admin_tasks_priority_check', $constraint$CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))$constraint$),
      ('rights_admin_tasks', 'rights_admin_tasks_resolved_by_fkey', $constraint$FOREIGN KEY (resolved_by) REFERENCES auth.users(id)$constraint$),
      ('rights_admin_tasks', 'rights_admin_tasks_status_check', $constraint$CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'dismissed'::text]))$constraint$),
      ('rights_allocations', 'rights_allocations_admin_share_check', $constraint$CHECK (admin_share >= 0)$constraint$),
      ('rights_allocations', 'rights_allocations_booked_by_fkey', $constraint$FOREIGN KEY (booked_by) REFERENCES auth.users(id)$constraint$),
      ('rights_allocations', 'rights_allocations_claim_reserve_share_check', $constraint$CHECK (claim_reserve_share >= 0)$constraint$),
      ('rights_allocations', 'rights_allocations_distribution_key_scope_check', $constraint$CHECK (distribution_key_scope = ANY (ARRAY['episode'::text, 'season'::text, 'work'::text]))$constraint$),
      ('rights_allocations', 'rights_allocations_gross_share_check', $constraint$CHECK (gross_share >= 0)$constraint$),
      ('rights_allocations', 'rights_allocations_net_amount_check', $constraint$CHECK (net_amount >= 0)$constraint$),
      ('rights_allocations', 'rights_allocations_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_allocations', 'rights_allocations_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_allocations', 'rights_allocations_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('rights_allocations', 'rights_allocations_run_id_fkey', $constraint$FOREIGN KEY (run_id) REFERENCES rights_calculation_runs(id) ON DELETE CASCADE$constraint$),
      ('rights_allocations', 'rights_allocations_share_percent_check', $constraint$CHECK (share_percent > 0::numeric AND share_percent <= 100::numeric)$constraint$),
      ('rights_allocations', 'rights_allocations_sku_direct_share_check', $constraint$CHECK (sku_direct_share >= 0)$constraint$),
      ('rights_allocations', 'rights_allocations_sku_from_reserve_share_check', $constraint$CHECK (sku_from_reserve_share >= 0)$constraint$),
      ('rights_allocations', 'rights_allocations_status_check', $constraint$CHECK (status = ANY (ARRAY['pending'::text, 'reserved'::text, 'settled'::text, 'paid'::text, 'adjusted'::text]))$constraint$),
      ('rights_allocations', 'rights_allocations_statutory_collective_share_check', $constraint$CHECK (statutory_collective_share >= 0)$constraint$),
      ('rights_allocations', 'rights_allocations_work_allocation_id_fkey', $constraint$FOREIGN KEY (work_allocation_id) REFERENCES rights_work_allocations(id) ON DELETE RESTRICT$constraint$),
      ('rights_calculation_runs', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_admin_amount_check', $constraint$CHECK (admin_amount >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_claim_reserve_amount_check', $constraint$CHECK (claim_reserve_amount >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_distribution_basis_check', $constraint$CHECK (distribution_basis >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_gross_amount_check', $constraint$CHECK (gross_amount >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_individual_amount_check', $constraint$CHECK (individual_amount >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_net_claim_reserve_amount_check', $constraint$CHECK (net_claim_reserve_amount >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_org_id_fund_id_fkey', $constraint$FOREIGN KEY (org_id, fund_id) REFERENCES rights_funds(org_id, id)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_policy_version_id_fkey', $constraint$FOREIGN KEY (policy_version_id) REFERENCES distribution_policy_versions(id) ON DELETE RESTRICT$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_sku_direct_amount_check', $constraint$CHECK (sku_direct_amount >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_sku_from_reserve_amount_check', $constraint$CHECK (sku_from_reserve_amount >= 0)$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_status_check', $constraint$CHECK (status = ANY (ARRAY['draft'::text, 'calculated'::text, 'awaiting_approval'::text, 'approved'::text, 'booked'::text, 'cancelled'::text]))$constraint$),
      ('rights_calculation_runs', 'rights_calculation_runs_statutory_collective_amount_check', $constraint$CHECK (statutory_collective_amount >= 0)$constraint$),
      ('rights_claims', 'claim_funding_source', $constraint$CHECK (withheld_position_id IS NOT NULL AND fund_id IS NULL OR withheld_position_id IS NULL AND fund_id IS NOT NULL)$constraint$),
      ('rights_claims', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('rights_claims', 'rights_claims_approved_amount_check', $constraint$CHECK (approved_amount IS NULL OR approved_amount >= 0)$constraint$),
      ('rights_claims', 'rights_claims_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('rights_claims', 'rights_claims_claim_type_check', $constraint$CHECK (claim_type = ANY (ARRAY['heir'::text, 'identity_resolved'::text, 'rights_transfer'::text, 'new_beneficiary'::text, 'other'::text]))$constraint$),
      ('rights_claims', 'rights_claims_claimed_amount_check', $constraint$CHECK (claimed_amount > 0)$constraint$),
      ('rights_claims', 'rights_claims_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_claims', 'rights_claims_org_id_fund_id_fkey', $constraint$FOREIGN KEY (org_id, fund_id) REFERENCES rights_funds(org_id, id)$constraint$),
      ('rights_claims', 'rights_claims_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_claims', 'rights_claims_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('rights_claims', 'rights_claims_reviewed_by_fkey', $constraint$FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)$constraint$),
      ('rights_claims', 'rights_claims_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('rights_claims', 'rights_claims_run_id_fkey', $constraint$FOREIGN KEY (run_id) REFERENCES rights_calculation_runs(id)$constraint$),
      ('rights_claims', 'rights_claims_status_check', $constraint$CHECK (status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'approved'::text, 'rejected'::text, 'paid'::text, 'reversed'::text]))$constraint$),
      ('rights_claims', 'rights_claims_withheld_position_id_fkey', $constraint$FOREIGN KEY (withheld_position_id) REFERENCES withheld_beneficiary_positions(id) ON DELETE RESTRICT$constraint$),
      ('rights_funds', 'rights_funds_calculation_method_check', $constraint$CHECK (calculation_method = ANY (ARRAY['pool_weighted'::text, 'individual_work'::text, 'royalty_percentage'::text]))$constraint$),
      ('rights_funds', 'rights_funds_exploitation_type_check', $constraint$CHECK (exploitation_type = ANY (ARRAY['primary'::text, 'secondary'::text]))$constraint$),
      ('rights_funds', 'rights_funds_org_id_code_key', $constraint$UNIQUE (org_id, code)$constraint$),
      ('rights_funds', 'rights_funds_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_funds', 'rights_funds_org_id_id_key', $constraint$UNIQUE (org_id, id)$constraint$),
      ('rights_funds', 'rights_funds_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_holder_search_publications', 'rights_holder_search_publications_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('rights_holder_search_publications', 'rights_holder_search_publications_channel_check', $constraint$CHECK (channel = ANY (ARRAY['external_url'::text, 'portal_public_page'::text, 'other'::text]))$constraint$),
      ('rights_holder_search_publications', 'rights_holder_search_publications_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_holder_search_publications', 'rights_holder_search_publications_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_holder_search_publications', 'rights_holder_search_publications_unpublished_by_fkey', $constraint$FOREIGN KEY (unpublished_by) REFERENCES auth.users(id)$constraint$),
      ('rights_notifications', 'rights_notifications_channel_check', $constraint$CHECK (channel = ANY (ARRAY['email'::text, 'portal'::text]))$constraint$),
      ('rights_notifications', 'rights_notifications_event_type_check', $constraint$CHECK (event_type = ANY (ARRAY['allocations_booked'::text, 'settlement_submitted'::text, 'payout_confirmed'::text]))$constraint$),
      ('rights_notifications', 'rights_notifications_idempotency_key_key', $constraint$UNIQUE (idempotency_key)$constraint$),
      ('rights_notifications', 'rights_notifications_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_notifications', 'rights_notifications_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_notifications', 'rights_notifications_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('rights_notifications', 'rights_notifications_status_check', $constraint$CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))$constraint$),
      ('rights_notifications', 'rights_notifications_subject_type_check', $constraint$CHECK (subject_type = ANY (ARRAY['rights_calculation_run'::text, 'payout'::text]))$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_admin_share_check', $constraint$CHECK (admin_share >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_claim_reserve_share_check', $constraint$CHECK (claim_reserve_share >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_episode_id_fkey', $constraint$FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE RESTRICT$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_gross_share_check', $constraint$CHECK (gross_share >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_individual_net_check', $constraint$CHECK (individual_net >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_net_claim_reserve_share_check', $constraint$CHECK (net_claim_reserve_share >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_run_id_fkey', $constraint$FOREIGN KEY (run_id) REFERENCES rights_calculation_runs(id) ON DELETE RESTRICT$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_sku_direct_share_check', $constraint$CHECK (sku_direct_share >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_sku_from_reserve_share_check', $constraint$CHECK (sku_from_reserve_share >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_status_check', $constraint$CHECK (status = ANY (ARRAY['pending'::text, 'distributed'::text, 'partially_withheld'::text, 'fully_withheld'::text]))$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_statutory_collective_share_check', $constraint$CHECK (statutory_collective_share >= 0)$constraint$),
      ('rights_work_allocations', 'rights_work_allocations_work_id_fkey', $constraint$FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE RESTRICT$constraint$),
      ('settlement_items', 'settlement_items_allocation_id_fkey', $constraint$FOREIGN KEY (allocation_id) REFERENCES rights_allocations(id) ON DELETE RESTRICT$constraint$),
      ('settlement_items', 'settlement_items_allocation_id_key', $constraint$UNIQUE (allocation_id)$constraint$),
      ('settlement_items', 'settlement_items_net_amount_check', $constraint$CHECK (net_amount >= 0)$constraint$),
      ('settlement_items', 'settlement_items_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('settlement_items', 'settlement_items_org_id_fund_id_fkey', $constraint$FOREIGN KEY (org_id, fund_id) REFERENCES rights_funds(org_id, id)$constraint$),
      ('settlement_items', 'settlement_items_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('settlement_items', 'settlement_items_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id)$constraint$),
      ('settlement_items', 'settlement_items_settlement_id_fkey', $constraint$FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE RESTRICT$constraint$),
      ('settlements', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('settlements', 'settlements_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('settlements', 'settlements_fund_id_fkey', $constraint$FOREIGN KEY (fund_id) REFERENCES rights_funds(id)$constraint$),
      ('settlements', 'settlements_gross_amount_check', $constraint$CHECK (gross_amount >= 0)$constraint$),
      ('settlements', 'settlements_net_amount_check', $constraint$CHECK (net_amount >= 0)$constraint$),
      ('settlements', 'settlements_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('settlements', 'settlements_paid_confirmed_by_fkey', $constraint$FOREIGN KEY (paid_confirmed_by) REFERENCES auth.users(id)$constraint$),
      ('settlements', 'settlements_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('settlements', 'settlements_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('settlements', 'settlements_rights_holder_id_fkey', $constraint$FOREIGN KEY (rights_holder_id) REFERENCES rettighedshavere(id) ON DELETE RESTRICT$constraint$),
      ('settlements', 'settlements_status_check', $constraint$CHECK (status = ANY (ARRAY['draft'::text, 'calculated'::text, 'awaiting_approval'::text, 'approved'::text, 'ready_for_payout'::text, 'export_generated'::text, 'submitted'::text, 'payroll_processed'::text, 'paid'::text, 'failed'::text, 'cancelled'::text]))$constraint$),
      ('undistributable_fund_actions', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR prepared_by <> approved_by)$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_org_id_fund_id_fkey', $constraint$FOREIGN KEY (org_id, fund_id) REFERENCES rights_funds(org_id, id)$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_prepared_by_fkey', $constraint$FOREIGN KEY (prepared_by) REFERENCES auth.users(id)$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_run_id_fkey', $constraint$FOREIGN KEY (run_id) REFERENCES rights_calculation_runs(id) ON DELETE RESTRICT$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_status_check', $constraint$CHECK (status = ANY (ARRAY['draft'::text, 'awaiting_approval'::text, 'approved'::text, 'executed'::text, 'cancelled'::text]))$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_total_amount_check', $constraint$CHECK (total_amount >= 0)$constraint$),
      ('undistributable_fund_actions', 'undistributable_fund_actions_treatment_check', $constraint$CHECK (treatment = ANY (ARRAY['redistribute_by_work'::text, 'transfer_to_collective'::text, 'individual_redistribution'::text, 'manual_decision'::text]))$constraint$),
      ('withheld_beneficiary_positions', 'four_eyes', $constraint$CHECK (approved_by IS NULL OR created_by <> approved_by)$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_approved_by_fkey', $constraint$FOREIGN KEY (approved_by) REFERENCES auth.users(id)$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_created_by_fkey', $constraint$FOREIGN KEY (created_by) REFERENCES auth.users(id)$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_org_id_fkey', $constraint$FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE RESTRICT$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_pkey', $constraint$PRIMARY KEY (id)$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_position_scope_check', $constraint$CHECK (position_scope = ANY (ARRAY['episode'::text, 'season'::text, 'work'::text]))$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_reason_check', $constraint$CHECK (reason = ANY (ARRAY['deceased_heir_search'::text, 'unresolved_identity_match'::text, 'disputed_rights_transfer'::text, 'other'::text]))$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_remaining_amount_check', $constraint$CHECK (remaining_amount >= 0)$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_share_percent_check', $constraint$CHECK (share_percent > 0::numeric AND share_percent <= 100::numeric)$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_status_check', $constraint$CHECK (status = ANY (ARRAY['active'::text, 'partially_claimed'::text, 'fully_claimed'::text, 'transferred_to_reserve'::text]))$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_withheld_amount_check', $constraint$CHECK (withheld_amount >= 0)$constraint$),
      ('withheld_beneficiary_positions', 'withheld_beneficiary_positions_work_allocation_id_fkey', $constraint$FOREIGN KEY (work_allocation_id) REFERENCES rights_work_allocations(id) ON DELETE RESTRICT$constraint$)
    ) as constraints_to_add(table_name, constraint_name, definition)
    order by case
      when definition like 'PRIMARY KEY%' then 1
      when definition like 'UNIQUE%' then 2
      else 3
    end
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', item.table_name)::regclass
        and conname = item.constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I %s',
        item.table_name, item.constraint_name, item.definition
      );
    end if;
  end loop;
end
$migration$;

CREATE INDEX IF NOT EXISTS distribution_policies_org_fund_idx ON public.distribution_policies USING btree (org_id, fund_id);

CREATE INDEX IF NOT EXISTS distribution_policy_components_version_idx ON public.distribution_policy_components USING btree (policy_version_id, sort_order);

CREATE INDEX IF NOT EXISTS distribution_policy_versions_policy_idx ON public.distribution_policy_versions USING btree (policy_id, version_number);

CREATE INDEX IF NOT EXISTS inheritance_relations_deceased_idx ON public.inheritance_relations USING btree (org_id, deceased_rights_holder_id, status);

CREATE INDEX IF NOT EXISTS inheritance_relations_heir_idx ON public.inheritance_relations USING btree (org_id, heir_rights_holder_id, status);

CREATE INDEX IF NOT EXISTS payouts_org_status_idx ON public.payouts USING btree (org_id, status);

CREATE INDEX IF NOT EXISTS payouts_settlement_idx ON public.payouts USING btree (settlement_id);

CREATE INDEX IF NOT EXISTS payroll_export_batch_items_batch_idx ON public.payroll_export_batch_items USING btree (batch_id);

CREATE INDEX IF NOT EXISTS payroll_export_batches_settlement_idx ON public.payroll_export_batches USING btree (settlement_id);

CREATE INDEX IF NOT EXISTS payroll_recipient_references_holder_idx ON public.payroll_recipient_references USING btree (org_id, rights_holder_id, active);

CREATE INDEX IF NOT EXISTS reserve_entries_org_fund_idx ON public.reserve_entries USING btree (org_id, fund_id, created_at);

CREATE INDEX IF NOT EXISTS reserve_entries_run_idx ON public.reserve_entries USING btree (run_id);

CREATE INDEX IF NOT EXISTS rights_adjustments_allocation_idx ON public.rights_adjustments USING btree (original_allocation_id);

CREATE INDEX IF NOT EXISTS rights_admin_tasks_org_idx ON public.rights_admin_tasks USING btree (org_id);

CREATE INDEX IF NOT EXISTS rights_admin_tasks_status_idx ON public.rights_admin_tasks USING btree (status);

CREATE INDEX IF NOT EXISTS rights_allocations_available_at_idx ON public.rights_allocations USING btree (org_id, available_at, status) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS rights_allocations_holder_idx ON public.rights_allocations USING btree (rights_holder_id);

CREATE INDEX IF NOT EXISTS rights_allocations_holder_status_idx ON public.rights_allocations USING btree (org_id, rights_holder_id, status);

CREATE INDEX IF NOT EXISTS rights_allocations_run_idx ON public.rights_allocations USING btree (run_id);

CREATE INDEX IF NOT EXISTS rights_allocations_work_allocation_idx ON public.rights_allocations USING btree (work_allocation_id);

CREATE INDEX IF NOT EXISTS rights_calculation_runs_org_fund_idx ON public.rights_calculation_runs USING btree (org_id, fund_id, status);

CREATE INDEX IF NOT EXISTS rights_calculation_runs_policy_version_idx ON public.rights_calculation_runs USING btree (policy_version_id);

CREATE INDEX IF NOT EXISTS rights_claims_blocking_idx ON public.rights_claims USING btree (org_id, blocks_undistributable) WHERE (blocks_undistributable = true);

CREATE INDEX IF NOT EXISTS rights_claims_holder_idx ON public.rights_claims USING btree (rights_holder_id, status);

CREATE INDEX IF NOT EXISTS rights_claims_org_status_idx ON public.rights_claims USING btree (org_id, status) WHERE (status <> ALL (ARRAY['rejected'::text, 'reversed'::text, 'paid'::text]));

CREATE INDEX IF NOT EXISTS rights_funds_org_id_idx ON public.rights_funds USING btree (org_id);

CREATE INDEX IF NOT EXISTS rights_funds_org_idx ON public.rights_funds USING btree (org_id);

CREATE INDEX IF NOT EXISTS search_publications_org_date_idx ON public.rights_holder_search_publications USING btree (org_id, publication_date DESC);

CREATE INDEX IF NOT EXISTS rights_notifications_holder_idx ON public.rights_notifications USING btree (rights_holder_id, event_type, status);

CREATE INDEX IF NOT EXISTS rights_notifications_org_status_idx ON public.rights_notifications USING btree (org_id, status, created_at DESC) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

CREATE INDEX IF NOT EXISTS rights_notifications_subject_idx ON public.rights_notifications USING btree (subject_type, subject_id);

CREATE INDEX IF NOT EXISTS rights_work_allocations_claim_deadline_idx ON public.rights_work_allocations USING btree (claim_deadline, status) WHERE (status <> 'distributed'::text);

CREATE INDEX IF NOT EXISTS rights_work_allocations_run_idx ON public.rights_work_allocations USING btree (run_id);

CREATE INDEX IF NOT EXISTS rights_work_allocations_work_idx ON public.rights_work_allocations USING btree (org_id, work_id, usage_year);

CREATE INDEX IF NOT EXISTS settlement_items_fund_idx ON public.settlement_items USING btree (org_id, fund_id);

CREATE INDEX IF NOT EXISTS settlement_items_settlement_idx ON public.settlement_items USING btree (settlement_id);

CREATE INDEX IF NOT EXISTS settlements_cutoff_idx ON public.settlements USING btree (org_id, cutoff_at, status);

CREATE INDEX IF NOT EXISTS settlements_fund_idx ON public.settlements USING btree (fund_id);

CREATE INDEX IF NOT EXISTS settlements_org_holder_status_idx ON public.settlements USING btree (org_id, rights_holder_id, status);

CREATE INDEX IF NOT EXISTS settlements_org_idx ON public.settlements USING btree (org_id);

CREATE INDEX IF NOT EXISTS settlements_status_idx ON public.settlements USING btree (status);

CREATE INDEX IF NOT EXISTS undistributable_actions_run_idx ON public.undistributable_fund_actions USING btree (run_id, status);

CREATE INDEX IF NOT EXISTS withheld_positions_work_allocation_idx ON public.withheld_beneficiary_positions USING btree (work_allocation_id, status);

drop trigger if exists "trg_check_policy_period_overlap" on public."distribution_policies";
CREATE TRIGGER trg_check_policy_period_overlap BEFORE INSERT OR UPDATE ON distribution_policies FOR EACH ROW EXECUTE FUNCTION check_policy_period_overlap();

drop trigger if exists "trg_validate_sku_from_reserve_total" on public."distribution_policy_components";
CREATE TRIGGER trg_validate_sku_from_reserve_total BEFORE INSERT OR UPDATE ON distribution_policy_components FOR EACH ROW EXECUTE FUNCTION validate_sku_from_reserve_total();

drop trigger if exists "trg_guard_policy_version_immutability" on public."distribution_policy_versions";
CREATE TRIGGER trg_guard_policy_version_immutability BEFORE UPDATE ON distribution_policy_versions FOR EACH ROW EXECUTE FUNCTION guard_policy_version_immutability();

drop trigger if exists "trg_validate_inheritance_share_total" on public."inheritance_relations";
CREATE TRIGGER trg_validate_inheritance_share_total BEFORE INSERT OR UPDATE ON inheritance_relations FOR EACH ROW EXECUTE FUNCTION validate_inheritance_share_total();

drop trigger if exists "trg_guard_allocation_immutability" on public."rights_allocations";
CREATE TRIGGER trg_guard_allocation_immutability BEFORE UPDATE ON rights_allocations FOR EACH ROW EXECUTE FUNCTION guard_allocation_immutability();

drop trigger if exists "trg_check_calculation_run_invariant" on public."rights_calculation_runs";
CREATE TRIGGER trg_check_calculation_run_invariant BEFORE INSERT OR UPDATE ON rights_calculation_runs FOR EACH ROW EXECUTE FUNCTION check_calculation_run_invariant();

drop trigger if exists "trg_guard_calculation_run_immutability" on public."rights_calculation_runs";
CREATE TRIGGER trg_guard_calculation_run_immutability BEFORE UPDATE ON rights_calculation_runs FOR EACH ROW EXECUTE FUNCTION guard_calculation_run_immutability();

drop trigger if exists "trg_update_claim_timely_flags" on public."rights_claims";
CREATE TRIGGER trg_update_claim_timely_flags BEFORE INSERT OR UPDATE ON rights_claims FOR EACH ROW EXECUTE FUNCTION update_claim_timely_flags();

drop trigger if exists "trg_guard_notification_sent_immutability" on public."rights_notifications";
CREATE TRIGGER trg_guard_notification_sent_immutability BEFORE UPDATE ON rights_notifications FOR EACH ROW EXECUTE FUNCTION guard_notification_sent_immutability();

drop trigger if exists "trg_check_work_allocation_dates" on public."rights_work_allocations";
CREATE TRIGGER trg_check_work_allocation_dates BEFORE INSERT ON rights_work_allocations FOR EACH ROW EXECUTE FUNCTION check_work_allocation_dates();

drop trigger if exists "trg_release_allocation_on_settlement_item_delete" on public."settlement_items";
CREATE TRIGGER trg_release_allocation_on_settlement_item_delete AFTER DELETE ON settlement_items FOR EACH ROW EXECUTE FUNCTION release_allocation_on_settlement_item_delete();

drop trigger if exists "trg_reserve_allocation_on_settlement_item" on public."settlement_items";
CREATE TRIGGER trg_reserve_allocation_on_settlement_item AFTER INSERT ON settlement_items FOR EACH ROW EXECUTE FUNCTION reserve_allocation_on_settlement_item();

drop trigger if exists "trg_guard_settlement_cutoff_immutability" on public."settlements";
CREATE TRIGGER trg_guard_settlement_cutoff_immutability BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION guard_settlement_cutoff_immutability();

drop trigger if exists "trg_guard_settlement_paid_immutability" on public."settlements";
CREATE TRIGGER trg_guard_settlement_paid_immutability BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION guard_settlement_paid_immutability();

alter table public."distribution_policies" enable row level security;
alter table public."distribution_policy_components" enable row level security;
alter table public."distribution_policy_versions" enable row level security;
alter table public."inheritance_relations" enable row level security;
alter table public."payouts" enable row level security;
alter table public."payroll_export_batch_items" enable row level security;
alter table public."payroll_export_batches" enable row level security;
alter table public."payroll_recipient_references" enable row level security;
alter table public."reserve_entries" enable row level security;
alter table public."rights_adjustments" enable row level security;
alter table public."rights_admin_tasks" enable row level security;
alter table public."rights_allocations" enable row level security;
alter table public."rights_calculation_runs" enable row level security;
alter table public."rights_claims" enable row level security;
alter table public."rights_funds" enable row level security;
alter table public."rights_holder_search_publications" enable row level security;
alter table public."rights_notifications" enable row level security;
alter table public."rights_work_allocations" enable row level security;
alter table public."settlement_items" enable row level security;
alter table public."settlements" enable row level security;
alter table public."undistributable_fund_actions" enable row level security;
alter table public."withheld_beneficiary_positions" enable row level security;

drop policy if exists "distribution_policies_admin_all" on public."distribution_policies";
create policy "distribution_policies_admin_all" on public."distribution_policies"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "distribution_policy_components_admin_all" on public."distribution_policy_components";
create policy "distribution_policy_components_admin_all" on public."distribution_policy_components"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "distribution_policy_versions_admin_all" on public."distribution_policy_versions";
create policy "distribution_policy_versions_admin_all" on public."distribution_policy_versions"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "inheritance_relations_admin_all" on public."inheritance_relations";
create policy "inheritance_relations_admin_all" on public."inheritance_relations"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "payouts_admin_all" on public."payouts";
create policy "payouts_admin_all" on public."payouts"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "payouts_member_read" on public."payouts";
create policy "payouts_member_read" on public."payouts"
  as permissive
  for select
  to authenticated
  using ((rights_holder_id IN ( SELECT rettighedshavere.id
   FROM rettighedshavere
  WHERE (rettighedshavere.user_id = auth.uid()))));

drop policy if exists "payroll_export_batch_items_admin_all" on public."payroll_export_batch_items";
create policy "payroll_export_batch_items_admin_all" on public."payroll_export_batch_items"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "payroll_export_batches_admin_all" on public."payroll_export_batches";
create policy "payroll_export_batches_admin_all" on public."payroll_export_batches"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "payroll_recipient_references_admin_all" on public."payroll_recipient_references";
create policy "payroll_recipient_references_admin_all" on public."payroll_recipient_references"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "reserve_entries_admin_all" on public."reserve_entries";
create policy "reserve_entries_admin_all" on public."reserve_entries"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "rights_adjustments_admin_all" on public."rights_adjustments";
create policy "rights_adjustments_admin_all" on public."rights_adjustments"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "rights_admin_tasks_admin_all" on public."rights_admin_tasks";
create policy "rights_admin_tasks_admin_all" on public."rights_admin_tasks"
  as permissive
  for all
  to authenticated
  using (((org_id = current_user_org_id()) AND is_org_admin()))
  with check (((org_id = current_user_org_id()) AND is_org_admin()));

drop policy if exists "rights_allocations_admin_all" on public."rights_allocations";
create policy "rights_allocations_admin_all" on public."rights_allocations"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "rights_allocations_holder_select" on public."rights_allocations";
create policy "rights_allocations_holder_select" on public."rights_allocations"
  as permissive
  for select
  to public
  using ((rights_holder_id IN ( SELECT rettighedshavere.id
   FROM rettighedshavere
  WHERE (rettighedshavere.user_id = auth.uid()))));

drop policy if exists "rights_allocations_member_read" on public."rights_allocations";
create policy "rights_allocations_member_read" on public."rights_allocations"
  as permissive
  for select
  to authenticated
  using ((rights_holder_id IN ( SELECT rettighedshavere.id
   FROM rettighedshavere
  WHERE (rettighedshavere.user_id = auth.uid()))));

drop policy if exists "rights_calculation_runs_admin_all" on public."rights_calculation_runs";
create policy "rights_calculation_runs_admin_all" on public."rights_calculation_runs"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "rights_claims_admin_all" on public."rights_claims";
create policy "rights_claims_admin_all" on public."rights_claims"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "rights_funds_admin_all" on public."rights_funds";
create policy "rights_funds_admin_all" on public."rights_funds"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "search_publications_admin_all" on public."rights_holder_search_publications";
create policy "search_publications_admin_all" on public."rights_holder_search_publications"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "rights_notifications_admin_all" on public."rights_notifications";
create policy "rights_notifications_admin_all" on public."rights_notifications"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "rights_notifications_holder_select" on public."rights_notifications";
create policy "rights_notifications_holder_select" on public."rights_notifications"
  as permissive
  for select
  to public
  using ((rights_holder_id IN ( SELECT rettighedshavere.id
   FROM rettighedshavere
  WHERE (rettighedshavere.user_id = auth.uid()))));

drop policy if exists "rights_notifications_member_read" on public."rights_notifications";
create policy "rights_notifications_member_read" on public."rights_notifications"
  as permissive
  for select
  to authenticated
  using (((channel = 'portal'::text) AND (rights_holder_id IN ( SELECT rettighedshavere.id
   FROM rettighedshavere
  WHERE (rettighedshavere.user_id = auth.uid())))));

drop policy if exists "rights_work_allocations_admin_all" on public."rights_work_allocations";
create policy "rights_work_allocations_admin_all" on public."rights_work_allocations"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "settlement_items_admin_all" on public."settlement_items";
create policy "settlement_items_admin_all" on public."settlement_items"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "settlement_items_member_read" on public."settlement_items";
create policy "settlement_items_member_read" on public."settlement_items"
  as permissive
  for select
  to authenticated
  using ((rights_holder_id IN ( SELECT rettighedshavere.id
   FROM rettighedshavere
  WHERE (rettighedshavere.user_id = auth.uid()))));

drop policy if exists "settlements_admin_all" on public."settlements";
create policy "settlements_admin_all" on public."settlements"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "settlements_holder_select" on public."settlements";
create policy "settlements_holder_select" on public."settlements"
  as permissive
  for select
  to public
  using ((rights_holder_id IN ( SELECT rettighedshavere.id
   FROM rettighedshavere
  WHERE (rettighedshavere.user_id = auth.uid()))));

drop policy if exists "undistributable_fund_actions_admin_all" on public."undistributable_fund_actions";
create policy "undistributable_fund_actions_admin_all" on public."undistributable_fund_actions"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

drop policy if exists "withheld_positions_admin_all" on public."withheld_beneficiary_positions";
create policy "withheld_positions_admin_all" on public."withheld_beneficiary_positions"
  as permissive
  for all
  to public
  using ((org_id IN ( SELECT user_org_roles.org_id
   FROM user_org_roles
  WHERE ((user_org_roles.user_id = auth.uid()) AND (user_org_roles.role = ANY (ARRAY['admin'::text, 'org-admin'::text, 'superadmin'::text]))))));

create or replace view public."rights_notifications_admin_tasks" as SELECT id,
    org_id,
    task_type,
    subject_type,
    subject_id,
    priority,
    status,
    description,
    resolved_at,
    resolved_by,
    created_at
   FROM rights_admin_tasks;
