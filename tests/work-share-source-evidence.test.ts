import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeWorkShareSourceEvidence } from "../lib/work-share-source-evidence";

test("medlemskilde bevares når eksterne kilder tilføjes", () => {
  const result = mergeWorkShareSourceEvidence({
    existingTags: ["member"],
    existingDetails: { reportedByRightsHolderId: "holder-a" },
    incomingTags: ["tmdb", "dfi"],
    incomingDetails: { externalPersonIds: ["tmdb:12"], matchType: "exact_name" },
  });

  assert.deepEqual(result.sourceTags, ["dfi", "member", "tmdb"]);
  assert.deepEqual(result.sourceDetails, {
    reportedByRightsHolderId: "holder-a",
    externalPersonIds: ["tmdb:12"],
    matchType: "exact_name",
  });
});

test("nye kendte og ukendte medlemsforslag gemmer indberetteren", () => {
  const source = readFileSync("lib/server/work-share-cases.ts", "utf8");
  const occurrences = source.match(/source_details: \{ reportedByRightsHolderId: params\.actorRightsHolderId \}/g) ?? [];
  assert.equal(occurrences.length, 2);
  assert.match(source, /source_tags: \["member"\]/);
});

test("reparationsmigrationen retter også allerede taggede rækker og er idempotent", () => {
  const migration = readFileSync("supabase/migrations/20260831140754_repair_member_reporter_source_details.sql", "utf8");
  assert.match(migration, /source_details\s*->>\s*'reportedByRightsHolderId'/);
  assert.match(migration, /is distinct from participant\.invited_by_rights_holder_id::text/);
  assert.match(migration, /jsonb_build_object\([\s\S]*'reportedByRightsHolderId'/);
  assert.match(migration, /participant\.invited_by_rights_holder_id is not null/);
});
