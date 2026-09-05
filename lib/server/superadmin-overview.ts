import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { calculateResponseTimeStats, formatUserActionDescription, type ResponseEvent } from "@/lib/admin-dashboard";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { fetchObservabilityInsights, type ObservabilityInsights } from "@/lib/server/observability-insights";
import type { KeyPageTiming } from "@/lib/server/key-page-timing-stats";

export type ActionCategoryDetail = {
  key: string;
  label: string;
  count: number;
  pct: number;
  explanation: string;
};

export type SuperadminInsightsData = {
  observability: ObservabilityInsights;
  analytics: {
    activeUsers24h: number;
    activeUsers7d: number;
    activeUsers30d: number;
    totalMembers: number;
    totalAdmins: number;
    actionsLast30Days: number;
    baselineDate: string;
    sessionBreakdown: {
      membersPct: number;
      adminsPct: number;
      memberEvents: number;
      adminEvents: number;
    };
    actionCategories: ActionCategoryDetail[];
    deviceBreakdown: {
      desktop: number | null;
      mobile: number | null;
      tablet: number | null;
    };
  };
  speedInsights: {
    medianResponseTimeMs: number | null;
    p90ResponseTimeMs: number | null;
    webVitals: {
      lcp: { value: string | null; score: "good" | "needs-improvement" | "poor" | "unavailable"; target: string; explanation: string };
      inp: { value: string | null; score: "good" | "needs-improvement" | "poor" | "unavailable"; target: string; explanation: string };
      cls: { value: string | null; score: "good" | "needs-improvement" | "poor" | "unavailable"; target: string; explanation: string };
      fcp: { value: string | null; score: "good" | "needs-improvement" | "poor" | "unavailable"; target: string; explanation: string };
      ttfb: { value: string | null; score: "good" | "needs-improvement" | "poor" | "unavailable"; target: string; explanation: string };
    };
    keyPages: KeyPageTiming[];
    systemHealth: "healthy" | "degraded" | "unknown";
    sourceLabel: string;
  };
  collection: {
    collectedAt: string;
    complete: boolean;
    issues: string[];
    selectedOrgId: string | null;
  };
  adminActivityLog: Array<{
    id: string;
    occurredAt: string;
    orgId: string | null;
    orgName: string;
    actorName: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityLabel: string | null;
    description: string;
  }>;
  userActivityLog: Array<{
    id: string;
    occurredAt: string;
    orgId: string | null;
    orgName: string;
    actorName: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityLabel: string | null;
    description: string;
  }>;
  organisations: Array<{
    id: string;
    name: string;
  }>;
  systemErrors: Array<{
    id: string;
    occurredAt: string;
    action: string;
    outcome: string;
    errorCode: string | null;
    systemComponent: string | null;
    actorName: string | null;
    description: string;
  }>;
};

export async function assertSuperadminRole(supabase: SupabaseClient) {
  return assertAdminRole(supabase, ["superadmin"]);
}

function formatAdminActionDescription(action: string, entityType: string, entityLabel: string | null): string {
  if (action === "validate" && (entityType === "contracts" || entityType.startsWith("contract"))) {
    return entityLabel ? `Validerede kontrakt: ${entityLabel}` : "Validerede en kontrakt";
  }
  if (action === "approve") {
    return entityLabel ? `Godkendte: ${entityLabel}` : `Godkendte ${entityType}`;
  }
  if (action === "update" && entityType === "organisations") {
    return "Opdaterede organisationsindstillinger";
  }
  if (action === "update" && entityType === "contracts") {
    return entityLabel ? `Redigerede kontrakt: ${entityLabel}` : "Redigerede kontrakt";
  }
  if (action === "update" && entityType === "works") {
    return entityLabel ? `Redigerede værk: ${entityLabel}` : "Redigerede værk";
  }
  if (action === "create" && entityType === "users") {
    return entityLabel ? `Oprettede bruger: ${entityLabel}` : "Oprettede ny bruger";
  }
  if (action === "invite") {
    return entityLabel ? `Inviterede bruger: ${entityLabel}` : "Sendte invitation";
  }
  if (action === "link") {
    return entityLabel ? `Tilknyttede: ${entityLabel}` : `Tilknyttede ${entityType}`;
  }
  if (action === "unlink") {
    return entityLabel ? `Frakoblede: ${entityLabel}` : `Frakoblede ${entityType}`;
  }
  if (action === "delete" || action === "archive") {
    return entityLabel ? `Arkiverede/slettede: ${entityLabel}` : `Arkiverede ${entityType}`;
  }
  if (action === "retention") {
    return entityLabel ? `Udførte retention på: ${entityLabel}` : "Udførte dataoprydning / retention";
  }
  if (action === "ai_analysis") {
    return entityLabel ? `Kørte AI-analyse på: ${entityLabel}` : "Kørte AI-kontraktanalyse";
  }
  return `${action} på ${entityLabel || entityType}`;
}

