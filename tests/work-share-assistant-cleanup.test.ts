import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("den afgrænsede reparation fjerner kun klippeassistenter fra Præsidentens aktive sag", () => {
  const migration = readFileSync("supabase/migrations/20260831211639_exclude_ineligible_work_share_roles.sql", "utf8");
  assert.match(migration, /lower\(trim\(work\.title\)\)\s*=\s*lower\('Præsidenten'\)/);
  assert.match(migration, /participant\.excluded_at\s+is\s+null/);
  assert.match(migration, /klippeassistent\|klipperassistent\|assistant editor\|assistant klipper/);
  assert.doesNotMatch(migration, /delete\s+from/i);
  assert.doesNotMatch(migration, /work_assignments/i);
});

test("kildeopdatering frasorterer uegnede roller og respekterer tidligere fravalg", () => {
  const action = readFileSync("app/actions/work-share-cases.ts", "utf8");
  assert.match(action, /newlyIneligible/);
  assert.match(action, /isEligibleWorkShareRole\(row\.role\)/);
  assert.match(action, /excludedHolderIds/);
  assert.match(action, /excludedNames/);
});
