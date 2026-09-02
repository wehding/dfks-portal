import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("ejerskabskontrol er et særskilt manager-modul", () => {
  const staff = source("lib/staff-access.ts");
  assert.match(staff, /contract_ownership: all \? FULL : NONE/);
  assert.doesNotMatch(staff, /contract_ownership:.*legal/);

  const actions = source("app/actions/contract-owner-verifications.ts");
  assert.match(actions, /USER_ADMIN_ROLES/);
  assert.match(actions, /modules\?\.contract_ownership\?\.\[operation\]/);
  assert.match(actions, /admin\.contract_ownership\.queue/);
  assert.match(actions, /admin\.contract_ownership\.detail/);
  assert.match(actions, /admin\.contract_ownership\.owner_search/);
  assert.equal((actions.match(/recordSensitiveFlow\s*\(/g) ?? []).length, 3);
  assert.match(actions, /RPC writes one atomic semantic audit event/);
});

test("køen er pagineret og detaljen læser kun bundet rå AI- og dokumentevidens", () => {
  const dal = source("lib/server/contract-owner-verifications.ts");
  assert.match(dal, /list_contract_owner_verification_queue/);
  assert.match(dal, /p_limit: params\.pageSize/);
  assert.match(dal, /evidence_ai_job_id/);
  assert.match(dal, /evidence_document_job_id/);
  assert.match(dal, /\.eq\("id", verificationResult\.data\.evidence_ai_job_id\)/);
  assert.ok((dal.match(/\.is\("superseded_by_job_id", null\)/g) ?? []).length >= 2);
  assert.match(dal, /result_data/);
  assert.doesNotMatch(dal, /contract_validations/);
  assert.match(dal, /parseVerifiedSpatialV3Artifact/);
  assert.match(dal, /searchActiveContractOwnerCandidates/);
  assert.match(dal, /safeLimit/);
  assert.match(dal, /member_no/);
  assert.match(dal, /secondaryLabel/);
  const ownerSearch = dal.slice(
    dal.indexOf("export async function searchActiveContractOwnerCandidates"),
    dal.indexOf("export async function getContractOwnerVerificationDetail"),
  );
  assert.match(ownerSearch, /from\("org_affiliations"\)[\s\S]*eq\("org_id", orgId\)[\s\S]*referencedTable: "rettighedshavere"/);
  assert.doesNotMatch(ownerSearch, /from\("rettighedshavere"\)[\s\S]*limit\(60\)/);
});

test("review accepterer kun faste årsager og serverafledt geometrisk evidens", () => {
  const actions = source("app/actions/contract-owner-verifications.ts");
  assert.match(actions, /isContractOwnerDecisionReason\(input\.decision, reasonCode\)/);
  assert.doesNotMatch(actions, /evidencePage\??:/);
  assert.doesNotMatch(actions, /evidenceBbox\??:/);
  assert.doesNotMatch(actions, /evidenceConfidence\??:/);
  assert.match(actions, /getContractOwnerVerificationDetail\(db, caller, input\.contractId/);
  assert.match(actions, /trustedSpatialEvidence\?\.bbox/);

  const types = source("lib/contract-owner-verification-types.ts");
  assert.match(types, /CONTRACT_OWNER_BLOCK_REASON_CODES/);
  assert.match(types, /wrong_organization/);
});

test("massebekræftelse er ét afgrænset serverkald med ny kontrol pr. kontrakt", () => {
  const actions = source("app/actions/contract-owner-verifications.ts");
  assert.match(actions, /export async function bulkConfirmContractOwners/);
  assert.match(actions, /BULK_OWNER_CONFIRM_LIMIT = 25/);
  assert.match(actions, /offset \+= 5/);
  assert.match(actions, /reasonCode === "ai_matches_assigned"/);
  assert.doesNotMatch(actions, /includeEligibleRightsHolders/);
  assert.match(actions, /reasonCode: "bulk_confirmed_existing_owner"/);
});

test("AI-matching foreslår ejer men ændrer aldrig kontraktens ejer", () => {
  const processor = source("lib/server/contract-import-processor.ts");
  assert.match(processor, /ownerSuggestionId: ownerCandidateId/);
  assert.match(processor, /rightsHolderId: null/);
  assert.match(processor, /AI matching is evidence, never authority/);

  const matching = source("app/actions/contract-imports.ts");
  assert.match(matching, /contract_ai_jobs/);
  assert.match(matching, /recordContractOwnerCandidate/);
  assert.match(matching, /modules\?\.contract_ownership\?\.write/);
  assert.match(matching, /is\("superseded_by_job_id", null\)/);
  assert.match(matching, /original_view_storage_path/);
  assert.doesNotMatch(matching, /proposedRightsHolderId: null/);
  assert.doesNotMatch(matching, /from\("contracts"\)\.update\(\{ rights_holder_id/);

  const ownerVerification = source("lib/server/contract-owner-verifications.ts");
  assert.match(ownerVerification, /if \(!input\.proposedRightsHolderId\) return/);
  assert.match(ownerVerification, /record_contract_owner_candidate/);
  assert.doesNotMatch(ownerVerification, /contract_owner_provenance"\)\.insert/);

  const migration = source("supabase/migrations/20260902140000_contract_owner_verifications.sql");
  assert.match(migration, /create or replace function public\.record_contract_owner_candidate/);
  assert.match(migration, /from public\.contract_owner_verifications[\s\S]*for update/);
  assert.match(migration, /A final\/manual decision is never silently reopened/);
});

test("generel redigering og validering kan ikke skifte ejer", () => {
  const memberContracts = source("app/actions/member-contracts.ts");
  assert.match(memberContracts, /rights_holder_id: _ignoredRightsHolderId/);
  assert.match(memberContracts, /rights_holder_id: existing\.rights_holder_id/);
  const validateRoute = source("app/api/admin/contracts/validate/route.ts");
  assert.doesNotMatch(validateRoute, /const \{[^}]*rightsHolderId/);
  assert.match(validateRoute, /p_rights_holder_id: contract\.rights_holder_id/);
  assert.match(validateRoute, /ADMIN_ROLES/);
});

test("kontraktens AI- og importstatus er altid afgrænset til aktiv organisation", () => {
  const actions = source("app/actions/contract-imports.ts");
  const validationRead = actions.slice(actions.indexOf("export async function getContractValidationData"));
  assert.match(validationRead, /from\("contracts"\)[\s\S]*?eq\("org_id", caller\.orgId\)/);
  assert.match(validationRead, /if \(!contract\) return/);
  assert.match(validationRead, /from\("contract_validations"\)[\s\S]*?eq\("org_id", caller\.orgId\)/);

  const importState = source("lib/server/contract-import-state.ts");
  assert.match(importState, /from\("contract_validations"\)[\s\S]*?eq\("org_id", orgId\)/);
});

test("PDF, DOC og DOCX går gennem dokumentworkeren før AI", () => {
  const intake = source("lib/server/contract-import-intake.ts");
  assert.match(intake, /\["pdf", "doc", "docx"\]\.includes\(extension\)/);
  assert.match(intake, /if \(needsDocumentProcessing\)/);
  const memberContracts = source("app/actions/member-contracts.ts");
  assert.match(memberContracts, /function requiresDocumentProcessing/);
  assert.match(memberContracts, /\["pdf", "doc", "docx"\]/);
  assert.match(memberContracts, /documentExtension\(filePath\) === "txt"/);
});

test("jurist kan uploade uden at tildele ejer", () => {
  const access = source("lib/server/contract-import-access.ts");
  assert.match(access, /assertAdminRole\(session, ADMIN_ROLES\)/);
  assert.match(access, /modules\?\.contracts\?\.write/);
  assert.match(access, /contract_ownership\?\.write/);

  for (const routePath of [
    "app/api/admin/contract-imports/route.ts",
    "app/api/admin/contract-imports/[batchId]/items/route.ts",
    "app/api/admin/contract-imports/[batchId]/route.ts",
    "app/api/admin/contract-imports/[batchId]/retry/route.ts",
  ]) {
    assert.match(source(routePath), /requireContractImportWriteAccess\(\)/, `${routePath} skal bruge den fælles uploadpolicy`);
  }

  const itemRoute = source("app/api/admin/contract-imports/[batchId]/items/route.ts");
  assert.match(itemRoute, /auth\.canManageOwnership[\s\S]*?formData\.get\("rightsHolderId"\)[\s\S]*?: null/);
  assert.match(itemRoute, /rightsHolderId: effectiveRightsHolderId/);

  const batchDetail = source("app/api/admin/contract-imports/[batchId]/route.ts");
  assert.doesNotMatch(batchDetail, /\.select\("[^"]*owner_match_score/);

  const intake = source("lib/server/contract-import-intake.ts");
  assert.match(intake, /\["superadmin", "admin", "org-admin"\]/);
  assert.match(intake, /actor\.role === "member"/);
  assert.match(intake, /rights_holder_id: null/);
  assert.match(intake, /record_contract_owner_provenance/);

  const page = source("app/admin/kontrakter/page.tsx");
  assert.match(page, /modules\?\.contract_ownership\?\.read/);
  const client = source("app/admin/kontrakter/ContractArchiveClient.tsx");
  assert.match(client, /canManageOwnership && updated\.length === 1 && uploadRightsHolderId/);
  assert.match(client, /\{canManageOwnership && uploadItems\.length === 1 && \(/);
});

test("sletning uden kontraktsletning kræver først reassignment", () => {
  const users = source("app/api/admin/users/route.ts");
  assert.match(users, /Flyt kontrakterne under Ejerskabskontrol/);
  assert.doesNotMatch(users, /update\(\{ rights_holder_id: null \}\)/);
  const holders = source("app/actions/rights-holder-admin.ts");
  assert.match(holders, /Flyt dem under Ejerskabskontrol/);
  assert.doesNotMatch(holders, /update\(\{ rights_holder_id: null \}\)/);
});

test("databasen håndhæver provenance, konfliktstatus og atomisk review", () => {
  const migration = source("supabase/migrations/20260902140000_contract_owner_verifications.sql");
  for (const value of [
    "conflict", "authenticated_member_upload", "authenticated_member_drive",
    "admin_selected_at_intake", "ai_suggestion", "historical_assignment",
  ]) assert.match(migration, new RegExp(`'${value}'`));
  assert.match(migration, /create or replace function public\.review_contract_owner/);
  assert.match(migration, /create or replace function public\.record_contract_owner_provenance/);
  assert.match(migration, /private\.guard_contract_owner_change/);
  assert.match(migration, /ownerSuggestionId/);
  assert.match(migration, /evidence_ai_job_id/);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /current_user_is_member_owner\(rights_holder_id\)/);
  assert.match(migration, /assignment_origin\s*\) values \([\s\S]*'pending', 'unknown'/);
});

test("ejerskifte overfører hverken afsnitsvalg eller tidligere medlemsbeskeder", () => {
  const migration = source("supabase/migrations/20260902140000_contract_owner_verifications.sql");
  const reassignStart = migration.indexOf("if p_decision = 'reassign' then");
  const reassignEnd = migration.indexOf("select coalesce(array_agg", reassignStart);
  assert.notEqual(reassignStart, -1);
  assert.notEqual(reassignEnd, -1);
  const reassign = migration.slice(reassignStart, reassignEnd);
  assert.match(reassign, /episode_scope_id = null/);
  assert.match(reassign, /episode_numbers = null/);
  assert.match(reassign, /contract_episode_confirmations[\s\S]*invalidated_at/);

  assert.match(migration, /member_rights_holder_id uuid/);
  assert.match(migration, /comment\.member_rights_holder_id = p_rights_holder_id/);
  assert.match(migration, /create or replace function public\.get_navigation_badge_counts/);
  assert.match(migration, /create or replace function public\.get_member_dashboard_task_overview/);

  const memberContracts = source("app/actions/member-contracts.ts");
  const memberListStart = memberContracts.indexOf("export async function fetchMemberContractsPage");
  const memberDetailStart = memberContracts.indexOf("export async function fetchMemberContractDetail");
  const memberDetailEnd = memberContracts.indexOf("export async function getContractSignedUrl", memberDetailStart);
  const markReadStart = memberContracts.indexOf("export async function markContractCommentsRead");
  const markReadEnd = memberContracts.indexOf("export async function createAdminEmployer", markReadStart);
  assert.match(memberContracts.slice(memberListStart, memberDetailStart), /member_rights_holder_id", context\.rightsHolderId/);
  assert.match(memberContracts.slice(memberDetailStart, memberDetailEnd), /member_rights_holder_id", rh\.id/);
  assert.match(memberContracts.slice(markReadStart, markReadEnd), /if \(asMember\) query = query\.eq\("member_rights_holder_id", contract\.rights_holder_id\)/);

  const adminEditorStart = memberContracts.indexOf("export async function fetchAdminContractEditorData");
  const adminEditorEnd = memberContracts.indexOf("export async function updateAdminContract", adminEditorStart);
  const adminEditorSlice = memberContracts.slice(adminEditorStart, adminEditorEnd);
  assert.doesNotMatch(adminEditorSlice, /contract_comments\(\*\)/);
  assert.match(adminEditorSlice, /from\("contract_comments"\)[\s\S]*member_rights_holder_id[\s\S]*\.eq\("org_id", orgId\)/);
  assert.match(adminEditorSlice, /participant_name: comment\.author_role === "member"/);
  assert.match(adminEditorSlice, /contract_comments: contractComments/);

  const sharedEditor = source("components/admin/shared-record-editors.tsx");
  assert.match(sharedEditor, /participant_name\?: string \| null/);
  assert.match(sharedEditor, /authorLabel: comment\.author_role === "member"[\s\S]*Historisk medlem \(ukendt\)/);
  const messageThread = source("components/messages/message-thread.tsx");
  assert.match(messageThread, /authorLabel\?: string \| null/);
  assert.match(messageThread, /message\.authorLabel \?\? roleLabel/);

  const memberInbox = source("app/actions/member-inbox.ts");
  const inboxStart = memberInbox.indexOf("export async function fetchMemberInbox");
  const adminInboxStart = memberInbox.indexOf("export async function fetchAdminInbox", inboxStart);
  const memberInboxSlice = memberInbox.slice(inboxStart, adminInboxStart);
  assert.match(memberInboxSlice, /member_rights_holder_id", holder\.id/);
  assert.doesNotMatch(memberInboxSlice, /contract_comments\(id/);
  const adminInboxEnd = memberInbox.indexOf("export async function fetchAdminWorkInbox", adminInboxStart);
  const adminInboxSlice = memberInbox.slice(adminInboxStart, adminInboxEnd);
  assert.match(adminInboxSlice, /comment\.member_rights_holder_id !== activeOwnerByContract\.get\(comment\.contract_id\)/);
  assert.doesNotMatch(adminInboxSlice, /contract_comments\(id/);
});
