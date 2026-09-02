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
  assert.match(ownership, /Godkend forslag/);
  assert.match(ownership, /Godkend og næste/);
  assert.match(ownership, /Ret og næste/);
  assert.match(ownership, /sourceKey: "rightsHolderName"/);
  assert.match(editor, /metaKey|ctrlKey/);
  assert.match(editor, /ArrowLeft/);
  assert.match(editor, /ArrowRight/);
});

test("status og oprindelse har forståelige danske etiketter", () => {
  assert.equal(contractOwnerStatusLabel("correction_proposed"), "Rettelse foreslået");
  assert.equal(contractOwnerOriginLabel("historical_assignment"), "Tidligere registreret ejer");
});
