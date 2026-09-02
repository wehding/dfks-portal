import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canManageContractOwnership,
  canRequestOwnerSuggestion,
  canSafelyBulkConfirm,
  contractOwnerOptionLabel,
  contractOwnerOriginLabel,
  contractOwnerStatusLabel,
  normalizeContractOwnerBlockReason,
} from "../lib/contract-owner-verification-ui";

const archiveSource = readFileSync("app/admin/kontrakter/ContractArchiveClient.tsx", "utf8");
const archivePageSource = readFileSync("app/admin/kontrakter/page.tsx", "utf8");
const ownerQueueSource = readFileSync("components/admin/contract-owner-verification-tab.tsx", "utf8");
const workbenchSource = readFileSync("app/admin/kontrakter/[id]/rediger/ContractWorkbenchClient.tsx", "utf8");
const sharedEditorsSource = readFileSync("components/admin/shared-record-editors.tsx", "utf8");
const legacyValidationSource = readFileSync("app/admin/validering/page.tsx", "utf8");

test("kun organisationsadministratorer kan se ejerskabskontrol", () => {
  for (const role of ["superadmin", "admin", "org-admin"]) assert.equal(canManageContractOwnership(role), true);
  for (const role of ["jurist", "viewer", "member", null, undefined]) assert.equal(canManageContractOwnership(role), false);
  assert.match(archiveSource, /canManageOwnership \?/);
  assert.match(archivePageSource, /access\.modules\?\.contract_ownership\?\.read/);
  assert.match(archivePageSource, /canManageOwnership=\{canManageOwnership\}/);
  assert.match(archiveSource, /Ejerskabskontrol/);
  // Kontraktupload er fortsat tilgængelig for jurister med kontrakt-write-adgang.
  assert.match(archiveSource, /Kontraktupload/);
});

test("juristens upload viser og indsender ikke et ejerfelt", () => {
  assert.match(archiveSource, /canManageOwnership && updated\.length === 1 && uploadRightsHolderId/);
  assert.match(archiveSource, /canManageOwnership && uploadItems\.length === 1/);
  assert.match(archiveSource, /AdminKontrakterContent view="upload" canManageOwnership=\{canManageOwnership\}/);
});

