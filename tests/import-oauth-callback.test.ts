import assert from "node:assert/strict";
import test from "node:test";
import { importOAuthCallbackOrigin } from "../lib/import-oauth-callback";

test("bruger localhost callback ved lokal adgang gennem Tailscale", () => {
  assert.equal(
    importOAuthCallbackOrigin("http://100.112.99.59:3000", { NODE_ENV: "development" }),
    "http://localhost:3000",
  );
});

test("bevarer den lokale udviklingsservers port", () => {
  assert.equal(
    importOAuthCallbackOrigin("http://127.0.0.1:3100", { NODE_ENV: "development" }),
    "http://localhost:3100",
  );
});

test("bruger den kanoniske produktionsadresse på Vercel", () => {
  assert.equal(
    importOAuthCallbackOrigin("https://dfks-portal-git-test.vercel.app", {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://dfks-portal-hazel.vercel.app/",
    }),
    "https://dfks-portal-hazel.vercel.app",
  );
});

test("en eksplicit callback-adresse har forrang", () => {
  assert.equal(
    importOAuthCallbackOrigin("https://dfks-portal-hazel.vercel.app", {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      IMPORT_OAUTH_CALLBACK_ORIGIN: "https://preview.example.dk/path",
    }),
    "https://preview.example.dk",
  );
});

test("afviser ikke-http callback-adresser", () => {
  assert.throws(
    () => importOAuthCallbackOrigin("https://example.dk", {
      IMPORT_OAUTH_CALLBACK_ORIGIN: "javascript:alert(1)",
    }),
    /gyldig http- eller https-adresse/,
  );
});
