import { readBaselineFile } from "../audit-ocr-backfill.mjs";
import { recordSensitiveFlow } from "../../lib/sensitive-flow-audit";
import { createServiceClient } from "../../lib/supabase/service";

const CONFIRMATION = "QUEUE_DIRECT_VISION_REPLACEMENTS";
const PILOT_LIMIT = 4;

type BaselineRecord = {
  jobId: string;
  contractId: string;
  originalSha256: string;
};

function safeMode(value: string | undefined) {
  if (value === "pilot" || value == null || value === "") return "pilot" as const;
  if (value === "full") return "full" as const;
  throw new Error("invalid_mode");
}

async function main() {
  if (process.env.OCR_REPLACEMENT_CONFIRM !== CONFIRMATION) {
    throw new Error("explicit_confirmation_required");
  }
  const mode = safeMode(process.env.OCR_REPLACEMENT_MODE);
  const baselinePath = process.env.OCR_BACKFILL_BASELINE_PATH;
  const baseline = await readBaselineFile(baselinePath) as { records: BaselineRecord[] };
  const records = mode === "pilot" ? baseline.records.slice(0, PILOT_LIMIT) : baseline.records;
  const db = createServiceClient({
    audit: { source: "cron", mode: "summary", correlationId: crypto.randomUUID() },
  });
  const summary = {
    mode,
    baselineDocuments: baseline.records.length,
    selected: records.length,
    queued: 0,
    replaced: 0,
    skippedStateChanged: 0,
    skippedNewerGeneration: 0,
    sourceMissing: 0,
    failed: 0,
    pendingDeletions: 0,
  };

  for (const record of records) {
    const { data, error } = await db.rpc("queue_direct_vision_replacement_generation", {
      p_source_job_id: record.jobId,
      p_expected_original_sha256: record.originalSha256,
      p_priority: 100,
    });
    if (error) {
      summary.failed += 1;
      if (mode === "pilot") break;
      continue;
    }
    const outcome = Array.isArray(data) ? data[0]?.outcome : data?.outcome;
    if (outcome === "queued") {
      summary.queued += 1;
    } else if (outcome === "skipped_state_changed") summary.skippedStateChanged += 1;
    else if (outcome === "skipped_newer_generation") summary.skippedNewerGeneration += 1;
    else if (outcome === "source_missing") summary.sourceMissing += 1;
    else summary.failed += 1;
  }

  const replacementJobs: Array<{ id: string; status: string }> = [];
  for (let offset = 0; offset < records.length; offset += 100) {
    const sourceJobIds = records.slice(offset, offset + 100).map((record) => record.jobId);
    const { data, error } = await db.from("contract_document_jobs")
      .select("id,status")
      .in("replacement_of_job_id", sourceJobIds);
    if (error) throw new Error("replacement_report_failed");
    replacementJobs.push(...(data ?? []));
  }
  summary.replaced = replacementJobs.filter((job) => job.status === "completed").length;
  summary.failed += replacementJobs.filter((job) => ["failed", "needs_review"].includes(job.status)).length;
  const replacementJobIds = replacementJobs.map((job) => job.id);
  for (let offset = 0; offset < replacementJobIds.length; offset += 100) {
    const { count, error } = await db.from("contract_document_artifact_deletions")
      .select("id", { count: "exact", head: true })
      .in("replacement_job_id", replacementJobIds.slice(offset, offset + 100))
      .neq("status", "deleted");
    if (error) throw new Error("deletion_report_failed");
    summary.pendingDeletions += count ?? 0;
  }

  if (records.length > 0) {
    const contracts: Array<{ id: string; org_id: string; rights_holder_id: string | null }> = [];
    for (let offset = 0; offset < records.length; offset += 100) {
      const { data, error } = await db.from("contracts")
        .select("id,org_id,rights_holder_id")
        .in("id", records.slice(offset, offset + 100).map((record) => record.contractId));
      if (error) throw new Error("audit_subject_resolution_failed");
      contracts.push(...(data ?? []));
    }
    await recordSensitiveFlow({
      actor: { source: "cron" },
      action: "create",
      component: "one-off.direct-vision-ocr-replacement",
      entityType: "contract_document_jobs",
      targetMemberUuids: [...new Set(contracts
        .map((contract) => contract.rights_holder_id)
        .filter((id): id is string => typeof id === "string"))],
      orgIds: [...new Set(contracts.map((contract) => contract.org_id))],
      purposeCode: "document_ocr_replacement",
      legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)",
      dataCategories: ["contract_data", "document_data", "ai_analysis"],
      outcome: summary.failed > 0 ? "partial" : "success",
      counts: {
        selected: summary.selected,
        queued: summary.queued,
        replaced: summary.replaced,
        skipped: summary.skippedStateChanged + summary.skippedNewerGeneration + summary.sourceMissing,
        failed: summary.failed,
        pendingDeletions: summary.pendingDeletions,
      },
    });
  }

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "replacement_failed";
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 2;
});
