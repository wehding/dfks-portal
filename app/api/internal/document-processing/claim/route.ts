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
  const outputParts = String(job.output_storage_path).split("/");
  outputParts[outputParts.length - 1] = "vision-layout.json.gz";
  const spatialUploadPath = outputParts.join("/");
  const { error: spatialPathError } = await db.from("contract_document_jobs")
    .update({ spatial_data_path: spatialUploadPath })
    .eq("id", job.id)
    .eq("status", "processing");
  // Derivater er reproducerbare og må aldrig genbruges fra et tidligere
  // mislykket/manuelt afvist job. Originalen berøres ikke.
  await db.storage.from("kontrakter").remove([job.output_storage_path, spatialUploadPath]);
  const upload = await db.storage.from("kontrakter").createSignedUploadUrl(job.output_storage_path);
  const spatialUpload = await db.storage.from("kontrakter").createSignedUploadUrl(spatialUploadPath);
  if (download.error || upload.error || spatialUpload.error || spatialPathError) {
    await db.rpc("finish_contract_document_job_v2", {
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
    spatialUploadPath,
    spatialUploadToken: spatialUpload.data.token,
    maxBytes: 25 * 1024 * 1024,
  }, { headers: { "Cache-Control": "no-store" } });
}
