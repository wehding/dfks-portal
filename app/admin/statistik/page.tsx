"use client"

import { useI18n } from "@/lib/i18n"
import { mockSalaryData, mockRightsClauseStats } from "@/lib/mock-data"
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
} from "recharts"

function formatKr(n: number) {
    return n.toLocaleString("da-DK") + " kr."
}

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
                <TabsList>
                    <TabsTrigger value="salary">{t("admin.stats.salaryDev")}</TabsTrigger>
                    <TabsTrigger value="rights">{t("admin.stats.rightsClauses")}</TabsTrigger>
                </TabsList>

                {/* Salary Development */}
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
                                            contentStyle={{
                                                backgroundColor: "hsl(var(--popover))",
                                                border: "1px solid hsl(var(--border))",
                                                borderRadius: "8px",
                                                fontSize: "13px",
                                            }}
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

                    {/* Data table */}
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

                {/* Rights Clauses */}
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
                                            contentStyle={{
                                                backgroundColor: "hsl(var(--popover))",
                                                border: "1px solid hsl(var(--border))",
                                                borderRadius: "8px",
                                                fontSize: "13px",
                                            }}
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
            </Tabs>
        </div>
    )
}
