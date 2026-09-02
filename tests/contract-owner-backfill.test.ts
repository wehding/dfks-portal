import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260902180312_contract_owner_backfill_runs.sql"), "utf8");
const actions = fs.readFileSync(path.join(root, "app/actions/contract-owner-backfill.ts"), "utf8");
const server = fs.readFileSync(path.join(root, "lib/server/contract-owner-backfill.ts"), "utf8");
const panel = fs.readFileSync(path.join(root, "components/admin/contract-owner-backfill-panel.tsx"), "utf8");

test("backfill is service-only and superadmin-gated", () => {
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on public\.contract_owner_backfill_runs from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.approve_contract_owner_backfill_run[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /private\.is_verified_superadmin/);
  assert.match(actions, /context\.role !== "superadmin"/);
});

test("preview stores hashes and categorical evidence instead of names", () => {
  assert.match(migration, /source_name_sha256 text not null/);
  assert.match(migration, /match_signals text\[\]/);
  assert.doesNotMatch(migration, /extracted_owner_name|rights_holder_name text|ocr_text|contract_text/i);
  assert.match(server, /source_name_sha256: sha256\(name\)/);
});

test("approval is manifest and revision fenced", () => {
  assert.match(migration, /approved_manifest_sha256 is distinct from locked_run\.manifest_sha256/);
  assert.match(migration, /run\.revision <> p_expected_revision/);
  assert.match(migration, /private\.contract_owner_backfill_manifest/);
  assert.match(actions, /expectedManifestSha256/);
});

test("application reuses canonical owner review and detects stale source", () => {
  assert.match(migration, /current_source_hash is distinct from locked_item\.source_name_sha256/);
  assert.match(migration, /current_contract\.rights_holder_id is distinct from locked_item\.expected_rights_holder_id/);
  assert.match(migration, /review_result := public\.review_contract_owner/);
  assert.match(migration, /for update skip locked limit 1/);
  assert.match(migration, /status = 'stale'/);
});

test("one approval automatically processes resumable chunks", () => {
  assert.match(panel, /Godkend og anvend én gang/);
  assert.match(panel, /while \(\["approved", "applying"\]\.includes\(current\.status\)\)/);
  assert.match(actions, /for \(let index = 0; index < 20; index \+= 1\)/);
  assert.match(panel, /Genoptag sikker kørsel/);
});

test("audit includes every current and proposed member subject", () => {
  assert.match(migration, /p_target_member_uuids => audit_subjects/g);
  assert.match(migration, /p_system_component => 'admin\.contract-owner-backfill\.preview'/);
  assert.match(migration, /p_system_component => 'admin\.contract-owner-backfill\.approve'/);
  assert.match(actions, /targetMemberUuids: auditSubjects\(run\)/);
});
