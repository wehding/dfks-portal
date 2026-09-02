import assert from "node:assert/strict";
import test from "node:test";
import { resolveOnboardingFirstStep } from "../lib/onboarding-navigation";

test("førstegangs-onboarding starter ved velkomsttrinnet", () => {
  assert.equal(resolveOnboardingFirstStep(false), 1);
});

test("administrativt nulstillet onboarding starter hele forløbet forfra", () => {
  assert.equal(resolveOnboardingFirstStep(true), 1);
});
