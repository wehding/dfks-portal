export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { after, NextRequest, NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { getInternalWorkerSecret, requireInternalSecretApi } from "@/lib/api-auth";
import {
  processPendingContractJobs,
  processSpecificContractJob,
  runDirectContractJob,
} from "@/lib/server/contract-import-processor";

function hasCronSecret(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function triggerNextWorkerRun() {
  const secret = getInternalWorkerSecret("contract-ai");
  const configuredBase = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const vercelBase = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  // Stay inside the deployment that received the request. This prevents a
  // Preview worker from continuing the queue through the Production domain.
  const base = vercelBase ?? configuredBase;
  if (!secret || !base) return;
  try {
    await fetch(`${base}/api/contracts/jobs/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ source: "worker_continuation" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.warn("[contract-import] Fortsættelseskald fejlede:", error instanceof Error ? error.message : "ukendt fejl");
  }
}

async function drainAndContinue(orgId: string | null) {
  try {
    const result = await processPendingContractJobs(orgId);
    if (result.hasMore) await triggerNextWorkerRun();
  } catch (error) {
    console.error("[contract-import] Baggrundskørsel fejlede:", error instanceof Error ? error.message : "ukendt fejl");
  }
}

async function handle(request: NextRequest) {
  try {
    const internal = requireInternalSecretApi(request, "contract-ai") || hasCronSecret(request);
    let callerOrgId: string | null = null;
    let callerUserId: string | null = null;
    if (!internal) {
      const session = await createSessionClient();
      const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
      if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
      callerOrgId = caller.orgId;
      callerUserId = caller.userId;
    }

    const body = await request.json().catch(() => ({})) as {
      jobId?: string;
      contractId?: string;
      orgId?: string;
    };
    const requestedOrgId = typeof body.orgId === "string" ? body.orgId : null;
    const orgId = internal ? requestedOrgId : callerOrgId;

    if (typeof body.contractId === "string") {
      const result = await runDirectContractJob({ contractId: body.contractId, orgId, actorUserId: callerUserId });
      return NextResponse.json({ ok: true, processed: true, ...result });
    }
    if (typeof body.jobId === "string") {
      const result = await processSpecificContractJob({ jobId: body.jobId, orgId });
      return NextResponse.json(result, { status: result.ok ? 200 : 500 });
    }

    if (internal) {
      // Cron and self-continuation get an immediate response. Vercel keeps the
      // worker alive through `after`, so pg_net never needs a five-minute HTTP
      // connection while the import itself may use the full function budget.
      after(() => drainAndContinue(orgId));
      return NextResponse.json({ ok: true, scheduled: true }, { status: 202 });
    }
    const result = await processPendingContractJobs(orgId);
    if (result.hasMore) after(triggerNextWorkerRun);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl";
    console.error("[contract-import] Workerfejl:", message);
    return NextResponse.json({ ok: false, error: "Kontraktkøen kunne ikke behandles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
