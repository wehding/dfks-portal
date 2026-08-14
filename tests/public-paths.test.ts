import assert from "node:assert/strict";
import test from "node:test";
import { isPublicPath } from "../lib/auth/public-paths";

test("lader kun de kendte drev-callbacks passere testadgangsfilteret", () => {
  assert.equal(isPublicPath("/api/admin/import-connections/google_drive/callback"), true);
  assert.equal(isPublicPath("/api/admin/import-connections/onedrive/callback"), true);
  assert.equal(isPublicPath("/api/admin/import-connections/dropbox/callback"), true);
  assert.equal(isPublicPath("/api/admin/import-connections/google_drive/authorize"), false);
  assert.equal(isPublicPath("/api/admin/import-connections/unknown/callback"), false);
});

test("lader kun kontraktworkerens præcise route passere invite-gaten", () => {
  assert.equal(isPublicPath("/api/contracts/jobs/process"), true);
  assert.equal(isPublicPath("/api/contracts/jobs/process/ekstra"), false);
  assert.equal(isPublicPath("/api/contracts/jobs/process-ukendt"), false);
});
