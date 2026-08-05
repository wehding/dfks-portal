import assert from "node:assert/strict";
import test from "node:test";
import { isRightBearingOnboardingRole } from "../lib/onboarding-credit-role";

test("bevarer almindelige klipperkrediteringer", () => {
  assert.equal(isRightBearingOnboardingRole("Klipper"), true);
  assert.equal(isRightBearingOnboardingRole("Film Editor"), true);
});

test("fjerner pilot-, trailer- og konsulentkrediteringer", () => {
  for (const role of [
    "Pilot klipper",
    "Pilotklipper",
    "Pilotklip",
    "Trailer klipper",
    "Trailerklipper",
    "Klippekonsulent",
    "Klip konsulent",
    "Editing Consultant",
    "Consulting Editor",
  ]) {
    assert.equal(isRightBearingOnboardingRole(role), false, role);
  }
});