const ACTION_EXPLANATIONS: Record<string, { label: string; explanation: string }> = {
  create: {
    label: "Oprettelse & Upload",
    explanation: "Nye kontrakter og værker indlæst eller oprettet i systemet.",
  },
  download: {
    label: "Download & Eksport",
    explanation: "Dokumenter, regneark og revisionsudtræk hentet af brugere.",
  },
  read: {
    label: "Opslag & Søgning",
    explanation: "Søgninger og visning af kontrakter, værker eller rettighedshavere.",
  },
  retention: {
    label: "Retention & Oprydning",
    explanation: "Automatisk anonymisering og sletning efter udløbet opbevaringsfrist.",
  },
  ai_analysis: {
    label: "AI Analyse & OCR",
    explanation: "Automatisk udlæsning af klausuler, parter, løn og arbejdsandele via Vision/Gemini.",
  },
  link: {
    label: "Værktilknytning & Erklæring",
    explanation: "Medlemmers tro- og loveerklæringer samt sammenkædning af værk og kontrakt.",
  },
  validate: {
    label: "Validering & Godkendelse",
    explanation: "Juridisk gennemgang og administrativ godkendelse af kontrakter og krav.",
  },
  complete_onboarding: {
    label: "Onboarding & Profil",
    explanation: "Gennemførte introduktionstrin og opdatering af medlemsstamdata.",
  },
};

// Nulstillingsdato: Data tælles fra dags dato (3. september 2026), hvor de første rigtige brugere lukkes ind
export const LAUNCH_BASELINE_ISO = "2026-09-03T00:00:00.000Z";

function resolveBaselineIso(customBaselineIso?: string): string {
  const candidate = customBaselineIso || process.env.SUPERADMIN_INSIGHTS_BASELINE_ISO || LAUNCH_BASELINE_ISO;
  return Number.isNaN(new Date(candidate).getTime()) ? LAUNCH_BASELINE_ISO : candidate;
}

