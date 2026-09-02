import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageHeader = readFileSync("components/page-header.tsx", "utf8");
const metadata = readFileSync("components/page-metadata.tsx", "utf8");
const adminShell = readFileSync("components/admin/admin-shell-client.tsx", "utf8");
const portalShell = readFileSync("components/portal/portal-shell-client.tsx", "utf8");

test("autentificerede sider afleverer titel og underoverskrift til topbjælken", () => {
  assert.match(pageHeader, /usePageMetadata\(title, subtitle \?\? null\)/);
  assert.match(metadata, /PageMetadataContext/);
  assert.match(adminShell, /pageMetadata\.title/);
  assert.match(adminShell, /currentPageSubtitle/);
  assert.match(portalShell, /pageMetadata\.title/);
  assert.match(portalShell, /currentPageSubtitle/);
});

test("sidetitlen gentages ikke synligt i sidekroppen", () => {
  assert.match(pageHeader, /<h2 className="sr-only">/);
  assert.doesNotMatch(pageHeader, /text-2xl|text-3xl/);
});
