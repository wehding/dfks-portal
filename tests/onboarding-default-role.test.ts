import assert from "node:assert/strict";
import test from "node:test";
import { resolveDefaultRole, resolveDefaultRoleLabel, resolveTerminology } from "../lib/branding";

test("foretrækker organisationens eksplicitte standardrolle", () => {
  assert.equal(resolveDefaultRoleLabel(["Klipper", "B-klipper"], "B-klipper"), "B-klipper");
});

test("ældre DFKS-lister vælger Klipper uanset rækkefølge", () => {
  assert.equal(resolveDefaultRole({ terminology: { role_labels: ["B-klipper", "Klipper"] } }), "Klipper");
});

test("falder tilbage til første organisationsrolle uden Klipper", () => {
  assert.equal(resolveDefaultRoleLabel(["Dramatiker", "Instruktør"], null), "Dramatiker");
});

test("Medklipper kan ikke tilbydes som en gemt fagrolle", () => {
  const terminology = resolveTerminology({
    terminology: {
      member_word: "medlem",
      coeditor_word: "Medklipper",
      role_labels: ["Klipper", "Medklipper", "B-klipper"],
      default_role_label: "Klipper",
      onboarding_keywords: ["klip"],
    },
  });
  assert.deepEqual(terminology.role_labels, ["Klipper", "B-klipper"]);
  assert.equal(terminology.default_role_label, "Klipper");
});
