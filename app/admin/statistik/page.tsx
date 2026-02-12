"use client"

import { useState, useMemo } from "react"
import { CalendarDays } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import {
    mockSalaryData,
    mockRightsClauseStats,
    mockPensionStats,
    mockGenderDistribution,
    mockWorkingWeeksStats,
    mockContracts,
} from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,
    Bar,
    Legend,
    PieChart,
    Pie,
    Cell,
    ReferenceLine,
} from "recharts"

function formatKr(n: number) {
    return n.toLocaleString("da-DK") + " kr."
}

const tooltipStyle = {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "13px",
}

const PIE_COLORS = ["hsl(340, 65%, 55%)", "hsl(210, 65%, 55%)", "hsl(160, 50%, 50%)"]

// Collect available years from all data sources
const allYears = Array.from(
    new Set([
        ...mockSalaryData.map((d) => d.year),
        ...mockPensionStats.map((d) => d.year),
        ...mockWorkingWeeksStats.map((d) => d.year),
        ...mockContracts.map((c) => c.premiereYear),
    ])
).sort((a, b) => b - a)

export default function AdminStatistikPage() {
    const { t } = useI18n()
    const [selectedYear, setSelectedYear] = useState<string>("all")

    // ── Filtered data based on selected year ───────────────────
    const yearNum = selectedYear === "all" ? null : Number(selectedYear)

    const filteredSalary = useMemo(
        () => (yearNum ? mockSalaryData.filter((d) => d.year === yearNum) : mockSalaryData),
        [yearNum]
    )

    const filteredPension = useMemo(
        () => (yearNum ? mockPensionStats.filter((d) => d.year === yearNum) : mockPensionStats),
        [yearNum]
    )

    const filteredWeeks = useMemo(
        () =>
            yearNum
                ? mockWorkingWeeksStats.filter((d) => d.year === yearNum)
                : mockWorkingWeeksStats,
        [yearNum]
    )

    const filteredContracts = useMemo(
        () =>
            yearNum
                ? mockContracts.filter((c) => c.premiereYear === yearNum)
                : mockContracts,
        [yearNum]
    )

    // Gender distribution from filtered contracts
    const genderData = useMemo(() => {
        const contractsWithGender = filteredContracts.filter(
            (c) => c.extractedData?.gender
        )
        if (contractsWithGender.length === 0) return mockGenderDistribution

        const groups: Record<string, { count: number; totalSalary: number }> = {}
        for (const c of contractsWithGender) {
            const g = c.extractedData!.gender!
            const label = g === "female" ? "Kvinde" : g === "male" ? "Mand" : "Andet"
            if (!groups[label]) groups[label] = { count: 0, totalSalary: 0 }
            groups[label].count++
            groups[label].totalSalary += c.extractedData?.salary || 0
        }
        return Object.entries(groups).map(([gender, data]) => ({
            gender,
            count: data.count,
            avgSalary: Math.round(data.totalSalary / data.count),
        }))
    }, [filteredContracts])

    // AI clause stats from filtered contracts
    const aiStats = useMemo(() => {
        const withData = filteredContracts.filter((c) => c.extractedData)
        const withClause = withData.filter((c) => c.extractedData?.aiDataMiningClause)
        const pct = withData.length > 0 ? Math.round((withClause.length / withData.length) * 100) : 0

        // Group by year
        const byYear = withData.reduce<Record<number, { total: number; withClause: number }>>(
            (acc, c) => {
                const y = c.premiereYear
                if (!acc[y]) acc[y] = { total: 0, withClause: 0 }
                acc[y].total++
                if (c.extractedData?.aiDataMiningClause) acc[y].withClause++
                return acc
            },
            {}
        )

        const chartData = Object.entries(byYear)
            .map(([year, data]) => ({
                year,
                withClause: data.withClause,
                withoutClause: data.total - data.withClause,
                pct: Math.round((data.withClause / data.total) * 100),
            }))
            .sort((a, b) => Number(a.year) - Number(b.year))

        return { withData, withClause, pct, chartData }
    }, [filteredContracts])

    // Summary for selected year
    const yearSummary = useMemo(() => {
        const salary = filteredSalary[filteredSalary.length - 1]
        const pension = filteredPension[filteredPension.length - 1]
        const weeks = filteredWeeks[filteredWeeks.length - 1]
        return { salary, pension, weeks }
    }, [filteredSalary, filteredPension, filteredWeeks])

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.stats.title")}
                subtitle={t("admin.stats.subtitle")}
            />

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                {/* YEAR SELECTOR — primary filter */}
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="w-[160px] border-primary/30 bg-primary/5 font-medium">
                        <CalendarDays className="mr-2 h-3.5 w-3.5 text-primary" />
                        <SelectValue placeholder={t("admin.stats.filterYear")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle år</SelectItem>
                        {allYears.map((y) => (
                            <SelectItem key={y} value={y.toString()}>
                                {y}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select defaultValue="all">
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder={t("admin.stats.filterCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle kategorier</SelectItem>
                        <SelectItem value="feature">{t("cat.feature")}</SelectItem>
                        <SelectItem value="tvSeries">{t("cat.tvSeries")}</SelectItem>
                        <SelectItem value="documentary">{t("cat.documentary")}</SelectItem>
                    </SelectContent>
                </Select>
                <Select defaultValue="all">
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder={t("admin.stats.filterRole")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle roller</SelectItem>
                        <SelectItem value="klipper">Klipper</SelectItem>
                        <SelectItem value="instruktor">Instruktør</SelectItem>
                    </SelectContent>
                </Select>
                <Select defaultValue="all">
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder={t("admin.stats.filterGender")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle køn</SelectItem>
                        <SelectItem value="male">{t("admin.stats.male")}</SelectItem>
                        <SelectItem value="female">{t("admin.stats.female")}</SelectItem>
                    </SelectContent>
                </Select>

                {yearNum && (
                    <Badge variant="secondary" className="self-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        Vis data for {yearNum}
                    </Badge>
                )}
            </div>

            {/* Summary cards for selected year */}
            {yearNum && yearSummary.salary && (
                <div className="grid gap-4 sm:grid-cols-4">
                    <Card>
                        <CardContent className="pt-6 text-center">
                            <p className="text-2xl font-bold tabular-nums">
                                {formatKr(yearSummary.salary.monthlyRate)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {t("admin.stats.monthlyRate")} ({yearNum})
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6 text-center">
                            <p className="text-2xl font-bold tabular-nums">
                                {formatKr(yearSummary.salary.dailyRate)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {t("admin.stats.dailyRate")} ({yearNum})
                            </p>
                        </CardContent>
                    </Card>
                    {yearSummary.pension && (
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-2xl font-bold tabular-nums">
                                    {yearSummary.pension.avgPensionPercent}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.stats.avgPension")} ({yearNum})
                                </p>
                            </CardContent>
                        </Card>
                    )}
                    {yearSummary.weeks && (
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-2xl font-bold tabular-nums">
                                    {yearSummary.weeks.avgWeeks} uger
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.stats.avgWeeks")} ({yearNum})
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            <Tabs defaultValue="salary">
                <TabsList className="flex-wrap">
                    <TabsTrigger value="salary">{t("admin.stats.salaryDev")}</TabsTrigger>
                    <TabsTrigger value="rights">{t("admin.stats.rightsClauses")}</TabsTrigger>
                    <TabsTrigger value="pension">{t("admin.stats.pension")}</TabsTrigger>
                    <TabsTrigger value="gender">{t("admin.stats.genderDist")}</TabsTrigger>
                    <TabsTrigger value="weeks">{t("admin.stats.workingWeeks")}</TabsTrigger>
                    <TabsTrigger value="aiClause">{t("admin.validation.aiClause")}</TabsTrigger>
                </TabsList>

                {/* ── Salary Development ─────────────────────────── */}
                <TabsContent value="salary" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.dailyRate")} & {t("admin.stats.monthlyRate")}
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum} markeret
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={mockSalaryData}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis className="text-xs" tickFormatter={(v) => `${v / 1000}k`} />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            formatter={(value) => formatKr(value as number)}
                                        />
                                        <Legend />
                                        {yearNum && (
                                            <ReferenceLine
                                                x={yearNum}
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                                label={{
                                                    value: yearNum.toString(),
                                                    position: "top",
                                                    fill: "hsl(var(--primary))",
                                                    fontSize: 12,
                                                }}
                                            />
                                        )}
                                        <Line
                                            type="monotone"
                                            dataKey="monthlyRate"
                                            name={t("admin.stats.monthlyRate")}
                                            stroke="hsl(var(--foreground))"
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="dailyRate"
                                            name={t("admin.stats.dailyRate")}
                                            stroke="hsl(var(--muted-foreground))"
                                            strokeWidth={2}
                                            strokeDasharray="5 5"
                                            dot={{ r: 3 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("admin.stats.filterYear")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.dailyRate")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.monthlyRate")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSalary.map((d) => (
                                    <TableRow
                                        key={d.year}
                                        className={yearNum === d.year ? "bg-primary/5 font-semibold" : ""}
                                    >
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {formatKr(d.dailyRate)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {formatKr(d.monthlyRate)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── Rights Clauses ──────────────────────────────── */}
                <TabsContent value="rights" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.rightsClauses")} — % med klausul pr. kategori
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum}
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={mockRightsClauseStats}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="category" className="text-xs" />
                                        <YAxis className="text-xs" tickFormatter={(v) => `${v}%`} />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            formatter={(value) => `${value}%`}
                                        />
                                        <Legend />
                                        <Bar
                                            dataKey="svodPercent"
                                            name="SVOD"
                                            fill="hsl(var(--foreground))"
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="copydanPercent"
                                            name="Copydan"
                                            fill="hsl(var(--muted-foreground))"
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="royaltyPercent"
                                            name="Royalty"
                                            fill="hsl(var(--ring))"
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Pension & Supplement Stats ──────────────────── */}
                <TabsContent value="pension" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.avgPension")} & {t("admin.stats.avgPersonalSupp")} pr. år
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum} markeret
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={mockPensionStats}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis
                                            yAxisId="left"
                                            className="text-xs"
                                            tickFormatter={(v) => `${v}%`}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            className="text-xs"
                                            tickFormatter={(v) => `${v / 1000}k`}
                                        />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            formatter={(value, name) =>
                                                name === t("admin.stats.avgPension")
                                                    ? `${value}%`
                                                    : formatKr(value as number)
                                            }
                                        />
                                        <Legend />
                                        {yearNum && (
                                            <ReferenceLine
                                                x={yearNum}
                                                yAxisId="left"
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                            />
                                        )}
                                        <Line
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="avgPensionPercent"
                                            name={t("admin.stats.avgPension")}
                                            stroke="hsl(var(--foreground))"
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                        />
                                        <Line
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="avgPersonalSupplement"
                                            name={t("admin.stats.avgPersonalSupp")}
                                            stroke="hsl(var(--muted-foreground))"
                                            strokeWidth={2}
                                            strokeDasharray="5 5"
                                            dot={{ r: 3 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>År</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgPension")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgPersonalSupp")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredPension.map((d) => (
                                    <TableRow
                                        key={d.year}
                                        className={yearNum === d.year ? "bg-primary/5 font-semibold" : ""}
                                    >
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.avgPensionPercent}%</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatKr(d.avgPersonalSupplement)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── Gender Distribution ─────────────────────────── */}
                <TabsContent value="gender" className="mt-4 space-y-4">
                    {yearNum && (
                        <Badge variant="outline" className="gap-1">
                            <CalendarDays className="h-3 w-3" />
                            Data filtreret for {yearNum}
                        </Badge>
                    )}
                    <div className="grid gap-4 lg:grid-cols-2">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {t("admin.stats.genderDist")}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={genderData}
                                                dataKey="count"
                                                nameKey="gender"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={100}
                                                label={({ name, value }) =>
                                                    `${name}: ${value}`
                                                }
                                            >
                                                {genderData.map((_, i) => (
                                                    <Cell
                                                        key={`cell-${i}`}
                                                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={tooltipStyle} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {t("admin.stats.avgSalary")} pr. køn
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={genderData}>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                            <XAxis dataKey="gender" className="text-xs" />
                                            <YAxis className="text-xs" tickFormatter={(v) => `${v / 1000}k`} />
                                            <Tooltip
                                                contentStyle={tooltipStyle}
                                                formatter={(value) => formatKr(value as number)}
                                            />
                                            <Bar
                                                dataKey="avgSalary"
                                                name={t("admin.stats.avgSalary")}
                                                radius={[4, 4, 0, 0]}
                                            >
                                                {genderData.map((_, i) => (
                                                    <Cell
                                                        key={`cell-${i}`}
                                                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Køn</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.count")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgSalary")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {genderData.map((d) => (
                                    <TableRow key={d.gender}>
                                        <TableCell className="font-medium">{d.gender}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.count}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatKr(d.avgSalary)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── Working Weeks ───────────────────────────────── */}
                <TabsContent value="weeks" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.avgWeeks")} & {t("admin.stats.medianWeeks")} pr. år
                                {yearNum && (
                                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                                        {yearNum} markeret
                                    </Badge>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={mockWorkingWeeksStats}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis className="text-xs" />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            formatter={(value) => `${value} uger`}
                                        />
                                        <Legend />
                                        {yearNum && (
                                            <ReferenceLine
                                                x={yearNum}
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                            />
                                        )}
                                        <Bar
                                            dataKey="avgWeeks"
                                            name={t("admin.stats.avgWeeks")}
                                            fill="hsl(var(--foreground))"
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="medianWeeks"
                                            name={t("admin.stats.medianWeeks")}
                                            fill="hsl(var(--muted-foreground))"
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>År</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.avgWeeks")}</TableHead>
                                    <TableHead className="text-right">{t("admin.stats.medianWeeks")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredWeeks.map((d) => (
                                    <TableRow
                                        key={d.year}
                                        className={yearNum === d.year ? "bg-primary/5 font-semibold" : ""}
                                    >
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.avgWeeks}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.medianWeeks}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── AI Clause Adoption ─────────────────────────── */}
                <TabsContent value="aiClause" className="mt-4 space-y-4">
                    {yearNum && (
                        <Badge variant="outline" className="gap-1">
                            <CalendarDays className="h-3 w-3" />
                            Data filtreret for {yearNum}
                        </Badge>
                    )}
                    <div className="grid gap-4 sm:grid-cols-3">
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-4xl font-bold">{aiStats.pct}%</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    af kontrakter har AI-forbehold
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-4xl font-bold text-emerald-600">
                                    {aiStats.withClause.length}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    med AI-klausul
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6 text-center">
                                <p className="text-4xl font-bold text-amber-600">
                                    {aiStats.withData.length - aiStats.withClause.length}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    uden AI-klausul
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                AI/Data mining forbehold pr. år
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={aiStats.chartData}>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            className="stroke-border"
                                        />
                                        <XAxis dataKey="year" className="text-xs" />
                                        <YAxis className="text-xs" />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            formatter={(value, name) => [
                                                `${value} kontrakter`,
                                                name === "withClause"
                                                    ? "Med AI-klausul"
                                                    : "Uden AI-klausul",
                                            ]}
                                        />
                                        <Legend
                                            formatter={(value) =>
                                                value === "withClause"
                                                    ? "Med AI-klausul"
                                                    : "Uden AI-klausul"
                                            }
                                        />
                                        <Bar
                                            dataKey="withClause"
                                            stackId="a"
                                            fill="hsl(160, 50%, 50%)"
                                            radius={[0, 0, 0, 0]}
                                        />
                                        <Bar
                                            dataKey="withoutClause"
                                            stackId="a"
                                            fill="hsl(var(--muted-foreground))"
                                            radius={[4, 4, 0, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20 p-4">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                            <strong>Anbefaling:</strong> DFKS anbefaler at alle nye
                            kontrakter inkluderer en AI/data mining klausul for at
                            beskytte klipperens rettigheder i forbindelse med
                            automatiseret tekst- og dataudvinding.
                        </p>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
