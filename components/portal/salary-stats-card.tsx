"use client";

import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveChartContainer } from "@/components/charts/responsive-chart-container";

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
          <Line type="monotone" dataKey="gennemsnit" name="Gennemsnit pr. uge, alle medlemmer" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
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

export function SalaryStatsCard({ points, optedOut, insufficientMembers }: {
  points: SalaryStatPoint[];
  optedOut: boolean;
  insufficientMembers: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-amber-500" />
          Din lønudvikling
        </CardTitle>
      </CardHeader>
      <CardContent>
        {optedOut ? (
          <MockOverlay title="Her ville din lønudvikling blive vist">
            <p className="mt-1 text-sm text-muted-foreground">
              Din grundløn pr. uge gennem årene sammenlignet med gennemsnittet for alle medlemmer —
              beregnet ud fra de kontrakter, du uploader. Du har fravalgt at bidrage med
              statistikdata, og derfor er statistikken slået fra.
            </p>
            <p className="mt-2 text-sm">
              Du kan slå den til under <Link href="/portal/min-profil" className="font-medium underline underline-offset-2">Min profil</Link>.
            </p>
          </MockOverlay>
        ) : insufficientMembers ? (
          <MockOverlay title="Lønstatistikken er på vej">
            <p className="mt-1 text-sm text-muted-foreground">
              Statistikken vises først, når tilstrækkeligt mange medlemmer har uploadet kontrakter —
              så er gennemsnittet både anonymt og retvisende. Dine egne kontrakter tæller allerede med.
            </p>
          </MockOverlay>
        ) : points.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Ingen løndata endnu — statistikken bygger sig selv, efterhånden som dine kontrakter uploades og analyseres.
          </p>
        ) : (
          <>
            <Chart points={points} />
            <p className="mt-2 text-xs text-muted-foreground">
              Grundløn pr. uge, beregnet ud fra dine uploadede kontrakter. Gennemsnittet omfatter medlemmer, der bidrager med statistikdata.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
