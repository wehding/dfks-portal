import assert from "node:assert/strict";
import test from "node:test";
import { isDuplicateProfileName, normalizeRightsHolderName } from "../lib/rights-holder-name";

test("normaliserer casing og gentagne mellemrum ens", () => {
  assert.equal(normalizeRightsHolderName("  Lars   WISSING "), "lars wissing");
});

test("bevarer accenter som forskellige bogstaver", () => {
  assert.notEqual(normalizeRightsHolderName("Søren"), normalizeRightsHolderName("Soren"));
});

test("afviser eget hovednavn og eksisterende lokale varianter", () => {
  assert.equal(isDuplicateProfileName({ candidate: " Steen  Johannessen ", canonicalName: "Steen Johannessen", variants: [] }), true);
  assert.equal(isDuplicateProfileName({ candidate: "LARS WISSING", canonicalName: "Test Testsen", variants: ["Lars Wissing"] }), true);
  assert.equal(isDuplicateProfileName({ candidate: "En ny variant", canonicalName: "Test Testsen", variants: [] }), false);
});
