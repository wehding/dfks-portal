import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeRoute } from "@/lib/observability/privacy";
import { verifyPayloadSignature } from "@/lib/observability/signatures";
import { createServiceClient } from "@/lib/supabase/service";
import { updateObservabilitySourceStatus } from "@/lib/observability/store";

export const runtime = "nodejs";

type PerformancePayload = {
  runId: string;
  runUrl?: string;
  commitSha?: string;
  branch?: string;
  rowCount?: number;
  observedAt: string;
  results: Array<{
    routeName: string;
    route: string;
    project: string;
    scenario?: string;
    firstRowMs?: number;
    completeMs?: number;
    requestCount?: number;
    bytes?: number;
    passed: boolean;
    thresholds?: Record<string, number>;
  }>;
};

export async function POST(request: Request) {
  const secret = process.env.PERFORMANCE_INGEST_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const rawBody = await request.text();
  if (!verifyPayloadSignature(rawBody, request.headers.get("x-dfks-signature"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as PerformancePayload;
    if (!payload.runId || !Array.isArray(payload.results) || payload.results.length > 100) throw new Error("invalid_payload");
    const rows = payload.results.map(result => {
      const route = normalizeRoute(result.route);
      if (!route) throw new Error("invalid_route");
      const identity = `${payload.runId}:${payload.rowCount ?? 0}:${result.project}:${result.routeName}:${result.scenario ?? "default"}`;
      return {
        event_key: createHash("sha256").update(identity).digest("hex"),
        run_id: payload.runId.slice(0, 100),
        run_url: payload.runUrl?.startsWith("https://github.com/") ? payload.runUrl.slice(0, 300) : null,
        commit_sha: payload.commitSha?.slice(0, 40) ?? null,
        branch_name: payload.branch?.slice(0, 120) ?? null,
        row_count: Number.isInteger(payload.rowCount) ? payload.rowCount : null,
        project_name: result.project.slice(0, 40),
        route_name: result.routeName.slice(0, 80),
        route_template: route,
        scenario: result.scenario?.slice(0, 40) ?? null,
        first_row_ms: Number.isFinite(result.firstRowMs) ? Math.round(result.firstRowMs!) : null,
        complete_ms: Number.isFinite(result.completeMs) ? Math.round(result.completeMs!) : null,
        request_count: Number.isFinite(result.requestCount) ? Math.round(result.requestCount!) : null,
        transferred_bytes: Number.isFinite(result.bytes) ? Math.round(result.bytes!) : null,
        passed: Boolean(result.passed),
        thresholds: result.thresholds ?? {},
        observed_at: new Date(payload.observedAt).toISOString(),
      };
    });
    const db = createServiceClient();
    const { error } = await db.from("performance_test_results").upsert(rows, { onConflict: "event_key" });
    if (error) throw error;
    const allPassed = rows.every(row => row.passed);
    await updateObservabilitySourceStatus({
      source: "github_performance",
      ok: allPassed,
      lastEventAt: new Date(payload.observedAt).toISOString(),
      errorCode: allPassed ? null : "performance_threshold_failed",
      details: { results: rows.length, failed: rows.filter(row => !row.passed).length },
    });
    return NextResponse.json({ accepted: rows.length });
  } catch {
    return NextResponse.json({ error: "invalid_or_unavailable" }, { status: 400 });
  }
}
