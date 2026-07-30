import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireInternalSecretApi } from "@/lib/api-auth";
import { analyseExistingContractReview } from "@/lib/contract-review-analysis";

export async function POST(request: NextRequest) {
  if (!requireInternalSecretApi(request)) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const db = createServiceClient();
  const workerId = crypto.randomUUID();
  const results: Array<{ reviewId: string; ok: boolean; dead?: boolean }> = [];
  for (let index = 0; index < 10; index += 1) {
    const { data: jobs, error: claimError } = await db.rpc("claim_contract_review_job", { worker_id: workerId });
    if (claimError) return NextResponse.json({ error: "Køen kunne ikke læses", processed: results }, { status: 500 });
    const job = jobs?.[0];
    if (!job) break;
    try {
      const { data: review, error: reviewError } = await db.from("contract_reviews").select("*").eq("id", job.review_id).eq("org_id", job.org_id).single();
      if (reviewError || !review?.storage_path) throw new Error(reviewError?.message ?? "Originalfil mangler");
      const { data: file, error: fileError } = await db.storage.from("contract-reviews").download(review.storage_path);
      if (fileError || !file) throw new Error(fileError?.message ?? "Originalfil kunne ikke hentes");
      let emailReference: string | null = null;
      if (review.gmail_contract_message_id) {
        const { data: mail } = await db.from("gmail_contract_messages")
          .select("subject,body_text")
          .eq("id", review.gmail_contract_message_id)
          .eq("org_id", review.org_id)
          .maybeSingle();
        emailReference = mail
          ? [mail.subject ? `Emne: ${mail.subject}` : null, mail.body_text].filter(Boolean).join("\n\n")
          : null;
      }
      await analyseExistingContractReview({
        reviewId: review.id,
        orgId: review.org_id,
        fileBuffer: Buffer.from(await file.arrayBuffer()), fileName: review.file_name,
        memberName: review.member_name, memberId: review.member_id, memberEmail: review.member_email,
        contractType: review.contract_type, productionType: review.production_type,
        distributionChannels: review.distribution_channels ?? [], producerName: review.producer_name,
        producerOverenskomst: review.producer_overenskomst_bound == null ? null : String(review.producer_overenskomst_bound),
        focusAreas: review.focus_areas ?? [], notes: review.notes,
        emailReference,
        source: review.intake_source === "gmail" ? "import" : "portal",
      });
      await db.from("contract_reviews").update({ intake_status: "complete" }).eq("id", review.id).eq("org_id", review.org_id);
      await db.from("contract_review_jobs").update({ status: "done", error_message: null, locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      results.push({ reviewId: review.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ukendt fejl";
      const dead = Number(job.attempts) >= 5;
      await db.from("contract_review_jobs").update({
        status: dead ? "dead" : "error",
        error_message: message.slice(0, 500),
        locked_at: null,
        locked_by: null,
        next_attempt_at: new Date(Date.now() + Math.min(60, 5 * (2 ** Math.max(0, Number(job.attempts) - 1))) * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      await db.from("contract_reviews").update({ ai_status: "fejl", intake_status: dead ? "dead" : "retryable" }).eq("id", job.review_id).eq("org_id", job.org_id);
      results.push({ reviewId: job.review_id, ok: false, dead });
    }
  }
  return NextResponse.json({ processed: results.length, succeeded: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, results });
}
