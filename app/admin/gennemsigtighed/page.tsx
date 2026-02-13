"use client"

import { useState } from "react"
import { Plus, Download, ChevronDown, ChevronUp, TrendingUp, Users, Coins } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { mockTransparencyReports } from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from "recharts"

function formatKr(n: number) {
    return n.toLocaleString("da-DK") + " kr."
}

function formatMKr(n: number) {
    return (n / 1_000_000).toFixed(2) + " mio. kr."
}

export default function AdminGennemsigtighedPage() {
    const { t } = useI18n()
    const [expandedId, setExpandedId] = useState<string | null>(
        mockTransparencyReports[0]?.id ?? null
    )

    const toggleExpand = (id: string) =>
        setExpandedId(expandedId === id ? null : id)

    // Chart data: year-over-year comparison
    const chartData = [...mockTransparencyReports]
        .reverse()
        .map((r) => ({
            year: r.year.toString(),
            collected: r.totalCollected,
            distributed: r.totalDistributed,
            admin: r.adminCosts,
        }))

    // Summary cards from latest report
    const latest = mockTransparencyReports[0]

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.transparency.title")}
                subtitle={t("admin.transparency.subtitle")}
                actions={
                    <Button size="sm" className="gap-1.5">
                        <Plus className="h-4 w-4" />
                        {t("admin.transparency.newReport")}
                    </Button>
                }
            />

            {/* Summary Cards */}
            {latest && (
                <div className="grid gap-4 sm:grid-cols-3">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                                    <Coins className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.transparency.collected")} ({latest.year})
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {formatMKr(latest.totalCollected)}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.transparency.distributed")} ({latest.year})
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {formatMKr(latest.totalDistributed)}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                                    <Users className="h-5 w-5 text-blue-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.transparency.members")} ({latest.year})
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {latest.memberCount}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Year-over-year Chart */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                        Indsamling vs. fordeling pr. år
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                <XAxis dataKey="year" className="text-xs" />
                                <YAxis
                                    className="text-xs"
                                    tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}m`}
                                />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: "rgba(255, 255, 255, 0.7)",
                                        backdropFilter: "blur(12px)",
                                        WebkitBackdropFilter: "blur(12px)",
                                        border: "1px solid rgba(255, 255, 255, 0.3)",
                                        borderRadius: "12px",
                                        fontSize: "13px",
                                        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                                        color: "#1a1a2e",
                                    }}
                                    wrapperStyle={{ zIndex: 50 }}
                                    formatter={(value) => formatKr(value as number)}
                                />
                                <Legend />
                                <Bar
                                    dataKey="collected"
                                    name={t("admin.transparency.collected")}
                                    fill="hsl(210, 65%, 55%)"
                                    radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                    dataKey="distributed"
                                    name={t("admin.transparency.distributed")}
                                    fill="hsl(160, 50%, 50%)"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Individual Reports */}
            <div className="space-y-3">
                {mockTransparencyReports.map((report) => {
                    const isExpanded = expandedId === report.id
                    const adminPercent = ((report.adminCosts / report.totalCollected) * 100).toFixed(1)

                    return (
                        <Card key={report.id}>
                            <div
                                className="flex cursor-pointer items-center justify-between p-6"
                                onClick={() => toggleExpand(report.id)}
                            >
                                <div className="space-y-1">
                                    <h3 className="text-base font-medium">{report.title}</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {t("admin.transparency.published")}:{" "}
                                        {new Date(report.publishedAt).toLocaleDateString("da-DK")}
                                        {" · "}
                                        {report.memberCount} {t("admin.transparency.members").toLowerCase()}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        <p className="text-sm font-medium tabular-nums">
                                            {formatMKr(report.totalCollected)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">indsamlet</p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            toggleExpand(report.id)
                                        }}
                                    >
                                        {isExpanded ? (
                                            <ChevronUp className="h-4 w-4" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>

                            {isExpanded && (
                                <CardContent className="border-t pt-4 space-y-4">
                                    {/* Summary row */}
                                    <div className="grid gap-4 sm:grid-cols-3">
                                        <div className="rounded-lg border p-4 text-center">
                                            <p className="text-xs text-muted-foreground mb-1">
                                                {t("admin.transparency.collected")}
                                            </p>
                                            <p className="text-lg font-bold tabular-nums">
                                                {formatKr(report.totalCollected)}
                                            </p>
                                        </div>
                                        <div className="rounded-lg border p-4 text-center">
                                            <p className="text-xs text-muted-foreground mb-1">
                                                {t("admin.transparency.distributed")}
                                            </p>
                                            <p className="text-lg font-bold tabular-nums text-emerald-600">
                                                {formatKr(report.totalDistributed)}
                                            </p>
                                        </div>
                                        <div className="rounded-lg border p-4 text-center">
                                            <p className="text-xs text-muted-foreground mb-1">
                                                {t("admin.transparency.adminCosts")}
                                            </p>
                                            <p className="text-lg font-bold tabular-nums">
                                                {formatKr(report.adminCosts)}
                                            </p>
                                            <Badge variant="outline" className="mt-1 text-xs">
                                                {adminPercent}%
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Source breakdown */}
                                    <div>
                                        <h4 className="text-sm font-medium mb-2">
                                            {t("admin.transparency.breakdown")}
                                        </h4>
                                        <div className="rounded-lg border">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>{t("admin.transparency.source")}</TableHead>
                                                        <TableHead className="text-right">
                                                            {t("admin.transparency.collected")}
                                                        </TableHead>
                                                        <TableHead className="text-right">
                                                            {t("admin.transparency.distributed")}
                                                        </TableHead>
                                                        <TableHead className="text-right">%</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {report.sources.map((src) => (
                                                        <TableRow key={src.name}>
                                                            <TableCell className="font-medium">
                                                                {src.name}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {formatKr(src.collected)}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums text-emerald-600">
                                                                {formatKr(src.distributed)}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {((src.collected / report.totalCollected) * 100).toFixed(0)}%
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>

                                    <div className="flex justify-end">
                                        <Button variant="outline" size="sm" className="gap-1.5">
                                            <Download className="h-3.5 w-3.5" />
                                            {t("admin.transparency.export")}
                                        </Button>
                                    </div>
                                </CardContent>
                            )}
                        </Card>
                    )
                })}
            </div>
        </div>
    )
}
