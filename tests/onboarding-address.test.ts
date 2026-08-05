import assert from "node:assert/strict";
import test from "node:test";
import { parseOnboardingAddress } from "../lib/onboarding-address";

test("opdeler adresse med komma", () => {
  assert.deepEqual(parseOnboardingAddress("Nørrebrogade 42, 2200 København N"), {
    street: "Nørrebrogade 42",
    postalCode: "2200",
    city: "København N",
  });
});

test("opdeler Foreninglet-adresse uden komma", () => {
  assert.deepEqual(parseOnboardingAddress("Nørrebrogade 42 2200 København N"), {
    street: "Nørrebrogade 42",
    postalCode: "2200",
    city: "København N",
  });
});

test("bevarer etage og side i vejfeltet", () => {
  assert.deepEqual(parseOnboardingAddress("Nørrebrogade 42, 3. tv., 2200 København N"), {
    street: "Nørrebrogade 42, 3. tv.",
    postalCode: "2200",
    city: "København N",
  });
});

test("bevarer en adresse uden postnummer som vejfelt", () => {
  assert.deepEqual(parseOnboardingAddress("Nørrebrogade 42"), {
    street: "Nørrebrogade 42",
    postalCode: "",
    city: "",
  });
});
