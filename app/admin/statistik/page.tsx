"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
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
import { evaluateChartEligibility, recommendCharts, STATISTICS_CHART_TYPES, type StatisticsChartType } from "@/lib/statistics-chart-eligibility";
import { EXPERIENCE_GROUPS } from "@/lib/experience-groups";

type YearRow = { year: number; memberCount: number; contractCount: number; validatedCount: number; draftCount: number; lowSample: boolean };
type StatisticsPayload = {
  suppressed: boolean; minimum: number; lowSampleThreshold: number; lowSample?: boolean; includeDrafts?: boolean; memberCount: number | null; contractCount?: number; validatedCount?: number; draftCount?: number; years: number[];
  salary?: Array<YearRow & { monthlyRate: number; dailyRate: number }>;
  salaryByCategory?: Array<YearRow & { category: string; monthlyRate: number }>;
  pension?: Array<YearRow & { avgPensionPercent: number }>;
  workingWeeks?: Array<YearRow & { avgWeeks: number; medianWeeks: number }>;
  contractCounts?: Array<YearRow & { total: number; aLoen: number; leverandoer: number }>;
  rights?: Array<{ category: string; svodPercent: number; svodUnknown: number; copydanPercent: number; copydanUnknown: number; royaltyPercent: number; royaltyUnknown: number; memberCount: number }>;
  gender?: Array<{ gender: string; count: number; avgSalary: number }>;
  aiClauses?: Array<YearRow & { withClause: number; withoutClause: number; pct: number }>;
  contributions?: Array<YearRow & { contractCount: number; totalHolidayPayAmount: number; totalBetaAmount: number }>;
};

