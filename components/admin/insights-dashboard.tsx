"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, BarChart3, Clock, Gauge, Info, MonitorSmartphone, ShieldCheck, Users } from "lucide-react";
import type { SuperadminInsightsData } from "@/lib/server/superadmin-overview";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatResponseDuration } from "@/lib/admin-dashboard";

type Status = "good" | "needs-improvement" | "poor" | "unavailable";

const STATUS_LABEL: Record<Status, string> = {
  good: "God",
  "needs-improvement": "Bør forbedres",
  poor: "Kræver handling",
  unavailable: "Mangler data",
};

function StatusBadge({ status }: { status: Status }) {
  const style = status === "good" ? "bg-emerald-100 text-emerald-800" : status === "needs-improvement" ? "bg-amber-100 text-amber-900" : status === "poor" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700";
  return <Badge className={`${style} border-0 text-[10px]`}>{STATUS_LABEL[status]}</Badge>;
}

function MetricCard(props: {
  label: string;
  value: string;
  explanation: string;
  source: string;
  period: string;
  samples?: number;
  target?: string;
  status: Status;
  action?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold">{props.label}</p>
        <StatusBadge status={props.status} />
      </div>
      <p className="text-2xl font-bold tabular-nums">{props.value}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{props.explanation}</p>
      {props.action ? <p className="rounded bg-muted/50 px-2 py-1.5 text-[10px]"><strong>Anbefaling:</strong> {props.action}</p> : null}
      <details className="text-[10px] text-muted-foreground">
        <summary className="cursor-pointer font-medium">Datagrundlag og teknik</summary>
        <div className="mt-1 space-y-0.5 border-l pl-2">
          <p>Kilde: {props.source}</p>
          <p>Periode: {props.period}</p>
          {props.samples != null ? <p>Antal målinger: {props.samples}</p> : null}
          {props.target ? <p>Mål: {props.target}</p> : null}
        </div>
      </details>
    </div>
  );
}

function Section(props: { id: string; title: string; description: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/30" aria-controls={`${props.id}-content`}>
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">{props.icon}</span>
          <span><span className="block text-sm font-semibold">{props.title}</span><span className="block text-[11px] text-muted-foreground">{props.description}</span></span>
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Skjul" : "Vis"}</span>
      </CollapsibleTrigger>
      <CollapsibleContent id={`${props.id}-content`} className="border-t p-4">{props.children}</CollapsibleContent>
    </Collapsible>
  );
}

function formatVital(metric: string, value: number | null): string {
  if (value == null) return "—";
  if (metric === "cls") return value.toFixed(3);
  return value >= 1000 ? `${(value / 1000).toFixed(2)} sek.` : `${Math.round(value)} ms`;
}

const VITAL_INFO = {
  lcp: ["Største indhold vises", "Hvor hurtigt sidens største synlige element bliver vist.", "højst 2,5 sek."],
  inp: ["Reaktion på klik", "Hvor hurtigt siden reagerer, når en bruger klikker eller skriver.", "højst 200 ms"],
  cls: ["Visuel stabilitet", "Om knapper og indhold flytter sig uventet, mens siden indlæses.", "højst 0,1"],
  fcp: ["Første indhold vises", "Tiden til brugeren ser det første indhold på siden.", "højst 1,8 sek."],
  ttfb: ["Serverens første svar", "Tiden fra forespørgslen sendes, til serveren begynder at svare.", "højst 800 ms"],
} as const;

