"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveChartContainer } from "@/components/charts/responsive-chart-container";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPERIENCE_GROUPS, type ExperienceGroup } from "@/lib/experience-groups";

export type SalaryStatPoint = { year: number; egen: number | null; gennemsnit: number | null };

// Statisk eksempelkurve (ugeløn) der ligner den rigtige statistik — vises sløret,
// når statistikken ikke kan vises (fravalgt eller for få medlemmer).
const MOCK_POINTS: SalaryStatPoint[] = [
  { year: 2019, egen: 7200, gennemsnit: 7700 },
  { year: 2020, egen: 7700, gennemsnit: 7900 },
  { year: 2021, egen: 8000, gennemsnit: 8100 },
  { year: 2022, egen: 8700, gennemsnit: 8400 },
  { year: 2023, egen: 8800, gennemsnit: 8800 },
  { year: 2024, egen: 9400, gennemsnit: 9100 },
];

const formatKr = (value: number) => `${Math.round(value).toLocaleString("da-DK")} kr.`;

function Chart({ points }: { points: SalaryStatPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveChartContainer minHeight={256}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="year" fontSize={12} />
          <YAxis fontSize={12} tickFormatter={value => `${Math.round(Number(value) / 1000)}k`} width={40} />
          <Tooltip formatter={value => formatKr(Number(value))} labelFormatter={label => `År ${label}`} />
          <Legend />
          <Line type="monotone" dataKey="egen" name="Din grundløn pr. uge" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="gennemsnit" name="Median pr. uge, alle medlemmer" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveChartContainer>
    </div>
  );
}

function MockOverlay({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none opacity-25 blur-[2px]">
        <Chart points={MOCK_POINTS} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-background/95 p-4 text-center shadow-sm">
          <p className="text-sm font-medium">{title}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function SalaryStatsCard({ points, benchmarkPointsByExperience, optedOut, benchmarkAvailable, contracts }: {
  points: SalaryStatPoint[];
  benchmarkPointsByExperience: Partial<Record<ExperienceGroup, SalaryStatPoint[]>>;
  optedOut: boolean;
  benchmarkAvailable: boolean;
  contracts: Array<{ id: string; title: string; year: number; weekly: number }>;
}) {
  const [experienceGroup, setExperienceGroup] = useState<"all" | ExperienceGroup>("all");
  const displayedPoints = useMemo(() => experienceGroup === "all" ? points : (benchmarkPointsByExperience[experienceGroup] ?? points.map(point => ({ ...point, gennemsnit: null }))), [benchmarkPointsByExperience, experienceGroup, points]);
  const displayedBenchmarkAvailable = experienceGroup === "all" ? benchmarkAvailable : displayedPoints.some(point => point.gennemsnit != null);
  const ownPoints = points.filter(point => point.egen != null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-amber-500" />
          Din lønudvikling
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section aria-labelledby="salary-own-title" className="space-y-2">
          <h3 id="salary-own-title" className="font-semibold">Min lønudvikling</h3>
          {ownPoints.length ? <Chart points={displayedPoints} /> : <MockOverlay title="Lønstatistikken er på vej"><p className="mt-1 text-sm text-muted-foreground">Din egen kurve vises, når mindst én kontrakt har en brugbar løn og dato.</p></MockOverlay>}
          <p className="text-xs text-muted-foreground">Grundløn pr. uge beregnet ud fra dine egne kontrakter. Dine egne tal kan ses, selv om organisationssammenligningen endnu ikke kan vises.</p>
        </section>

        <section aria-labelledby="salary-benchmark-title" className="space-y-2 rounded-lg border bg-muted/20 p-4">
          <h3 id="salary-benchmark-title" className="font-semibold">Sammenlign med organisationen</h3>
          {!optedOut && <Select value={experienceGroup} onValueChange={value => setExperienceGroup(value as "all" | ExperienceGroup)}><SelectTrigger className="w-full sm:max-w-sm"><SelectValue placeholder="Vælg erfaringsgruppe" /></SelectTrigger><SelectContent><SelectItem value="all">Alle erfaringsgrupper</SelectItem>{EXPERIENCE_GROUPS.map(group => <SelectItem key={group.value} value={group.value}>{group.label} ({group.description})</SelectItem>)}</SelectContent></Select>}
          {optedOut ? <p className="text-sm text-muted-foreground">Du har fravalgt fælles statistik. Dine egne tal vises fortsat, men organisationsbenchmark er slået fra.</p> : displayedBenchmarkAvailable ? <p className="text-sm text-muted-foreground">Den gule kurve viser organisationens personvægtede median for den valgte erfaringsgruppe. Erfaring beregnes i det år, kontrakten er indgået.</p> : <p className="text-sm text-muted-foreground">Benchmark vises først ved mindst 10 kvalificerede kontrakter og et sikkert antal bidragydere i den valgte gruppe. Skjulte benchmarktal sendes ikke til din browser.</p>}
        </section>

        <section aria-labelledby="salary-contracts-title" className="space-y-2">
          <h3 id="salary-contracts-title" className="font-semibold">Mine kontrakter i beregningen</h3>
          {contracts.length ? <div className="divide-y rounded-lg border">{contracts.map(contract => <Link key={contract.id} href={`/portal/mine-kontrakter?contract=${contract.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 truncate">{contract.title}</span><span className="shrink-0 text-muted-foreground">{contract.year} · {formatKr(contract.weekly)}/uge</span></Link>)}</div> : <p className="text-sm text-muted-foreground">Ingen kontrakter har endnu både en brugbar løn og dato.</p>}
        </section>

        <section aria-labelledby="salary-method-title" className="space-y-2 rounded-lg border p-4">
          <h3 id="salary-method-title" className="font-semibold">Sådan beregnes statistikken</h3>
          <p className="text-sm text-muted-foreground">Dagssats omregnes med fem arbejdsdage pr. uge, og månedsløn omregnes med 12 måneder fordelt på 52 uger. Organisationens benchmark beregnes først pr. person pr. år og derefter som median, så medlemmer med mange kontrakter ikke får større vægt.</p>
          <Link href="/portal/min-profil#statistik" className="inline-flex text-sm font-medium underline underline-offset-2">Ændr dit statistikvalg på Min profil</Link>
        </section>
      </CardContent>
    </Card>
  );
}
