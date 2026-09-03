import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync("app/actions/admin-contract-work-queues.ts", "utf8");
const archive = readFileSync("app/admin/kontrakter/ContractArchiveClient.tsx", "utf8");
const editor = readFileSync("app/admin/kontrakter/[id]/rediger/ContractWorkbenchClient.tsx", "utf8");
const filtering = readFileSync("lib/server/admin-contract-filtering.ts", "utf8");
const workArchive = readFileSync("app/admin/vaerker/WorkArchiveClient.tsx", "utf8");
const taskButton = readFileSync("components/admin/archive-task-button.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260902201509_admin_contract_work_queues.sql", "utf8");

test("arbejdskøer er organisations- og brugerafgrænsede", () => {
  assert.match(action, /eq\("org_id", caller\.orgId\)/);
  assert.match(action, /eq\("created_by", caller\.userId\)/);
  assert.match(action, /gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(action, /input\.kind === "ownership" \|\| input\.kind === "missingOwner"/);
  assert.match(action, /modules\.contract_ownership\?\.write/);
  assert.match(action, /recordSensitiveFlow/);
});

test("køerne er stabile snapshots uden kontrakttekst og udløber efter 24 timer", () => {
  assert.match(migration, /expires_at timestamptz not null default \(now\(\) \+ interval '24 hours'\)/);
  assert.match(migration, /filter_context jsonb/);
  assert.doesNotMatch(migration, /contract_text|document_text|raw_search/);
  assert.match(action, /hasSearch: Boolean\(filters\.search\)/);
  assert.doesNotMatch(action, /filter_context:[\s\S]{0,400}search:/);
});

test("arkivet viser opgaver og opretter navigation uden synlige køknapper", () => {
  assert.match(archive, /fetchAdminContractTaskCounts/);
  for (const label of ["Afventer validering", "Ejerskab skal afklares", "Tilføj ejer", "Ulæste beskeder"]) assert.match(archive, new RegExp(label));
  assert.doesNotMatch(archive, /Åbn aktuel liste som kø|Start valideringskø|Start ejerskabskø|Åbn valgte som kø/);
  assert.match(action, /kind === "messages"/);
  assert.match(migration, /'messages'/);
  assert.doesNotMatch(archive, />Kladder</);
  assert.match(archive, /grid-cols-1[\s\S]{0,80}sm:grid-cols-2/);
  assert.match(action, /Promise\.allSettled/);
  assert.match(action, /Valideringsafklaring/);
  assert.match(action, /workflowKind: input\.kind/);
  assert.match(action, /ownershipTaskIds\(db, caller\.orgId, "missing"\)/);
  assert.match(action, /ownershipTaskIds\(db, caller\.orgId, "review"\)/);
  assert.match(editor, /queue\?\.kind === "validation"[\s\S]{0,180}Valideringsafklaring/);
});

test("editoren bevarer section og queueId og beskytter tastaturkontekst", () => {
  assert.match(editor, /next\.set\("section", nextTab\)/);
  assert.match(editor, /params\.set\("queueId", queueId\)/);
  assert.match(editor, /blocksContractArrowNavigation/);
  assert.match(editor, /Du har ændringer, der ikke er gemt/);
  assert.match(editor, /metaKey \|\| event\.ctrlKey/);
  assert.match(editor, /value="messages"/);
  assert.match(editor, /markContractCommentsRead\(contract\.id, "admin"\)/);
  assert.doesNotMatch(editor, /Start valideringskø|Start ejerskabskø|Vis kontraktkø/);
  assert.doesNotMatch(editor, /Ejerskab: \$\{item\.ownershipStatus\}|item\.contractStatus/);
  assert.match(editor, /item\.workTitle \?\? item\.contractTitle/);
});

test("kontraktarkivets søgning og valideringsfilter bruger det faktiske databaseskema", () => {
  assert.match(filtering, /org_affiliations!inner\(org_id\)/);
  assert.match(filtering, /eq\("org_affiliations\.org_id", orgId\)/);
  assert.doesNotMatch(filtering, /from\("rettighedshavere"\)[\s\S]{0,120}\.eq\("org_id", orgId\)/);
  assert.doesNotMatch(filtering, /from\("employers"\)[^,\n]+?\.eq\("org_id"/);
  assert.doesNotMatch(filtering, /works\(id, type, is_season_group/);
  assert.doesNotMatch(filtering, /work\.is_season_group/);
  assert.doesNotMatch(filtering, /candidate\.solo_confirmed/);
  assert.doesNotMatch(filtering, /episode_numbers,\s*solo_confirmed/);
  assert.match(filtering, /hasResolvedShareDistribution/);
  assert.match(filtering, /hasCompleteAssignmentDistribution/);
  assert.doesNotMatch(filtering, /worksWithMultipleEditors|worksWithShareCases/);
});

test("værks- og kontraktarkivet bruger samme opgavepræsentation", () => {
  assert.match(archive, /ArchiveTaskButton/);
  assert.match(workArchive, /ArchiveTaskButton/);
  assert.match(workArchive, /Mangler afstemning af arbejdsandele/);
  assert.match(taskButton, /tone\?: "amber" \| "blue"/);
  assert.match(taskButton, /count === 0/);
});
