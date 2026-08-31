import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWorkShareQueue, paginateWorkShareQueue, type WorkShareQueueReference } from "../lib/work-share-admin-queue";

const references: WorkShareQueueReference[] = [
  { kind: "share", id: "case-1", workId: "work-1", title: "Sommerdahl", seasonNumber: 5, episodeNumber: null, participantCount: 3, missingResponseCount: 1, unresolvedCount: 1, updatedAt: "2026-08-20T12:00:00Z" },
  { kind: "dispute", id: "dispute-1", workId: "work-1", title: "Sommerdahl", seasonNumber: 5, episodeNumber: null, participantCount: 0, missingResponseCount: 0, unresolvedCount: 0, updatedAt: "2026-08-21T12:00:00Z" },
  { kind: "share", id: "case-2", workId: "work-2", title: "Felix og Åmanden", seasonNumber: null, episodeNumber: null, participantCount: 2, missingResponseCount: 0, unresolvedCount: 0, updatedAt: "2026-08-19T12:00:00Z" },
];

test("køen deduplikerer sag og indsigelse pr. værk og scope", () => {
  const rows = buildWorkShareQueue(references);
  assert.equal(rows.length, 2);
  const summerdahl = rows.find(row => row.workId === "work-1");
  assert.equal(summerdahl?.caseId, "case-1");
  assert.deepEqual(summerdahl?.disputeIds, ["dispute-1"]);
  assert.equal(summerdahl?.hasDispute, true);
});

test("køen søger, filtrerer og paginerer uden detaljefelter", () => {
  const page = paginateWorkShareQueue({ references, page: 1, pageSize: 20, search: "sommer", taskType: "unresolved" });
  assert.equal(page.filteredCount, 1);
  assert.equal(page.rows[0]?.title, "Sommerdahl");
  assert.equal("email" in page.rows[0], false);
  assert.equal("participants" in page.rows[0], false);
});

test("værksarkivet bruger URL-styret fane uden arbejdsandelsdialog", () => {
  const archive = readFileSync("app/admin/vaerker/WorkArchiveClient.tsx", "utf8");
  const page = readFileSync("app/admin/vaerker/page.tsx", "utf8");
  const tab = readFileSync("components/admin/work-share-reconciliation-tab.tsx", "utf8");
  assert.match(archive, /arbejdsandele/);
  assert.doesNotMatch(archive, /shareTasksOpen/);
  assert.match(page, /fetchAdminShareQueue/);
  assert.match(tab, /shareTask/);
  assert.match(tab, /Tilbage til køen|works\.shareQueue\.back/);
});

test("kø- og detaljelæsning auditeres uden søgetekst eller procentdata", () => {
  const actions = readFileSync("app/actions/work-share-cases.ts", "utf8");
  assert.match(actions, /auditShareRead/);
  assert.match(actions, /targetMemberUuid/);
  assert.doesNotMatch(actions, /metadata:\s*\{[^}]*search/);
  assert.doesNotMatch(actions, /metadata:\s*\{[^}]*(percent|email|phone)/i);
});
