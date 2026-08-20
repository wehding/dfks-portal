import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const analyseSource = readFileSync("lib/analyse.ts", "utf8");
const legalMigration = readFileSync("supabase/migrations/20260820204753_strengthen_legal_onboarding_compliance.sql", "utf8");
const legalVersionMigration = readFileSync("supabase/migrations/20260820210132_add_legal_acceptance_document_version.sql", "utf8");
const legalRecordSource = readFileSync("lib/server/legal-document-records.ts", "utf8");
const legalActionSource = readFileSync("app/actions/legal-documents.ts", "utf8");
const onboardingClientSource = readFileSync("app/(member)/onboarding/OnboardingClient.tsx", "utf8");
const rightsHolderActionSource = readFileSync("app/actions/rettighedshavere.ts", "utf8");
const rightsHolderAdminSource = readFileSync("app/admin/rettighedshavere/page.tsx", "utf8");

test("kontraktraadgivning sender ikke raad PDF/base64 til AI", () => {
  assert.equal(analyseSource.includes('fileBuffer.toString("base64")'), false);
  assert.equal(analyseSource.includes("inline_data"), false);
  assert.match(analyseSource, /maskSensitiveData\(contractText\)/);
});

test("accept-historik kan markeres foraeldet uden at blive slettet", () => {
  assert.match(legalMigration, /superseded_at timestamptz/);
  assert.match(legalMigration, /superseded_by_document_version_id uuid/);
  assert.match(legalMigration, /legal_document_acceptances_active_idx/);
});

test("accept-historik gemmer dokumentversion eksplicit", () => {
  assert.match(legalVersionMigration, /document_version integer/);
  assert.match(legalVersionMigration, /document_version set not null/);
  assert.match(legalRecordSource, /document_version: document\.version/);
});

test("terminale AI-jobfejl rydder midlertidig maskeret tekst", () => {
  assert.match(legalMigration, /p_status in \('blocked','dead'\) then null/);
  assert.match(legalMigration, /masked_text = case/);
});

test("manglende juridisk databaseopsætning blokerer onboarding tydeligt", () => {
  assert.match(legalActionSource, /schemaReady/);
  assert.match(legalActionSource, /PGRST205/);
  assert.match(onboardingClientSource, /legalDocumentsReady/);
  assert.match(onboardingClientSource, /mangler databaseopsætning/);
});

test("admin kan ikke statistikfravaelge aktive medlemmer", () => {
  assert.match(rightsHolderActionSource, /opt_out_statistics: intendedMemberStatus \? false : input\.opt_out_statistics/);
  assert.match(rightsHolderActionSource, /intendedMemberStatus = input\.is_member \?\? affiliation\?\.is_member/);
  assert.match(rightsHolderActionSource, /statistics_participation: intendedMemberStatus \? true/);
  assert.match(rightsHolderAdminSource, /Aktive medlemmer indgår i foreningens statistikarbejde/);
  assert.match(rightsHolderAdminSource, /optOutStatistics = editForm\.is_member \? false : editForm\.opt_out_statistics/);
});
