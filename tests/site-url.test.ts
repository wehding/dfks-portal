import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfiguredSiteUrl } from "../lib/site-url";

test("produktionslinks kræver en konfigureret HTTPS-origin", () => {
  assert.equal(resolveConfiguredSiteUrl({ nodeEnv: "production" }), null);
  assert.equal(resolveConfiguredSiteUrl({ nodeEnv: "production", siteUrl: "http://portal.example" }), null);
  assert.equal(resolveConfiguredSiteUrl({ nodeEnv: "production", siteUrl: "https://portal.example/path" }), "https://portal.example");
});

test("lokal udvikling får en fast localhost-fallback", () => {
  assert.equal(resolveConfiguredSiteUrl({ nodeEnv: "development" }), "http://localhost:3000");
  assert.equal(resolveConfiguredSiteUrl({ nodeEnv: "development", siteUrl: "http://127.0.0.1:3001/test" }), "http://127.0.0.1:3001");
});
