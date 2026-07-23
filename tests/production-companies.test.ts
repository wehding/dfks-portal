import test from "node:test";
import assert from "node:assert/strict";
import {
  companyMatches,
  normalizeCompanyName,
  normalizeRegistrationNumber,
  uniqueCompanySelections,
  validateRegistrationNumber,
  type ProductionCompanyOption,
} from "../lib/production-companies";

const option: ProductionCompanyOption = {
  employerId: "canonical-1",
  canonicalName: "Nordisk Film",
  aliases: ["Nordisk Film Production"],
  isVerified: true,
  legalEntities: [
    { id: "legal-1", legalName: "Nordisk Film Production A/S", registrationCountry: "DK", registrationType: "CVR", registrationNumber: "12345678", entityKind: "company", isPrimary: true, registrationStatus: "NORMAL" },
    { id: "legal-2", legalName: "Filmprojekt 2026 ApS", registrationCountry: "DK", registrationType: "CVR", registrationNumber: "87654321", entityKind: "spv", isPrimary: false, registrationStatus: "NORMAL" },
  ],
};

test("normaliserer selskabsnavne og danske CVR-numre", () => {
  assert.equal(normalizeCompanyName("  Nordisk–Film A/S  "), "nordisk film a s");
  assert.equal(normalizeRegistrationNumber("12 34-56 78"), "12345678");
  assert.deepEqual(validateRegistrationNumber("12345678"), { valid: true, normalized: "12345678" });
  assert.equal(validateRegistrationNumber("1234").valid, false);
});

test("finder kanonisk navn, alias, juridisk navn og hvert CVR under samme selskab", () => {
  assert.equal(companyMatches(option, "Nordisk Film"), true);
  assert.equal(companyMatches(option, "Production"), true);
  assert.equal(companyMatches(option, "Filmprojekt 2026"), true);
  assert.equal(companyMatches(option, "8765 4321"), true);
  assert.equal(companyMatches(option, "Andet selskab"), false);
});

test("bevarer flere CVR-enheder under samme kanoniske selskab uden dubletvalg", () => {
  const selections = uniqueCompanySelections([
    { employerId: "canonical-1", legalEntityId: "legal-1", canonicalName: "Nordisk Film" },
    { employerId: "canonical-1", legalEntityId: "legal-2", canonicalName: "Nordisk Film" },
    { employerId: "canonical-1", legalEntityId: "legal-1", canonicalName: "Nordisk Film" },
  ]);
  assert.equal(selections.length, 2);
  assert.deepEqual(selections.map(selection => selection.legalEntityId), ["legal-1", "legal-2"]);
});

