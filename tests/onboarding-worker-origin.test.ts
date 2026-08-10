import assert from "node:assert/strict";
import test from "node:test";
import { resolveOnboardingWorkerOrigin } from "../lib/onboarding-worker-origin";

test("bruger kun loopback lokalt", () => {
  assert.equal(resolveOnboardingWorkerOrigin({ nodeEnv: "development", siteUrl: "https://example.com" }), "http://127.0.0.1:3000");
});

test("accepterer Vercels serverbeskyttede deployment-host", () => {
  assert.equal(resolveOnboardingWorkerOrigin({ nodeEnv: "production", vercelUrl: "dfks-portal-abc.vercel.app" }), "https://dfks-portal-abc.vercel.app");
});

test("afviser usikre eller ugyldige production-origins", () => {
  assert.equal(resolveOnboardingWorkerOrigin({ nodeEnv: "production", siteUrl: "http://example.com" }), null);
  assert.equal(resolveOnboardingWorkerOrigin({ nodeEnv: "production", vercelUrl: "evil.example", siteUrl: "not-a-url" }), null);
});
