"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, Download, Loader2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ResponsiveChartContainer } from "@/components/charts/responsive-chart-container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";

type YearRow = { year: number; memberCount: number };
type StatisticsPayload = {
  suppressed: boolean; minimum: number; memberCount: number | null; contractCount?: number; years: number[];
  salary?: Array<YearRow & { monthlyRate: number; dailyRate: number }>;
  pension?: Array<YearRow & { avgPensionPercent: number }>;
  workingWeeks?: Array<YearRow & { avgWeeks: number; medianWeeks: number }>;
  contractCounts?: Array<YearRow & { total: number; aLoen: number; leverandoer: number }>;
  rights?: Array<{ category: string; svodPercent: number; copydanPercent: number; royaltyPercent: number; memberCount: number }>;
  gender?: Array<{ gender: string; count: number; avgSalary: number }>;
  aiClauses?: Array<YearRow & { withClause: number; withoutClause: number; pct: number }>;
  contributions?: Array<YearRow & { contractCount: number; totalHolidayPayAmount: number; totalBetaAmount: number }>;
};

const tooltipStyle = { backgroundColor: "rgba(255,255,255,.95)", border: "1px solid #ddd", borderRadius: 8, fontSize: 12 };
const categoryLabels: Record<string, string> = { feature: "Spillefilm", tvSeries: "TV-serie", documentary: "Dokumentar", docSeries: "Dok.-serie", short: "Kortfilm", tvEntertainment: "TV-underholdning", reality: "Reality", other: "Andet" };
const formatKr = (value: number) => `${value.toLocaleString("da-DK")} kr.`;

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return <div className="rounded-lg border"><Table><TableHeader><TableRow>{headers.map(header => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}>{row.map((value, cell) => <TableCell key={cell}>{value}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}

export default function AdminStatistikPage() {
  const { t } = useI18n();
  const [year, setYear] = useState("all");
  const [gender, setGender] = useState("all");
  const [category, setCategory] = useState("all");
  const [contractType, setContractType] = useState("all");
  const [data, setData] = useState<StatisticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (year !== "all") params.set("year", year);
    if (gender !== "all") params.set("gender", gender);
    if (category !== "all") params.set("category", category);
    if (contractType !== "all") params.set("contractType", contractType);
    fetch(`/api/admin/statistics?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Statistikken kunne ikke hentes"); return json; })
      .then(setData)
      .catch(fetchError => { if (fetchError.name !== "AbortError") setError(fetchError.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, gender, category, contractType]);

  const contributionTotal = useMemo(() => (data?.contributions ?? []).reduce((sum, row) => sum + row.totalHolidayPayAmount + row.totalBetaAmount, 0), [data]);
  const exportCsv = () => {
    const rows = data?.contributions ?? [];
    const csv = ["År;Medlemmer;Kontrakter;Feriepenge;BETA;I alt", ...rows.map(row => [row.year, row.memberCount, row.contractCount, row.totalHolidayPayAmount, row.totalBetaAmount, row.totalHolidayPayAmount + row.totalBetaAmount].join(";"))].join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `dfks-statistik-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="space-y-6"><PageHeader title={t("admin.stats.title")} subtitle={t("admin.stats.subtitle")} /><Alert variant="destructive"><AlertTitle>Statistikken kunne ikke hentes</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div>;

  return <div className="space-y-6">
    <PageHeader title={t("admin.stats.title")} subtitle="Anonymiseret statistik for den aktive organisation" />
    <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Beskyttet statistik</AlertTitle><AlertDescription>Personer, der har fravalgt statistik, indgår ikke. En gruppe vises kun, når den omfatter mindst {data?.minimum ?? 10} forskellige rettighedshavere. Rå kontrakt- og løndata sendes ikke til browseren.</AlertDescription></Alert>

    <div className="flex flex-wrap gap-3">
      <Select value={year} onValueChange={setYear}><SelectTrigger className="w-[160px]"><CalendarDays className="mr-2 h-4 w-4" /><SelectValue placeholder="År" /></SelectTrigger><SelectContent><SelectItem value="all">Alle år</SelectItem>{(data?.years ?? []).map(item => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select>
      <Select value={category} onValueChange={setCategory}><SelectTrigger className="w-[180px]"><SelectValue placeholder="Produktionstype" /></SelectTrigger><SelectContent><SelectItem value="all">Alle produktionstyper</SelectItem>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
      <Select value={contractType} onValueChange={setContractType}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Kontrakttype" /></SelectTrigger><SelectContent><SelectItem value="all">Alle kontrakttyper</SelectItem><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="leverandør">Leverandør</SelectItem></SelectContent></Select>
      <Select value={gender} onValueChange={setGender}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Køn" /></SelectTrigger><SelectContent><SelectItem value="all">Alle køn</SelectItem><SelectItem value="male">Mand</SelectItem><SelectItem value="female">Kvinde</SelectItem><SelectItem value="other">Andet</SelectItem></SelectContent></Select>
      {!data?.suppressed && <Button variant="outline" className="ml-auto" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV</Button>}
    </div>

    {data?.suppressed ? <Card><CardContent className="py-16 text-center"><ShieldCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground" /><h2 className="font-semibold">Ikke nok personer til anonym statistik</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Det valgte udsnit indeholder færre end {data.minimum} rettighedshavere. Systemet udleverer derfor ingen tal. Prøv bredere filtre.</p></CardContent></Card> : <>
      <div className="grid gap-4 sm:grid-cols-3"><Card><CardHeader><CardTitle className="text-sm">Rettighedshavere</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{data?.memberCount}</CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Kontrakter</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{data?.contractCount}</CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Samlede bidrag</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{formatKr(contributionTotal)}</CardContent></Card></div>
      <Tabs defaultValue="salary"><TabsList className="flex-wrap"><TabsTrigger value="salary">Løn</TabsTrigger><TabsTrigger value="pension">Pension</TabsTrigger><TabsTrigger value="weeks">Arbejdsuger</TabsTrigger><TabsTrigger value="rights">Rettigheder</TabsTrigger><TabsTrigger value="gender">Køn</TabsTrigger><TabsTrigger value="contracts">Kontrakter</TabsTrigger><TabsTrigger value="contributions">Bidrag</TabsTrigger><TabsTrigger value="ai">AI-forbehold</TabsTrigger><TabsTrigger value="individual">Individdata</TabsTrigger></TabsList>
        <TabsContent value="salary" className="space-y-4"><Card><CardContent className="h-[360px] pt-6"><ResponsiveChartContainer><LineChart data={data?.salary ?? []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis tickFormatter={value => `${value / 1000}k`} /><Tooltip contentStyle={tooltipStyle} formatter={value => formatKr(Number(value))} /><Legend /><Line dataKey="monthlyRate" name="Månedsløn" stroke="#3b82f6" /><Line dataKey="dailyRate" name="Dagsløn" stroke="#10b981" /></LineChart></ResponsiveChartContainer></CardContent></Card><DataTable headers={["År", "Medlemmer", "Månedsløn", "Dagsløn"]} rows={(data?.salary ?? []).map(row => [row.year, row.memberCount, formatKr(row.monthlyRate), formatKr(row.dailyRate)])} /></TabsContent>
        <TabsContent value="pension"><DataTable headers={["År", "Medlemmer", "Gennemsnitlig pension"]} rows={(data?.pension ?? []).map(row => [row.year, row.memberCount, `${row.avgPensionPercent}%`])} /></TabsContent>
        <TabsContent value="weeks"><DataTable headers={["År", "Medlemmer", "Gennemsnit", "Median"]} rows={(data?.workingWeeks ?? []).map(row => [row.year, row.memberCount, `${row.avgWeeks} uger`, `${row.medianWeeks} uger`])} /></TabsContent>
        <TabsContent value="rights"><DataTable headers={["Produktionstype", "Medlemmer", "Streaming", "Copydan", "Royalty"]} rows={(data?.rights ?? []).map(row => [categoryLabels[row.category] ?? row.category, row.memberCount, `${row.svodPercent}%`, `${row.copydanPercent}%`, `${row.royaltyPercent}%`])} /></TabsContent>
        <TabsContent value="gender"><DataTable headers={["Køn", "Personer", "Gennemsnitlig registreret løn"]} rows={(data?.gender ?? []).map(row => [row.gender === "female" ? "Kvinde" : row.gender === "male" ? "Mand" : "Andet", row.count, formatKr(row.avgSalary)])} /></TabsContent>
        <TabsContent value="contracts"><Card><CardContent className="h-[360px] pt-6"><ResponsiveChartContainer><BarChart data={data?.contractCounts ?? []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip contentStyle={tooltipStyle} /><Legend /><Bar dataKey="aLoen" name="A-løn" fill="#3b82f6" /><Bar dataKey="leverandoer" name="Leverandør" fill="#f59e0b" /></BarChart></ResponsiveChartContainer></CardContent></Card></TabsContent>
        <TabsContent value="contributions"><DataTable headers={["År", "Medlemmer", "Kontrakter", "Feriepenge", "BETA", "I alt"]} rows={(data?.contributions ?? []).map(row => [row.year, row.memberCount, row.contractCount, formatKr(row.totalHolidayPayAmount), formatKr(row.totalBetaAmount), formatKr(row.totalHolidayPayAmount + row.totalBetaAmount)])} /></TabsContent>
        <TabsContent value="ai"><DataTable headers={["År", "Medlemmer", "Med forbehold", "Uden forbehold", "Andel"]} rows={(data?.aiClauses ?? []).map(row => [row.year, row.memberCount, row.withClause, row.withoutClause, `${row.pct}%`])} /></TabsContent>
        <TabsContent value="individual"><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Individrangering er deaktiveret</AlertTitle><AlertDescription>Årsindkomst og kontraktdata for enkelte personer vises ikke på adminsiden. Statistikken præsenteres kun som grupper med mindst {data?.minimum ?? 10} personer.</AlertDescription></Alert></TabsContent>
      </Tabs>
    </>}
  </div>;
}