export function InsightsDashboard({ data }: { data: SuperadminInsightsData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activityTab, setActivityTab] = useState<"admin" | "member">("admin");
  const { observability, analytics, collection } = data;
  const sourceByName = new Map(observability.sources.map(source => [source.source, source]));
  const sourceStatus = (name: string): Status => {
    const source = sourceByName.get(name);
    if (!source || source.state === "pending" || source.state === "disabled") return "unavailable";
    if (source.state === "healthy") return "good";
    return source.state === "stale" ? "needs-improvement" : "poor";
  };
  const trafficStatus = sourceStatus("vercel_analytics");
  const runtimeStatus = sourceStatus("vercel_runtime");
  const testStatus = sourceStatus("github_performance");
  const activity = activityTab === "admin" ? data.adminActivityLog : data.userActivityLog;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-10">
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-4 dark:border-indigo-900 dark:from-indigo-950/30 dark:to-blue-950/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="text-xl font-bold">Insights og systemovervågning</h1><p className="mt-1 max-w-3xl text-xs text-muted-foreground">Samlet overblik over brug, brugeroplevet hastighed, automatiske tests, driftsfejl og følsomme handlinger. Hver måling viser sin kilde og forklarer, hvad tallet betyder.</p></div>
          <Badge variant="outline"><ShieldCheck className="mr-1 h-3.5 w-3.5" />Kun superadmin</Badge>
        </div>
      </div>

      {!collection.complete ? <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><Info className="h-4 w-4 shrink-0" /><span>Oversigten er delvis. Manglende kilder vises som “Mangler data” og bliver aldrig fortolket som nul eller fejlfri drift. {collection.issues.join(" ")}</span></div> : null}

      <Section id="status" title="Systemstatus nu" description="Viser om de fire uafhængige datakilder leverer aktuelle data" icon={<Activity className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["vercel_analytics", "Trafik og brug", "Reelle sidevisninger fra brugere"],
            ["vercel_speed_insights", "Brugeroplevet hastighed", "Målinger fra rigtige browsere"],
            ["github_performance", "Automatiske hastighedstests", "Kontrollerede tests i GitHub"],
            ["vercel_runtime", "Produktion og fejl", "Serverfejl fra Vercel"],
          ].map(([key, label, explanation]) => {
            const source = sourceByName.get(key);
            const status = sourceStatus(key);
            return <div key={key} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><p className="text-xs font-semibold">{label}</p><StatusBadge status={status} /></div><p className="mt-1 text-[10px] text-muted-foreground">{explanation}</p><p className="mt-2 text-[10px]">Senest modtaget: {source?.lastEventAt ? new Date(source.lastEventAt).toLocaleString("da-DK") : "Ingen data endnu"}</p></div>;
          })}
        </div>
      </Section>

      <Section id="traffic" title="Trafik og brug" description="Reel brug af produktionsportalen; ikke automatiske tests" icon={<Users className="h-4 w-4" />}>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Sidevisninger" value={observability.traffic.pageviews30d == null ? "—" : String(observability.traffic.pageviews30d)} explanation="Hvor mange sider der er blevet åbnet i portalen. Tallet siger noget om aktivitet, men ikke om hvor mange forskellige personer der har været på besøg." source="Vercel Web Analytics" period="Seneste 30 dage" samples={observability.traffic.sampleCount} status={trafficStatus} action={trafficStatus === "unavailable" ? "Tilslut Analytics-drainet og vent på reel trafik." : undefined} />
          <MetricCard label="Aktive brugere" value={String(analytics.activeUsers30d)} explanation="Unikke brugere med en registreret følsom eller forretningsmæssig handling. Dette kommer fra auditloggen og er derfor ikke det samme som en sidevisning." source="DFKS auditlog" period="Seneste 30 dage" status="good" />
          <MetricCard label="Registrerede handlinger" value={String(analytics.actionsLast30Days)} explanation="Oprettelser, opslag, downloads, AI-analyser og andre auditerede handlinger." source="DFKS auditlog" period="Seneste 30 dage" status="good" />
        </div>
        {observability.traffic.topRoutes.length ? <div className="mt-4"><h3 className="text-xs font-semibold">Mest besøgte sider</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{observability.traffic.topRoutes.map(item => <div key={item.route} className="flex justify-between rounded border px-3 py-2 text-xs"><span>{item.route}</span><strong>{item.count}</strong></div>)}</div></div> : null}
      </Section>

      <Section id="vitals" title="Brugeroplevet hastighed" description="Reelle målinger fra de browsere, som besøger udvalgte nøglesider" icon={<Gauge className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(VITAL_INFO) as Array<keyof typeof VITAL_INFO>).map(metric => {
            const item = observability.webVitals[metric];
            const [label, explanation, target] = VITAL_INFO[metric];
            return <MetricCard key={metric} label={label} value={formatVital(metric, item.value)} explanation={explanation} source={`Vercel Speed Insights (${metric.toUpperCase()}, 75-percentil)`} period="Seneste 30 dage" samples={item.sampleCount} target={target} status={item.score} action={item.score === "poor" ? "Undersøg de langsomste nøglesider og de største elementer." : item.score === "unavailable" ? "Der kræves reel trafik, før målingen kan beregnes." : undefined} />;
          })}
        </div>
      </Section>

      <Section id="tests" title="Automatiske hastighedstests" description="Sammenlignelige testkørsler på desktop og simuleret mobilforbindelse" icon={<BarChart3 className="h-4 w-4" />}>
        <div className="mb-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">Disse tal kommer fra GitHub Actions og måler en kontrolleret testdatabase. De supplerer reelle brugermålinger og bruges til at opdage forringelser før eller efter en ændring.</div>
        {observability.performanceTests.length === 0 ? <MetricCard label="Seneste testkørsel" value="—" explanation="Der er endnu ikke modtaget et testresultat. Testene køres ved pull requests og i den planlagte skala-kørsel." source="GitHub Actions" period="Seneste kørsel" status={testStatus} action="Konfigurér de to ingestion-secrets og kør performance-workflowet." /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground"><th className="p-2">Side</th><th className="p-2">Testtype</th><th className="p-2">Første liste</th><th className="p-2">Færdig side</th><th className="p-2">Datamængde</th><th className="p-2">Resultat</th></tr></thead><tbody>{observability.performanceTests.map(item => <tr key={item.key} className="border-b"><td className="p-2"><div className="font-medium">{item.routeName}</div><div className="text-[10px] text-muted-foreground">{item.route}</div></td><td className="p-2">{item.project}{item.scenario ? ` · ${item.scenario}` : ""}</td><td className="p-2 tabular-nums">{item.firstRowMs == null ? "—" : `${item.firstRowMs} ms`}</td><td className="p-2 tabular-nums">{item.completeMs == null ? "—" : `${item.completeMs} ms`}</td><td className="p-2">{item.rowCount ? `${item.rowCount.toLocaleString("da-DK")} rækker` : "Standard"}</td><td className="p-2"><StatusBadge status={item.passed ? "good" : "poor"} /></td></tr>)}</tbody></table></div>}
      </Section>

      <Section id="runtime" title="Produktion og fejl" description="Tekniske serverfejl fra Vercel, adskilt fra afviste forretningshandlinger" icon={<AlertTriangle className="h-4 w-4" />}>
        <div className="grid gap-3 md:grid-cols-2">
          <MetricCard label="Serverfejl" value={observability.runtime.errorCount30d == null ? "—" : String(observability.runtime.errorCount30d)} explanation="Fejl og HTTP 500-svar i den kørende produktionsapp. En tom liste er kun grøn, når runtime-kilden faktisk leverer data." source="Vercel Runtime Logs" period="Seneste 30 dage" samples={observability.runtime.errorCount30d ?? 0} status={runtimeStatus === "good" && (observability.runtime.errorCount30d ?? 0) > 0 ? "poor" : runtimeStatus} action={(observability.runtime.errorCount30d ?? 0) > 0 ? "Åbn fejldetaljerne, find den berørte side og undersøg den nyeste forekomst." : undefined} />
          <MetricCard label="Afviste eller fejlede behandlinger" value={String(data.systemErrors.length)} explanation="Forretnings- og sikkerhedshændelser fra auditloggen, eksempelvis en afvist adgang eller fejlet databehandling. De er ikke nødvendigvis servernedbrud." source="DFKS auditlog" period="Seneste 30 dage" samples={data.systemErrors.length} status={data.systemErrors.length ? "needs-improvement" : "good"} />
        </div>
        {observability.runtime.errors.length ? <div className="mt-3 max-h-72 divide-y overflow-y-auto rounded-lg border">{observability.runtime.errors.map(error => <div key={error.id} className="p-3 text-xs"><div className="flex justify-between gap-3"><strong>{error.summary ?? "Serverfejl uden sikker fejltekst"}</strong><span className="shrink-0 text-muted-foreground">{new Date(error.occurredAt).toLocaleString("da-DK")}</span></div><p className="mt-1 text-[10px] text-muted-foreground">Side: {error.route ?? "Ukendt"} · HTTP-status: {error.statusCode ?? "Ukendt"}</p></div>)}</div> : null}
      </Section>

      <Section id="audit" title="Auditaktivitet" description="Hvem har behandlet data og hvilke handlinger er udført" icon={<ShieldCheck className="h-4 w-4" />} defaultOpen={false}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-lg bg-muted p-1"><button type="button" onClick={() => setActivityTab("admin")} className={`rounded px-3 py-1 text-xs ${activityTab === "admin" ? "bg-background shadow" : ""}`}>Administratorer</button><button type="button" onClick={() => setActivityTab("member")} className={`rounded px-3 py-1 text-xs ${activityTab === "member" ? "bg-background shadow" : ""}`}>Medlemmer</button></div>
          <select aria-label="Filtrér efter organisation" disabled={pending} value={collection.selectedOrgId ?? "all"} onChange={event => startTransition(() => router.replace(event.target.value === "all" ? "/admin/insights" : `/admin/insights?org=${encodeURIComponent(event.target.value)}`))} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="all">Alle organisationer</option>{data.organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select>
        </div>
        {activity.length === 0 ? <p className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">Ingen handlinger i det valgte udsnit.</p> : <div className="max-h-96 divide-y overflow-y-auto rounded-lg border">{activity.map(item => <div key={item.id} className="flex justify-between gap-3 p-3 text-xs"><div><strong>{item.actorName}</strong><p className="text-muted-foreground">{item.description} · {item.orgName}</p></div><span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"><Clock className="h-3 w-3" />{new Date(item.occurredAt).toLocaleString("da-DK")}</span></div>)}</div>}
      </Section>

      <Section id="response" title="Svar til medlemmer" description="Sagsbehandlingstid i beskedtråde; dette er ikke teknisk serverhastighed" icon={<MonitorSmartphone className="h-4 w-4" />} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-2"><MetricCard label="Typisk svartid" value={formatResponseDuration(data.speedInsights.medianResponseTimeMs)} explanation="Medianen viser den midterste svartid fra et medlem skriver, til en medarbejder svarer." source="Kontraktbeskeder" period="Seneste 30 dage" status={data.speedInsights.medianResponseTimeMs == null ? "unavailable" : "good"} /><MetricCard label="90 % besvaret inden" value={formatResponseDuration(data.speedInsights.p90ResponseTimeMs)} explanation="Ni ud af ti registrerede svar ligger under denne tid. Den viser de langsommere sager bedre end gennemsnittet." source="Kontraktbeskeder" period="Seneste 30 dage" status={data.speedInsights.p90ResponseTimeMs == null ? "unavailable" : "good"} /></div>
      </Section>
    </div>
  );
}
