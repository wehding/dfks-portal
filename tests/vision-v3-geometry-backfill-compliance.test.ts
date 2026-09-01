import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const registry = JSON.parse(read("config/audit-coverage.json"));
const migration = read("supabase/migrations/20260901081533_vision_v3_geometry_backfill.sql");
const oneOffScript = read("scripts/one-off/vision-v3-geometry-backfill.ts");
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
    "supabase/migrations/20260901081533_vision_v3_geometry_backfill.sql",
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

test("engangskørsel og samlet regressionspakke har navngivne npm-scripts", () => {
  assert.equal(
    packageJson.scripts["one-off:vision-v3-geometry-backfill"],
    "NODE_OPTIONS=--conditions=react-server tsx scripts/one-off/vision-v3-geometry-backfill.ts",
  );
  assert.match(packageJson.scripts["test:vision-v3-geometry-backfill"], /vision-v3-geometry-backfill-compliance\.test\.ts/);
  assert.match(packageJson.scripts["test:vision-v3-geometry-backfill"], /contract-document-worker\/\*\.test\.mjs/);
});

test("engangskørslen indlæser lokal serverkonfiguration uden at udskrive hemmeligheder", () => {
  assert.match(oneOffScript, /loadEnv\(\{ path: "\.env\.local", quiet: true \}\)/);
  assert.doesNotMatch(oneOffScript, /console\.(?:log|error)\(process\.env/);
});
