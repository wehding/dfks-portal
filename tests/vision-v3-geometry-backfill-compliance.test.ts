import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const registry = JSON.parse(read("config/audit-coverage.json"));
const migration = read("supabase/migrations/20260901081533_vision_v3_geometry_backfill.sql");
const recoveryMigration = read("supabase/migrations/20260901103554_vision_v3_geometry_quality_recovery.sql");
const oneOffScript = read("scripts/one-off/vision-v3-geometry-backfill.ts");
const auditScript = read("scripts/audit-ocr-backfill.mjs");
const packageJson = JSON.parse(read("package.json"));

test("Vision v3-geometri-backfill er registreret som et implementeret, men ikke aktiveret Class D-dataflow", () => {
  const flow = registry.dataFlows?.find((candidate: { id?: string }) =>
    candidate.id === "FLOW-VISION-V3-GEOMETRY-BACKFILL");

  assert.ok(flow);
  assert.equal(flow.processingActivity, "PROC-DOCUMENT-AI");
  assert.equal(flow.status, "implemented");
  assert.match(flow.activation, /Afventer produktionsmigration/);
  assert.deepEqual(flow.sourceStores, ["STORE-SUPABASE-DB", "STORE-SUPABASE-STORAGE"]);
  assert.deepEqual(flow.destinationStores, ["STORE-SUPABASE-DB", "STORE-SUPABASE-STORAGE"]);
  assert.match(flow.originalHandling, /originale storage-objekter og deres stier ændres aldrig/);
  assert.equal(flow.test, "tests/vision-v3-geometry-backfill-compliance.test.ts");
  const activity = registry.processingActivities?.find((candidate: { id?: string }) =>
    candidate.id === flow.processingActivity);
  assert.ok(activity.categories.includes("document_data"));
});

test("engangskørslen har en registry-post med databaseaudit som autoritativ semantisk grænse", () => {
  const entry = registry.entries?.find((candidate: { path?: string }) =>
    candidate.path === "scripts/one-off/vision-v3-geometry-backfill.ts");

  assert.ok(entry);
  assert.equal(entry.status, "implemented");
  assert.equal(entry.lifecycleStage, "analysis");
  assert.equal(entry.failClosed, true);
  assert.equal(
    entry.auditImplementation,
    "supabase/migrations/20260901103554_vision_v3_geometry_quality_recovery.sql",
  );
  assert.match(entry.targetResolution, /contracts\.rights_holder_id/);
  assert.deepEqual(entry.categories, ["contract_data", "document_data", "ai_analysis"]);
});

