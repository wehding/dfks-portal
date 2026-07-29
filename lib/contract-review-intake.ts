import "server-only";

import { createHash } from "node:crypto";
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
  const storagePath = `${input.orgId}/${fileHash}/${safeName}`;
  const upload = await db.storage.from("contract-reviews").upload(storagePath, input.fileBuffer, {
    contentType: input.contentType || "application/octet-stream",
    upsert: false,
  });
  if (upload.error && !upload.error.message.toLowerCase().includes("already exists")) throw new Error(upload.error.message);

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
    ...(input.metadata ?? {}),
  };
  const { data: review, error: reviewError } = await db.from("contract_reviews").insert(payload).select("id").single();
  if (reviewError || !review) {
    const { data: raced } = await db.from("contract_reviews").select("id,storage_path")
      .eq("org_id", input.orgId).eq("intake_source", input.source).eq("external_source_id", externalSourceId)
      .eq("file_hash", fileHash).is("soft_deleted_at", null).maybeSingle();
    if (raced) return { reviewId: raced.id, duplicate: true, storagePath: raced.storage_path };
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
