import { NextResponse } from "next/server";

import { verifyOcrCloudRunRequest } from "@/lib/server/cloud-run-identity";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    await verifyOcrCloudRunRequest(request);
  } catch {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }

  let body: { jobId?: string; leaseToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig uploadanmodning" }, { status: 400 });
  }
  if (!body.jobId || !UUID_PATTERN.test(body.jobId)
    || !body.leaseToken || !UUID_PATTERN.test(body.leaseToken)) {
    return NextResponse.json({ error: "Ugyldigt dokumentjob" }, { status: 400 });
  }

  const db = createServiceClient({
    audit: { source: "cron", correlationId: body.jobId, mode: "summary" },
  });
  const { data: job, error: authorisationError } = await db.rpc(
    "authorise_contract_document_job_upload",
    {
      p_job_id: body.jobId,
      p_lease_token: body.leaseToken,
      p_lease_minutes: 30,
    },
  );
  if (authorisationError || !job?.id) {
    return NextResponse.json({ error: "Dokumentjobbet har ikke længere en aktiv lease" }, { status: 409 });
  }

  const leasePrefix = `${job.org_id}/processed/${job.contract_id}/leases/${body.leaseToken}`;
  if (job.output_storage_path !== `${leasePrefix}/normalised.pdf`
    || job.spatial_data_path !== `${leasePrefix}/vision-layout.json.gz`) {
    return NextResponse.json({ error: "Ugyldige lease-stier" }, { status: 409 });
  }

  // Mint close to upload. Never delete here: a repeated authorisation request
  // must not be able to remove a derivative that this active lease has already
  // uploaded while it is waiting to complete.
  const outputUpload = await db.storage.from("kontrakter")
    .createSignedUploadUrl(job.output_storage_path);
  const spatialUpload = await db.storage.from("kontrakter")
    .createSignedUploadUrl(job.spatial_data_path);
  if (outputUpload.error || spatialUpload.error) {
    return NextResponse.json({ error: "Midlertidig uploadadgang kunne ikke oprettes" }, { status: 503 });
  }

  return NextResponse.json({
    uploadToken: outputUpload.data.token,
    spatialUploadToken: spatialUpload.data.token,
  }, { headers: { "Cache-Control": "no-store" } });
}
