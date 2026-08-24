import "server-only";

import { analyseExistingContractReview } from "@/lib/contract-review-analysis";
import { createServiceClient } from "@/lib/supabase/service";
import { buildMaskedReviewMailContext, latestThreadMessageId } from "@/lib/contract-review-mail-context";
import { getContractReviewThread, syncContractReviewThread } from "@/lib/gmail-contract-thread";

const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 10;

type ClaimedReviewJob = {
  id: string;
  review_id: string;
  org_id: string;
  attempts: number;
};

export type ContractReviewJobResult = {
  reviewId: string;
  ok: boolean;
  dead?: boolean;
};

export function safeContractReviewJobError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/storage|originalfil|fil.*mangler|kunne ikke hentes/i.test(message)) {
    return "Kontraktfilen kunne ikke hentes sikkert.";
  }
  if (/ingen tekst|læsbar tekst|ikke-understøttet|pdf-analyse|format/i.test(message)) {
    return "Kontraktfilen kunne ikke aflæses i det nuværende format.";
  }
  if (/api|rate|429|credit|billing|model|anthropic|google/i.test(message)) {
    return "AI-tjenesten er midlertidigt utilgængelig.";
  }
  return "Kontraktanalysen kunne ikke gennemføres.";
}

async function processClaimedJob(job: ClaimedReviewJob): Promise<ContractReviewJobResult> {
  const db = createServiceClient({ audit: { source: "import", actorOrgId: job.org_id } });
  try {
    const { data: review, error: reviewError } = await db.from("contract_reviews")
      .select("*")
      .eq("id", job.review_id)
      .eq("org_id", job.org_id)
      .single();
    if (reviewError || !review?.storage_path) throw new Error(reviewError?.message ?? "Originalfil mangler");

    await db.from("contract_reviews")
      .update({ ai_status: "analyserer" })
      .eq("id", review.id)
      .eq("org_id", review.org_id);

    const { data: file, error: fileError } = await db.storage.from("contract-reviews").download(review.storage_path);
    if (fileError || !file) throw new Error(fileError?.message ?? "Originalfil kunne ikke hentes");

    let emailReference: string | null = null;
    let emailReferenceMessageId: string | null = null;
    if (review.gmail_contract_message_id) {
      await syncContractReviewThread(review.id, review.org_id).catch(() => null);
      const thread = await getContractReviewThread(review.id, review.org_id);
      emailReference = buildMaskedReviewMailContext(thread) || null;
      emailReferenceMessageId = latestThreadMessageId(thread);
    }

    await analyseExistingContractReview({
      reviewId: review.id,
      orgId: review.org_id,
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      fileName: review.file_name ?? review.id,
      memberName: review.member_name,
      memberId: review.member_id,
      memberEmail: review.member_email,
      contractType: review.contract_type,
      productionType: review.production_type,
      distributionChannels: review.distribution_channels ?? [],
      producerName: review.producer_name,
      producerOverenskomst: review.producer_overenskomst_bound == null ? null : String(review.producer_overenskomst_bound),
      focusAreas: review.focus_areas ?? [],
      notes: review.notes,
      emailReference,
      emailReferenceMessageId,
      source: review.intake_source === "portal" ? "portal" : review.intake_source === "gmail" ? "import" : "admin",
    });

    await Promise.all([
      db.from("contract_reviews")
        .update({ intake_status: "complete" })
        .eq("id", review.id)
        .eq("org_id", review.org_id),
      db.from("contract_review_jobs")
        .update({ status: "done", error_message: null, locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
        .eq("id", job.id),
    ]);
    return { reviewId: review.id, ok: true };
  } catch (error) {
    const safeError = safeContractReviewJobError(error);
    const dead = Number(job.attempts) >= MAX_ATTEMPTS;
    const nextAttemptAt = new Date(
      Date.now() + Math.min(60, 5 * (2 ** Math.max(0, Number(job.attempts) - 1))) * 60_000,
    ).toISOString();
    await Promise.all([
      db.from("contract_review_jobs").update({
        status: dead ? "dead" : "error",
        error_message: safeError,
        locked_at: null,
        locked_by: null,
        next_attempt_at: nextAttemptAt,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id),
      db.from("contract_reviews")
        .update({ ai_status: "fejl", intake_status: dead ? "dead" : "retryable" })
        .eq("id", job.review_id)
        .eq("org_id", job.org_id),
    ]);
    console.warn("[contract-review-worker] Analysejob fejlede", {
      reviewId: job.review_id,
      attempt: job.attempts,
      dead,
      error: safeError,
    });
    return { reviewId: job.review_id, ok: false, dead };
  }
}

export async function processPendingContractReviewJobs(batchSize = DEFAULT_BATCH_SIZE) {
  const db = createServiceClient();
  const workerId = crypto.randomUUID();
  const results: ContractReviewJobResult[] = [];
  const limit = Math.max(1, Math.min(25, batchSize));

  for (let index = 0; index < limit; index += 1) {
    const { data: jobs, error } = await db.rpc("claim_contract_review_job", { worker_id: workerId });
    if (error) throw new Error("Kontraktgennemgangskøen kunne ikke læses.");
    const job = jobs?.[0] as ClaimedReviewJob | undefined;
    if (!job) break;
    results.push(await processClaimedJob(job));
  }

  const { count, error: countError } = await db.from("contract_review_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "error"])
    .lt("attempts", MAX_ATTEMPTS)
    .lte("next_attempt_at", new Date().toISOString());
  if (countError) throw new Error("Kontraktgennemgangskøens reststatus kunne ikke læses.");

  return {
    processed: results.length,
    succeeded: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    hasMore: (count ?? 0) > 0,
    results,
  };
}
