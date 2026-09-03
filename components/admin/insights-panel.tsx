"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BrainCircuit,
  ChevronDown,
  Zap,
  Users2,
  AlertTriangle,
  Clock,
  Building2,
  CheckCircle2,
  BarChart3,
  Smartphone,
  Monitor,
  Tablet,
  Shield,
  Copy,
  Check,
  FileDown,
  Search,
  Trash2,
  Sparkles,
  Link2,
  CheckCheck,
  UserCheck,
  User,
  ArrowRight,
} from "lucide-react";
import type { SuperadminInsightsData } from "@/lib/server/superadmin-overview";
import { Badge } from "@/components/ui/badge";
import { formatResponseDuration } from "@/lib/admin-dashboard";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { recordSuperadminInsightsExport } from "@/app/actions/superadmin-insights";

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "Lige nu";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `for ${diffMin} min. siden`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `for ${diffHours} t. siden`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "I går";
  if (diffDays < 30) return `for ${diffDays} dage siden`;
  return new Date(isoString).toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

function getCategoryIcon(key: string) {
  switch (key) {
    case "create": return Sparkles;
    case "download": return FileDown;
    case "read": return Search;
    case "retention": return Trash2;
    case "ai_analysis": return BrainCircuit;
    case "link": return Link2;
    case "validate": return CheckCheck;
    case "complete_onboarding": return UserCheck;
    default: return BarChart3;
  }
}

