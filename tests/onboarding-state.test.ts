import assert from "node:assert/strict";
import test from "node:test";
import { mustCompleteOnboarding, resolveOnboardingStatus } from "../lib/auth/onboarding-state";

test("bruger uden portalprofil har ingen onboarding", () => {
  assert.equal(resolveOnboardingStatus({ hasPortalUser: false }), "no_portal_user");
});

test("førstegangsbruger skal gennemføre onboarding", () => {
  const status = resolveOnboardingStatus({ hasPortalUser: true, completedAt: null });
  assert.equal(status, "first_time_required");
  assert.equal(mustCompleteOnboarding(status), true);
});

test("gennemført onboarding uden nyt krav giver adgang", () => {
  assert.equal(resolveOnboardingStatus({
    hasPortalUser: true,
    completedAt: "2026-08-01T10:00:00.000Z",
    requiredAt: null,
    lastSignInAt: "2026-08-08T10:00:00.000Z",
  }), "completed");
});

test("nyt krav aktiveres ikke i den eksisterende session", () => {
  const status = resolveOnboardingStatus({
    hasPortalUser: true,
    completedAt: "2026-08-01T10:00:00.000Z",
    requiredAt: "2026-08-08T10:00:00.000Z",
    lastSignInAt: "2026-08-08T09:00:00.000Z",
  });
  assert.equal(status, "reset_scheduled");
  assert.equal(mustCompleteOnboarding(status), false);
});

test("nyt krav aktiveres ved næste login", () => {
  const status = resolveOnboardingStatus({
    hasPortalUser: true,
    completedAt: "2026-08-01T10:00:00.000Z",
    requiredAt: "2026-08-08T10:00:00.000Z",
    lastSignInAt: "2026-08-08T10:00:00.000Z",
  });
  assert.equal(status, "reset_required");
  assert.equal(mustCompleteOnboarding(status), true);
});

test("en nyere gennemførelse ophæver et ældre krav", () => {
  assert.equal(resolveOnboardingStatus({
    hasPortalUser: true,
    completedAt: "2026-08-08T11:00:00.000Z",
    requiredAt: "2026-08-08T10:00:00.000Z",
    lastSignInAt: "2026-08-08T10:30:00.000Z",
  }), "completed");
});
