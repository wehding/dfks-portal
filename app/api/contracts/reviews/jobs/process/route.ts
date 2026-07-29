import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireInternalSecretApi } from "@/lib/api-auth";
import { analyserKontrakt } from "@/lib/analyse";

export async function POST(request: NextRequest) {
  if (!requireInternalSecretApi(request)) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const db = createServiceClient();
  const workerId = crypto.randomUUID();
  const { data: jobs, error: claimError } = await db.rpc("claim_contract_review_job", { worker_id: workerId });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  const job = jobs?.[0];
  if (!job) return NextResponse.json({ processed: false });
  try {
    const { data: review, error: reviewError } = await db.from("contract_reviews").select("*").eq("id", job.review_id).eq("org_id", job.org_id).single();
    if (reviewError || !review?.storage_path) throw new Error(reviewError?.message ?? "Originalfil mangler");
    const { data: file, error: fileError } = await db.storage.from("contract-reviews").download(review.storage_path);
    if (fileError || !file) throw new Error(fileError?.message ?? "Originalfil kunne ikke hentes");
    const result = await analyserKontrakt({
      fileBuffer: Buffer.from(await file.arrayBuffer()), fileName: review.file_name,
      memberName: review.member_name, memberId: review.member_id, memberEmail: review.member_email,
      contractType: review.contract_type, productionType: review.production_type,
      distributionChannels: review.distribution_channels ?? [], producerName: review.producer_name,
      producerOverenskomst: review.producer_overenskomst_bound == null ? null : String(review.producer_overenskomst_bound),
      focusAreas: review.focus_areas ?? [], notes: review.notes, orgId: review.org_id,
      entityId: review.id, source: "cron",
    });
    await db.from("contract_reviews").update({ ai_result: result.result, ai_run_at: new Date().toISOString(), ai_language: result.klassifikation?.kontraktsprog ?? null, risk_level: result.risk_level, should_escalate: result.should_escalate, ai_status: "klar", intake_status: "complete" }).eq("id", review.id).eq("org_id", review.org_id);
    await db.from("contract_review_jobs").update({ status: "done", locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ processed: true, reviewId: review.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl";
    await db.from("contract_review_jobs").update({ status: "error", error_message: message.slice(0, 500), locked_at: null, locked_by: null, next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    await db.from("contract_reviews").update({ ai_status: "fejl", intake_status: "retryable" }).eq("id", job.review_id).eq("org_id", job.org_id);
    return NextResponse.json({ processed: false, error: "Behandlingen fejlede" }, { status: 500 });
  }
}
