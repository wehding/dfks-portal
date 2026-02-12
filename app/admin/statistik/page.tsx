"use client"

import { useI18n } from "@/lib/i18n"
import {
    mockSalaryData,
    mockRightsClauseStats,
    mockPensionStats,
    mockGenderDistribution,
    mockWorkingWeeksStats,
} from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

export default function AdminStatistikPage() {
    const { t } = useI18n()

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.stats.title")}
                subtitle={t("admin.stats.subtitle")}
            />

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <Select defaultValue="all">
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder={t("admin.stats.filterCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("admin.stats.all")}</SelectItem>
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
                        <SelectItem value="all">{t("admin.stats.all")}</SelectItem>
                        <SelectItem value="klipper">Klipper</SelectItem>
                        <SelectItem value="instruktor">Instruktør</SelectItem>
                    </SelectContent>
                </Select>
                <Select defaultValue="all">
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder={t("admin.stats.filterGender")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("admin.stats.all")}</SelectItem>
                        <SelectItem value="male">{t("admin.stats.male")}</SelectItem>
                        <SelectItem value="female">{t("admin.stats.female")}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <Tabs defaultValue="salary">
                <TabsList className="flex-wrap">
                    <TabsTrigger value="salary">{t("admin.stats.salaryDev")}</TabsTrigger>
                    <TabsTrigger value="rights">{t("admin.stats.rightsClauses")}</TabsTrigger>
                    <TabsTrigger value="pension">{t("admin.stats.pension")}</TabsTrigger>
                    <TabsTrigger value="gender">{t("admin.stats.genderDist")}</TabsTrigger>
                    <TabsTrigger value="weeks">{t("admin.stats.workingWeeks")}</TabsTrigger>
                </TabsList>

                {/* ── Salary Development ─────────────────────────── */}
                <TabsContent value="salary" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t("admin.stats.dailyRate")} & {t("admin.stats.monthlyRate")}
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
                                {mockSalaryData.map((d) => (
                                    <TableRow key={d.year}>
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
                                {mockPensionStats.map((d) => (
                                    <TableRow key={d.year}>
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
                                                data={mockGenderDistribution}
                                                dataKey="count"
                                                nameKey="gender"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={100}
                                                label={({ name, value }) =>
                                                    `${name}: ${value}`
                                                }
                                            >
                                                {mockGenderDistribution.map((_, i) => (
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
                                        <BarChart data={mockGenderDistribution}>
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
                                                {mockGenderDistribution.map((_, i) => (
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
                                {mockGenderDistribution.map((d) => (
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
                                {mockWorkingWeeksStats.map((d) => (
                                    <TableRow key={d.year}>
                                        <TableCell className="font-medium tabular-nums">{d.year}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.avgWeeks}</TableCell>
                                        <TableCell className="text-right tabular-nums">{d.medianWeeks}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
