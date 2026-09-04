import "server-only";

import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeRoute, sanitiseRuntimeMessage } from "./privacy";

export type SafeObservabilityEvent = {
  source: "vercel_analytics" | "vercel_speed_insights" | "vercel_runtime";
  eventType: string;
  observedAt: string;
  route?: string | null;
  metricName?: string | null;
  value?: number | null;
  deviceClass?: "desktop" | "mobile" | "tablet" | "unknown" | null;
  deploymentId?: string | null;
  statusCode?: number | null;
  errorSummary?: string | null;
  eventIdentity: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export async function storeObservabilityEvents(events: SafeObservabilityEvent[]) {
  if (!events.length) return { stored: 0 };
  const db = createServiceClient();
  const rows = events.map(event => ({
    event_key: createHash("sha256").update(`${event.source}:${event.eventIdentity}`).digest("hex"),
    source: event.source,
    event_type: event.eventType.slice(0, 80),
    metric_name: event.metricName?.slice(0, 40) ?? null,
    route_template: normalizeRoute(event.route),
    observed_at: event.observedAt,
    numeric_value: Number.isFinite(event.value) ? event.value : null,
    device_class: event.deviceClass ?? null,
    environment: "production",
    deployment_id: event.deploymentId?.slice(0, 100) ?? null,
    status_code: event.statusCode ?? null,
    error_fingerprint: event.errorSummary
      ? createHash("sha256").update(event.errorSummary).digest("hex")
      : null,
    error_summary: sanitiseRuntimeMessage(event.errorSummary),
    sample_metadata: event.metadata ?? {},
  }));
  const { error } = await db.from("observability_events").upsert(rows, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) throw new Error(`observability_store_failed:${error.code ?? "unknown"}`);
  return { stored: rows.length };
}

export async function updateObservabilitySourceStatus(input: {
  source: "vercel_analytics" | "vercel_speed_insights" | "vercel_runtime" | "github_performance";
  ok: boolean;
  lastEventAt?: string | null;
  errorCode?: string | null;
  details?: Record<string, string | number | boolean | null>;
}) {
  const now = new Date().toISOString();
  const db = createServiceClient();
  const timestamps = input.ok
    ? { last_success_at: now }
    : { last_failure_at: now };
  const { error } = await db.from("observability_source_status").upsert({
    source: input.source,
    state: input.ok ? "healthy" : "degraded",
    last_event_at: input.lastEventAt ?? null,
    ...timestamps,
    last_error_code: input.errorCode?.slice(0, 80) ?? null,
    safe_details: input.details ?? {},
    updated_at: now,
  }, { onConflict: "source" });
  if (error) throw new Error(`observability_status_failed:${error.code ?? "unknown"}`);
}
