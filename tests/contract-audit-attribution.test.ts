import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveAdminMessageAuditTargets } from "../lib/admin-message-audit-targets";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("sletning af historiske kontraktbeskeder auditerer den stabile deltager", () => {
  const previousOwner = "10000000-0000-4000-8000-000000000001";
  const currentOwner = "20000000-0000-4000-8000-000000000002";

  assert.deepEqual(resolveAdminMessageAuditTargets([
    { member_rights_holder_id: previousOwner },
    { member_rights_holder_id: previousOwner },
  ], currentOwner), [previousOwner]);
  assert.deepEqual(resolveAdminMessageAuditTargets([
    { member_rights_holder_id: previousOwner },
    { member_rights_holder_id: currentOwner },
  ], currentOwner), [previousOwner, currentOwner]);
  assert.deepEqual(resolveAdminMessageAuditTargets([
    { member_rights_holder_id: null },
  ], currentOwner), [currentOwner]);
  assert.deepEqual(resolveAdminMessageAuditTargets([], currentOwner), []);
});

test("beskedsletning læser og låser auditmål til de faktisk slettede rækker", () => {
  const action = source("app/actions/admin-messages.ts");
  assert.match(action, /target\.table === "contract_comments"[\s\S]*"id,member_rights_holder_id"/);
  assert.match(action, /resolveAdminMessageAuditTargets\(rows, target\.targetMemberUuid\)/);
  assert.match(action, /\.in\("id", messageIds\)/);
  assert.ok((action.match(/targetMemberUuids: affected\.targetMemberUuids/g) ?? []).length === 2);
});

test("den fælles kontrakteditor auditerer jurist og admin med deres faktiske rolle", () => {
  const action = source("app/actions/member-contracts.ts");
  assert.match(action, /async function staffRoleForOrg[\s\S]*highestStaffRole/);
  assert.match(action, /const staffRole = await staffRoleForOrg\(db, user\.id, contract\.org_id\)/);
  assert.match(action, /admin\.contracts\.validation[\s\S]*role: staffRole|role: staffRole[\s\S]*admin\.contracts\.validation/);
  assert.match(action, /admin\.contracts\.editor[\s\S]*role: staffRole|role: staffRole[\s\S]*admin\.contracts\.editor/);
  assert.match(action, /actorRole: staffRole/);
  assert.match(action, /let actorRole: "member" \| StaffRole = "member"/);
  assert.doesNotMatch(action, /role: isOwnContract \? "member" : "admin"/);
  assert.doesNotMatch(action, /role: "admin" \}, "admin", "admin\.contracts/);

  const adminAuditBlocks = [...action.matchAll(/createServiceClient\(\{ audit: \{([\s\S]*?)\}\s*\}\)/g)]
    .map(match => match[1])
    .filter(block => block.includes('source: "admin"'));
  assert.ok(adminAuditBlocks.length >= 5);
  for (const block of adminAuditBlocks) assert.match(block, /actorRole(?:\s*:|\s*,)/);
});