export function InsightsPanel({ data }: { data: SuperadminInsightsData }) {
  const router = useRouter();
  const [isFiltering, startFiltering] = useTransition();
  const baselineLabel = new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Copenhagen",
  }).format(new Date(data.analytics.baselineDate));
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { analytics: true, speed: true, activity: true, errors: true };
    try {
      const saved = localStorage.getItem("dfks_insights_sections");
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return { analytics: true, speed: true, activity: true, errors: true };
  });

  const [activityTab, setActivityTab] = useState<"admin" | "user">("admin");
  const [selectedOrgId, setSelectedOrgId] = useState<string>(data.collection.selectedOrgId ?? "all");
  const [copiedReport, setCopiedReport] = useState(false);
  const [showReportPreview, setShowReportPreview] = useState(false);

  const toggleSection = (key: string) => {
    setOpenSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("dfks_insights_sections", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const { analytics, speedInsights, adminActivityLog, userActivityLog, organisations, systemErrors, collection } = data;
  const filteredAdminLogs = adminActivityLog;
  const filteredUserLogs = userActivityLog;

  const applyOrganisationFilter = (orgId: string) => {
    setSelectedOrgId(orgId);
    startFiltering(() => {
      router.replace(orgId === "all" ? "/admin/insights" : `/admin/insights?org=${encodeURIComponent(orgId)}`);
    });
  };

  // Generer tekst-/markdown-rapport over de seneste dages fejl
  const generateErrorReportText = () => {
    const timestamp = new Date().toLocaleString("da-DK", { dateStyle: "long", timeStyle: "short" });
    const lines: string[] = [
      `# Fejl- og Hændelsesrapport – DFKS Portal`,
      `Genereret: ${timestamp}`,
      `Datakilde komplet: ${collection.complete ? "Ja" : "Nej"}`,
      ``,
      `## 1. Opsummering`,
      `- Registrerede fejl/sikkerhedshændelser (30d): ${systemErrors.length}`,
      `- Aktive organisationer overvåget: ${organisations.length}`,
      `- Systemstatus: ${speedInsights.systemHealth === "healthy" ? "Normal drift" : "Advarsel"}`,
      `- Median responstid: ${formatResponseDuration(speedInsights.medianResponseTimeMs)}`,
      ``,
      `## 2. Registrerede Fejllogs`,
    ];

    if (systemErrors.length === 0) {
      lines.push(`Ingen registrerede fejl i perioden.`);
    } else {
      systemErrors.forEach((err, idx) => {
        const timeStr = new Date(err.occurredAt).toLocaleString("da-DK");
        lines.push(`### Fejl #${idx + 1}: ${err.description}`);
        lines.push(`- Tidspunkt: ${timeStr} (${formatRelativeTime(err.occurredAt)})`);
        lines.push(`- Komponent: ${err.systemComponent || "Core System"}`);
        lines.push(`- Fejlkode: ${err.errorCode || "N/A"}`);
        lines.push(`- Udfald: ${err.outcome}`);
        lines.push(``);
      });
    }

    lines.push(`## 3. Nøglesider Indlæsningshastighed`);
    speedInsights.keyPages.forEach(p => {
      lines.push(p.sampleCount > 0 && p.averageMs != null && p.p90Ms != null
        ? `- ${p.name} (${p.route}): Gns. ${p.averageMs} ms (P90: ${p.p90Ms} ms, ${p.sampleCount} proceslokale målinger) – Status: ${p.statusLabel}`
        : `- ${p.name} (${p.route}): Ingen målinger tilgængelige`);
    });

    return lines.join("\n");
  };

  const handleCopyReport = async () => {
    const reportText = generateErrorReportText();
    try {
      await recordSuperadminInsightsExport({
        orgId: selectedOrgId === "all" ? null : selectedOrgId,
        errorCount: systemErrors.length,
      });
      await navigator.clipboard.writeText(reportText);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    } catch {
      // fallback
    }
  };

  return (
    <div className="space-y-4 max-w-6xl pb-10">
      {/* Top Banner / Badge */}
      <div className="rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/70 via-purple-50/50 to-blue-50/70 p-4 shadow-sm dark:border-indigo-900/50 dark:from-indigo-950/20 dark:via-purple-950/20 dark:to-blue-950/20">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300/80 bg-indigo-100/70 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-800 shadow-sm dark:border-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
              <BrainCircuit className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Super Admin Aktivitetsinfo</span>
            </div>
            <h1 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Insights & Systemovervågning
            </h1>
            <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
              Driftsoversigt baseret på auditdata og tilgængelige målinger. Manglende telemetri markeres tydeligt.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-background/80 text-[11px] px-2.5 py-1">
              <Shield className="mr-1 h-3.5 w-3.5 text-indigo-500" /> Kun synlig for Superadmin
            </Badge>
          </div>
        </div>
      </div>

      {!collection.complete && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          En eller flere datakilder kunne ikke læses. Oversigten er markeret som delvis og må ikke bruges som fuldstændigt revisionsbevis.
        </div>
      )}

      {/* Sektion 1: Vercel Analytics & Brugeraktivitet */}
      <Collapsible
        open={openSections.analytics}
        onOpenChange={() => toggleSection("analytics")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3.5 sm:p-4 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Auditbaseret aktivitet og handlingsfordeling
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Eksakte aggregater fra auditdatabasen for det valgte tidsrum og organisationsfilter
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-[10px] font-medium border-0">
              {collection.complete ? "Data indlæst" : "Delvise data"}
            </Badge>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                openSections.analytics ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border/60 p-3.5 sm:p-4 pt-3 space-y-4">
          {/* Nulstillings-info */}
          <div className="flex items-center justify-between rounded-lg border border-blue-200/80 bg-blue-50/60 dark:border-blue-950 dark:bg-blue-950/20 px-3 py-1.5 text-[11px] text-blue-900 dark:text-blue-200">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
              <span>
                <strong>Måleperiode:</strong> Målingen tæller reelle handlinger fra {baselineLabel}.
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">Ekskluderer historisk testdata</span>
          </div>

          {/* Nøgletal (kompakt) */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-lg border bg-muted/20 p-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Aktive i dag (24t)</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{analytics.activeUsers24h}</p>
              <p className="text-[10px] text-emerald-600 font-medium">Brugere med aktivitet</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Aktive (7 dage)</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{analytics.activeUsers7d}</p>
              <p className="text-[10px] text-muted-foreground">Unikke brugere</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Månedlige aktive (30d)</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{analytics.activeUsers30d}</p>
              <p className="text-[10px] text-muted-foreground">Unikke brugere (faktisk)</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Handlinger (30d)</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{analytics.actionsLast30Days}</p>
              <p className="text-[10px] text-muted-foreground">Reelle brugerhandlinger</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {/* Sessioner & roller */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                <span>Aktivitetsfordeling</span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {analytics.sessionBreakdown.memberEvents + analytics.sessionBreakdown.adminEvents} hændelser
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Medlemmer (Portal)</span>
                  <span className="font-semibold">{analytics.sessionBreakdown.membersPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${analytics.sessionBreakdown.membersPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] pt-0.5">
                  <span className="text-muted-foreground">Administratorer & Staff</span>
                  <span className="font-semibold">{analytics.sessionBreakdown.adminsPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full"
                    style={{ width: `${analytics.sessionBreakdown.adminsPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Enhedsfordeling */}
            <div className="rounded-lg border p-3 space-y-2">
              <span className="text-xs font-semibold text-foreground">Enhedsfordeling</span>
              {analytics.deviceBreakdown.desktop == null ? (
                <p className="rounded border border-dashed bg-muted/10 p-3 text-[10px] text-muted-foreground">
                  Ingen verificeret enhedstelemetri er tilsluttet endnu.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-center pt-0.5">
                  {[
                    [Monitor, analytics.deviceBreakdown.desktop, "Desktop"],
                    [Smartphone, analytics.deviceBreakdown.mobile, "Mobil"],
                    [Tablet, analytics.deviceBreakdown.tablet, "Tablet"],
                  ].map(([Icon, value, label]) => {
                    const DeviceIcon = Icon as typeof Monitor;
                    return <div key={String(label)} className="rounded border bg-muted/20 p-1.5">
                      <DeviceIcon className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
                      <p className="text-xs font-bold text-foreground">{String(value)}%</p>
                      <p className="text-[9px] text-muted-foreground">{String(label)}</p>
                    </div>;
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 8 Kompakte Handlingsbokse med forklaringer */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                Uddybende handlingsstatistik (seneste 30 dage)
              </span>
              <span className="text-[10px] text-muted-foreground">
                Hver boks beskriver funktionens formål i systemet
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {analytics.actionCategories.map(item => {
                const Icon = getCategoryIcon(item.key);
                return (
                  <div
                    key={item.key}
                    className="flex flex-col justify-between rounded-lg border bg-muted/15 p-2.5 transition-colors hover:bg-muted/30"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Icon className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span className="font-semibold text-xs text-foreground truncate">{item.label}</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums shrink-0">
                          {item.count}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-snug mt-1.5">
                        {item.explanation}
                      </p>
                    </div>
                    <div className="mt-2 pt-1.5 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Andel af hændelser:</span>
                      <span className="font-medium text-foreground">{item.pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Sektion 2: Speed Insights & Nøglesiders Loadtider */}
      <Collapsible
        open={openSections.speed}
        onOpenChange={() => toggleSection("speed")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3.5 sm:p-4 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Sidehastigheder og svartider
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Tilgængelige procesmålinger; verificeret produktionstelemetri vises først, når den er tilsluttet
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-[10px] font-medium border-0">
              {speedInsights.keyPages.some(page => page.sampleCount > 0) ? "Lokale målinger" : "Afventer telemetri"}
            </Badge>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                openSections.speed ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border/60 p-3.5 sm:p-4 pt-3 space-y-4">
          {/* Core Web Vitals med forklaringer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>Core Web Vitals</span>
              <span className="text-[10px] text-muted-foreground font-normal">Verificeret datakilde ikke tilsluttet</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Object.entries(speedInsights.webVitals).map(([key, item]) => (
                <div key={key} className="flex flex-col justify-between rounded-lg border bg-muted/20 p-2.5">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">{key}</span>
                      <span className={`h-2 w-2 rounded-full ${item.value == null ? "bg-slate-300" : "bg-emerald-500"}`} />
                    </div>
                    <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{item.value ?? "—"}</p>
                    <p className="text-[9px] font-medium text-muted-foreground">{item.value == null ? "Ingen måling" : `Mål ${item.target}`}</p>
                  </div>
                  <p className="mt-1.5 pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground leading-snug">
                    {item.explanation}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Nøglesiders loadtider */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                Loadhastighed på nøglesider (Arkiver & Mine Sider)
              </span>
              <span className="text-[10px] text-muted-foreground">
                Gennemsnitlig server- og dataindlæsningstid (letvægts-måling)
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {speedInsights.keyPages.map(page => (
                <div
                  key={page.key}
                  className="rounded-lg border bg-muted/15 p-2.5 space-y-2 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground truncate">{page.name}</span>
                    <Badge
                      className={`text-[9px] px-1.5 py-0 border-0 ${
                        page.status === "fast"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : page.status === "moderate"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                          : page.status === "slow"
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      }`}
                    >
                      {page.statusLabel}
                    </Badge>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-lg font-bold tabular-nums text-foreground">{page.averageMs ?? "—"}</span>
                      {page.averageMs != null && <span className="text-[10px] text-muted-foreground ml-1">ms gns.</span>}
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {page.p90Ms == null ? "0 målinger" : `P90: ${page.p90Ms} ms · n=${page.sampleCount}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px]">
                    <span className="text-muted-foreground font-mono text-[9px] truncate max-w-[130px]" title={page.route}>
                      {page.route}
                    </span>
                    <Link href={page.route} className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-0.5">
                      <span>Test</span>
                      <ArrowRight className="h-2.5 w-2.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-emerald-50/60 dark:bg-emerald-950/20 px-3.5 py-2 text-xs text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                Median sagsbehandlings-svartid:{" "}
                <strong className="font-semibold">
                  {formatResponseDuration(speedInsights.medianResponseTimeMs)}
                </strong>{" "}
                (P90: {formatResponseDuration(speedInsights.p90ResponseTimeMs)})
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">Edge-routing og global responsivitet</span>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Sektion 3: Aktivitetsmonitor ("Kig over skulderen") */}
      <Collapsible
        open={openSections.activity}
        onOpenChange={() => toggleSection("activity")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3.5 sm:p-4 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
              <Users2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Aktivitetsmonitor: Administratorer & Medlemmer
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Følg præcis hvad administratorer og brugere foretager sig med organisationsfiltrering
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-normal">
              {activityTab === "admin" ? filteredAdminLogs.length : filteredUserLogs.length} handlinger
            </Badge>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                openSections.activity ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border/60 p-0">
          {/* Værktøjslinje: Tabs + Organisationsfilter */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 px-4 bg-muted/20 border-b border-border/60">
            {/* Faneblade */}
            <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActivityTab("admin")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  activityTab === "admin"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Shield className="h-3 w-3" />
                <span>Administratorer</span>
                <span className="ml-1 text-[10px] opacity-75">({filteredAdminLogs.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActivityTab("user")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  activityTab === "user"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <User className="h-3 w-3" />
                <span>Brugere & Medlemmer</span>
                <span className="ml-1 text-[10px] opacity-75">({filteredUserLogs.length})</span>
              </button>
            </div>

            {/* Organisationsvælger */}
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <label htmlFor="org-filter" className="text-[11px] text-muted-foreground font-medium">
                Organisation:
              </label>
              <select
                id="org-filter"
                value={selectedOrgId}
                onChange={e => applyOrganisationFilter(e.target.value)}
                disabled={isFiltering}
                className="h-7 text-xs rounded-md border bg-background px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">Alle organisationer</option>
                {organisations.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Aktivitetsliste */}
          {activityTab === "admin" ? (
            filteredAdminLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                Ingen administratorhandlinger fundet for det valgte filter.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-border/60">
                {filteredAdminLogs.map(item => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 px-4 hover:bg-muted/30 text-xs transition-colors"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{item.actorName}</span>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                          {item.actorRole}
                        </Badge>
                        <span className="text-muted-foreground">•</span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Building2 className="h-2.5 w-2.5" />
                          {item.orgName}
                        </span>
                      </div>
                      <p className="text-muted-foreground font-medium truncate text-[11px]">
                        {item.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 sm:self-center">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatRelativeTime(item.occurredAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            filteredUserLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                Ingen brugerhandlinger fundet for det valgte filter.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-border/60">
                {filteredUserLogs.map(item => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 px-4 hover:bg-muted/30 text-xs transition-colors"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{item.actorName}</span>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
                          Medlem
                        </Badge>
                        <span className="text-muted-foreground">•</span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Building2 className="h-2.5 w-2.5" />
                          {item.orgName}
                        </span>
                      </div>
                      <p className="text-muted-foreground font-medium truncate text-[11px]">
                        {item.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 sm:self-center">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatRelativeTime(item.occurredAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Sektion 4: Fejllog, Sikkerhedshændelser & Rapport-generator */}
      <Collapsible
        open={openSections.errors}
        onOpenChange={() => toggleSection("errors")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3.5 sm:p-4 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Fejllog & Hændelsesrapport
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Fejlede transaktioner, adgangsafvisninger samt hurtig generering af fejlrapport
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {systemErrors.length === 0 ? (
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-[10px] font-medium border-0">
                0 fejl
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px]">
                {systemErrors.length} hændelser
              </Badge>
            )}
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                openSections.errors ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border/60 p-0">
          {/* Rapport-handlingsbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 px-4 bg-muted/20 border-b border-border/60">
            <span className="text-xs font-semibold text-foreground">
              Seneste systemhændelser ({systemErrors.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowReportPreview(p => !p)}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
              >
                {showReportPreview ? "Skjul forhåndsvisning" : "Forhåndsvis rapport"}
              </button>
              <button
                type="button"
                onClick={handleCopyReport}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 transition-colors"
              >
                {copiedReport ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-white" />
                    <span>Kopieret til udklipsholder!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Kopier fejlrapport</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Rapport preview boks */}
          {showReportPreview && (
            <div className="p-3 bg-muted/30 border-b border-border/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-foreground">Rapporttekst (Markdown / Text):</span>
                <span className="text-[10px] text-muted-foreground">Klar til indsættelse i sager eller e-mails</span>
              </div>
              <pre className="p-2.5 rounded border bg-background text-[10px] font-mono text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                {generateErrorReportText()}
              </pre>
            </div>
          )}

          {systemErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
              <CheckCircle2 className="h-6 w-6 text-emerald-500 mb-1" />
              <p className="text-xs font-semibold text-foreground">Ingen registrerede systemfejl</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {collection.complete
                  ? "Der er ikke registreret fejl i den indlæste periode. Det er ikke en garanti for fejlfri drift."
                  : "Fejllisten er ufuldstændig, fordi en datakilde ikke kunne læses."}
              </p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
              {systemErrors.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-2.5 px-4 text-xs hover:bg-muted/30"
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-semibold text-rose-700 dark:text-rose-300 truncate text-[11px]">
                      {item.description}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>Komponent: {item.systemComponent || "Core"}</span>
                      {item.errorCode && <span>• Kode: {item.errorCode}</span>}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatRelativeTime(item.occurredAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
