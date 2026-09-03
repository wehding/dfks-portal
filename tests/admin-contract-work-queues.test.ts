import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync("app/actions/admin-contract-work-queues.ts", "utf8");
const archive = readFileSync("app/admin/kontrakter/ContractArchiveClient.tsx", "utf8");
const editor = readFileSync("app/admin/kontrakter/[id]/rediger/ContractWorkbenchClient.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260902201509_admin_contract_work_queues.sql", "utf8");

test("arbejdskøer er organisations- og brugerafgrænsede", () => {
  assert.match(action, /eq\("org_id", caller\.orgId\)/);
  assert.match(action, /eq\("created_by", caller\.userId\)/);
  assert.match(action, /gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(action, /requireQueueCaller\(input\.kind === "ownership"\)/);
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
  for (const label of ["Afventer validering", "Ejerskab skal afklares", "Ulæste beskeder"]) assert.match(archive, new RegExp(label));
  assert.doesNotMatch(archive, /Åbn aktuel liste som kø|Start valideringskø|Start ejerskabskø|Åbn valgte som kø/);
  assert.match(action, /kind === "messages"/);
  assert.match(migration, /'messages'/);
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
});
