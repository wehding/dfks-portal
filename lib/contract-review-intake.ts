import "server-only";

import { createHash } from "node:crypto";
import { getInternalWorkerSecret } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export type ReviewIntakeInput = {
  orgId: string;
  source: "portal" | "admin" | "gmail";
  externalSourceId?: string | null;
  fileName: string;
  contentType?: string | null;
  fileBuffer: Buffer;
  memberId?: string | null;
  memberName?: string | null;
  memberEmail?: string | null;
  metadata?: Record<string, unknown>;
};

export async function triggerContractReviewWorker(origin: string) {
  const secret = getInternalWorkerSecret("contract-review");
  if (!secret) {
    console.warn("[review-intake] Køen er oprettet, men intern worker-secret mangler");
    return false;
  }
  try {
    const response = await fetch(new URL("/api/contracts/reviews/jobs/process", origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) {
      console.warn("[review-intake] Worker kunne ikke startes", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[review-intake] Worker kunne ikke kontaktes", error instanceof Error ? error.message : "ukendt fejl");
    return false;
  }
}

/**
 * Starter analysejob-workeren — og kører køen inline som fallback hvis workeren
 * ikke kunne startes (typisk fordi CONTRACT_REVIEW_JOB_SECRET ikke er sat, eller
 * det interne fetch-kald ikke kan nå deployment'et). Uden dette hænger et
 * netop indsat/genkøet job til den daglige cron.
 *
 * Kald altid via `after(...)` fra route-handleren, og sæt `maxDuration` højt nok
 * til at et enkelt AI-kald kan nå at køre færdigt.
 */
export async function ensureContractReviewWorkerRuns(origin: string) {
  const started = await triggerContractReviewWorker(origin);
  if (started) return;
  try {
    const { processPendingContractReviewJobs } = await import("@/lib/server/contract-review-job-processor");
    await processPendingContractReviewJobs(3);
  } catch (error) {
    console.warn("[review-intake] Inline jobkørsel fejlede", error instanceof Error ? error.message : "ukendt fejl");
  }
}

export async function createContractReviewIntake(input: ReviewIntakeInput) {
  const db = createServiceClient();
  const fileHash = createHash("sha256").update(input.fileBuffer).digest("hex");
  const externalSourceId = input.externalSourceId ?? "";
  const { data: existing } = await db.from("contract_reviews")
    .select("id,storage_path,intake_status")
    .eq("org_id", input.orgId).eq("intake_source", input.source)
    .eq("external_source_id", externalSourceId).eq("file_hash", fileHash)
    .is("soft_deleted_at", null).maybeSingle();
  if (existing) return { reviewId: existing.id, duplicate: true, storagePath: existing.storage_path };

  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Hver sag ejer sin egen fil. Samme dokument må ikke dele storage-objekt
  // med en anden indsendelse, da sager kan have forskellig retention/legal hold.
  const storagePath = `${input.orgId}/${crypto.randomUUID()}/${safeName}`;
  const upload = await db.storage.from("contract-reviews").upload(storagePath, input.fileBuffer, {
    contentType: input.contentType || "application/octet-stream",
    upsert: false,
  });
  if (upload.error && !upload.error.message.toLowerCase().includes("already exists")) throw new Error(upload.error.message);

  const metadata = input.metadata ?? {};
  const payload = {
    org_id: input.orgId,
    member_id: input.memberId ?? null,
    member_name: input.memberName ?? null,
    member_email: input.memberEmail ?? null,
    status: "afventer",
    ai_status: "analyserer",
    intake_status: "queued",
    intake_source: input.source,
    external_source_id: externalSourceId,
    file_hash: fileHash,
    file_name: input.fileName,
    file_size_bytes: input.fileBuffer.length,
    storage_path: storagePath,
    contract_type: typeof metadata.contract_type === "string" ? metadata.contract_type.slice(0, 100) : null,
    production_type: typeof metadata.production_type === "string" ? metadata.production_type.slice(0, 100) : null,
    distribution_channels: Array.isArray(metadata.distribution_channels) ? metadata.distribution_channels.map(String).slice(0, 20) : null,
    producer_name: typeof metadata.producer_name === "string" ? metadata.producer_name.slice(0, 500) : null,
    producer_dfks_id: typeof metadata.producer_dfks_id === "string" ? metadata.producer_dfks_id.slice(0, 100) : null,
    producer_dfi_id: typeof metadata.producer_dfi_id === "string" ? metadata.producer_dfi_id.slice(0, 100) : null,
    producer_overenskomst_bound: typeof metadata.producer_overenskomst_bound === "boolean" ? metadata.producer_overenskomst_bound : null,
    focus_areas: Array.isArray(metadata.focus_areas) ? metadata.focus_areas.map(String).slice(0, 20) : null,
    notes: typeof metadata.notes === "string" ? metadata.notes.slice(0, 50_000) : null,
    gmail_contract_message_id: typeof metadata.gmail_contract_message_id === "string" ? metadata.gmail_contract_message_id : null,
    gmail_attachment_id: typeof metadata.gmail_attachment_id === "string" ? metadata.gmail_attachment_id.slice(0, 1000) : null,
  };
  const { data: review, error: reviewError } = await db.from("contract_reviews").insert(payload).select("id").single();
  if (reviewError || !review) {
    const { data: raced } = await db.from("contract_reviews").select("id,storage_path")
      .eq("org_id", input.orgId).eq("intake_source", input.source).eq("external_source_id", externalSourceId)
      .eq("file_hash", fileHash).is("soft_deleted_at", null).maybeSingle();
    if (raced) {
      // En anden request kan have vundet insert-racet efter vores indledende
      // dubletkontrol. Den fil, som denne request netop uploadede, tilhører da
      // ingen sag og skal fjernes, før den eksisterende sag returneres.
      if (!upload.error && storagePath !== raced.storage_path) {
        await db.storage.from("contract-reviews").remove([storagePath]);
      }
      return { reviewId: raced.id, duplicate: true, storagePath: raced.storage_path };
    }
    if (!upload.error) await db.storage.from("contract-reviews").remove([storagePath]);
    throw new Error(reviewError?.message ?? "Kontraktgennemgangen kunne ikke oprettes");
  }
  const { error: jobError } = await db.from("contract_review_jobs").insert({ review_id: review.id, org_id: input.orgId });
  if (jobError) {
    await db.from("contract_reviews").delete().eq("id", review.id).eq("org_id", input.orgId);
    if (!upload.error) await db.storage.from("contract-reviews").remove([storagePath]);
    throw new Error(jobError.message);
  }
  return { reviewId: review.id, duplicate: false, storagePath };
}
