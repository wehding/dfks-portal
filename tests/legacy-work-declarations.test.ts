import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { qualifiesForLegacyDeclaration, resolveWorkArchiveDocumentationState, resolveWorkDocumentationStatus } from "../lib/work-documentation";

test("2015 qualifies and 2016 does not at a 2016 cutoff", () => {
  assert.equal(qualifiesForLegacyDeclaration({ enabled: true, cutoffYear: 2016, premiereYear: 2015, productionYear: null }), true);
  assert.equal(qualifiesForLegacyDeclaration({ enabled: true, cutoffYear: 2016, premiereYear: 2016, productionYear: null }), false);
});

test("either premiere or production year can qualify", () => {
  assert.equal(qualifiesForLegacyDeclaration({ enabled: true, cutoffYear: 2016, premiereYear: 2020, productionYear: 2014 }), true);
  assert.equal(qualifiesForLegacyDeclaration({ enabled: false, cutoffYear: 2016, premiereYear: 2014, productionYear: 2014 }), false);
});

test("contract takes precedence and missing dates remain actionable", () => {
  assert.equal(resolveWorkDocumentationStatus({ hasContract: true, hasActiveDeclaration: false, enabled: true, cutoffYear: 2016, premiereYear: 2010, productionYear: null }), "contract_documented");
  assert.equal(resolveWorkDocumentationStatus({ hasContract: false, hasActiveDeclaration: false, enabled: true, cutoffYear: 2016, premiereYear: null, productionYear: null }), "date_required");
  assert.equal(resolveWorkDocumentationStatus({ hasContract: false, hasActiveDeclaration: true, enabled: true, cutoffYear: 2016, premiereYear: 2015, productionYear: null }), "legacy_declared");
});

test("migration keeps bulk acceptance atomic, scoped and server-only", () => {
  const sql = readFileSync("supabase/migrations/20260902193200_legacy_work_declarations.sql", "utf8");
  assert.match(sql, /qualifying_scope_ids_snapshot uuid\[\] not null/);
  assert.match(sql, /p_batch_id uuid/);
  assert.match(sql, /append_audit_event_v2/);
  assert.match(sql, /p_target_member_uuids => array\[p_rights_holder_id\]/);
  assert.match(sql, /revoke all on function public\.accept_member_legacy_declarations[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.accept_member_legacy_declarations[\s\S]*to service_role/);
  assert.match(sql, /work\.year < config\.cutoff_year/);
  assert.match(sql, /work\.production_year < config\.cutoff_year/);
});

test("declaration is not part of onboarding documents", () => {
  const legal = readFileSync("lib/legal-documents.ts", "utf8");
  const onboarding = legal.match(/ONBOARDING_LEGAL_DOCUMENT_TYPES = \[([\s\S]*?)\] as const/)?.[1] ?? "";
  assert.doesNotMatch(onboarding, /legacy_work_declaration/);
  assert.match(legal, /legacy_work_declaration/);
});

test("member rejection creates review and does not create a declaration", () => {
  const sql = readFileSync("supabase/migrations/20260902193200_legacy_work_declarations.sql", "utf8");
  const rejectBody = sql.match(/create or replace function public\.reject_member_legacy_declaration_task([\s\S]*?)revoke all on function public\.reject_member_legacy_declaration_task/)?.[1] ?? "";
  assert.match(rejectBody, /insert into public\.work_change_requests/);
  assert.match(rejectBody, /relationship_disputed/);
  assert.doesNotMatch(rejectBody, /insert into public\.legacy_work_declarations/);
});

test("værksarkiv viser Mangler erklæring før 2016 og Erklæring afgivet når den er afgivet", () => {
  const pre2016Missing = resolveWorkArchiveDocumentationState({
    contractCount: 0,
    isMissing: true,
    year: 2014,
    hasDeclaration: false,
  });
  assert.equal(pre2016Missing.kind, "missing_declaration");
  assert.equal(pre2016Missing.label, "Mangler erklæring");

  const pre2016Declared = resolveWorkArchiveDocumentationState({
    contractCount: 0,
    isMissing: true,
    year: 2014,
    hasDeclaration: true,
  });
  assert.equal(pre2016Declared.kind, "declared");
  assert.equal(pre2016Declared.label, "Erklæring afgivet");

  const post2016Missing = resolveWorkArchiveDocumentationState({
    contractCount: 0,
    isMissing: true,
    year: 2018,
    hasDeclaration: false,
  });
  assert.equal(post2016Missing.kind, "missing_contract");
  assert.equal(post2016Missing.label, "Mangler kontrakt");

  const withContract = resolveWorkArchiveDocumentationState({
    contractCount: 2,
    isMissing: false,
    year: 2014,
    hasDeclaration: false,
  });
  assert.equal(withContract.kind, "contracts");
  assert.equal(withContract.label, "2 kontrakter");
});

test("mine værker placerer serie fold-ud-pilen til højre for plakatikonet", () => {
  const file = readFileSync("app/portal/mine-vaerker/MineVaerkerClient.tsx", "utf8");
  const posterIndex = file.indexOf("aria-label={isSeriesParent ? `Rediger ${w.title} sæson ${w.season_number}` : `Rediger ${w.title}`}");
  const triggerIndex = file.indexOf("<ExpandableListTrigger expanded={isExpanded} onToggle={() => void toggleSeries(w)}");
  assert.ok(posterIndex > 0, "plakatknap skal findes i MineVaerkerClient.tsx");
  assert.ok(triggerIndex > 0, "ExpandableListTrigger skal findes i MineVaerkerClient.tsx");
  assert.ok(posterIndex < triggerIndex, "plakatikonet skal stå før fold-ud-pilen så ikonerne flugter");
});

test("kontraktvisning og redigering anvender Konverteret PDF i stedet for Kommenteret PDF", () => {
  const archive = readFileSync("app/admin/kontrakter/ContractArchiveClient.tsx", "utf8");
  const workbench = readFileSync("app/admin/kontrakter/[id]/rediger/ContractWorkbenchClient.tsx", "utf8");
  const lib = readFileSync("lib/contract-workbench.ts", "utf8");

  assert.match(archive, />Konverteret PDF</);
  assert.doesNotMatch(archive, />Kommenteret PDF</);

  assert.match(workbench, /Konverteret PDF/);
  assert.doesNotMatch(workbench, /Kommenteret PDF/);

  assert.match(lib, /Konverteret PDF klar/);
  assert.doesNotMatch(lib, /Kommenteret PDF klar/);
});

