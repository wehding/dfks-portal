import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireInternalSecretApi, requireSessionApi } from "@/lib/api-auth";
import { onboardingImportWorkerSecret, triggerOnboardingImportWorker } from "@/lib/onboarding-import-worker";
import { processQueuedOnboardingWorkImportItem } from "@/app/actions/dfi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeJobId(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

async function updateJobProgress(db: ReturnType<typeof createServiceClient>, jobId: string) {
  const { data: items, error } = await db.from("onboarding_work_import_items")
    .select("status,attempts").eq("job_id", jobId);
  if (error) throw new Error(error.message);
  const completed = (items ?? []).filter(item => item.status === "done").length;
  const failed = (items ?? []).filter(item => item.status === "error" && Number(item.attempts) >= 3).length;
  const remaining = (items ?? []).some(item => item.status === "queued" || item.status === "processing" || (item.status === "error" && Number(item.attempts) < 3));
  const now = new Date().toISOString();
  const status = remaining ? "processing" : failed > 0 ? "partial" : "complete";
  const update = {
    status,
    completed_items: completed,
    failed_items: failed,
    ...(remaining ? {} : { current_title: null }),
    completed_at: remaining ? null : now,
    updated_at: now,
  };
  const { error: updateError } = await db.from("onboarding_work_import_jobs").update(update).eq("id", jobId);
  if (updateError) throw new Error(updateError.message);
  return { remaining, completed, failed, status };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
  const jobId = safeJobId(body?.jobId);
  if (!jobId) return NextResponse.json({ error: "Ugyldigt importjob" }, { status: 400 });
  const db = createServiceClient();
  const internalRequest = requireInternalSecretApi(request);

  if (!internalRequest) {
    const auth = await requireSessionApi();
    if (!auth.ok) return auth.response;
    const { data: job } = await db.from("onboarding_work_import_jobs").select("id,status")
      .eq("id", jobId).eq("user_id", auth.userId).maybeSingle();
    if (!job) return NextResponse.json({ error: "Importjobbet blev ikke fundet" }, { status: 404 });
    if (!onboardingImportWorkerSecret()) return NextResponse.json({ error: "Baggrundsimport er ikke konfigureret" }, { status: 503 });
    if (job.status === "queued" || job.status === "processing") after(() => triggerOnboardingImportWorker(jobId));
    return NextResponse.json({ queued: true, jobId, status: job.status }, { status: 202 });
  }

  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: claimed, error: claimError } = await db.rpc("claim_onboarding_work_import_item", { p_job_id: jobId });
  if (claimError) return NextResponse.json({ error: "Importkøen kunne ikke læses" }, { status: 500 });
  const item = claimed?.[0];
  if (!item) {
    const progress = await updateJobProgress(db, jobId);
    return NextResponse.json({ processed: 0, ...progress });
  }

  const result = await processQueuedOnboardingWorkImportItem(secret, String(item.id));
  const now = new Date().toISOString();
  if (result.success) {
    await db.from("onboarding_work_import_items").update({
      status: "done", error_message: result.errors?.join(" ").slice(0, 500) || null,
      locked_at: null, completed_at: now, updated_at: now,
    }).eq("id", item.id);
  } else {
    await db.from("onboarding_work_import_items").update({
      status: "error", error_message: result.error.slice(0, 500), locked_at: null, updated_at: now,
    }).eq("id", item.id);
  }

  const progress = await updateJobProgress(db, jobId);
  if (progress.remaining) after(() => triggerOnboardingImportWorker(jobId));
  return NextResponse.json({ processed: 1, itemId: item.id, ok: result.success, ...progress });
}
