"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BrainCircuit, Clock3, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";

import { ResponsiveChartContainer } from "@/components/charts/responsive-chart-container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CountRow = { value: string; count: number };
type AdvicePayload = {
  suppressed: boolean;
  minimum: number;
  years: number[];
  caseCount: number | null;
  memberCount: number | null;
  byYear?: Array<{ year: number; received: number; analysed: number; responded: number; completed: number; escalated: number }>;
  workflow?: { awaiting: number; processing: number; completed: number; analysisFailures: number; escalated: number; medianAnalysisSeconds: number | null; medianResponseSeconds: number | null; p90ResponseSeconds: number | null; medianCompletionSeconds: number | null };
  intakeSources?: CountRow[];
  documentStages?: CountRow[];
  agreementStatuses?: CountRow[];
  agreementNames?: CountRow[];
  contractTypes?: CountRow[];
  productionTypes?: CountRow[];
  riskLevels?: CountRow[];
  issueFrequency?: Array<{ ruleCode: string; label: string; count: number; sharePercent: number; highSeverity: number; assessed: number; correct: number; incorrect: number }>;
  corrections?: Array<{ ruleCode: string; label: string; compared: number; fixed: number; notFixed: number; newIssues: number; uncertain: number }>;
  aiQuality?: { totalFindings: number; assessedFindings: number; correctFindings: number; incorrectFindings: number; wrongSeverity: number; notRelevant: number; missedFindings: number; assessmentCoveragePercent: number; precisionPercent: number | null };
  aiOperations?: { runs: number; succeeded: number; failed: number; totalCostDkk: number; medianLatencyMs: number | null; models: CountRow[]; errors: CountRow[] };
};

const stageLabels: Record<string, string> = { draft: "Udkast", unsigned: "Usigneret", signed: "Underskrevet", unknown: "Ukendt" };
const agreementLabels: Record<string, string> = { present: "Overenskomst fundet", missing: "Mangler henvisning", unclear: "Uklar henvisning", not_applicable: "Ikke relevant", unknown: "Ukendt" };
const sourceLabels: Record<string, string> = { portal: "Portal", admin: "Admin", gmail: "Gmail", import: "Import", unknown: "Ukendt" };

function duration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min.`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} timer`;
  return `${Math.round(seconds / 86_400)} dage`;
}

