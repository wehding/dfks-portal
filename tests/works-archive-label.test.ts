import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const visibleAdminFiles = [
  "lib/i18n.tsx",
  "lib/admin-help.ts",
  "app/admin/vaerker/WorkArchiveClient.tsx",
  "app/actions/work-identity.ts",
  "app/actions/work-collaboration-reviews.ts",
  "components/admin/work-share-reconciliation-wizard.tsx",
];

test("viser Værksarkiv uden gamle adminbetegnelser", () => {
  const content = visibleAdminFiles.map(path => readFileSync(path, "utf8")).join("\n");
  assert.match(content, /Værksarkiv/);
  assert.doesNotMatch(content, /Værksadmin|Værksadministration/i);
});
