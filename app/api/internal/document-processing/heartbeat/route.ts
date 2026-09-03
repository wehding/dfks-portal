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
    return NextResponse.json({ error: "Ugyldig leasebesked" }, { status: 400 });
  }
  if (!body.jobId || !UUID_PATTERN.test(body.jobId)
    || !body.leaseToken || !UUID_PATTERN.test(body.leaseToken)) {
    return NextResponse.json({ error: "Ugyldigt dokumentjob" }, { status: 400 });
  }

  const db = createServiceClient({
    audit: { source: "cron", correlationId: body.jobId, mode: "summary" },
  });
  const { data: renewed, error } = await db.rpc("renew_contract_document_job_lease", {
    p_job_id: body.jobId,
    p_lease_token: body.leaseToken,
    p_lease_minutes: 30,
  });
  if (error || renewed !== true) {
    return NextResponse.json({ error: "Dokumentjobbet har ikke længere en aktiv lease" }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
