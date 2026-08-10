import assert from "node:assert/strict";
import test from "node:test";
import { googleDriveOAuthCredentials } from "../lib/import-oauth-environment";

test("bruger særskilte Google-klienter til admin og medlem", () => {
  const environment = {
    GOOGLE_DRIVE_ADMIN_CLIENT_ID: "admin-id",
    GOOGLE_DRIVE_ADMIN_CLIENT_SECRET: "admin-secret",
    GOOGLE_DRIVE_MEMBER_CLIENT_ID: "member-id",
    GOOGLE_DRIVE_MEMBER_CLIENT_SECRET: "member-secret",
  };
  assert.deepEqual(googleDriveOAuthCredentials("organisation", environment), { clientId: "admin-id", clientSecret: "admin-secret" });
  assert.deepEqual(googleDriveOAuthCredentials("member", environment), { clientId: "member-id", clientSecret: "member-secret" });
});

test("falder ikke tilbage til den anden klients hemmeligheder", () => {
  assert.throws(
    () => googleDriveOAuthCredentials("member", {
      GOOGLE_DRIVE_ADMIN_CLIENT_ID: "admin-id",
      GOOGLE_DRIVE_ADMIN_CLIENT_SECRET: "admin-secret",
    }),
    /medlemmer er ikke konfigureret/,
  );
});

test("afviser tomme værdier", () => {
  assert.throws(
    () => googleDriveOAuthCredentials("organisation", {
      GOOGLE_DRIVE_ADMIN_CLIENT_ID: "  ",
      GOOGLE_DRIVE_ADMIN_CLIENT_SECRET: "secret",
    }),
    /organisationen er ikke konfigureret/,
  );
});
