import { NextResponse } from "next/server";
import { sanitiseRuntimeLogs, type RuntimeLog } from "@/lib/observability/ingestion";
import { storeObservabilityEvents, updateObservabilitySourceStatus } from "@/lib/observability/store";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

async function vercelFetch(path: string, token: string, teamId: string) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`https://api.vercel.com${path}${separator}teamId=${encodeURIComponent(teamId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`vercel_api_${response.status}`);
  return response.json();
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const token = process.env.VERCEL_OBSERVABILITY_TOKEN;
  const projectId = process.env.VERCEL_OBSERVABILITY_PROJECT_ID;
  const teamId = process.env.VERCEL_OBSERVABILITY_TEAM_ID;
  if (!token || !projectId || !teamId) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    const deployments = await vercelFetch(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&limit=1`, token, teamId) as { deployments?: Array<{ uid: string; created?: number }> };
    const deployment = deployments.deployments?.[0];
    if (!deployment) throw new Error("vercel_deployment_missing");
    const since = Date.now() - 20 * 60 * 1000;
    const logs = await vercelFetch(`/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deployment.uid)}/runtime-logs?since=${since}&limit=1000`, token, teamId) as RuntimeLog[] | { logs?: RuntimeLog[] };
    const rows = Array.isArray(logs) ? logs : logs.logs ?? [];
    const events = sanitiseRuntimeLogs(rows, deployment.uid);
    await storeObservabilityEvents(events);
    await updateObservabilitySourceStatus({
      source: "vercel_runtime",
      ok: true,
      lastEventAt: events.at(-1)?.observedAt ?? null,
      details: { scanned: rows.length, accepted: events.length, deployment: deployment.uid },
    });
    return NextResponse.json({ scanned: rows.length, accepted: events.length });
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 80) : "runtime_collection_failed";
    await updateObservabilitySourceStatus({ source: "vercel_runtime", ok: false, errorCode: code }).catch(() => undefined);
    return NextResponse.json({ error: "collection_failed" }, { status: 502 });
  }
}
