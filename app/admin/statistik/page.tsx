"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, Download, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ResponsiveChartContainer } from "@/components/charts/responsive-chart-container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { EXPERIENCE_GROUPS } from "@/lib/experience-groups";
import type { CombinedChartType, StatisticsVisualization } from "@/lib/statistics/visualization";

type SafeNumber = number | null;
type SuppressionReason = "minimum_count" | "dominance" | "secondary";
type YearRow = {
  year: number; memberCount: number; contractCount: number; validatedCount: number; draftCount: number; lowSample: boolean;
  suppressed?: boolean; suppressionReason?: SuppressionReason; outlierExcludedCount?: number;
};
type StatisticsPayload = {
  dataSource: "production";
  suppressed: boolean; minimum: number; lowSampleThreshold: number; lowSample?: boolean; includeDrafts?: boolean; memberCount: number | null; contractCount?: number; validatedCount?: number; draftCount?: number; years: number[];
  minimumGroupSize?: number; dominanceLimit?: number; calculationVersion?: string;
  suppressionCount?: number; suppressionReasons?: Partial<Record<SuppressionReason, number>>; outlierExcludedCount?: number;
  salary?: Array<YearRow & { monthlyRate: SafeNumber; averageMonthlyRate: SafeNumber; dailyRate: SafeNumber }>;
  salaryByCategory?: Array<YearRow & { category: string; monthlyRate: SafeNumber; averageMonthlyRate: SafeNumber }>;
  pension?: Array<YearRow & { avgPensionPercent: SafeNumber }>;
  workingWeeks?: Array<YearRow & { avgWeeks: SafeNumber; medianWeeks: SafeNumber }>;
  contractCounts?: Array<YearRow & { total: SafeNumber; aLoen: SafeNumber; leverandoer: SafeNumber }>;
  rights?: Array<{ category: string; svodPercent: SafeNumber; svodUnknown: SafeNumber; copydanPercent: SafeNumber; copydanUnknown: SafeNumber; royaltyPercent: SafeNumber; royaltyUnknown: SafeNumber; memberCount: number; suppressed?: boolean; suppressionReason?: SuppressionReason; outlierExcludedCount?: number }>;
  gender?: Array<{ gender: string; count: number; avgSalary: SafeNumber; suppressed?: boolean; suppressionReason?: SuppressionReason; outlierExcludedCount?: number }>;
  aiClauses?: Array<YearRow & { withClause: SafeNumber; withoutClause: SafeNumber; unknownCount: SafeNumber; pct: SafeNumber }>;
  creditClauses?: Array<YearRow & { precise: SafeNumber; vague: SafeNumber; conditional: SafeNumber; roleOnly: SafeNumber; absent: SafeNumber; unclear: SafeNumber; precisePercent: SafeNumber }>;
  creditTitles?: Array<{ title: string; count: SafeNumber; memberCount: number; suppressed?: boolean; suppressionReason?: SuppressionReason }>;
  contributions?: Array<YearRow & { contractCount: number; totalHolidayPayAmount: SafeNumber; totalBetaAmount: SafeNumber; incompleteContributionCount: SafeNumber }>;
};