function CountTable({ title, rows, labels = {} }: { title: string; rows?: CountRow[]; labels?: Record<string, string> }) {
  return <Card><CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Antal</TableHead></TableRow></TableHeader><TableBody>{(rows ?? []).map(row => <TableRow key={row.value}><TableCell>{labels[row.value] ?? row.value}</TableCell><TableCell className="text-right tabular-nums">{row.count}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>;
}

export function ContractAdviceStatistics() {
  const [data, setData] = useState<AdvicePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState("all");
  const [source, setSource] = useState("all");
  const [contractType, setContractType] = useState("all");
  const [rule, setRule] = useState("all");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function askAdviceStatistics() {
    const trimmed = question.trim();
    if (trimmed.length < 5) return;
    setAsking(true);
    setAnswer(null);
    try {
      const response = await fetch("/api/admin/statistics/contract-advice/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Spørgsmålet kunne ikke besvares");
      setAnswer(json.answer);
    } catch (reason) {
      setAnswer(reason instanceof Error ? reason.message : "Spørgsmålet kunne ikke besvares");
    } finally {
      setAsking(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (year !== "all") params.set("year", year);
    if (source !== "all") params.set("source", source);
    if (contractType !== "all") params.set("contractType", contractType);
    if (rule !== "all") params.set("rule", rule);
    fetch(`/api/admin/statistics/contract-advice?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Kunne ikke hente rådgivningsstatistik"); return json; })
      .then(setData).catch(reason => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Kunne ikke hente rådgivningsstatistik"); });
    return () => controller.abort();
  }, [contractType, rule, source, year]);

  if (error) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Rådgivningsstatistik kunne ikke indlæses</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!data) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (data.suppressed) return <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Ikke nok sager til en sikker visning</AlertTitle><AlertDescription>Rådgivningsstatistik vises først, når gruppen indeholder mindst {data.minimum} forskellige personer eller uafhængige sager.</AlertDescription></Alert>;

  return <section className="space-y-4" aria-labelledby="contract-advice-statistics-title">
    <div><h2 id="contract-advice-statistics-title" className="text-xl font-semibold">Kontraktrådgivning</h2><p className="text-sm text-muted-foreground">Anonymiserede mønstre, behandlingstider, rettelser og AI-kvalitet. Ingen kontrakttekst eller personoplysninger indgår.</p></div>
    <Card>
      <CardHeader><CardTitle className="text-sm">Spørg rådgivningsstatistikken</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void askAdviceStatistics(); }} placeholder="Fx: Hvor ofte mangler der en overenskomsthenvisning?" />
          <Button type="button" onClick={() => void askAdviceStatistics()} disabled={asking || question.trim().length < 5}>{asking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spørg"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">Spørgsmålet matches kun med godkendte rådgivningsmål. Assistenten kan ikke skrive SQL eller læse kontrakttekst.</p>
        {answer ? <Alert><BrainCircuit className="h-4 w-4" /><AlertTitle>Svar</AlertTitle><AlertDescription>{answer}</AlertDescription></Alert> : null}
      </CardContent>
    </Card>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <Select value={year} onValueChange={setYear}><SelectTrigger><SelectValue placeholder="År" /></SelectTrigger><SelectContent><SelectItem value="all">Alle år</SelectItem>{data.years.map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select>
      <Select value={source} onValueChange={setSource}><SelectTrigger><SelectValue placeholder="Kilde" /></SelectTrigger><SelectContent><SelectItem value="all">Alle kilder</SelectItem>{Object.entries(sourceLabels).filter(([value]) => value !== "unknown").map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
      <Select value={contractType} onValueChange={setContractType}><SelectTrigger><SelectValue placeholder="Kontrakttype" /></SelectTrigger><SelectContent><SelectItem value="all">Alle kontrakttyper</SelectItem>{(data.contractTypes ?? []).map(row => <SelectItem key={row.value} value={row.value}>{row.value}</SelectItem>)}</SelectContent></Select>
      <Select value={rule} onValueChange={setRule}><SelectTrigger><SelectValue placeholder="Problemtype" /></SelectTrigger><SelectContent><SelectItem value="all">Alle problemtyper</SelectItem>{(data.issueFrequency ?? []).map(row => <SelectItem key={row.ruleCode} value={row.ruleCode}>{row.label}</SelectItem>)}</SelectContent></Select>
      <Button type="button" variant="outline" onClick={() => { setYear("all"); setSource("all"); setContractType("all"); setRule("all"); }}>Nulstil filtre</Button>
    </div>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Card><CardHeader className="p-3"><CardTitle className="flex items-center gap-2 text-xs"><FileCheck2 className="h-4 w-4" />Sager</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-2xl font-bold">{data.caseCount}</CardContent></Card>
      <Card><CardHeader className="p-3"><CardTitle className="flex items-center gap-2 text-xs"><Clock3 className="h-4 w-4" />Median til svar</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold">{duration(data.workflow?.medianResponseSeconds)}</CardContent></Card>
      <Card><CardHeader className="p-3"><CardTitle className="flex items-center gap-2 text-xs"><AlertTriangle className="h-4 w-4" />Eskaleret</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-2xl font-bold">{data.workflow?.escalated ?? 0}</CardContent></Card>
      <Card><CardHeader className="p-3"><CardTitle className="flex items-center gap-2 text-xs"><BrainCircuit className="h-4 w-4" />AI-fund vurderet</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-xl font-bold">{data.aiQuality?.assessmentCoveragePercent ?? 0}%</CardContent></Card>
    </div>

    <Tabs defaultValue="flow">
      <div className="overflow-x-auto pb-1"><TabsList className="w-max"><TabsTrigger value="flow">Mængde og flow</TabsTrigger><TabsTrigger value="contracts">Kontrakternes udgangspunkt</TabsTrigger><TabsTrigger value="issues">Typiske problemer</TabsTrigger><TabsTrigger value="corrections">Rettelser</TabsTrigger><TabsTrigger value="quality">AI-kvalitet</TabsTrigger></TabsList></div>
      <TabsContent value="flow" className="space-y-4">
        <Card><CardHeader><CardTitle className="text-sm">Sagsudvikling</CardTitle></CardHeader><CardContent className="h-[320px]"><ResponsiveChartContainer><BarChart data={data.byYear ?? []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip /><Legend /><Bar dataKey="received" name="Modtaget" fill="#3b82f6" /><Bar dataKey="responded" name="Besvaret" fill="#f59e0b" /><Bar dataKey="completed" name="Afsluttet" fill="#10b981" /></BarChart></ResponsiveChartContainer></CardContent></Card>
        <div className="grid gap-4 md:grid-cols-2"><CountTable title="Indgangskilde" rows={data.intakeSources} labels={sourceLabels} /><Card><CardHeader><CardTitle className="text-sm">Behandlingstid</CardTitle></CardHeader><CardContent><Table><TableBody><TableRow><TableCell>Analyse</TableCell><TableCell className="text-right">{duration(data.workflow?.medianAnalysisSeconds)}</TableCell></TableRow><TableRow><TableCell>Første svar, median</TableCell><TableCell className="text-right">{duration(data.workflow?.medianResponseSeconds)}</TableCell></TableRow><TableRow><TableCell>Første svar, 90-percentil</TableCell><TableCell className="text-right">{duration(data.workflow?.p90ResponseSeconds)}</TableCell></TableRow><TableRow><TableCell>Afslutning</TableCell><TableCell className="text-right">{duration(data.workflow?.medianCompletionSeconds)}</TableCell></TableRow></TableBody></Table></CardContent></Card></div>
      </TabsContent>
      <TabsContent value="contracts"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><CountTable title="Dokumentstadie" rows={data.documentStages} labels={stageLabels} /><CountTable title="Overenskomststatus" rows={data.agreementStatuses} labels={agreementLabels} /><CountTable title="Navngivne overenskomster" rows={data.agreementNames} /><CountTable title="Kontrakttype" rows={data.contractTypes} /><CountTable title="Produktionstype" rows={data.productionTypes} /><CountTable title="Risikoniveau" rows={data.riskLevels} /></div></TabsContent>
      <TabsContent value="issues"><Card><CardContent className="pt-6"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Problem</TableHead><TableHead>Antal</TableHead><TableHead>Andel</TableHead><TableHead>Høj alvor</TableHead><TableHead>Juristvurderet</TableHead></TableRow></TableHeader><TableBody>{(data.issueFrequency ?? []).map(row => <TableRow key={row.ruleCode}><TableCell className="font-medium">{row.label}</TableCell><TableCell>{row.count}</TableCell><TableCell>{row.sharePercent}%</TableCell><TableCell>{row.highSeverity}</TableCell><TableCell>{row.assessed}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="corrections"><Alert className="mb-4"><BrainCircuit className="h-4 w-4" /><AlertTitle>Automatisk versionssammenligning</AlertTitle><AlertDescription>Resultater under 70 % sikkerhed vises som usikre og tælles ikke som dokumenterede rettelser.</AlertDescription></Alert><Card><CardContent className="pt-6"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Problem</TableHead><TableHead>Sammenlignet</TableHead><TableHead>Rettet</TableHead><TableHead>Ikke rettet</TableHead><TableHead>Nye problemer</TableHead><TableHead>Usikre</TableHead></TableRow></TableHeader><TableBody>{(data.corrections ?? []).map(row => <TableRow key={row.ruleCode}><TableCell className="font-medium">{row.label}</TableCell><TableCell>{row.compared}</TableCell><TableCell>{row.fixed}</TableCell><TableCell>{row.notFixed}</TableCell><TableCell>{row.newIssues}</TableCell><TableCell>{row.uncertain}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="quality" className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><CountTable title="Fund" rows={[{ value: "Alle AI-fund", count: data.aiQuality?.totalFindings ?? 0 }, { value: "Vurderet", count: data.aiQuality?.assessedFindings ?? 0 }]} /><CountTable title="Vurdering" rows={[{ value: "Korrekte", count: data.aiQuality?.correctFindings ?? 0 }, { value: "Forkerte", count: data.aiQuality?.incorrectFindings ?? 0 }]} /><CountTable title="Korrektioner" rows={[{ value: "Oversete problemer", count: data.aiQuality?.missedFindings ?? 0 }, { value: "Forkert alvor", count: data.aiQuality?.wrongSeverity ?? 0 }, { value: "Ikke relevant", count: data.aiQuality?.notRelevant ?? 0 }]} /><Card><CardHeader><CardTitle className="text-sm">Målt præcision</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{data.aiQuality?.precisionPercent == null ? "—" : `${data.aiQuality.precisionPercent}%`}</CardContent></Card></div><div className="grid gap-4 md:grid-cols-3"><CountTable title="AI-kørsler" rows={[{ value: "Gennemført", count: data.aiOperations?.succeeded ?? 0 }, { value: "Fejlet", count: data.aiOperations?.failed ?? 0 }]} /><CountTable title="Modeller" rows={data.aiOperations?.models} /><Card><CardHeader><CardTitle className="text-sm">AI-drift</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p><span className="text-muted-foreground">Samlet omkostning:</span> {data.aiOperations?.totalCostDkk.toLocaleString("da-DK", { style: "currency", currency: "DKK" })}</p><p><span className="text-muted-foreground">Median svartid:</span> {data.aiOperations?.medianLatencyMs == null ? "—" : `${Math.round(data.aiOperations.medianLatencyMs / 100) / 10} sek.`}</p></CardContent></Card></div></TabsContent>
    </Tabs>
  </section>;
}