const tooltipStyle = { backgroundColor: "rgba(255,255,255,.95)", border: "1px solid #ddd", borderRadius: 8, fontSize: 12 };
const categoryLabels: Record<string, string> = { feature: "Spillefilm", tvSeries: "TV-serie", documentary: "Dokumentarfilm", docSeries: "Dok.-serie", short: "Kortfilm", tvEntertainment: "TV-underholdning", reality: "Reality", other: "Andet" };
const formatKr = (value: number) => `${value.toLocaleString("da-DK")} kr.`;
const querySuggestions = [
  "Hvordan har medianlønnen for spillefilm og dokumentarfilm udviklet sig siden 2022?",
  "Hvordan har den gennemsnitlige pension udviklet sig over alle år?",
  "Hvor mange kontrakter er der registreret pr. år?",
  "Hvordan har producentbidragene udviklet sig over alle år?",
  "Hvordan har det gennemsnitlige antal arbejdsuger udviklet sig over alle år?",
];
const chartLabels: Record<StatisticsChartType, string> = { table: "Tabel", bar: "Søjlediagram", horizontal_bar: "Vandret søjlediagram", grouped_bar: "Grupperet søjlediagram", stacked_bar: "Stablet søjlediagram", pie: "Cirkeldiagram", donut: "Ringdiagram", stacked_100: "Stablet 100 %-søjlediagram", line: "Linjediagram", area: "Arealdiagram", histogram: "Histogram", box_plot: "Boksplot", scatter: "Prikdiagram", bubble: "Boblediagram" };
const demoSalary = [
  { year: 2022, feature: 46_000, documentary: 41_000 },
  { year: 2023, feature: 48_500, documentary: 43_000 },
  { year: 2024, feature: 51_000, documentary: 45_500 },
];
const demoRights = [
  { name: "Copydan-forbehold", value: 72 },
  { name: "Streamingforbehold", value: 54 },
  { name: "Ukendt", value: 18 },
];

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return <div className="max-w-full overflow-x-auto rounded-lg border"><Table className="min-w-max"><TableHeader><TableRow>{headers.map((header, index) => <TableHead key={`${header}-${index}`}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}>{row.map((value, cell) => <TableCell key={cell}>{value}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}

function AiChartView({ chart, rows, labels }: { chart: StatisticsChartType; rows: Array<Record<string, number>>; labels: Array<[string, string]> }) {
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
  if (chart === "pie" || chart === "donut") {
    const row = rows[0] ?? {};
    const values = labels.map(([key, label]) => ({ name: label, value: Number(row[key] ?? 0) }));
    return <PieChart><Tooltip contentStyle={tooltipStyle} /><Legend /><Pie data={values} dataKey="value" nameKey="name" innerRadius={chart === "donut" ? 65 : 0} outerRadius={110}>{values.map((value, index) => <Cell key={`${value.name}-${index}`} fill={colors[index % colors.length]} />)}</Pie></PieChart>;
  }
  if (chart === "line") return <LineChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip contentStyle={tooltipStyle} /><Legend />{labels.map(([key, label], index) => <Line connectNulls key={key} dataKey={key} name={label} stroke={colors[index % colors.length]} />)}</LineChart>;
  if (chart === "area") return <AreaChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip contentStyle={tooltipStyle} /><Legend />{labels.map(([key, label], index) => <Area key={key} dataKey={key} name={label} stroke={colors[index % colors.length]} fill={colors[index % colors.length]} fillOpacity={0.25} />)}</AreaChart>;
  const horizontal = chart === "horizontal_bar";
  const stacked = chart === "stacked_bar" || chart === "stacked_100";
  return <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} stackOffset={chart === "stacked_100" ? "expand" : "none"}><CartesianGrid strokeDasharray="3 3" />{horizontal ? <><XAxis type="number" /><YAxis type="category" dataKey="year" width={70} /></> : <><XAxis dataKey="year" /><YAxis tickFormatter={chart === "stacked_100" ? value => `${Math.round(Number(value) * 100)}%` : undefined} /></>}<Tooltip contentStyle={tooltipStyle} /><Legend />{labels.map(([key, label], index) => <Bar key={key} dataKey={key} name={label} stackId={stacked ? "total" : undefined} fill={colors[index % colors.length]} />)}</BarChart>;
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
  const [aiAnswer, setAiAnswer] = useState<{ suppressed?: boolean; minimum?: number; explanation?: string; caveats?: string[]; chart?: "line" | "bar" | "table"; plan?: { metric?: string }; lowSample?: boolean; includeDrafts?: boolean; candidates?: Array<{ id: string; name: string }>; series?: Array<{ year: number; value: number; contractCount: number; memberCount: number; lowSample: boolean; seriesKey: string; seriesLabel: string; inflationIndex?: number | null; realChangePercent?: number | null }> } | null>(null);
  const [aiError, setAiError] = useState<{ title: string; reason: string; suggestion?: string } | null>(null);
  const [selectedCharts, setSelectedCharts] = useState<StatisticsChartType[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    years.forEach(year => params.append("year", String(year)));
    if (gender !== "all") params.set("gender", gender);
    if (category !== "all") params.set("category", category);
    if (contractType !== "all") params.set("contractType", contractType);
    if (experienceGroup !== "all") params.set("experienceGroup", experienceGroup);
    fetch(`/api/admin/statistics?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Statistikken kunne ikke hentes"); return json; })
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
  ].filter(rows => (rows?.length ?? 0) > 0).length, [data]);
  const showDemonstrations = Boolean(data?.suppressed) || availableStatisticsCount < 2;
  const salaryCategoryChart = useMemo(() => {
    const rows = new Map<number, { year: number; feature?: number; documentary?: number }>();
    for (const item of data?.salaryByCategory ?? []) {
      const row = rows.get(item.year) ?? { year: item.year };
      if (item.category === "feature") row.feature = item.monthlyRate;
      if (item.category === "documentary") row.documentary = item.monthlyRate;
      rows.set(item.year, row);
    }
    return [...rows.values()].sort((left, right) => left.year - right.year);
  }, [data]);
  const aiChart = useMemo(() => {
    const labels = new Map<string, string>();
    const rows = new Map<number, Record<string, number>>();
    for (const item of aiAnswer?.series ?? []) {
      labels.set(item.seriesKey, item.seriesLabel);
      rows.set(item.year, { ...(rows.get(item.year) ?? { year: item.year }), [item.seriesKey]: item.value });
    }
    return { rows: [...rows.values()].sort((left, right) => Number(left.year) - Number(right.year)), labels: [...labels.entries()] };
  }, [aiAnswer]);
  const chartShape = useMemo(() => {
    const timePoints = new Set((aiAnswer?.series ?? []).map(row => row.year)).size;
    const seriesCount = new Set((aiAnswer?.series ?? []).map(row => row.seriesKey)).size;
    const additive = aiAnswer?.plan?.metric === "contract_count" || aiAnswer?.plan?.metric === "contributions";
    return { pointCount: aiAnswer?.series?.length ?? 0, seriesCount, timePointCount: timePoints, categoryCount: Math.max(timePoints, seriesCount), observationCount: 0, numericDimensions: 1, additive };
  }, [aiAnswer]);
  const effectiveCharts = useMemo(() => selectedCharts.length ? selectedCharts : recommendCharts(chartShape), [selectedCharts, chartShape]);
  const rejectedCharts = useMemo(() => effectiveCharts.map(chart => ({ chart, ...evaluateChartEligibility(chart, chartShape) })).filter(result => !result.eligible), [effectiveCharts, chartShape]);
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
    const csv = ["År;Medlemmer;Kontrakter;Feriepenge;BETA;I alt", ...rows.map(row => [row.year, row.memberCount, row.contractCount, row.totalHolidayPayAmount, row.totalBetaAmount, row.totalHolidayPayAmount + row.totalBetaAmount].join(";"))].join("\n");
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
      const result = await response.json();
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

    {showDemonstrations && <section className="space-y-4" aria-labelledby="demo-statistics-title">
      <Alert>
        <Sparkles className="h-4 w-4" />
        <AlertTitle id="demo-statistics-title">Eksempler på statistikvisninger</AlertTitle>
        <AlertDescription>Der er endnu ikke data nok til at vise mindst to reelle statistikker. Diagrammerne nedenfor bruger fiktive eksempeldata og indgår ikke i beregninger, forespørgsler eller eksport.</AlertDescription>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Demonstration: lønudvikling</CardTitle></CardHeader>
          <CardContent className="h-[300px]"><ResponsiveChartContainer><LineChart data={demoSalary}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis tickFormatter={value => `${Number(value) / 1000}k`} /><Tooltip contentStyle={tooltipStyle} formatter={value => formatKr(Number(value))} /><Legend /><Line dataKey="feature" name="Spillefilm" stroke="#3b82f6" /><Line dataKey="documentary" name="Dokumentarfilm" stroke="#10b981" /></LineChart></ResponsiveChartContainer></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Demonstration: rettighedsforbehold</CardTitle></CardHeader>
          <CardContent className="h-[300px]"><ResponsiveChartContainer><BarChart data={demoRights} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" domain={[0, 100]} tickFormatter={value => `${value}%`} /><YAxis type="category" dataKey="name" width={130} /><Tooltip contentStyle={tooltipStyle} formatter={value => `${value}%`} /><Bar dataKey="value" name="Andel" fill="#8b5cf6" /></BarChart></ResponsiveChartContainer></CardContent>
        </Card>
      </div>
    </section>}

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" />Spørg statistikken</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Spørg databasen, skriv fx: “Hvordan har gennemsnitslønnen udviklet sig siden 2022?”</p>
        <Textarea value={aiQuestion} onChange={event => setAiQuestion(event.target.value)} placeholder="Skriv et spørgsmål om de anonymiserede data…" />
        <div className="flex flex-wrap gap-2">{querySuggestions.map(suggestion => <Button key={suggestion} type="button" size="sm" variant="outline" className="h-auto whitespace-normal text-left" onClick={() => void askStatistics(suggestion)} disabled={aiLoading}>{suggestion}</Button>)}</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button className="w-full sm:w-auto" onClick={() => void askStatistics()} disabled={aiLoading || aiQuestion.trim().length < 5}>{aiLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Undersøg</Button><Popover><PopoverTrigger asChild><Button type="button" variant="outline">{selectedCharts.length ? `${selectedCharts.length} resultatvisninger` : "Resultatvisning: Automatisk"}</Button></PopoverTrigger><PopoverContent className="w-80"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Vælg resultat</span><Button size="sm" variant="ghost" onClick={() => setSelectedCharts([])}>Automatisk</Button></div><div className="max-h-72 space-y-1 overflow-y-auto">{STATISTICS_CHART_TYPES.map(chart => <label key={chart} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"><input type="checkbox" checked={selectedCharts.includes(chart)} onChange={event => setSelectedCharts(current => event.target.checked ? [...current, chart] : current.filter(item => item !== chart))} />{chartLabels[chart]}</label>)}</div></PopoverContent></Popover></div>
        {aiError && <Alert variant="destructive"><AlertTitle>{aiError.title}</AlertTitle><AlertDescription><span className="block">{aiError.reason}</span>{aiError.suggestion && <span className="mt-1 block">Forslag: {aiError.suggestion}</span>}</AlertDescription></Alert>}
        {aiAnswer?.suppressed && <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Ikke nok data til et sikkert resultat</AlertTitle><AlertDescription>Det valgte udsnit indeholder færre end {aiAnswer.minimum ?? 2} kontrakter. Prøv en længere periode, færre filtre eller en bredere produktionstype.</AlertDescription></Alert>}
        {aiAnswer && !aiAnswer.suppressed && <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm">{aiAnswer.explanation}</p>
          {Boolean(aiAnswer.caveats?.length) && <Alert><AlertTitle>Forbehold ved resultatet</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-5">{aiAnswer.caveats?.map(caveat => <li key={caveat}>{caveat}</li>)}</ul></AlertDescription></Alert>}
          {rejectedCharts.map(result => <Alert key={result.chart}><AlertTitle>{chartLabels[result.chart]} kan ikke bruges</AlertTitle><AlertDescription>{result.reason}</AlertDescription></Alert>)}
          {effectiveCharts.filter(chart => chart !== "table" && evaluateChartEligibility(chart, chartShape).eligible).map(chart => <Card key={chart}><CardHeader><CardTitle className="text-sm">{chartLabels[chart]}</CardTitle></CardHeader><CardContent className="h-[320px]"><ResponsiveChartContainer><AiChartView chart={chart} rows={aiChart.rows} labels={aiChart.labels} /></ResponsiveChartContainer></CardContent></Card>)}
          {(effectiveCharts.includes("table") || selectedCharts.length === 0) && <DataTable headers={["Serie", "År", "Resultat", "Kontrakter", "Grundlag", "Inflationsindeks", "Realændring"]} rows={(aiAnswer.series ?? []).map(row => [row.seriesLabel, row.year, row.value.toLocaleString("da-DK"), row.contractCount, row.lowSample ? "Usikkert" : "≥ 5", row.inflationIndex ?? "—", row.realChangePercent == null ? "—" : `${row.realChangePercent}%`])} />}
          {aiAnswer.lowSample && <Alert><AlertTitle>Statistisk usikkert grundlag</AlertTitle><AlertDescription>Mindst ét datapunkt bygger på færre end 5 kontrakter.</AlertDescription></Alert>}
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
      {!data?.suppressed && <Button variant="outline" className="w-full" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV</Button>}
    </div>

    {data?.suppressed ? <Card><CardContent className="py-16 text-center"><ShieldCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground" /><h2 className="font-semibold">Ikke nok kontrakter til statistik</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Det valgte udsnit indeholder færre end {data.minimum} kontrakter. Systemet udleverer derfor ingen tal. Prøv bredere filtre.</p></CardContent></Card> : <>
      <div className="grid grid-cols-3 gap-2 sm:gap-4"><Card><CardHeader className="p-3 sm:p-6"><CardTitle className="text-xs sm:text-sm">Rettighedshavere i datagrundlaget</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold sm:px-6 sm:pb-6 sm:text-3xl">{data?.memberCount}</CardContent></Card><Card><CardHeader className="p-3 sm:p-6"><CardTitle className="text-xs sm:text-sm">Samlet antal kontrakter</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold sm:px-6 sm:pb-6 sm:text-3xl">{data?.contractCount}</CardContent></Card><Card><CardHeader className="p-3 sm:p-6"><CardTitle className="text-xs sm:text-sm">Kontrakter med løndata</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold sm:px-6 sm:pb-6 sm:text-3xl">{salaryContractCount}</CardContent></Card></div>
      <Tabs defaultValue="salary"><div className="-mx-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"><TabsList className="w-max min-w-full justify-start"><TabsTrigger value="salary">Løn</TabsTrigger><TabsTrigger value="pension">Pension</TabsTrigger><TabsTrigger value="weeks">Arbejdsuger</TabsTrigger><TabsTrigger value="rights">Rettigheder</TabsTrigger><TabsTrigger value="gender">Køn</TabsTrigger><TabsTrigger value="contracts">Kontrakter</TabsTrigger><TabsTrigger value="contributions">Bidrag</TabsTrigger><TabsTrigger value="ai">AI-forbehold</TabsTrigger><TabsTrigger value="individual">Individdata</TabsTrigger></TabsList></div>
        <TabsContent value="salary" className="space-y-4"><Card><CardContent className="h-[360px] pt-6"><ResponsiveChartContainer><LineChart data={salaryCategoryChart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis tickFormatter={value => `${value / 1000}k`} /><Tooltip contentStyle={tooltipStyle} formatter={value => formatKr(Number(value))} /><Legend /><Line connectNulls dataKey="feature" name="Spillefilm" stroke="#3b82f6" /><Line connectNulls dataKey="documentary" name="Dokumentarfilm" stroke="#10b981" /></LineChart></ResponsiveChartContainer></CardContent></Card><DataTable headers={["År", "Produktionstype", "Kontrakter", "Median månedsløn", "Grundlag"]} rows={(data?.salaryByCategory ?? []).map(row => [row.year, categoryLabels[row.category] ?? row.category, row.contractCount, formatKr(row.monthlyRate), row.lowSample ? "Statistisk usikkert" : "≥ 5 kontrakter"])} /></TabsContent>
        <TabsContent value="pension"><DataTable headers={["År", "Medlemmer", "Gennemsnitlig pension"]} rows={(data?.pension ?? []).map(row => [row.year, row.memberCount, `${row.avgPensionPercent}%`])} /></TabsContent>
        <TabsContent value="weeks"><DataTable headers={["År", "Medlemmer", "Gennemsnit", "Median"]} rows={(data?.workingWeeks ?? []).map(row => [row.year, row.memberCount, `${row.avgWeeks} uger`, `${row.medianWeeks} uger`])} /></TabsContent>
        <TabsContent value="rights"><DataTable headers={["Produktionstype", "Medlemmer", "Streaming", "Ukendt", "Copydan", "Ukendt", "Royalty", "Ukendt"]} rows={(data?.rights ?? []).map(row => [categoryLabels[row.category] ?? row.category, row.memberCount, `${row.svodPercent}%`, row.svodUnknown, `${row.copydanPercent}%`, row.copydanUnknown, `${row.royaltyPercent}%`, row.royaltyUnknown])} /></TabsContent>
        <TabsContent value="gender"><DataTable headers={["Køn", "Personer", "Gennemsnitlig registreret løn"]} rows={(data?.gender ?? []).map(row => [row.gender === "female" ? "Kvinde" : row.gender === "male" ? "Mand" : "Andet", row.count, formatKr(row.avgSalary)])} /></TabsContent>
        <TabsContent value="contracts"><Card><CardContent className="h-[360px] pt-6"><ResponsiveChartContainer><BarChart data={data?.contractCounts ?? []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip contentStyle={tooltipStyle} /><Legend /><Bar dataKey="aLoen" name="A-løn" fill="#3b82f6" /><Bar dataKey="leverandoer" name="Leverandør" fill="#f59e0b" /></BarChart></ResponsiveChartContainer></CardContent></Card></TabsContent>
        <TabsContent value="contributions"><DataTable headers={["År", "Medlemmer", "Kontrakter", "Feriepenge", "BETA", "I alt"]} rows={(data?.contributions ?? []).map(row => [row.year, row.memberCount, row.contractCount, formatKr(row.totalHolidayPayAmount), formatKr(row.totalBetaAmount), formatKr(row.totalHolidayPayAmount + row.totalBetaAmount)])} /></TabsContent>
        <TabsContent value="ai"><DataTable headers={["År", "Medlemmer", "Med forbehold", "Uden forbehold", "Andel"]} rows={(data?.aiClauses ?? []).map(row => [row.year, row.memberCount, row.withClause, row.withoutClause, `${row.pct}%`])} /></TabsContent>
        <TabsContent value="individual"><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Individrangering er deaktiveret</AlertTitle><AlertDescription>Årsindkomst og kontraktdata for enkelte personer vises ikke på adminsiden. Statistikken præsenteres kun som grupper med mindst {data?.minimum ?? 2} kontrakter, og små grupper markeres som usikre.</AlertDescription></Alert></TabsContent>
      </Tabs>
      {data?.includeDrafts && <Alert><AlertTitle>Kladder indgår</AlertTitle><AlertDescription>Organisationens indstilling medtager kladekontrakter. De kan indeholde ufuldstændige eller endnu ikke kontrollerede udtræksdata.</AlertDescription></Alert>}
      {data?.lowSample && <Alert><AlertTitle>Statistisk usikkert grundlag</AlertTitle><AlertDescription>Det valgte resultat bygger på {data.contractCount} kontrakter. Vær forsigtig med konklusioner baseret på færre end {data.lowSampleThreshold} kontrakter.</AlertDescription></Alert>}
    </>}
  </div>;
}