test("kø og kvalitetsport skriver hver ét kohorteaudit-event med medlemmer og organisationer", () => {
  const auditCalls = migration.match(/(?:created_audit_event_id :=|perform) public\.append_audit_event_v2\(/g) ?? [];
  assert.equal(auditCalls.length, 2);
  assert.match(migration, /p_target_member_uuids => member_uuids/g);
  assert.match(migration, /p_org_ids => org_uuids/g);
  assert.match(migration, /array_agg\(distinct contract\.rights_holder_id\)/g);
  assert.match(migration, /vision_v3_geometry_backfill_queued/);
  assert.match(migration, /vision_v3_geometry_backfill_quality_approved/);

  const metadataBodies = [...migration.matchAll(/p_metadata => jsonb_build_object\(([\s\S]*?)\),\n\s*p_target_member_uuids/g)]
    .map((match) => match[1]);
  assert.equal(metadataBodies.length, 2);
  for (const metadata of metadataBodies) {
    assert.doesNotMatch(metadata, /storage_path|signed|token|file_name|contract_text|ocr_text|salary/i);
  }
});

test("backfilltabeller og styringsfunktioner er service-only og kohorten fejler lukket", () => {
  assert.match(migration, /alter table public\.contract_document_backfill_runs enable row level security/);
  assert.match(migration, /alter table public\.contract_document_backfill_targets enable row level security/);
  assert.match(
    migration,
    /revoke all on function public\.prepare_contract_document_geometry_backfill_run\([\s\S]*?from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.claim_next_contract_document_geometry_backfill_job\(uuid, integer\)[\s\S]*?from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.complete_contract_document_geometry_backfill_run\([\s\S]*?from public, anon, authenticated/,
  );
  assert.match(migration, /geometry backfill digest drift/);
  assert.match(migration, /geometry backfill baseline drift/);
  assert.match(migration, /geometry backfill quality gate unavailable/);
  assert.match(migration, /geometry backfill accounting mismatch/);
});

test("recovery opretter immutable generationer og flytter kun target-pointeren", () => {
  assert.match(recoveryMigration, /add column if not exists recovery_generation/);
  assert.match(recoveryMigration, /recovery_of_job_id, downstream_ai_policy/);
  assert.match(recoveryMigration, /terminal_job\.backfill_source_job_id/);
  assert.match(recoveryMigration, /terminal_job\.downstream_ai_policy/);
  assert.match(recoveryMigration, /set queued_job_id = recovery_job_id/);
  assert.match(recoveryMigration, /set state = 'queued'/);
  assert.doesNotMatch(
    recoveryMigration.match(/create or replace function public\.queue_contract_document_geometry_backfill_recovery\([\s\S]*?revoke all on function public\.queue_contract_document_geometry_backfill_recovery/)?.[0] ?? "",
    /update public\.contracts/,
  );
});

test("recovery er service-only, auditbundet og medlemssubjekter følger transaktionen", () => {
  assert.match(
    recoveryMigration,
    /revoke all on function public\.queue_contract_document_geometry_backfill_recovery\([\s\S]*?from public, anon, authenticated/,
  );
  assert.match(
    recoveryMigration,
    /grant execute on function public\.queue_contract_document_geometry_backfill_recovery\([\s\S]*?to service_role/,
  );
  assert.match(recoveryMigration, /vision_v3_geometry_backfill_recovery_queued/);
  assert.match(recoveryMigration, /p_target_member_uuids => member_uuids/);
  assert.match(recoveryMigration, /backfill_recovery_audit_event_id = recovery_audit_event_id/);
  assert.doesNotMatch(
    recoveryMigration.match(/p_metadata => jsonb_build_object\([\s\S]*?p_target_member_uuids => member_uuids/)?.[0] ?? "",
    /storage_path|signed|token|file_name|contract_text|ocr_text|salary/i,
  );
});

test("claim, completion og kvalitetsport følger kun den aktuelle recovery-kæde", () => {
  assert.match(recoveryMigration, /contract_document_geometry_recovery_chain_valid/);
  assert.match(recoveryMigration, /current_target\.queued_job_id = job\.id/);
  assert.match(recoveryMigration, /join public\.contract_document_jobs as job on job\.id = current_target\.queued_job_id/);
  assert.match(recoveryMigration, /and current_target\.outcome = job\.status/);
  assert.match(recoveryMigration, /guard_geometry_backfill_recovery_completion/);
  assert.match(recoveryMigration, /contract_document_jobs_one_active_geometry_source_idx/);
  assert.match(recoveryMigration, /contract_document_jobs_one_active_geometry_contract_idx/);
  assert.match(recoveryMigration, /geometry backfill exact completion required/);
  assert.match(recoveryMigration, /target\.outcome <> 'completed'/);
  assert.match(recoveryMigration, /recovery_reason_code[\s\S]*?geometry_quality_recovery_v1/);
  assert.match(recoveryMigration, /canonical row-lock order/i);
  assert.match(recoveryMigration, /contract -> source -> target -> active job/);
});

test("auditporten kræver eksakt færdiggørelse og tæller alle AI-generationer", () => {
  assert.match(auditScript, /geometryBackfillSummaryReadyForApproval/);
  assert.match(auditScript, /outcomes\.completed === expected/);
  assert.match(auditScript, /outcomes\.needs_review === 0/);
  assert.match(auditScript, /geometryUnexpectedAiGeneration/);
  const postBaselineLoader = auditScript.match(
    /export async function loadPostBaselineAiCounts[\s\S]*?async function loadRelevantAiJobs/,
  )?.[0] ?? "";
  assert.match(postBaselineLoader, /\.gte\("created_at", cutoff\)/);
  assert.doesNotMatch(postBaselineLoader, /ACTIVE_AI_JOB_STATUSES|\.in\("status"/);
});

test("engangskørsel og samlet regressionspakke har navngivne npm-scripts", () => {
  assert.equal(
    packageJson.scripts["one-off:vision-v3-geometry-backfill"],
    "NODE_OPTIONS=--conditions=react-server tsx scripts/one-off/vision-v3-geometry-backfill.ts",
  );
  assert.match(packageJson.scripts["test:vision-v3-geometry-backfill"], /vision-v3-geometry-backfill-compliance\.test\.ts/);
  assert.match(packageJson.scripts["test:vision-v3-geometry-backfill"], /contract-document-worker\/\*\.test\.mjs/);
  assert.match(packageJson.scripts["test:vision-v3-geometry-backfill"], /ocr-backfill-audit\.test\.mjs/);
  assert.match(packageJson.scripts["test:vision-v3-geometry-backfill"], /contract-document-geometry-backfill-concurrency\.test\.mjs/);
});

test("engangskørslen indlæser lokal serverkonfiguration uden at udskrive hemmeligheder", () => {
  assert.match(oneOffScript, /loadEnv\(\{ path: "\.env\.local", quiet: true \}\)/);
  assert.doesNotMatch(oneOffScript, /console\.(?:log|error)\(process\.env/);
  assert.match(oneOffScript, /recover-preview/);
  assert.match(oneOffScript, /QUEUE_VISION_V3_GEOMETRY_RECOVERY/);
  assert.match(oneOffScript, /queue_contract_document_geometry_backfill_recovery/);
  assert.doesNotMatch(oneOffScript, /original_storage_path|pdf_url|processed_pdf_url/);
});
