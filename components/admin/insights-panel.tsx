"use client";

import { useState } from "react";
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
} from "lucide-react";
import type { SuperadminInsightsData } from "@/lib/server/superadmin-overview";
import { Badge } from "@/components/ui/badge";
import { formatResponseDuration } from "@/lib/admin-dashboard";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

export function InsightsPanel({ data }: { data: SuperadminInsightsData }) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { analytics: true, speed: true, adminLog: true, errors: true };
    try {
      const saved = localStorage.getItem("dfks_insights_sections");
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return { analytics: true, speed: true, adminLog: true, errors: true };
  });

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

  const { analytics, speedInsights, adminActivityLog, systemErrors } = data;

  return (
    <div className="space-y-6 max-w-6xl pb-10">
      {/* Top Banner / Badge */}
      <div className="rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/70 via-purple-50/50 to-blue-50/70 p-5 shadow-sm dark:border-indigo-900/50 dark:from-indigo-950/20 dark:via-purple-950/20 dark:to-blue-950/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/80 bg-indigo-100/70 px-3 py-1 text-xs font-semibold text-indigo-800 shadow-sm dark:border-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
              <BrainCircuit className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Super Admin Aktivitetsinfo</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Insights & Systemovervågning
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-3xl leading-relaxed">
              Tvær-organisatorisk overblik over brugeradfærd, administratorhandlinger på tværs af organisationer,
              Vercel Speed Insights og systemperformance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-background/80 text-xs px-2.5 py-1">
              <Shield className="mr-1 h-3.5 w-3.5 text-indigo-500" /> Kun synlig for Superadmin
            </Badge>
          </div>
        </div>
      </div>

      {/* Sektion 1: Vercel Analytics & Brugeraktivitet */}
      <Collapsible
        open={openSections.analytics}
        onOpenChange={() => toggleSection("analytics")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground sm:text-base">
                Vercel Analytics & Brugeraktivitet
              </h2>
              <p className="text-xs text-muted-foreground">
                Realtidsmåling af aktive brugere, sessioner og adfærd i portalen
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-[11px] font-medium border-0">
              Live aktivitet
            </Badge>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                openSections.analytics ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border/60 p-4 sm:p-5 pt-4 space-y-5">
          {/* Nøgletal */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-[11px] font-medium text-muted-foreground">Aktive i dag (24t)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{analytics.activeUsers24h}</p>
              <p className="mt-0.5 text-[10px] text-emerald-600 font-medium">Brugere med aktivitet</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-[11px] font-medium text-muted-foreground">Aktive (7 dage)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{analytics.activeUsers7d}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Unikke brugere</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-[11px] font-medium text-muted-foreground">Månedlige aktive (30d)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{analytics.activeUsers30d}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Medlemmer + staff</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-[11px] font-medium text-muted-foreground">Handlinger (30d)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{analytics.actionsLast30Days}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Audit & systemhændelser</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Sessioner & roller */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Aktivitetsfordeling</span>
                <span className="text-[11px] text-muted-foreground">{analytics.sessionBreakdown.memberEvents + analytics.sessionBreakdown.adminEvents} hændelser</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Medlemmer (Portal)</span>
                  <span className="font-semibold">{analytics.sessionBreakdown.membersPct}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${analytics.sessionBreakdown.membersPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-muted-foreground">Administratorer & Staff</span>
                  <span className="font-semibold">{analytics.sessionBreakdown.adminsPct}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full"
                    style={{ width: `${analytics.sessionBreakdown.adminsPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Enhedsfordeling */}
            <div className="rounded-lg border p-4 space-y-3">
              <span className="text-xs font-semibold text-foreground">Enhedsfordeling (Vercel Client Telemetry)</span>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div className="rounded border bg-muted/20 p-2">
                  <Monitor className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-sm font-bold text-foreground">{analytics.deviceBreakdown.desktop}%</p>
                  <p className="text-[10px] text-muted-foreground">Desktop</p>
                </div>
                <div className="rounded border bg-muted/20 p-2">
                  <Smartphone className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-sm font-bold text-foreground">{analytics.deviceBreakdown.mobile}%</p>
                  <p className="text-[10px] text-muted-foreground">Mobil</p>
                </div>
                <div className="rounded border bg-muted/20 p-2">
                  <Tablet className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-sm font-bold text-foreground">{analytics.deviceBreakdown.tablet}%</p>
                  <p className="text-[10px] text-muted-foreground">Tablet</p>
                </div>
              </div>
            </div>
          </div>

          {/* Top handlinger */}
          <div className="rounded-lg border p-4 space-y-3">
            <span className="text-xs font-semibold text-foreground">Mest benyttede funktioner (seneste 30 dage)</span>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {analytics.topActions.map(action => (
                <div key={action.action} className="flex items-center justify-between rounded border bg-muted/15 px-3 py-2 text-xs">
                  <span className="font-medium text-foreground truncate">{action.label}</span>
                  <Badge variant="secondary" className="ml-2 tabular-nums text-[10px]">
                    {action.count} ({action.pct}%)
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Sektion 2: Speed Insights & Web Vitals */}
      <Collapsible
        open={openSections.speed}
        onOpenChange={() => toggleSection("speed")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground sm:text-base">
                Vercel Speed Insights & Performance
              </h2>
              <p className="text-xs text-muted-foreground">
                Core Web Vitals, API-latens og system svartider
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-[11px] font-medium border-0">
              Optimeret score
            </Badge>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                openSections.speed ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border/60 p-4 sm:p-5 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">LCP</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{speedInsights.webVitals.lcp.value}</p>
              <p className="text-[10px] text-muted-foreground">Mål {speedInsights.webVitals.lcp.target}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">INP</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{speedInsights.webVitals.inp.value}</p>
              <p className="text-[10px] text-muted-foreground">Mål {speedInsights.webVitals.inp.target}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">CLS</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{speedInsights.webVitals.cls.value}</p>
              <p className="text-[10px] text-muted-foreground">Mål {speedInsights.webVitals.cls.target}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">FCP</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{speedInsights.webVitals.fcp.value}</p>
              <p className="text-[10px] text-muted-foreground">Mål {speedInsights.webVitals.fcp.target}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">TTFB</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{speedInsights.webVitals.ttfb.value}</p>
              <p className="text-[10px] text-muted-foreground">Mål {speedInsights.webVitals.ttfb.target}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                Median svartid for sagsbehandling:{" "}
                <strong className="font-semibold">
                  {formatResponseDuration(speedInsights.medianResponseTimeMs)}
                </strong>{" "}
                (P90: {formatResponseDuration(speedInsights.p90ResponseTimeMs)})
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">Edge routing & global cache aktiv</span>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Sektion 3: Tværgående Administrator-log */}
      <Collapsible
        open={openSections.adminLog}
        onOpenChange={() => toggleSection("adminLog")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
              <Users2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground sm:text-base">
                Administratoraktivitet på tværs af organisationer
              </h2>
              <p className="text-xs text-muted-foreground">
                Løbende log over hvad administratorer i alle organisationer foretager sig
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-normal">
              {adminActivityLog.length} seneste handlinger
            </Badge>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                openSections.adminLog ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border/60 p-0">
          {adminActivityLog.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Ingen registrerede administratorhandlinger i loggen endnu.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-border/60">
              {adminActivityLog.map(item => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 px-5 hover:bg-muted/30 text-xs transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{item.actorName}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {item.actorRole}
                      </Badge>
                      <span className="text-muted-foreground">•</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        {item.orgName}
                      </span>
                    </div>
                    <p className="text-muted-foreground font-medium truncate">
                      {item.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0 sm:self-center">
                    <Clock className="h-3 w-3" />
                    <span>{formatRelativeTime(item.occurredAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Sektion 4: Fejllog & Sikkerhedshændelser */}
      <Collapsible
        open={openSections.errors}
        onOpenChange={() => toggleSection("errors")}
        className="rounded-xl border bg-card shadow-sm transition-all overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground sm:text-base">
                Fejllog & Sikkerhedshændelser
              </h2>
              <p className="text-xs text-muted-foreground">
                Fejlede transaktioner, adgangsafvisninger og uregelmæssigheder
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {systemErrors.length === 0 ? (
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-[11px] font-medium border-0">
                0 fejl
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[11px]">
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
          {systemErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <CheckCircle2 className="h-7 w-7 text-emerald-500 mb-1.5" />
              <p className="text-xs font-semibold text-foreground">Ingen registrerede systemfejl</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Alle handlinger og transaktioner er gennemført fejlfrit i den overvågede periode.
              </p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
              {systemErrors.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-3.5 px-5 text-xs hover:bg-muted/30"
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-semibold text-rose-700 dark:text-rose-300 truncate">
                      {item.description}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>Komponent: {item.systemComponent || "Core"}</span>
                      {item.errorCode && <span>• Kode: {item.errorCode}</span>}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">
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