export async function fetchSuperadminInsights(input: {
  caller: { userId: string; orgId: string; role: string };
  customBaselineIso?: string;
  orgId?: string | null;
}): Promise<SuperadminInsightsData> {
  const db = createServiceClient();
  const now = Date.now();
  const baselineIso = resolveBaselineIso(input.customBaselineIso);
  const baselineTime = new Date(baselineIso).getTime();
  const selectedOrgId = input.orgId || null;

  // Tidsvinduer afskåret så der ikke tælles hændelser før lancering/nulstilling
  const t24h = new Date(Math.max(now - 24 * 60 * 60 * 1000, baselineTime)).toISOString();
  const t7d = new Date(Math.max(now - 7 * 24 * 60 * 60 * 1000, baselineTime)).toISOString();
  const t30d = new Date(Math.max(now - 30 * 24 * 60 * 60 * 1000, baselineTime)).toISOString();

  const activitySelect = selectedOrgId
    ? "id,occurred_at,action,entity_type,entity_id,entity_label,actor_display_name,actor_email,actor_role,source,audit_event_organisations!inner(org_id,org_name),audit_event_subjects(target_member_uuid)"
    : "id,occurred_at,action,entity_type,entity_id,entity_label,actor_display_name,actor_email,actor_role,source,audit_event_organisations(org_id,org_name),audit_event_subjects(target_member_uuid)";
  let adminLogsQuery = db.from("audit_events")
    .select(activitySelect)
    .gte("occurred_at", t30d)
    .neq("actor_role", "member")
    .neq("source", "portal")
    .order("occurred_at", { ascending: false })
    .limit(60);
  let userLogsQuery = db.from("audit_events")
    .select(activitySelect)
    .gte("occurred_at", t30d)
    .or("source.eq.portal,actor_role.eq.member")
    .order("occurred_at", { ascending: false })
    .limit(60);
  const errorSelect = selectedOrgId
    ? "id,occurred_at,action,outcome,error_code,system_component,actor_display_name,entity_type,entity_label,audit_event_organisations!inner(org_id)"
    : "id,occurred_at,action,outcome,error_code,system_component,actor_display_name,entity_type,entity_label";
  let errorLogsQuery = db.from("audit_events")
    .select(errorSelect)
    .gte("occurred_at", t30d)
    .or("outcome.eq.failed,action.eq.security_failure")
    .order("occurred_at", { ascending: false })
    .limit(30);
  let commentsQuery = db.from("contract_comments")
    .select("id,contract_id,author_role,created_at,org_id")
    .gte("created_at", t30d)
    .limit(500);
  if (selectedOrgId) {
    adminLogsQuery = adminLogsQuery.eq("audit_event_organisations.org_id", selectedOrgId);
    userLogsQuery = userLogsQuery.eq("audit_event_organisations.org_id", selectedOrgId);
    errorLogsQuery = errorLogsQuery.eq("audit_event_organisations.org_id", selectedOrgId);
    commentsQuery = commentsQuery.eq("org_id", selectedOrgId);
  }

  const [
    summaryRes,
    adminLogsRes,
    userLogsRes,
    organisationsRes,
    errorLogsRes,
    commentsRes,
    observability,
  ] = await Promise.all([
    db.rpc("get_superadmin_insights_summary", {
      p_actor_user_id: input.caller.userId,
      p_from_24h: t24h,
      p_from_7d: t7d,
      p_from_30d: t30d,
      p_org_id: selectedOrgId,
    }),
    adminLogsQuery,
    userLogsQuery,
    db.from("organisations").select("id, name").order("name"),
    errorLogsQuery,
    commentsQuery,
    fetchObservabilityInsights(db, t30d),
  ]);

  const queryResults = [summaryRes, adminLogsRes, userLogsRes, organisationsRes, errorLogsRes, commentsRes];
  const issues = queryResults
    .map(result => result.error?.message)
    .filter((message): message is string => Boolean(message));

  if (summaryRes.error || !summaryRes.data) {
    throw new Error("Systemindsigt kunne ikke beregnes sikkert.");
  }

  type SummaryRow = {
    activeUsers24h: number;
    activeUsers7d: number;
    activeUsers30d: number;
    totalMembers: number;
    totalAdmins: number;
    actionsLast30Days: number;
    memberEvents: number;
    adminEvents: number;
    actionCounts: Record<string, number>;
  };
  const summary = summaryRes.data as unknown as SummaryRow;
  const totalMembers = Number(summary.totalMembers ?? 0);
  const totalAdmins = Number(summary.totalAdmins ?? 0);

  // Hændelser opgjort fra baseline
  const memberEventsCount = Number(summary.memberEvents ?? 0);
  const adminEventsCount = Number(summary.adminEvents ?? 0);
  const actionCounts = summary.actionCounts ?? {};
  const totalEvents = Number(summary.actionsLast30Days ?? 0);
  const membersPct = totalEvents > 0 ? Math.round((memberEventsCount / totalEvents) * 100) : 0;
  const adminsPct = totalEvents > 0 ? 100 - membersPct : 0;

  // Faktiske handlingskategorier (0 hvis ingen handlinger er sket)
  const categoriesList: Array<{ key: string; actions: string[] }> = [
    { key: "create", actions: ["create"] },
    { key: "download", actions: ["download", "export", "sar_export"] },
    { key: "read", actions: ["read", "search"] },
    { key: "retention", actions: ["retention"] },
    { key: "ai_analysis", actions: ["ai_analysis"] },
    { key: "link", actions: ["link", "update", "unlink"] },
    { key: "validate", actions: ["validate", "approve"] },
    { key: "complete_onboarding", actions: ["complete_onboarding", "require_onboarding"] },
  ];

  const actionCategories: ActionCategoryDetail[] = categoriesList.map(cat => {
    let count = 0;
    for (const a of cat.actions) {
      count += actionCounts[a] ?? 0;
    }
    const meta = ACTION_EXPLANATIONS[cat.key] || { label: cat.key, explanation: "Systemhandling" };
    return {
      key: cat.key,
      label: meta.label,
      count,
      pct: totalEvents > 0 ? Math.round((count / totalEvents) * 100) : 0,
      explanation: meta.explanation,
    };
  });

  // Speed insights response times calculation
  const responseEvents: ResponseEvent[] = (commentsRes.data ?? []).map(c => ({
    threadId: `c-${c.contract_id}`,
    role: c.author_role === "member" ? "member" : "staff",
    createdAt: c.created_at,
  }));
  const speedStats = calculateResponseTimeStats(responseEvents, t30d);

  // Admin logs mapping
  type RawAuditLogRow = {
    id: string;
    occurred_at: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    entity_label: string | null;
    actor_display_name: string | null;
    actor_email: string | null;
    actor_role: string | null;
    source: string;
    audit_event_organisations?: Array<{ org_id: string; org_name: string | null }>;
    audit_event_subjects?: Array<{ target_member_uuid: string }>;
  };

  const adminActivityLog = ((adminLogsRes.data ?? []) as unknown as RawAuditLogRow[]).map(row => {
    const org = row.audit_event_organisations?.[0];
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      orgId: org?.org_id ?? null,
      orgName: org?.org_name || "Generel administration",
      actorName: row.actor_display_name || row.actor_email || "Administrator",
      actorRole: row.actor_role || "admin",
      action: row.action,
      entityType: row.entity_type,
      entityLabel: row.entity_label,
      description: formatAdminActionDescription(row.action, row.entity_type, row.entity_label),
    };
  });

  // User logs mapping
  const userActivityLog = ((userLogsRes.data ?? []) as unknown as RawAuditLogRow[]).map(row => {
    const org = row.audit_event_organisations?.[0];
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      orgId: org?.org_id ?? null,
      orgName: org?.org_name || "Dansk Filmklipperselskab",
      actorName: row.actor_display_name || "Medlem",
      actorRole: row.actor_role || "member",
      action: row.action,
      entityType: row.entity_type,
      entityLabel: row.entity_label,
      description: formatUserActionDescription(row.action, row.entity_type, row.entity_label),
    };
  });

  // Organisations list
  const organisations = (organisationsRes.data ?? []).map(o => ({
    id: o.id,
    name: o.name,
  }));

  // System errors mapping
  type RawErrorLogRow = {
    id: string;
    occurred_at: string;
    action: string;
    outcome: string | null;
    error_code: string | null;
    system_component: string | null;
    actor_display_name: string | null;
    entity_type: string | null;
  };
  const systemErrors = ((errorLogsRes.data ?? []) as unknown as RawErrorLogRow[]).map(row => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    outcome: row.outcome || "failed",
    errorCode: row.error_code,
    systemComponent: row.system_component,
    actorName: row.actor_display_name,
    description: `Fejl i ${row.system_component || row.entity_type || "systemet"}: ${row.error_code || "Uventet fejl"}`,
  }));

  const displayedSubjects = [...new Set(
    [...((adminLogsRes.data ?? []) as unknown as RawAuditLogRow[]), ...((userLogsRes.data ?? []) as unknown as RawAuditLogRow[])]
      .flatMap(row => row.audit_event_subjects ?? [])
      .map(subject => subject.target_member_uuid)
      .filter(Boolean),
  )];
  await recordSensitiveFlow({
    actor: {
      userId: input.caller.userId,
      orgId: input.caller.orgId,
      role: input.caller.role,
      source: "admin",
    },
    action: "read",
    component: "admin.superadmin.insights",
    entityType: "audit_insights",
    targetMemberUuids: displayedSubjects,
    orgIds: selectedOrgId ? [selectedOrgId] : [],
    purposeCode: "security_and_operations_monitoring",
    legalBasis: "GDPR Art. 6(1)(f), Art. 9(2)(d)",
    dataCategories: ["audit_data", "usage_data", "union_membership_data"],
    counts: {
      displayedAdminEvents: adminActivityLog.length,
      displayedMemberEvents: userActivityLog.length,
      filteredByOrganisation: Boolean(selectedOrgId),
    },
  });

  return {
    observability,
    analytics: {
      activeUsers24h: Number(summary.activeUsers24h ?? 0),
      activeUsers7d: Number(summary.activeUsers7d ?? 0),
      activeUsers30d: Number(summary.activeUsers30d ?? 0),
      totalMembers,
      totalAdmins,
      actionsLast30Days: totalEvents,
      baselineDate: baselineIso,
      sessionBreakdown: {
        membersPct,
        adminsPct,
        memberEvents: memberEventsCount,
        adminEvents: adminEventsCount,
      },
      actionCategories,
      deviceBreakdown: observability.traffic.deviceBreakdown,
    },
    speedInsights: {
      medianResponseTimeMs: speedStats.medianMs,
      p90ResponseTimeMs: speedStats.p90Ms,
      webVitals: {
        lcp: { value: null, score: "unavailable", target: "< 2.5s", explanation: "Indlæsningstid for sidens største element (f.eks. tabel/PDF)" },
        inp: { value: null, score: "unavailable", target: "< 200ms", explanation: "Brugerens oplevede klik- og tastaturforsinkelse" },
        cls: { value: null, score: "unavailable", target: "< 0.1", explanation: "Visuel layout-stabilitet under side-rendering" },
        fcp: { value: null, score: "unavailable", target: "< 1.8s", explanation: "Tidspunkt hvor det første indhold vises på skærmen" },
        ttfb: { value: null, score: "unavailable", target: "< 800ms", explanation: "Serverens svartid fra forespørgsel til første datapakke" },
      },
      keyPages: [],
      systemHealth: !observability.available ? "unknown" : issues.length === 0 && observability.sources.every(source => source.state !== "degraded") ? "healthy" : "degraded",
      sourceLabel: "Vercel Speed Insights og GitHub Actions",
    },
    collection: {
      collectedAt: new Date(now).toISOString(),
      complete: issues.length === 0 && observability.available,
      issues: [...issues.map(() => "En datakilde kunne ikke læses"), ...(observability.issue ? [observability.issue] : [])],
      selectedOrgId,
    },
    adminActivityLog,
    userActivityLog,
    organisations,
    systemErrors,
  };
}
