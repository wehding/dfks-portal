import { createHash, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import {
  contractSourceFormatFromPath,
  detectContractSourceFormat,
} from "../../cloud-run/contract-document-worker/source-format.mjs";
import {
  appendWordRecoveryAudit,
  fetchWordRecoveryCandidates,
} from "./recover-word-contract-jobs-lib.mjs";

config({ path: ".env.local" });

const apply = process.argv.includes("--apply");
const workerConfirmed = process.argv.includes("--confirm-worker-deployed");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Math.min(500, Math.max(1, Number(limitArgument?.split("=")[1] ?? 100)));
const MAX_BYTES = 25 * 1024 * 1024;

if (apply && !workerConfirmed) throw new Error("--apply kræver --confirm-worker-deployed");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase-miljøvariabler mangler");

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const candidates = await fetchWordRecoveryCandidates(db, limit);

  const result = {
    mode: apply ? "apply" : "dry-run",
    inspected: 0,
    eligible: 0,
    queued: 0,
    wrongExtension: 0,
    signatureMismatch: 0,
    tooLarge: 0,
    skippedByFence: 0,
  };
  const queuedContractIds = [];

  for (const job of candidates) {
    result.inspected += 1;
    const pathFormat = contractSourceFormatFromPath(job.original_storage_path);
    if (pathFormat !== "doc" && pathFormat !== "docx") {
      result.wrongExtension += 1;
      continue;
    }
    const { data: blob, error: downloadError } = await db.storage
      .from("kontrakter")
      .download(job.original_storage_path);
    if (downloadError || !blob) {
      result.skippedByFence += 1;
      continue;
    }
    if (blob.size > MAX_BYTES) {
      result.tooLarge += 1;
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (detectContractSourceFormat(bytes) !== pathFormat) {
      bytes.fill(0);
      result.signatureMismatch += 1;
      continue;
    }
    const expectedHash = sha256(bytes);
    bytes.fill(0);
    result.eligible += 1;
    if (!apply) continue;

    const { data: recovery, error: recoveryError } = await db.rpc(
      "queue_word_contract_document_recovery",
      {
        p_source_job_id: job.id,
        p_expected_source_path: job.original_storage_path,
        p_expected_original_sha256: expectedHash,
        p_priority: 1000,
      },
    );
    const recoveryRow = Array.isArray(recovery) ? recovery[0] : recovery;
    if (recoveryError || recoveryRow?.outcome !== "queued") {
      throw new Error("Recovery blev afvist af sikkerhedskontrollen");
    }
    result.queued += 1;
    queuedContractIds.push(job.contract_id);
  }

  if (apply && result.queued > 0) {
    await appendWordRecoveryAudit(db, {
      contractIds: queuedContractIds,
      correlationId: randomUUID(),
      summary: {
        inspected: result.inspected,
        eligible: result.eligible,
        queued: result.queued,
        wrongExtension: result.wrongExtension,
        signatureMismatch: result.signatureMismatch,
        tooLarge: result.tooLarge,
        skippedByFence: result.skippedByFence,
      },
    });
  }

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Recovery fejlede");
  process.exitCode = 1;
});
