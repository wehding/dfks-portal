import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionSource = readFileSync("app/actions/member-works.ts", "utf8");
const migrationSource = readFileSync(
  "supabase/migrations/20260902223030_backfill_missing_member_work_share_cases.sql",
  "utf8",
);

test("known co-editors create the same pending share case as unmatched suggestions", () => {
  assert.match(actionSource, /linkedCoeditorAssignments/);
  assert.match(actionSource, /isEligibleWorkShareRole\(assignment\.role\)/);
  assert.match(actionSource, /const shareSuggestions = \[\.\.\.linkedSuggestions\.values\(\), \.\.\.pendingAdminSuggestions\]/);
  assert.match(actionSource, /registerShareSuggestions\([\s\S]*suggestions: shareSuggestions/);
  assert.match(actionSource, /Angiv din egen arbejdsandel, før medklippergennemgangen afsluttes/);
});

test("member co-editor mutations remain session and organisation scoped and audited", () => {
  assert.match(actionSource, /ensureOwnRightsHolder\(db, params\.rightsHolderId\)/);
  assert.match(actionSource, /\.eq\("org_id", orgId\)/);
  assert.match(actionSource, /component: "portal\.member_work_collaboration"/);
  assert.match(actionSource, /targetMemberUuids: \[ownHolder\.id, \.\.\.linkedRightsHolderIds\]/);
});

test("the Steen backfill is scoped, idempotent and creates pending participant tasks", () => {
  assert.match(migrationSource, /review\.rights_holder_id = 'b07a8e92-5b2f-4baa-9700-2b8b53f35090'::uuid/);
  assert.match(migrationSource, /review\.status = 'coeditors_reported'/);
  assert.match(migrationSource, /review\.work_share_case_id is null/);
  assert.match(migrationSource, /not exists \([\s\S]*from public\.work_share_cases existing_case/);
  assert.match(migrationSource, /'awaiting_members'/);
  assert.match(migrationSource, /then 'confirmed'[\s\S]*else 'pending'/);
  assert.match(migrationSource, /on conflict \(case_id, rights_holder_id\) where rights_holder_id is not null do nothing/);
  assert.match(migrationSource, /set[\s\S]*work_share_case_id = share_case\.id/);
});

test("the corrective backfill writes one content-free semantic audit event", () => {
  assert.match(migrationSource, /append_audit_event_v2/);
  assert.match(migrationSource, /'repair_known_coeditor_case_gap'/);
  assert.match(migrationSource, /p_target_member_uuids/);
  assert.doesNotMatch(migrationSource, /Børnesoldat|Motley|Putins|frontlinjen/i);
});
