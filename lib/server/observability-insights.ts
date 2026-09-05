import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type SourceState = "pending" | "healthy" | "stale" | "degraded" | "disabled";

export type ObservabilityInsights = {
  traffic: {
    pageviews30d: number | null;
    sampleCount: number;
    deviceBreakdown: { desktop: number | null; mobile: number | null; tablet: number | null };
    topRoutes: Array<{ route: string; count: number }>;
  };
  webVitals: Record<"lcp" | "inp" | "cls" | "fcp" | "ttfb", { value: number | null; sampleCount: number; score: "good" | "needs-improvement" | "poor" | "unavailable" }>;
  performanceTests: Array<{
    key: string;
    routeName: string;
    route: string;
    project: string;
    scenario: string | null;
    firstRowMs: number | null;
    completeMs: number | null;
    passed: boolean;
    observedAt: string;
    rowCount: number | null;
    runUrl: string | null;
  }>;
  runtime: {
    errorCount30d: number | null;
    latestDeployment: string | null;
    errors: Array<{ id: string; occurredAt: string; route: string | null; statusCode: number | null; summary: string | null }>;
  };
  sources: Array<{ source: string; state: SourceState; lastEventAt: string | null; lastSuccessAt: string | null; errorCode: string | null }>;
  available: boolean;
  issue: string | null;
};

const EMPTY_VITALS: ObservabilityInsights["webVitals"] = {
  lcp: { value: null, sampleCount: 0, score: "unavailable" },
  inp: { value: null, sampleCount: 0, score: "unavailable" },
  cls: { value: null, sampleCount: 0, score: "unavailable" },
  fcp: { value: null, sampleCount: 0, score: "unavailable" },
  ttfb: { value: null, sampleCount: 0, score: "unavailable" },
};

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function vitalScore(metric: string, value: number | null): "good" | "needs-improvement" | "poor" | "unavailable" {
  if (value == null) return "unavailable";
  const limits: Record<string, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
  const [good, poor] = limits[metric] ?? [Infinity, Infinity];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

export async function fetchObservabilityInsights(db: SupabaseClient, sinceIso: string): Promise<ObservabilityInsights> {
  const [eventsRes, performanceRes, sourcesRes] = await Promise.all([
    db.from("observability_events")
      .select("id,source,event_type,metric_name,route_template,observed_at,numeric_value,device_class,deployment_id,status_code,error_summary")
      .gte("observed_at", sinceIso).order("observed_at", { ascending: false }).limit(5000),
    db.from("performance_test_results")
      .select("event_key,run_url,row_count,project_name,route_name,route_template,scenario,first_row_ms,complete_ms,passed,observed_at")
      .order("observed_at", { ascending: false }).limit(500),
    db.from("observability_source_status")
      .select("source,state,last_event_at,last_success_at,last_error_code").order("source"),
  ]);
  const error = eventsRes.error ?? performanceRes.error ?? sourcesRes.error;
  if (error) {
    return {
      traffic: { pageviews30d: null, sampleCount: 0, deviceBreakdown: { desktop: null, mobile: null, tablet: null }, topRoutes: [] },
      webVitals: EMPTY_VITALS,
      performanceTests: [],
      runtime: { errorCount30d: null, latestDeployment: null, errors: [] },
      sources: [], available: false, issue: "Telemetry-tabellerne er endnu ikke tilgængelige.",
    };
  }

  type EventRow = {
    id: string; source: string; event_type: string; metric_name: string | null; route_template: string | null;
    observed_at: string; numeric_value: number | null; device_class: string | null; deployment_id: string | null;
    status_code: number | null; error_summary: string | null;
  };
  const events = (eventsRes.data ?? []) as EventRow[];
  const analytics = events.filter(event => event.source === "vercel_analytics" && event.event_type === "pageview");
  const routeCounts = new Map<string, number>();
  const devices = { desktop: 0, mobile: 0, tablet: 0 };
  for (const event of analytics) {
    if (event.route_template) routeCounts.set(event.route_template, (routeCounts.get(event.route_template) ?? 0) + 1);
    if (event.device_class === "desktop" || event.device_class === "mobile" || event.device_class === "tablet") devices[event.device_class] += 1;
  }
  const classifiedDevices = devices.desktop + devices.mobile + devices.tablet;
  const speed = events.filter(event => event.source === "vercel_speed_insights" && event.numeric_value != null);
  const webVitals = Object.fromEntries(["LCP", "INP", "CLS", "FCP", "TTFB"].map(metric => {
    const values = speed.filter(event => event.metric_name?.toUpperCase() === metric).map(event => Number(event.numeric_value));
    const value = percentile(values, 0.75);
    return [metric.toLowerCase(), { value, sampleCount: values.length, score: vitalScore(metric, value) }];
  })) as ObservabilityInsights["webVitals"];

  type PerformanceRow = {
    event_key: string; run_url: string | null; row_count: number | null; project_name: string; route_name: string;
    route_template: string; scenario: string | null; first_row_ms: number | null; complete_ms: number | null; passed: boolean; observed_at: string;
  };
  const latest = new Map<string, PerformanceRow>();
  for (const row of (performanceRes.data ?? []) as PerformanceRow[]) {
    const key = `${row.project_name}:${row.route_name}:${row.scenario ?? "default"}:${row.row_count ?? 0}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const runtime = events.filter(event => event.source === "vercel_runtime" && event.event_type === "runtime_error");
  const freshnessMs: Record<string, number> = {
    vercel_analytics: 36 * 60 * 60 * 1000,
    vercel_speed_insights: 36 * 60 * 60 * 1000,
    vercel_runtime: 30 * 60 * 1000,
    github_performance: 8 * 24 * 60 * 60 * 1000,
  };
  return {
    traffic: {
      pageviews30d: analytics.length,
      sampleCount: analytics.length,
      deviceBreakdown: classifiedDevices ? {
        desktop: Math.round(devices.desktop / classifiedDevices * 100), mobile: Math.round(devices.mobile / classifiedDevices * 100), tablet: Math.round(devices.tablet / classifiedDevices * 100),
      } : { desktop: null, mobile: null, tablet: null },
      topRoutes: [...routeCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([route, count]) => ({ route, count })),
    },
    webVitals,
    performanceTests: [...latest.values()].slice(0, 40).map(row => ({
      key: row.event_key, routeName: row.route_name, route: row.route_template, project: row.project_name, scenario: row.scenario,
      firstRowMs: row.first_row_ms, completeMs: row.complete_ms, passed: row.passed, observedAt: row.observed_at, rowCount: row.row_count, runUrl: row.run_url,
    })),
    runtime: {
      errorCount30d: runtime.length,
      latestDeployment: events.find(event => event.source === "vercel_runtime" && event.deployment_id)?.deployment_id ?? null,
      errors: runtime.slice(0, 30).map(event => ({ id: event.id, occurredAt: event.observed_at, route: event.route_template, statusCode: event.status_code, summary: event.error_summary })),
    },
    sources: (sourcesRes.data ?? []).map(row => {
      const lastSuccess = row.last_success_at ? new Date(row.last_success_at).getTime() : null;
      const state = row.state === "healthy" && lastSuccess != null && Date.now() - lastSuccess > (freshnessMs[row.source] ?? Infinity)
        ? "stale"
        : row.state as SourceState;
      return { source: row.source, state, lastEventAt: row.last_event_at, lastSuccessAt: row.last_success_at, errorCode: row.last_error_code };
    }),
    available: true,
    issue: null,
  };
}
