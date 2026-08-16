import { NextResponse } from "next/server";

import { verifyOcrCloudRunRequest } from "@/lib/server/cloud-run-identity";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await verifyOcrCloudRunRequest(request);
  } catch {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }

  const db = createServiceClient({ audit: { source: "cron", mode: "summary" } });
  const { data: job, error } = await db.rpc("claim_next_contract_document_job", { p_lease_minutes: 15 });
  if (error) return NextResponse.json({ error: "Dokumentkøen kunne ikke læses" }, { status: 500 });
  if (!job?.id) return new NextResponse(null, { status: 204 });

  const download = await db.storage.from("kontrakter").createSignedUrl(job.original_storage_path, 10 * 60, {
    download: false,
  });
  if (job.attempts > 1) await db.storage.from("kontrakter").remove([job.output_storage_path]);
  const upload = await db.storage.from("kontrakter").createSignedUploadUrl(job.output_storage_path);
  if (download.error || upload.error) {
    await db.rpc("finish_contract_document_job", {
      p_job_id: job.id,
      p_status: "failed",
      p_error_code: "signed_url_failed",
      p_safe_error_message: "Midlertidig filadgang kunne ikke oprettes.",
    });
    return NextResponse.json({ error: "Midlertidig filadgang kunne ikke oprettes" }, { status: 500 });
  }

  return NextResponse.json({
    jobId: job.id,
    downloadUrl: download.data.signedUrl,
    uploadPath: job.output_storage_path,
    uploadToken: upload.data.token,
    maxBytes: 25 * 1024 * 1024,
  }, { headers: { "Cache-Control": "no-store" } });
}
