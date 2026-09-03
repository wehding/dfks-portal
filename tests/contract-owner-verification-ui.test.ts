import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canManageContractOwnership,
  contractOwnerOriginLabel,
  contractOwnerStatusLabel,
} from "../lib/contract-owner-verification-ui";

const archive = readFileSync("app/admin/kontrakter/ContractArchiveClient.tsx", "utf8");
const editor = readFileSync("app/admin/kontrakter/[id]/rediger/ContractWorkbenchClient.tsx", "utf8");
const aiEditor = readFileSync("app/admin/kontrakter/ContractAiDataEditor.tsx", "utf8");
const ownership = readFileSync("components/admin/contract-ownership-editor.tsx", "utf8");

test("ejerskab er integreret i arkiv og editor og ikke et separat panel", () => {
  assert.doesNotMatch(archive, /Ejerskabskontrol|ContractOwnerVerificationTab/);
  assert.match(archive, /Alle ejerskaber/);
  assert.match(archive, /Mangler ejer/);
  assert.match(editor, /key: "ownership", label: "Ejerskab"/);
  assert.match(editor, /ContractOwnershipEditor/);
  assert.equal((archive.match(/tabIndex=\{activeTab ===/g) ?? []).length, 3);
});

test("kun organisationsadministratorer kan ændre ejerskab", () => {
  for (const role of ["superadmin", "admin", "org-admin"]) assert.equal(canManageContractOwnership(role), true);
  for (const role of ["jurist", "viewer", "member", null, undefined]) assert.equal(canManageContractOwnership(role), false);
  assert.match(ownership, /reviewContractOwnerVerification/);
  assert.match(ownership, /admin_verified_existing_owner/);
  assert.match(ownership, /admin_verified_correction/);
});

test("editoren understøtter ét klik, næste og PDF-kilde", () => {
  assert.match(ownership, /Godkend ejerskab/);
  assert.match(ownership, /Godkend ejerskab og gå til næste/);
  assert.match(ownership, /Vælg ejer/);
  assert.match(ownership, /sourceKey: "rightsHolderName"/);
  assert.match(editor, /metaKey|ctrlKey/);
  assert.match(editor, /ArrowLeft/);
  assert.match(editor, /ArrowRight/);
  assert.match(ownership, /Vis ejerskabsgrundlag/);
  assert.doesNotMatch(ownership, /Tidligere registreret ejer/);
  assert.match(ownership, /canConfirm && oneClickOwner/);
  assert.match(editor, /queue\?\.kind === "ownership"/);
  assert.match(editor, /Ejerskab afklaring/);
});

test("en historisk registreret ejer kan godkendes uden et separat AI-forslag", () => {
  assert.match(ownership, /const oneClickOwner = proposedOwner \?\? assignedOwner/);
  assert.match(ownership, /canManage && detail && oneClickOwner/);
  assert.doesNotMatch(ownership, /canManage && detail && proposedOwner &&/);
});

test("status og oprindelse har forståelige danske etiketter", () => {
  assert.equal(contractOwnerStatusLabel("correction_proposed"), "Rettelse foreslået");
  assert.equal(contractOwnerOriginLabel("historical_assignment"), "Tidligere registreret ejer");
});

test("arkivlisten viser kun ejerskabs- og dokumentstatusser der kræver handling", () => {
  assert.doesNotMatch(archive, /ownership_status === "confirmed" \? <Badge/);
  assert.doesNotMatch(archive, /ownership_status === "corrected" \? <Badge/);
  assert.match(archive, /\['warning', 'danger'\]\.includes\(state\.processingTone\)/);
  assert.match(archive, /AI_JOB_ATTENTION_STATES\.has\(contract\.ai_job_status\)/);
  assert.match(archive, /Mangler værk/);
  assert.match(archive, /Afventer bekræftelse af afsnit/);
});

test("kontrakttypen viser kun den valgte type med ikon og tekst", () => {
  assert.match(editor, /<SelectValue/);
  assert.match(editor, /<SelectItem value="a-løn">A-løn<\/SelectItem>/);
  assert.match(editor, /<SelectItem value="leverandør">Leverandøraftale<\/SelectItem>/);
  assert.match(editor, /contract\.type \? "stored" : "unknown"/);
});

test("producentforslag og manuel værksoprettelse genbruger de aflæste kontraktdata", () => {
  assert.match(editor, /extractedProductionCompanyNames\(validationData\)/);
  assert.match(editor, /suggestedNames=\{extractedProducerNames\}/);
  assert.match(editor, /contractDataToManualWorkSeed/);
  assert.match(editor, /production_companies: data\.producerSelections/);
  assert.match(editor, /void searchWorks\(query\)/);
  assert.match(editor, /contractWorkTypeFilter/);
});

test("gem og validering gemmer alle åbne editorfelter før kontraktstatus ændres", () => {
  const flushPosition = editor.indexOf("for (const flush of flushHandlersRef.current.values())");
  const workPosition = editor.indexOf("const workId = await resolveWorkBeforeSave()");
  const updatePosition = editor.indexOf("const result = await updateAdminContract");
  assert.ok(flushPosition >= 0);
  assert.ok(flushPosition < workPosition);
  assert.ok(workPosition < updatePosition);
  assert.match(editor, /const success = await save\("valideret"/);
  assert.match(editor, /Validér kontrakt<\/Button>/);
  assert.match(editor, /Validér og næste <kbd/); // tastaturgenvej vises på "og næste"-varianten
});

test("kontraktarbejdsfladen har en tilgængelig og vedvarende breddejustering", () => {
  assert.match(editor, /role="separator"/);
  assert.match(editor, /aria-orientation="vertical"/);
  assert.match(editor, /cursor-col-resize/);
  assert.match(editor, /setPointerCapture/);
  assert.match(editor, /SPLIT_STORAGE_KEY/);
  assert.match(editor, /event\.key === "ArrowLeft"/);
  assert.match(editor, /event\.key === "ArrowRight"/);
});

test("godkendelsesfanen viser tydelige dokument- og underskriftsstatusser", () => {
  assert.match(aiEditor, /: "Ikke underskrevet"/); // tydelig underskriftsstatus-badge
  assert.match(editor, /Original konverteret PDF/);
  assert.match(editor, /CLAUSE_EVIDENCE_KEYS\.has\(evidence\.sourceKey\)/);
  // underskrifts-evidens falder tilbage til sidste side når der ikke er en konkret side
  assert.match(editor, /evidence\.fieldKey === "signatureStatus" \|\| evidence\.fieldKey === "signatureDate"/);
  assert.match(editor, /evidence\.page \?\? documentLastPage/);
});
