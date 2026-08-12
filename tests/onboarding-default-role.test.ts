import assert from "node:assert/strict";
import test from "node:test";
import { resolveDefaultRole, resolveDefaultRoleLabel } from "../lib/branding";

test("foretrækker organisationens eksplicitte standardrolle", () => {
  assert.equal(resolveDefaultRoleLabel(["Klipper", "B-klipper"], "B-klipper"), "B-klipper");
});

test("ældre DFKS-lister vælger Klipper uanset rækkefølge", () => {
  assert.equal(resolveDefaultRole({ terminology: { role_labels: ["B-klipper", "Klipper"] } }), "Klipper");
});

test("falder tilbage til første organisationsrolle uden Klipper", () => {
  assert.equal(resolveDefaultRoleLabel(["Dramatiker", "Instruktør"], null), "Dramatiker");
});
