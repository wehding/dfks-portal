"use client";

import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveChartContainer } from "@/components/charts/responsive-chart-container";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPERIENCE_GROUPS, type ExperienceGroup } from "@/lib/experience-groups";

export type SalaryStatPoint = {
  year: number;
  ownFiction: number | null;
  ownDocumentary: number | null;
  benchmarkFiction: number | null;
  benchmarkDocumentary: number | null;
};

// Statisk eksempelkurve (ugeløn) der ligner den rigtige statistik — vises sløret,
// når statistikken ikke kan vises (fravalgt eller for få medlemmer).
const MOCK_POINTS: SalaryStatPoint[] = [
  { year: 2019, ownFiction: 7_700, ownDocumentary: 7_200, benchmarkFiction: 7_800, benchmarkDocumentary: 7_300 },
  { year: 2020, ownFiction: 7_900, ownDocumentary: 7_500, benchmarkFiction: 8_000, benchmarkDocumentary: 7_600 },
  { year: 2021, ownFiction: 8_200, ownDocumentary: 7_900, benchmarkFiction: 8_300, benchmarkDocumentary: 7_900 },
  { year: 2022, ownFiction: 8_600, ownDocumentary: 8_200, benchmarkFiction: 8_600, benchmarkDocumentary: 8_200 },
  { year: 2023, ownFiction: 9_000, ownDocumentary: 8_500, benchmarkFiction: 9_000, benchmarkDocumentary: 8_500 },
  { year: 2024, ownFiction: 9_400, ownDocumentary: 8_900, benchmarkFiction: 9_300, benchmarkDocumentary: 8_900 },
];

const formatKr = (value: number) => `${Math.round(value).toLocaleString("da-DK")} kr.`;

function OwnSalaryChart({ points }: { points: SalaryStatPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveChartContainer minHeight={256}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="year" fontSize={12} />
          <YAxis fontSize={12} tickFormatter={value => `${Math.round(Number(value) / 1000)}k`} width={40} />
          <Tooltip formatter={value => formatKr(Number(value))} labelFormatter={label => `År ${label}`} />
          <Legend />
          <Line type="monotone" dataKey="ownFiction" name="Fiktion · median pr. uge" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="ownDocumentary" name="Dokumentarfilm · median pr. uge" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveChartContainer>
    </div>
  );
}

function BenchmarkChart({ points }: { points: SalaryStatPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveChartContainer minHeight={256}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="year" fontSize={12} />
          <YAxis fontSize={12} tickFormatter={value => `${Math.round(Number(value) / 1000)}k`} width={40} />
          <Tooltip formatter={value => formatKr(Number(value))} labelFormatter={label => `År ${label}`} />
          <Legend />
          <Line type="monotone" dataKey="benchmarkFiction" name="Fiktion · organisationens median" stroke="#2563eb" strokeDasharray="6 4" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="benchmarkDocumentary" name="Dokumentarfilm · organisationens median" stroke="#059669" strokeDasharray="6 4" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveChartContainer>
    </div>
  );
}

function MockOverlay({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none opacity-25 blur-[2px]">
        <OwnSalaryChart points={MOCK_POINTS} />
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

export function SalaryStatsCard({ points, benchmarkPointsByExperience, optedOut, benchmarkAvailable }: {
  points: SalaryStatPoint[];
  benchmarkPointsByExperience: Partial<Record<ExperienceGroup, SalaryStatPoint[]>>;
  optedOut: boolean;
  benchmarkAvailable: boolean;
}) {
  const [experienceGroup, setExperienceGroup] = useState<"all" | ExperienceGroup>("all");
  const displayedPoints = useMemo(() => experienceGroup === "all" ? points : (benchmarkPointsByExperience[experienceGroup] ?? points.map(point => ({ ...point, benchmarkFiction: null, benchmarkDocumentary: null }))), [benchmarkPointsByExperience, experienceGroup, points]);
  const displayedBenchmarkAvailable = experienceGroup === "all" ? benchmarkAvailable : displayedPoints.some(point => point.benchmarkFiction != null || point.benchmarkDocumentary != null);
  const ownPoints = points.filter(point => point.ownFiction != null || point.ownDocumentary != null);
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
          <h3 id="salary-own-title" className="font-semibold">Min medianløn pr. uge</h3>
          {ownPoints.length ? <OwnSalaryChart points={points} /> : <MockOverlay title="Lønstatistikken er på vej"><p className="mt-1 text-sm text-muted-foreground">Dine kurver vises, når mindst én kontrakt i fiktion eller dokumentar har en brugbar løn og dato.</p></MockOverlay>}
          <p className="text-xs text-muted-foreground">Hver kurve viser medianen af din ugeløn inklusive relevante tillæg for henholdsvis fiktion og dokumentarfilm. TV-fiktion tæller som fiktion, og dokumentarserier tæller som dokumentar.</p>
        </section>

        <section aria-labelledby="salary-benchmark-title" className="space-y-2 rounded-lg border bg-muted/20 p-4">
          <h3 id="salary-benchmark-title" className="font-semibold">Sammenlign med organisationen</h3>
          {!optedOut && <Select value={experienceGroup} onValueChange={value => setExperienceGroup(value as "all" | ExperienceGroup)}><SelectTrigger className="w-full sm:max-w-sm"><SelectValue placeholder="Vælg erfaringsgruppe" /></SelectTrigger><SelectContent><SelectItem value="all">Alle erfaringsgrupper</SelectItem>{EXPERIENCE_GROUPS.map(group => <SelectItem key={group.value} value={group.value}>{group.label} ({group.description})</SelectItem>)}</SelectContent></Select>}
          {optedOut ? <p className="text-sm text-muted-foreground">Du har fravalgt fælles statistik. Dine egne tal vises fortsat, men organisationsbenchmark er slået fra.</p> : displayedBenchmarkAvailable ? <><BenchmarkChart points={displayedPoints} /><p className="text-sm text-muted-foreground">De stiplede kurver viser organisationens personvægtede median pr. uge for fiktion og dokumentarfilm i den valgte erfaringsgruppe. Erfaring beregnes i det år, kontrakten er indgået.</p></> : <p className="text-sm text-muted-foreground">Benchmark for hver produktionstype vises først ved mindst 10 kvalificerede kontrakter og et sikkert antal bidragydere i den valgte gruppe. Skjulte benchmarktal sendes ikke til din browser.</p>}
        </section>

      </CardContent>
    </Card>
  );
}
