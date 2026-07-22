import test from "node:test";
import assert from "node:assert/strict";
import { isPlausibleBankAccount, isValidCpr, isValidDanishPhone, normalizeBankAccount, normalizeCpr, normalizeDanishPhone } from "../lib/onboarding-validation";

test("CPR accepts an optional hyphen and rejects impossible dates", () => {
  assert.equal(normalizeCpr("010190-1234"), "0101901234");
  assert.equal(isValidCpr("010190-1234"), true);
  assert.equal(isValidCpr("310290-1234"), false);
});

test("Danish telephone normalization accepts +45 and 0045", () => {
  assert.equal(isValidDanishPhone("+45 12 34 56 78"), true);
  assert.equal(normalizeDanishPhone("0045 12 34 56 78"), "+4512345678");
  assert.equal(isValidDanishPhone("123"), false);
});

test("bank account validation is explicitly only a length plausibility check", () => {
  assert.equal(normalizeBankAccount("1234-1234567"), "12341234567");
  assert.equal(isPlausibleBankAccount("1234-1234567"), true);
  assert.equal(isPlausibleBankAccount("123"), false);
});
