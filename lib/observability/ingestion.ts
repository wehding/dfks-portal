import { createHash } from "node:crypto";
import { normalizeRoute, sanitiseRuntimeMessage } from "./privacy";
import type { SafeObservabilityEvent } from "./store";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function stringValue(...values: unknown[]): string | null {
  return values.find(value => typeof value === "string") as string | null ?? null;
}

function numberValue(...values: unknown[]): number | null {
  const value = values.find(item => typeof item === "number" && Number.isFinite(item));
  return typeof value === "number" ? value : null;
}

function timestampValue(...values: unknown[]): string {
  const value = values.find(item => typeof item === "string" || typeof item === "number");
  const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value as string | number);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function parseDrainBody(rawBody: string): unknown[] {
  try {
    const parsed = JSON.parse(rawBody);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return rawBody.split("\n").filter(Boolean).map(line => JSON.parse(line));
  }
}

export function sanitiseDrainEvents(payloads: unknown[]): SafeObservabilityEvent[] {
  return payloads.flatMap((value, index) => {
    const item = record(value);
    if (!item) return [];
    const nested = record(item.payload) ?? record(item.data) ?? item;
    const schema = stringValue(item.schema, nested.schema)?.toLowerCase() ?? "";
    const type = stringValue(item.type, nested.type, nested.eventType)?.toLowerCase() ?? "";
    const metric = stringValue(nested.metric, nested.name, nested.metricName, nested.metricType)?.toUpperCase();
    const isSpeed = schema.includes("speed_insights") || type.includes("speed")
      || Boolean(metric && ["LCP", "INP", "CLS", "FCP", "TTFB", "FID"].includes(metric));
    const isAnalytics = schema.includes("analytics") || type.includes("analytics")
      || type.includes("pageview") || type.includes("page_view");
    if (!isSpeed && !isAnalytics) return [];
    const route = normalizeRoute(stringValue(nested.url, nested.path, nested.route));
    if (!route) return [];
    const observedAt = timestampValue(nested.timestamp, nested.timestampInMs, item.timestamp);
    const identity = stringValue(item.id, nested.id, nested.eventId)
      ?? createHash("sha256").update(`${type}:${route}:${observedAt}:${index}`).digest("hex");
    const deviceInfo = record(nested.device);
    const device = stringValue(nested.deviceType, deviceInfo?.type, deviceInfo?.category)?.toLowerCase();
    const deviceClass = device === "desktop" || device === "mobile" || device === "tablet" ? device : "unknown";
    return [{
      source: isSpeed ? "vercel_speed_insights" : "vercel_analytics",
      eventType: isSpeed ? "web_vital" : "pageview",
      metricName: isSpeed ? metric : null,
      route,
      observedAt,
      value: numberValue(nested.value, nested.metricValue),
      deviceClass,
      eventIdentity: identity,
      metadata: {},
    } satisfies SafeObservabilityEvent];
  });
}

export type RuntimeLog = {
  id?: string;
  rowId?: string;
  timestampInMs?: number;
  timestamp?: number | string;
  level?: string;
  message?: string;
  requestPath?: string;
  path?: string;
  responseStatusCode?: number;
  statusCode?: number;
  source?: string;
};

export function sanitiseRuntimeLogs(logs: RuntimeLog[], deploymentId: string): SafeObservabilityEvent[] {
  return logs.flatMap((log, index) => {
    const level = log.level?.toLowerCase() ?? "info";
    const statusCode = log.responseStatusCode ?? log.statusCode ?? null;
    const message = sanitiseRuntimeMessage(log.message);
    const isPerformance = message?.includes("[list-performance]") ?? false;
    const isError = level === "error" || level === "warning" || level === "warn" || (statusCode ?? 0) >= 500;
    if (!isPerformance && !isError) return [];
    const observedAt = timestampValue(log.timestampInMs, log.timestamp);
    const safeSummary = /schema cache|relationship|PGRST/i.test(message ?? "")
      ? "En databaseforespørgsel kunne ikke gennemføres"
      : statusCode != null && statusCode >= 500
        ? `Serveren returnerede HTTP ${statusCode}`
        : "En teknisk serverfejl blev registreret";
    return [{
      source: "vercel_runtime",
      eventType: isPerformance ? "list_performance" : "runtime_error",
      route: normalizeRoute(log.requestPath ?? log.path),
      observedAt,
      deploymentId,
      statusCode,
      errorSummary: isError ? safeSummary : null,
      eventIdentity: log.rowId ?? log.id ?? `${deploymentId}:${observedAt}:${index}`,
      metadata: { level },
    } satisfies SafeObservabilityEvent];
  });
}