const tooltipStyle = { backgroundColor: "rgba(255,255,255,.95)", border: "1px solid #ddd", borderRadius: 8, fontSize: 12 };
const categoryLabels: Record<string, string> = { feature: "Spillefilm", tvSeries: "TV-serie", documentary: "Dokumentarfilm", docSeries: "Dok.-serie", short: "Kortfilm", tvEntertainment: "TV-underholdning", reality: "Reality", other: "Andet" };
const formatKr = (value: number) => `${value.toLocaleString("da-DK")} kr.`;
const formatSafeKr = (value: SafeNumber) => value == null ? "N/A" : formatKr(value);
const formatSafeValue = (value: SafeNumber, suffix = "") => value == null ? "N/A" : `${value.toLocaleString("da-DK", { maximumFractionDigits: 1 })}${suffix}`;
const safeTotal = (...values: SafeNumber[]) => values.every(value => typeof value === "number") ? values.reduce((sum, value) => sum + (value ?? 0), 0) : null;
const suppressionLabels: Record<SuppressionReason, string> = {
  minimum_count: "sløret: for få personer",
  dominance: "sløret: dominans",
  secondary: "sekundært sløret",
};
const suppressionDescriptions: Record<SuppressionReason, string> = {
  minimum_count: "for få forskellige personer",
  dominance: "få producenter fylder for meget i tallet",
  secondary: "ekstra sløring, så skjulte tal ikke kan regnes baglæns",
};
function basisText(row: { memberCount?: number; count?: number | null; lowSample?: boolean; suppressed?: boolean; suppressionReason?: SuppressionReason; outlierExcludedCount?: number }) {
  const parts = [`${row.memberCount ?? row.count ?? 0} personer`];
  if (row.suppressed) parts.push(suppressionLabels[row.suppressionReason ?? "minimum_count"]);
  else if (row.lowSample) parts.push("statistisk usikkert");
  if ((row.outlierExcludedCount ?? 0) > 0) parts.push(`${row.outlierExcludedCount} afviger(e) frasorteret`);
  return parts.join(" · ");
}
function suppressionSummaryText(reasons?: Partial<Record<SuppressionReason, number>>) {
  const entries = Object.entries(reasons ?? {}) as Array<[SuppressionReason, number]>;
  return entries
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${count === 1 ? "celle" : "celler"}: ${suppressionDescriptions[reason] ?? reason}`)
    .join(" · ");
}
function suppressionExportText(reason?: SuppressionReason) {
  return `Sløret af diskretionshensyn${reason ? `: ${suppressionDescriptions[reason]}` : ""}`;
}
function aiBasisText(row: Pick<AiSeriesRow, "sampleBand" | "outlierExcludedCount">) {
  const parts = [row.sampleBand ?? "—"];
  if ((row.outlierExcludedCount ?? 0) > 0) parts.push(`${row.outlierExcludedCount} afviger(e) frasorteret`);
  return parts.join(" · ");
}
function hasVisibleStatisticRows(rows?: Array<{ suppressed?: boolean }>) {
  return (rows ?? []).some(row => !row.suppressed);
}
const querySuggestions = [
  "Hvordan har medianlønnen for spillefilm og dokumentarfilm udviklet sig siden 2022?",
  "Sammenlign gennemsnitslønnen for A-løn og leverandørkontrakter over alle år.",
  "Sammenlign pension og arbejdsuger for spillefilm og dokumentarfilm siden 2022.",
  "Hvor mange A-løns- og leverandørkontrakter er der registreret pr. år?",
  "Hvordan har andelen med Copydan- og streamingforbehold udviklet sig over alle år sammenholdt med løn?",
];
const chartLabels: Record<CombinedChartType, string> = { table: "Tabel", grouped_bar: "Grupperet søjlediagram", line: "Linjediagram", area: "Arealdiagram", composed: "Kombineret diagram", indexed_line: "Indekseret linjediagram" };
const selectableCharts: CombinedChartType[] = ["line", "grouped_bar", "area", "composed", "indexed_line", "table"];
function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return <div className="max-w-full overflow-x-auto rounded-lg border"><Table className="min-w-max"><TableHeader><TableRow>{headers.map((header, index) => <TableHead key={`${header}-${index}`}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length ? rows.map((row, index) => <TableRow key={index}>{row.map((value, cell) => <TableCell key={cell}>{value}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={headers.length} className="text-muted-foreground">Ingen synlige datapunkter med de valgte filtre.</TableCell></TableRow>}</TableBody></Table></div>;
}

function formatStatisticsValue(value: number, unit: "dkk" | "percent" | "weeks" | "count") {
  if (unit === "dkk") return formatKr(Math.round(value));
  if (unit === "percent") return `${value.toLocaleString("da-DK", { maximumFractionDigits: 1 })}%`;
  if (unit === "weeks") return `${value.toLocaleString("da-DK", { maximumFractionDigits: 1 })} uger`;
  return value.toLocaleString("da-DK", { maximumFractionDigits: 1 });
}

type AiSeriesRow = {
  year: number; value: number; contractCount: number; memberCount: number; lowSample: boolean;
  seriesKey: string; seriesLabel: string; metric: string; metricLabel: string;
  unit: "dkk" | "percent" | "weeks" | "count";
  inflationIndex?: number | null; realValue?: number | null; realChangePercent?: number | null;
  sampleBand?: string; outlierExcludedCount?: number;
};

type OmittedStatisticsPoint = {
  year: number | null;
  seriesLabel: string;
  metricLabel: string;
  reason: SuppressionReason | "suppressed_segment";
  memberCount: number | null;
  contractCount: number | null;
};

type AiAnswer = {
  suppressed?: boolean; minimum?: number; explanation?: string; understoodAs?: string; interpretedBy?: "rules" | "ai";
  minimumGroupSize?: number; dominanceLimit?: number; calculationVersion?: string;
  suppressionCount?: number; suppressionReasons?: Partial<Record<SuppressionReason, number>>;
  caveats?: string[]; chart?: "line" | "bar" | "table";
  plan?: { metrics?: string[]; compareBy?: string[]; adjustForInflation?: boolean };
  lowSample?: boolean; includeDrafts?: boolean; candidates?: Array<{ id: string; name: string }>;
  metricMeta?: Array<{ metric: string; label: string; unit: "dkk" | "percent" | "weeks" | "count"; additive: boolean }>;
  series?: AiSeriesRow[];
  visualization?: StatisticsVisualization;
  omittedData?: OmittedStatisticsPoint[];
};

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.ok
      ? "Statistikserveren svarede tomt."
      : `Statistikserveren svarede uden fejltekst (${response.status}).`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Statistikserveren svarede ikke med gyldig JSON.");
  }
}

function omittedPointText(point: OmittedStatisticsPoint) {
  const reason = point.reason === "suppressed_segment"
    ? "hele delgruppen blev skjult"
    : suppressionDescriptions[point.reason] ?? "diskretionshensyn";
  const basis = point.memberCount == null
    ? ""
    : ` · ${point.memberCount} ${point.memberCount === 1 ? "person" : "personer"}${point.contractCount == null ? "" : ` / ${point.contractCount} kontrakter`}`;
  return `${point.year ?? "Ukendt år"} · ${point.seriesLabel || point.metricLabel}: ${reason}${basis}`;
}

function AiChartView({ chart, visualization }: { chart: CombinedChartType; visualization: StatisticsVisualization }) {
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
  const datasetByLabel = new Map(visualization.datasets.map(dataset => [dataset.label, dataset]));
  const formatter = (value: number | string | undefined, name: string | number | undefined) => {
    const dataset = datasetByLabel.get(String(name));
    return dataset?.unit === "index"
      ? `${Number(value ?? 0).toLocaleString("da-DK", { maximumFractionDigits: 1 })} (indeks)`
      : formatStatisticsValue(Number(value ?? 0), dataset?.sourceUnit ?? "count");
  };
  const axes = <>{[...new Set(visualization.datasets.map(dataset => dataset.axis))].map(axis => {
    const dataset = visualization.datasets.find(item => item.axis === axis)!;
    return <YAxis key={axis} yAxisId={axis} orientation={axis === "right" ? "right" : "left"} tickFormatter={value => dataset.unit === "index" ? String(value) : formatStatisticsValue(Number(value), dataset.sourceUnit).replace(" kr.", "")} />;
  })}</>;
  if (chart === "composed") return <ComposedChart data={visualization.rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" />{axes}<Tooltip contentStyle={tooltipStyle} formatter={formatter} /><Legend />{visualization.datasets.map((dataset, index) => <Line connectNulls key={dataset.key} dataKey={dataset.key} name={dataset.label} yAxisId={dataset.axis} stroke={colors[index % colors.length]} strokeWidth={2} />)}</ComposedChart>;
  if (chart === "line" || chart === "indexed_line") return <LineChart data={visualization.rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" />{axes}<Tooltip contentStyle={tooltipStyle} formatter={formatter} /><Legend />{visualization.datasets.map((dataset, index) => <Line connectNulls key={dataset.key} dataKey={dataset.key} name={dataset.label} yAxisId={dataset.axis} stroke={colors[index % colors.length]} strokeWidth={2} />)}</LineChart>;
  if (chart === "area") return <AreaChart data={visualization.rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" />{axes}<Tooltip contentStyle={tooltipStyle} formatter={formatter} /><Legend />{visualization.datasets.map((dataset, index) => <Area connectNulls key={dataset.key} dataKey={dataset.key} name={dataset.label} yAxisId={dataset.axis} stroke={colors[index % colors.length]} fill={colors[index % colors.length]} fillOpacity={0.2} />)}</AreaChart>;
  return <BarChart data={visualization.rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" />{axes}<Tooltip contentStyle={tooltipStyle} formatter={formatter} /><Legend />{visualization.datasets.map((dataset, index) => <Bar key={dataset.key} dataKey={dataset.key} name={dataset.label} yAxisId={dataset.axis} fill={colors[index % colors.length]} />)}</BarChart>;
}

export default function AdminStatistikPage() {
  const { t } = useI18n();
  const [years, setYears] = useState<number[]>([]);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [gender, setGender] = useState("all");
  const [category, setCategory] = useState("all");
  const [contractType, setContractType] = useState("all");
  const [experienceGroup, setExperienceGroup] = useState("all");
  const [data, setData] = useState<StatisticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiQuestion, setAiQuestion] = useState("Sammenlign den gennemsnitlige lønudvikling for dokumentarfilm og spillefilm for alle år.");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [aiError, setAiError] = useState<{ title: string; reason: string; suggestion?: string } | null>(null);
  const [selectedChart, setSelectedChart] = useState<"auto" | CombinedChartType>("auto");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    years.forEach(year => params.append("year", String(year)));
    if (gender !== "all") params.set("gender", gender);
    if (category !== "all") params.set("category", category);
    if (contractType !== "all") params.set("contractType", contractType);
    if (experienceGroup !== "all") params.set("experienceGroup", experienceGroup);
    fetch(`/api/admin/statistics?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const json = await readJsonResponse(response) as Partial<StatisticsPayload> & { error?: string };
        if (!response.ok) throw new Error(json.error ?? "Statistikken kunne ikke hentes");
        return json as StatisticsPayload;
      })
      .then(setData)
      .catch(fetchError => { if (fetchError.name !== "AbortError") setError(fetchError.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [years, gender, category, contractType, experienceGroup]);

  const salaryContractCount = useMemo(() => (data?.salary ?? []).reduce((sum, row) => sum + row.contractCount, 0), [data]);
  const availableStatisticsCount = useMemo(() => [
    data?.salaryByCategory,
    data?.rights,
    data?.contractCounts,
    data?.pension,
    data?.workingWeeks,
    data?.contributions,
  ].filter(rows => hasVisibleStatisticRows(rows)).length, [data]);
  const hasProductionStatistics = !data?.suppressed && availableStatisticsCount > 0;
  const dataProtectionSummary = suppressionSummaryText(data?.suppressionReasons);
  const salaryCategoryChart = useMemo(() => {
    const rows = new Map<number, { year: number; feature?: number; documentary?: number }>();
    for (const item of data?.salaryByCategory ?? []) {
      const row = rows.get(item.year) ?? { year: item.year };
      if (item.category === "feature" && item.monthlyRate != null) row.feature = item.monthlyRate;
      if (item.category === "documentary" && item.monthlyRate != null) row.documentary = item.monthlyRate;
      rows.set(item.year, row);
    }
    return [...rows.values()].sort((left, right) => left.year - right.year);
  }, [data]);
  const contractCountsChart = useMemo(() => (data?.contractCounts ?? [])
    .filter(row => !row.suppressed && (row.aLoen != null || row.leverandoer != null))
    .map(row => ({ year: row.year, aLoen: row.aLoen ?? undefined, leverandoer: row.leverandoer ?? undefined }))
    .sort((left, right) => left.year - right.year), [data]);
  const activeAiChart = aiAnswer?.visualization
    ? selectedChart === "auto" ? aiAnswer.visualization.chart : selectedChart
    : "table";
  const chartSelectionError = aiAnswer?.visualization && selectedChart !== "auto" && !aiAnswer.visualization.compatibleCharts.includes(selectedChart)
    ? `${chartLabels[selectedChart]} kan ikke sammenholde de valgte enheder på en statistisk meningsfuld måde. Vælg Automatisk.`
    : null;
  const applyYearRange = () => {
    const from = Number(yearFrom);
    const to = Number(yearTo);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    const lower = Math.min(from, to);
    const upper = Math.max(from, to);
    setYears((data?.years ?? []).filter(year => year >= lower && year <= upper));
  };
  const exportCsv = () => {
    const rows = data?.contributions ?? [];
    const csv = ["År;Medlemmer;Kontrakter;Feriepenge;BETA;I alt;Diskretion", ...rows.map(row => [
      row.year,
      row.memberCount,
      row.contractCount,
      row.totalHolidayPayAmount ?? "N/A",
      row.totalBetaAmount ?? "N/A",
      safeTotal(row.totalHolidayPayAmount, row.totalBetaAmount) ?? "N/A",
      row.suppressed ? suppressionExportText(row.suppressionReason) : "",
    ].join(";"))].join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `dfks-statistik-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const askStatistics = async (question = aiQuestion) => {
    if (!question.trim()) return;
    setAiQuestion(question);
    setAiLoading(true); setAiError(null); setAiAnswer(null);
    try {
      const response = await fetch("/api/admin/statistics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const result = await readJsonResponse(response) as AiAnswer & { error?: string; reason?: string; suggestion?: string };
      if (!response.ok) {
        setAiError({
          title: result.error ?? "Forespørgslen kunne ikke gennemføres",
          reason: result.reason ?? "Spørgsmålet kunne ikke matches med de statistikmål og filtre, som systemet må bruge.",
          suggestion: result.suggestion,
        });
        return;
      }
      setAiAnswer(result);
    } catch (queryError) {
      setAiError({
        title: "Statistikforespørgslen kunne ikke gennemføres",
        reason: queryError instanceof Error && queryError.message === "Failed to fetch"
          ? "Forbindelsen til statistikserveren blev afbrudt. Der er ikke sendt eller vist data."
          : "Der opstod en midlertidig teknisk fejl under behandlingen.",
        suggestion: "Prøv igen. Hvis fejlen fortsætter, kan du vælge et af eksemplerne under feltet.",
      });
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="space-y-6"><PageHeader title={t("admin.stats.title")} subtitle={t("admin.stats.subtitle")} /><Alert variant="destructive"><AlertTitle>Statistikken kunne ikke hentes</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div>;

  return <div className="space-y-6">
    <PageHeader title={t("admin.stats.title")} subtitle="Anonymiseret statistik for den aktive organisation" />

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" />Spørg statistikken</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Spørg databasen, skriv fx: “Hvordan har gennemsnitslønnen udviklet sig siden 2022?”</p>
        <Textarea value={aiQuestion} onChange={event => setAiQuestion(event.target.value)} placeholder="Skriv et spørgsmål om de anonymiserede data…" />
        <div className="flex flex-wrap gap-2">{querySuggestions.map(suggestion => <Button key={suggestion} type="button" size="sm" variant="outline" className="h-auto whitespace-normal text-left" onClick={() => void askStatistics(suggestion)} disabled={aiLoading}>{suggestion}</Button>)}</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button className="w-full sm:w-auto" onClick={() => void askStatistics()} disabled={aiLoading || aiQuestion.trim().length < 5}>{aiLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Undersøg</Button><Select value={selectedChart} onValueChange={value => setSelectedChart(value as "auto" | CombinedChartType)}><SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Resultatvisning" /></SelectTrigger><SelectContent><SelectItem value="auto">Resultatvisning: Automatisk</SelectItem>{selectableCharts.map(chart => <SelectItem key={chart} value={chart}>{chartLabels[chart]}</SelectItem>)}</SelectContent></Select></div>
        {aiError && <Alert variant="destructive"><AlertTitle>{aiError.title}</AlertTitle><AlertDescription><span className="block">{aiError.reason}</span>{aiError.suggestion && <span className="mt-1 block">Forslag: {aiError.suggestion}</span>}</AlertDescription></Alert>}
        {aiAnswer?.suppressed && <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Ikke nok data til et sikkert resultat</AlertTitle><AlertDescription>Det valgte udsnit indeholder færre end {aiAnswer.minimum ?? 3} forskellige personer. Prøv en længere periode, færre filtre eller en bredere produktionstype.</AlertDescription></Alert>}
        {aiAnswer && !aiAnswer.suppressed && <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1 text-sm"><p className="font-medium">Sådan blev spørgsmålet forstået</p><p>{aiAnswer.understoodAs}</p><p className="text-muted-foreground">{aiAnswer.explanation}</p></div>
          <p className="text-xs text-muted-foreground">
            Beregnet med mindst {aiAnswer.minimumGroupSize ?? aiAnswer.minimum ?? 3} personer pr. gruppe og dominansgrænse på {Math.round((aiAnswer.dominanceLimit ?? 0.8) * 100)} %. Beregningsversion: {aiAnswer.calculationVersion ?? "union-stats-v1"}.
          </p>
          {aiAnswer.visualization && <section className="space-y-3" aria-labelledby="combined-statistics-result">
            <div><h3 id="combined-statistics-result" className="font-semibold">Samlet statistik</h3><p className="text-sm text-muted-foreground">{aiAnswer.visualization.explanation}</p></div>
            {chartSelectionError && <Alert><AlertTitle>Den valgte graf kan ikke bruges</AlertTitle><AlertDescription>{chartSelectionError}</AlertDescription></Alert>}
            {!chartSelectionError && activeAiChart !== "table" && <Card><CardHeader><CardTitle className="text-sm">{chartLabels[activeAiChart]}</CardTitle></CardHeader><CardContent className="h-[360px] min-w-0"><ResponsiveChartContainer minWidth={0}><AiChartView chart={activeAiChart} visualization={aiAnswer.visualization} /></ResponsiveChartContainer></CardContent></Card>}
            <DataTable headers={["Serie", "År", "Resultat", "Kontrakter", "Grundlag", "Reel værdi", "Realændring"]} rows={(aiAnswer.series ?? []).map(row => [row.seriesLabel, row.year, formatStatisticsValue(row.value, row.unit), row.contractCount, aiBasisText(row), row.realValue == null ? "—" : formatStatisticsValue(row.realValue, row.unit), row.realChangePercent == null ? "—" : `${row.realChangePercent}%`])} />
          </section>}
          {Boolean(aiAnswer.omittedData?.length) && <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Data udeladt af diskretionshensyn</AlertTitle><AlertDescription><p className="mb-2">Nogle år eller delgrupper findes i datagrundlaget, men vises ikke, fordi anonymiseringsreglerne skal beskytte små grupper og forhindre bagudregning.</p><ul className="list-disc space-y-1 pl-5">{aiAnswer.omittedData?.slice(0, 12).map((point, index) => <li key={`${point.year}-${point.seriesLabel}-${point.metricLabel}-${index}`}>{omittedPointText(point)}</li>)}</ul>{(aiAnswer.omittedData?.length ?? 0) > 12 && <p className="mt-2">{(aiAnswer.omittedData?.length ?? 0) - 12} yderligere datapunkt(er) er udeladt af samme årsager.</p>}</AlertDescription></Alert>}
          {Boolean(aiAnswer.caveats?.length) && <Alert><AlertTitle>Forbehold ved resultatet</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-5">{aiAnswer.caveats?.map(caveat => <li key={caveat}>{caveat}</li>)}</ul></AlertDescription></Alert>}
          {aiAnswer.lowSample && <Alert><AlertTitle>Statistisk usikkert grundlag</AlertTitle><AlertDescription>Mindst ét datapunkt ligger under den valgte advarselsgrænse for små grupper. Tolk derfor udviklingen forsigtigt.</AlertDescription></Alert>}
        </div>}
      </CardContent>
    </Card>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start"><CalendarDays className="mr-2 h-4 w-4" />{years.length ? `${years.length} valgte år` : "Alle år"}</Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3">
        <div className="flex justify-between gap-2"><Button size="sm" variant="outline" onClick={() => setYears(data?.years ?? [])}>Vælg alle</Button><Button size="sm" variant="ghost" onClick={() => setYears([])}>Alle år</Button></div>
        <div className="max-h-44 space-y-1 overflow-y-auto">{(data?.years ?? []).map(year => <label key={year} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"><input type="checkbox" checked={years.includes(year)} onChange={event => setYears(current => event.target.checked ? [...new Set([...current, year])].sort() : current.filter(value => value !== year))} />{year}</label>)}</div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2"><Input aria-label="Fra år" inputMode="numeric" placeholder="Fra" value={yearFrom} onChange={event => setYearFrom(event.target.value)} /><Input aria-label="Til år" inputMode="numeric" placeholder="Til" value={yearTo} onChange={event => setYearTo(event.target.value)} /><Button size="sm" onClick={applyYearRange}>Vælg</Button></div>
      </PopoverContent></Popover>
      <Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full"><SelectValue placeholder="Produktionstype" /></SelectTrigger><SelectContent><SelectItem value="all">Alle produktionstyper</SelectItem>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
      <Select value={contractType} onValueChange={setContractType}><SelectTrigger className="w-full"><SelectValue placeholder="Kontrakttype" /></SelectTrigger><SelectContent><SelectItem value="all">Alle kontrakttyper</SelectItem><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="leverandør">Leverandør</SelectItem></SelectContent></Select>
      <Select value={experienceGroup} onValueChange={setExperienceGroup}><SelectTrigger className="w-full"><SelectValue placeholder="Erfaringsgruppe" /></SelectTrigger><SelectContent><SelectItem value="all">Alle erfaringsgrupper</SelectItem>{EXPERIENCE_GROUPS.map(group => <SelectItem key={group.value} value={group.value}>{group.label} ({group.description})</SelectItem>)}</SelectContent></Select>
      <Select value={gender} onValueChange={setGender}><SelectTrigger className="w-full"><SelectValue placeholder="Køn" /></SelectTrigger><SelectContent><SelectItem value="all">Alle køn</SelectItem><SelectItem value="male">Mand</SelectItem><SelectItem value="female">Kvinde</SelectItem><SelectItem value="other">Andet</SelectItem></SelectContent></Select>
      {hasProductionStatistics && <Button variant="outline" className="w-full" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV</Button>}
    </div>
    {data && <Alert>
      <ShieldCheck className="h-4 w-4" />
      <AlertTitle>Statistikpolicy for denne visning</AlertTitle>
      <AlertDescription>
        Grupper kræver mindst {data.minimumGroupSize ?? data.minimum} forskellige personer. Økonomiske celler sløres, hvis de to største producenter overstiger {Math.round((data.dominanceLimit ?? 0.8) * 100)} % af cellens total. Beregningsversion: {data.calculationVersion ?? "union-stats-v1"}.
      </AlertDescription>
    </Alert>}

    <section data-statistics-source={data?.dataSource ?? "production"} data-exportable="true">
    {data?.suppressed ? <Card><CardContent className="py-16 text-center"><ShieldCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground" /><h2 className="font-semibold">Ikke nok personer til statistik</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Det valgte udsnit indeholder færre end {data.minimum} forskellige personer. Systemet udleverer derfor ingen tal. Prøv bredere filtre.</p></CardContent></Card> : !hasProductionStatistics ? <Card><CardContent className="py-16 text-center"><h2 className="font-semibold">Ingen statistikdata</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Der findes endnu ingen beregnede data med de valgte filtre. Statistikken viser ikke eksempel- eller demonstrationsdata.</p></CardContent></Card> : <>
      {((data?.suppressionCount ?? 0) > 0 || (data?.outlierExcludedCount ?? 0) > 0) && <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Diskretionsregler er anvendt</AlertTitle><AlertDescription>{(data?.suppressionCount ?? 0) > 0 && <span className="block">Nogle felter vises som N/A, fordi de ikke må udleveres som statistik. {dataProtectionSummary}</span>}{(data?.outlierExcludedCount ?? 0) > 0 && <span className="block">{data?.outlierExcludedCount} åbenlyse afvigere er frasorteret før beregning af løn, medianer og bidrag.</span>}<span className="block">Grupper kan også være udeladt, hvis de ikke har nok forskellige personer, mangler statistiktilvalg eller ikke har et årstal, som statistikmotoren kan bruge.</span><span className="block">Grafer og CSV-eksport bruger de samme slørede tal som tabellerne.</span></AlertDescription></Alert>}
      <div className="grid grid-cols-3 gap-2 sm:gap-4"><Card><CardHeader className="p-3 sm:p-6"><CardTitle className="text-xs sm:text-sm">Rettighedshavere i datagrundlaget</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold sm:px-6 sm:pb-6 sm:text-3xl">{data?.memberCount}</CardContent></Card><Card><CardHeader className="p-3 sm:p-6"><CardTitle className="text-xs sm:text-sm">Kontrakter i statistikgrundlaget</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold sm:px-6 sm:pb-6 sm:text-3xl">{data?.contractCount}</CardContent></Card><Card><CardHeader className="p-3 sm:p-6"><CardTitle className="text-xs sm:text-sm">Kontrakter med løndata</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold sm:px-6 sm:pb-6 sm:text-3xl">{salaryContractCount}</CardContent></Card></div>
      <Tabs defaultValue="salary"><div className="-mx-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"><TabsList className="w-max min-w-full justify-start"><TabsTrigger value="salary">Løn</TabsTrigger><TabsTrigger value="pension">Pension</TabsTrigger><TabsTrigger value="weeks">Arbejdsuger</TabsTrigger><TabsTrigger value="rights">Rettigheder</TabsTrigger><TabsTrigger value="credits">Kreditering</TabsTrigger><TabsTrigger value="gender">Køn</TabsTrigger><TabsTrigger value="contracts">Kontrakter</TabsTrigger><TabsTrigger value="contributions">Bidrag</TabsTrigger><TabsTrigger value="ai">AI-forbehold</TabsTrigger><TabsTrigger value="individual">Individdata</TabsTrigger></TabsList></div>
        <TabsContent value="salary" className="space-y-4"><Card><CardContent className="h-[360px] pt-6"><ResponsiveChartContainer><LineChart data={salaryCategoryChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis tickFormatter={value => `${value / 1000}k`} /><Tooltip contentStyle={tooltipStyle} formatter={value => formatKr(Number(value))} /><Legend /><Line connectNulls dataKey="feature" name="Spillefilm" stroke="#3b82f6" /><Line connectNulls dataKey="documentary" name="Dokumentarfilm" stroke="#10b981" /></LineChart></ResponsiveChartContainer></CardContent></Card><DataTable headers={["År", "Produktionstype", "Kontrakter", "Median månedsløn", "Grundlag"]} rows={(data?.salaryByCategory ?? []).map(row => [row.year, categoryLabels[row.category] ?? row.category, row.contractCount, formatSafeKr(row.monthlyRate), basisText(row)])} /></TabsContent>
        <TabsContent value="pension"><DataTable headers={["År", "Medlemmer", "Gennemsnitlig pension", "Grundlag"]} rows={(data?.pension ?? []).map(row => [row.year, row.memberCount, formatSafeValue(row.avgPensionPercent, "%"), basisText(row)])} /></TabsContent>
        <TabsContent value="weeks"><DataTable headers={["År", "Medlemmer", "Gennemsnit", "Median", "Grundlag"]} rows={(data?.workingWeeks ?? []).map(row => [row.year, row.memberCount, formatSafeValue(row.avgWeeks, " uger"), formatSafeValue(row.medianWeeks, " uger"), basisText(row)])} /></TabsContent>
        <TabsContent value="rights"><DataTable headers={["Produktionstype", "Medlemmer", "Streaming", "Ukendt", "Copydan", "Ukendt", "Royalty", "Ukendt", "Grundlag"]} rows={(data?.rights ?? []).map(row => [categoryLabels[row.category] ?? row.category, row.memberCount, formatSafeValue(row.svodPercent, "%"), row.svodUnknown ?? "N/A", formatSafeValue(row.copydanPercent, "%"), row.copydanUnknown ?? "N/A", formatSafeValue(row.royaltyPercent, "%"), row.royaltyUnknown ?? "N/A", basisText(row)])} /></TabsContent>
        <TabsContent value="credits" className="space-y-4"><DataTable headers={["År", "Præcise", "Upræcise", "Betingede", "Kun funktion", "Ingen", "Kræver manuel kontrol", "Andel præcise", "Grundlag"]} rows={(data?.creditClauses ?? []).map(row => [row.year, row.precise ?? "N/A", row.vague ?? "N/A", row.conditional ?? "N/A", row.roleOnly ?? "N/A", row.absent ?? "N/A", row.unclear ?? "N/A", formatSafeValue(row.precisePercent, "%"), basisText(row)])} /><DataTable headers={["Aftalt krediteringstitel", "Kontrakter", "Grundlag"]} rows={(data?.creditTitles ?? []).map(row => [row.title, row.count ?? "N/A", basisText(row)])} /></TabsContent>
        <TabsContent value="gender"><DataTable headers={["Køn", "Personer", "Gennemsnitlig registreret løn", "Grundlag"]} rows={(data?.gender ?? []).map(row => [row.gender === "female" ? "Kvinde" : row.gender === "male" ? "Mand" : "Andet", row.count, formatSafeKr(row.avgSalary), basisText(row)])} /></TabsContent>
        <TabsContent value="contracts" className="space-y-4"><Card><CardContent className="h-[360px] pt-6">{contractCountsChart.length ? <ResponsiveChartContainer><BarChart data={contractCountsChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip contentStyle={tooltipStyle} /><Legend /><Bar dataKey="aLoen" name="A-løn" fill="#3b82f6" /><Bar dataKey="leverandoer" name="Leverandør" fill="#f59e0b" /></BarChart></ResponsiveChartContainer> : <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">Ingen synlige kontrakttal med de valgte filtre.</div>}</CardContent></Card><DataTable headers={["År", "Medlemmer", "Kontrakter", "A-løn", "Leverandør", "Grundlag"]} rows={(data?.contractCounts ?? []).map(row => [row.year, row.memberCount, formatSafeValue(row.total), formatSafeValue(row.aLoen), formatSafeValue(row.leverandoer), basisText(row)])} /></TabsContent>
        <TabsContent value="contributions"><DataTable headers={["År", "Medlemmer", "Kontrakter", "Feriepenge", "BETA", "I alt", "Grundlag"]} rows={(data?.contributions ?? []).map(row => [row.year, row.memberCount, row.contractCount, formatSafeKr(row.totalHolidayPayAmount), formatSafeKr(row.totalBetaAmount), formatSafeKr(safeTotal(row.totalHolidayPayAmount, row.totalBetaAmount)), basisText(row)])} /></TabsContent>
        <TabsContent value="ai"><DataTable headers={["År", "Medlemmer", "Med forbehold", "Uden forbehold", "Andel", "Grundlag"]} rows={(data?.aiClauses ?? []).map(row => [row.year, row.memberCount, row.withClause ?? "N/A", row.withoutClause ?? "N/A", formatSafeValue(row.pct, "%"), basisText(row)])} /></TabsContent>
        <TabsContent value="individual"><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Individrangering er deaktiveret</AlertTitle><AlertDescription>Årsindkomst og kontraktdata for enkelte personer vises ikke på adminsiden. Statistikken præsenteres kun som grupper med mindst {data?.minimum ?? 3} forskellige personer, og små grupper markeres som usikre.</AlertDescription></Alert></TabsContent>
      </Tabs>
      {data?.includeDrafts && <Alert><AlertTitle>Kladder indgår</AlertTitle><AlertDescription>Organisationens indstilling medtager kladekontrakter. De kan indeholde ufuldstændige eller endnu ikke kontrollerede udtræksdata.</AlertDescription></Alert>}
      {data?.lowSample && <Alert><AlertTitle>Statistisk usikkert grundlag</AlertTitle><AlertDescription>Det valgte resultat bygger på {data.memberCount} forskellige personer. Vær forsigtig med konklusioner baseret på færre end {data.lowSampleThreshold} personer.</AlertDescription></Alert>}
    </>}
    </section>
  </div>;
}
