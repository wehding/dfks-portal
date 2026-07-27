import assert from "node:assert/strict";
import test from "node:test";
import { mergeCvrLegalEntity, resolveProducerStatus } from "../lib/admin-producers";

test("producentstatus prioriterer kladder over øvrig aktivitet", () => {
  assert.equal(resolveProducerStatus(["valideret", "kladde"], 2), "attention");
  assert.equal(resolveProducerStatus(["valideret"], 0), "active");
  assert.equal(resolveProducerStatus([], 1), "active");
  assert.equal(resolveProducerStatus([], 0), "inactive");
});

test("første CVR-match udfylder navngivet kladde uden at oprette en ekstra enhed", () => {
  const result = mergeCvrLegalEntity(
    [{ registrationNumber: "", legalName: "Made in Valby", isPrimary: true }],
    [{ registrationNumber: "12345678", legalName: "Made in Valby ApS", isPrimary: false }][0],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].legalName, "Made in Valby ApS");
  assert.equal(result[0].registrationNumber, "12345678");
  assert.equal(result[0].isPrimary, true);
});

test("eksisterende juridisk enhed med samme CVR opdateres uden dublet", () => {
  const result = mergeCvrLegalEntity(
    [{ id: "entity-1", registrationNumber: "12 34 56 78", legalName: "Gammelt navn", isPrimary: true }],
    [{ registrationNumber: "12345678", legalName: "Nyt navn ApS", isPrimary: false }][0],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "entity-1");
  assert.equal(result[0].legalName, "Nyt navn ApS");
});

test("nyt CVR tilføjes når alle eksisterende enheder allerede har CVR", () => {
  const result = mergeCvrLegalEntity(
    [{ id: "entity-1", registrationNumber: "12345678", legalName: "Første ApS", isPrimary: true }],
    [{ registrationNumber: "87654321", legalName: "Anden ApS", isPrimary: false }][0],
  );
  assert.equal(result.length, 2);
  assert.equal(result[1].isPrimary, false);
});
