import { NextResponse } from "next/server";

import { CONTRACT_IMPORT_PROMPT_VERSION, CONTRACT_IMPORT_SCHEMA_VERSION } from "@/lib/contract-import-job";
import { getAiRuntimeConfig } from "@/lib/ai-runtime";
import { verifyOcrCloudRunRequest } from "@/lib/server/cloud-run-identity";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Completion = {
  jobId?: string;
  status?: "completed" | "failed" | "needs_review";
  orientationCorrections?: Array<{ page: number; degrees: 90 | 180 | 270 }>;
  ocrApplied?: boolean;
  pageCount?: number | null;
  textCharCount?: number | null;
  errorCode?: string | null;
  safeErrorMessage?: string | null;
};

export async function POST(request: Request) {
  try {
    await verifyOcrCloudRunRequest(request);
  } catch {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }

  let body: Completion;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig statusbesked" }, { status: 400 });
  }
  if (!body.jobId || !/^[0-9a-f-]{36}$/i.test(body.jobId) || !body.status) {
    return NextResponse.json({ error: "Ugyldig jobstatus" }, { status: 400 });
  }
  const corrections = Array.isArray(body.orientationCorrections)
    ? body.orientationCorrections.slice(0, 500).filter((entry) =>
      Number.isInteger(entry.page) && entry.page > 0 && [90, 180, 270].includes(entry.degrees))
    : [];
  const db = createServiceClient({ audit: { source: "cron", correlationId: body.jobId, mode: "summary" } });
  const { data: finished, error } = await db.rpc("finish_contract_document_job", {
    p_job_id: body.jobId,
    p_status: body.status,
    p_orientation_corrections: corrections,
    p_ocr_applied: Boolean(body.ocrApplied),
    p_page_count: Number.isInteger(body.pageCount) ? body.pageCount : null,
    p_text_char_count: Number.isInteger(body.textCharCount) ? body.textCharCount : null,
    p_error_code: body.errorCode?.slice(0, 80) || null,
    p_safe_error_message: body.safeErrorMessage?.slice(0, 500) || null,
  });
  if (error || !finished?.contract_id) {
    return NextResponse.json({ error: "Dokumentjobbet kunne ikke afsluttes" }, { status: 409 });
  }

  if (body.status === "completed") {
    const existing = await db.from("contract_ai_jobs").select("id").eq("contract_id", finished.contract_id).is("attachment_id", null).limit(1);
    if (!existing.data?.length) {
      const runtimeConfig = await getAiRuntimeConfig("contract_extraction");
      await db.from("contract_ai_jobs").insert({
        contract_id: finished.contract_id,
        org_id: finished.org_id,
        created_by: finished.created_by,
        status: "queued",
        stage: "extraction",
        priority: 100,
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        prompt_version: CONTRACT_IMPORT_PROMPT_VERSION,
        schema_version: CONTRACT_IMPORT_SCHEMA_VERSION,
        next_attempt_at: new Date().toISOString(),
      });
    }
  }
  return NextResponse.json({ ok: true });
}
