import test from "node:test";
import assert from "node:assert/strict";
import { attachmentChanges } from "../lib/attachment-ai";

test("allonge comparison reports changes without mutating parent payment data", () => {
  const parent = { salary: 10_000, workingWeeks: 8, rightsOverview: { tv: 1 } };
  const snapshot = structuredClone(parent);
  const result = attachmentChanges(parent, { salary: 12_000, workingWeeks: 8, rightsOverview: { tv: 2 } });
  assert.deepEqual(parent, snapshot);
  assert.deepEqual(result.changes.map(change => change.field), ["salary", "rightsOverview"]);
  assert.equal(result.extracted.salary, 12_000);
});
