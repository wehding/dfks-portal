import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkEditorRole, resolveWorkEditorRelation } from "../lib/work-editor-roles";

test("Medklipper is normalised to the organisation default role", () => {
  assert.equal(normalizeWorkEditorRole("Medklipper", "Klipper"), "Klipper");
  assert.equal(normalizeWorkEditorRole("medklipper", "Klipper"), "Klipper");
});

test("special professional credits are preserved", () => {
  assert.equal(normalizeWorkEditorRole("B-klipper"), "B-klipper");
  assert.equal(normalizeWorkEditorRole("Supplerende klipper"), "Supplerende klipper");
  assert.equal(normalizeWorkEditorRole("Hovedklipper"), "Konceptuerende klipper");
});

test("member sees self as Klipper and another editor as Medklipper", () => {
  const self = resolveWorkEditorRelation({ view: "member", isSelf: true, editorCount: 2, storedRole: "B-klipper" });
  const other = resolveWorkEditorRelation({ view: "member", isSelf: false, editorCount: 2, storedRole: "B-klipper" });

  assert.equal(self.combinedLabel, "Klipper · B-klipper");
  assert.equal(other.combinedLabel, "Medklipper · B-klipper");
});

test("a single editor and neutral admin views only use Klipper", () => {
  const single = resolveWorkEditorRelation({ view: "member", isSelf: true, editorCount: 1, storedRole: "Klipper" });
  const admin = resolveWorkEditorRelation({ view: "admin", isSelf: false, editorCount: 2, storedRole: "Klipper" });

  assert.equal(single.combinedLabel, "Klipper");
  assert.equal(admin.combinedLabel, "Klipper");
});