test("samlet bekræftelse accepterer kun ukonfliktfyldte afventende ejere", () => {
  const owner = { id: "owner-1" };
  const proof = { reasonCode: "ai_matches_assigned", aiEvidenceAvailable: true, spatialEvidenceAvailable: true };
  assert.equal(canSafelyBulkConfirm({ verificationStatus: "pending", assignedRightsHolder: owner, proposedRightsHolder: null, ...proof }), true);
  assert.equal(canSafelyBulkConfirm({ verificationStatus: "pending", assignedRightsHolder: owner, proposedRightsHolder: owner, ...proof }), true);
  assert.equal(canSafelyBulkConfirm({ verificationStatus: "pending", assignedRightsHolder: owner, proposedRightsHolder: { id: "owner-2" }, ...proof }), false);
  assert.equal(canSafelyBulkConfirm({ verificationStatus: "conflict", assignedRightsHolder: owner, proposedRightsHolder: null, ...proof }), false);
  assert.equal(canSafelyBulkConfirm({ verificationStatus: "pending", assignedRightsHolder: null, proposedRightsHolder: null, ...proof }), false);
  assert.equal(canSafelyBulkConfirm({ verificationStatus: "pending", assignedRightsHolder: owner, proposedRightsHolder: null, ...proof, spatialEvidenceAvailable: false }), false);
  assert.equal(canSafelyBulkConfirm({ verificationStatus: "pending", assignedRightsHolder: owner, proposedRightsHolder: null, ...proof, reasonCode: "historical_assignment" }), false);
  assert.match(ownerQueueSource, /bulkConfirmContractOwners\(bulkBatch\.flatMap/);
  const bulkStart = ownerQueueSource.indexOf("async function confirmSelected");
  const bulkEnd = ownerQueueSource.indexOf("async function findOwnerSuggestion", bulkStart);
  assert.notEqual(bulkStart, -1);
  assert.notEqual(bulkEnd, -1);
  assert.doesNotMatch(ownerQueueSource.slice(bulkStart, bulkEnd), /for \(const item|fetchContractOwnerVerificationDetail/);
});

test("masseejersøgning omfatter åbne kontroller men ikke manuelt afsluttede sager", () => {
  for (const verificationStatus of ["pending", "conflict", "correction_proposed"]) {
    assert.equal(canRequestOwnerSuggestion({ verificationStatus, reasonCode: null }), true);
  }
  for (const verificationStatus of ["corrected", "blocked", "not_applicable"]) {
    assert.equal(canRequestOwnerSuggestion({ verificationStatus, reasonCode: null }), false);
  }
  assert.equal(canRequestOwnerSuggestion({ verificationStatus: "confirmed", reasonCode: "session_bound_owner" }), true);
  assert.equal(canRequestOwnerSuggestion({ verificationStatus: "confirmed", reasonCode: "admin_verified_existing_owner" }), false);
  assert.equal(canRequestOwnerSuggestion({ verificationStatus: "confirmed", reasonCode: "bulk_confirmed_existing_owner" }), false);
  assert.equal(canRequestOwnerSuggestion({ verificationStatus: "confirmed", reasonCode: "manual_identity_check" }), false);
  assert.match(ownerQueueSource, /findOwnersForContracts\(ownerSuggestionBatch\.map/);
  assert.match(ownerQueueSource, /result\.matched/);
  assert.match(ownerQueueSource, /result\.unresolved/);
  assert.match(ownerQueueSource, /result\.skipped/);
  assert.match(ownerQueueSource, /!canRequestOwnerSuggestion\(item\)/);
  assert.match(ownerQueueSource, /bulkConfirmEligible\.length/);
});

test("kontraktfanerne følger tastaturmønsteret og kan rulle vandret på mobil", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    assert.match(archiveSource, new RegExp(`event\\.key === "${key}"`));
  }
  assert.equal((archiveSource.match(/tabIndex=\{activeTab ===/g) ?? []).length, 4);
  assert.equal((archiveSource.match(/onKeyDown=\{event => handleTabKeyDown/g) ?? []).length, 4);
  assert.equal((archiveSource.match(/shrink-0 whitespace-nowrap border-b-2/g) ?? []).length, 4);
  assert.match(archiveSource, /role="tablist"[^>]*overflow-x-auto|overflow-x-auto[^>]*role="tablist"/);
  assert.ok(
    (ownerQueueSource.match(/aria-label=\{`Åbn ejerskabskontrol for \$\{item\.workingTitle \?\? "kontrakten"\}`\}/g) ?? []).length >= 2,
  );
});

test("blokårsager og ens navne håndteres entydigt i brugerfladen", () => {
  assert.equal(normalizeContractOwnerBlockReason("missing_evidence"), "missing_evidence");
  assert.equal(normalizeContractOwnerBlockReason("ai_matches_assigned"), "manual_review_required");
  assert.equal(normalizeContractOwnerBlockReason(null), "manual_review_required");

  const first = { id: "00000000-0000-0000-0000-000000000001", name: "Anne Jensen" };
  const namesake = { id: "00000000-0000-0000-0000-000000000002", name: "  anne   jensen " };
  assert.equal(contractOwnerOptionLabel(first, [first, namesake]), "Anne Jensen · profil 00000001");
  assert.equal(
    contractOwnerOptionLabel({ ...first, secondaryLabel: "Medlemsnr. 42" }, [first, namesake]),
    "Anne Jensen · Medlemsnr. 42",
  );
});

test("ejervælgeren søger server-side og viser en sekundær profilidentitet", () => {
  assert.match(ownerQueueSource, /searchEligibleContractOwners\(query\)/);
  assert.match(ownerQueueSource, /contractOwnerOptionLabel\(owner, ownerCandidates\)/);
  assert.match(ownerQueueSource, /selectedOwner\.secondaryLabel/);
  assert.doesNotMatch(ownerQueueSource, /detail\.eligibleRightsHolders/);
});

test("status og oprindelse har forståelige danske etiketter", () => {
  assert.equal(contractOwnerStatusLabel("correction_proposed"), "Rettelse foreslået");
  assert.equal(contractOwnerOriginLabel("authenticated_member_upload"), "Uploadet af medlemmet");
  assert.equal(contractOwnerOriginLabel("admin_selected_at_intake"), "Valgt ved adminupload");
});

test("den almindelige kontrakteditor kan ikke indsende et ejerskifte", () => {
  const updateStart = workbenchSource.indexOf("const result = await updateAdminContract");
  const updateEnd = workbenchSource.indexOf("if (!result.success)", updateStart);
  assert.notEqual(updateStart, -1);
  assert.notEqual(updateEnd, -1);
  assert.doesNotMatch(workbenchSource.slice(updateStart, updateEnd), /rights_holder_id/);
  assert.match(workbenchSource, /sourceKey: "ownershipAssignment"/);
  assert.match(workbenchSource, /data\.canManageOwnership \?/);
  assert.doesNotMatch(workbenchSource, /Søg efter rettighedshaver/);

  const legacyUpdateStart = archiveSource.indexOf("const updateResult = await updateAdminContract");
  const legacyUpdateEnd = archiveSource.indexOf("if (!updateResult.success)", legacyUpdateStart);
  assert.notEqual(legacyUpdateStart, -1);
  assert.notEqual(legacyUpdateEnd, -1);
  assert.doesNotMatch(archiveSource.slice(legacyUpdateStart, legacyUpdateEnd), /rights_holder_id/);
  assert.doesNotMatch(archiveSource, /Find ejer|Søg efter rettighedshaver/);
  assert.match(archiveSource, /Ejeren kan ikke ændres i den almindelige kontrakteditor/);

  const sharedStart = sharedEditorsSource.indexOf("export function SharedContractEditor");
  assert.notEqual(sharedStart, -1);
  const sharedContractEditor = sharedEditorsSource.slice(sharedStart);
  assert.doesNotMatch(sharedContractEditor, /RightsHolderAutocomplete/);
  assert.doesNotMatch(sharedContractEditor, /rights_holder_id:\s*form/);
  assert.match(sharedContractEditor, /payload\.canManageOwnership \?/);
  assert.match(sharedContractEditor, /Ejeren kan ikke ændres i den almindelige kontrakteditor/);
});

test("den gamle valideringsside ændrer ikke kontraktens ejer", () => {
  const validationRequestStart = legacyValidationSource.indexOf('fetch("/api/admin/contracts/validate"');
  const validationRequestEnd = legacyValidationSource.indexOf("}).then", validationRequestStart);
  assert.notEqual(validationRequestStart, -1);
  assert.notEqual(validationRequestEnd, -1);
  assert.doesNotMatch(legacyValidationSource.slice(validationRequestStart, validationRequestEnd), /rightsHolderId/);
  assert.doesNotMatch(legacyValidationSource, /setSelectedRhId|rhSuggestions/);
  assert.match(legacyValidationSource, /administreres under Ejerskabskontrol/);
});
