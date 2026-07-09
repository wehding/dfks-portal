"use client"

import { useState, useMemo } from "react"
import { Baby, Plus, TrendingUp, Users, Coins, Calendar, Download } from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { mockMaternityFundEntries as initialEntries, mockMaternityFundSummaries } from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
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
import type { LeaveType, MaternityFundEntry } from "@/lib/types"

function formatKr(n: number) {
    return n.toLocaleString("da-DK") + " kr."
}

const tooltipStyle: React.CSSProperties = {
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    borderRadius: "12px",
    fontSize: "13px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
    color: "#1a1a2e",
}

const tooltipWrapperStyle: React.CSSProperties = { zIndex: 50 }

export default function AdminBarselspuljePage() {
    const { t } = useI18n()
    const [entries, setEntries] = useState<MaternityFundEntry[]>(initialEntries)
    const [selectedYear, setSelectedYear] = useState<string>("all")
    const [selectedType, setSelectedType] = useState<string>("all")
    const [searchQuery, setSearchQuery] = useState("")
    const [showNewDialog, setShowNewDialog] = useState(false)

    // Form state
    const [formName, setFormName] = useState("")
    const [formType, setFormType] = useState<LeaveType>("maternity")
    const [formStart, setFormStart] = useState("")
    const [formEnd, setFormEnd] = useState("")
    const [formWeekly, setFormWeekly] = useState("")

    const years = [...new Set(
        entries.map((e) => new Date(e.applicationDate).getFullYear())
    )].sort((a, b) => b - a)

    const yearNum = selectedYear === "all" ? null : Number(selectedYear)

    const filteredEntries = useMemo(() => {
        let list = entries
        if (yearNum) {
            list = list.filter(
                (e) => new Date(e.applicationDate).getFullYear() === yearNum
            )
        }
        if (selectedType !== "all") {
            list = list.filter((e) => e.leaveType === selectedType)
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            list = list.filter((e) => e.memberName.toLowerCase().includes(q))
        }
        return list
    }, [entries, yearNum, selectedType, searchQuery])

    const resetForm = () => {
        setFormName("")
        setFormType("maternity")
        setFormStart("")
        setFormEnd("")
        setFormWeekly("")
    }

    const handleNewApplication = () => {
        if (!formName.trim() || !formStart || !formEnd || !formWeekly) {
            toast.error("Udfyld alle felter")
            return
        }
        const weekly = Number(formWeekly)
        const start = new Date(formStart)
        const end = new Date(formEnd)
        const weeks = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
        const newEntry: MaternityFundEntry = {
            id: `mf${Date.now()}`,
            memberId: `u${Date.now()}`,
            memberName: formName.trim(),
            leaveType: formType,
            startDate: formStart,
            endDate: formEnd,
            weeksApproved: weeks,
            weeklyAmount: weekly,
            totalAmount: weekly * weeks,
            status: "applied",
            childBirthDate: formStart,
            applicationDate: new Date().toISOString().split("T")[0],
        }
        setEntries((prev) => [newEntry, ...prev])
        toast.success(`Ansøgning oprettet for ${formName}`)
        setShowNewDialog(false)
        resetForm()
    }

    const exportCsv = () => {
        const headers = ["Medlem", "Type", "Start", "Slut", "Uger", "Ugentligt", "Total", "Status"]
        const rows = filteredEntries.map((e) =>
            [e.memberName, e.leaveType, e.startDate, e.endDate, e.weeksApproved, e.weeklyAmount, e.totalAmount, e.status].join(";")
        )
        const csv = [headers.join(";"), ...rows].join("\n")
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `barselspulje_${new Date().toISOString().split("T")[0]}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast.success("CSV eksporteret")
    }

    // Summary for selected year or latest
    const summary = yearNum
        ? mockMaternityFundSummaries.find((s) => s.year === yearNum)
        : mockMaternityFundSummaries[0]

    // Chart data
    const chartData = [...mockMaternityFundSummaries]
        .reverse()
        .map((s) => ({
            year: s.year.toString(),
            maternity: s.byType.find((t) => t.type === "maternity")?.totalAmount ?? 0,
            paternity: s.byType.find((t) => t.type === "paternity")?.totalAmount ?? 0,
            parental: s.byType.find((t) => t.type === "parental")?.totalAmount ?? 0,
        }))

    const leaveTypeLabel = (type: LeaveType) => {
        switch (type) {
            case "maternity":
                return t("admin.maternityFund.maternity")
            case "paternity":
                return t("admin.maternityFund.paternity")
            case "parental":
                return t("admin.maternityFund.parental")
        }
    }

    const leaveTypeBadge = (type: LeaveType) => {
        switch (type) {
            case "maternity":
                return (
                    <Badge className="bg-pink-500/10 text-pink-600 border-pink-500/20 hover:bg-pink-500/15">
                        {leaveTypeLabel(type)}
                    </Badge>
                )
            case "paternity":
                return (
                    <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 hover:bg-blue-500/15">
                        {leaveTypeLabel(type)}
                    </Badge>
                )
            case "parental":
                return (
                    <Badge className="bg-violet-500/10 text-violet-600 border-violet-500/20 hover:bg-violet-500/15">
                        {leaveTypeLabel(type)}
                    </Badge>
                )
        }
    }

    const statusBadge = (status: string) => {
        switch (status) {
            case "applied":
                return (
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/15">
                        {t("admin.maternityFund.applied")}
                    </Badge>
                )
            case "approved":
                return (
                    <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 hover:bg-blue-500/15">
                        {t("admin.maternityFund.approved")}
                    </Badge>
                )
            case "active":
                return (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15">
                        {t("admin.maternityFund.active")}
                    </Badge>
                )
            case "completed":
                return (
                    <Badge variant="secondary">
                        {t("admin.maternityFund.completed")}
                    </Badge>
                )
            case "rejected":
                return (
                    <Badge className="bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/15">
                        {t("admin.maternityFund.rejected")}
                    </Badge>
                )
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.maternityFund.title")}
                subtitle={t("admin.maternityFund.subtitle")}
                actions={
                    <Button size="sm" className="gap-1.5" onClick={() => setShowNewDialog(true)}>
                        <Plus className="h-4 w-4" />
                        {t("admin.maternityFund.newApplication")}
                    </Button>
                }
            />

            {/* Summary Cards */}
            {summary && (
                <div className="grid gap-4 sm:grid-cols-4">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                                    <Users className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.maternityFund.totalApplicants")} ({summary.year})
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {summary.totalApplicants}
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
                                        {t("admin.maternityFund.approved")}
                                    </p>
                                    <p className="text-xl font-bold tabular-nums text-emerald-600">
                                        {summary.totalApproved}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                                    <Coins className="h-5 w-5 text-blue-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.maternityFund.totalPaid")}
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {formatKr(summary.totalPaidOut)}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                                    <Calendar className="h-5 w-5 text-violet-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.maternityFund.avgWeeks")}
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {summary.avgWeeks} uger
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Chart */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                        Udbetalinger pr. barselstype pr. år
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                <XAxis dataKey="year" className="text-xs" />
                                <YAxis
                                    className="text-xs"
                                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                                />
                                <Tooltip
                                    contentStyle={tooltipStyle}
                                    wrapperStyle={tooltipWrapperStyle}
                                    formatter={(value) => formatKr(value as number)}
                                />
                                <Legend />
                                <Bar
                                    dataKey="maternity"
                                    name={t("admin.maternityFund.maternity")}
                                    fill="hsl(340, 65%, 55%)"
                                    radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                    dataKey="paternity"
                                    name={t("admin.maternityFund.paternity")}
                                    fill="hsl(210, 65%, 55%)"
                                    radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                    dataKey="parental"
                                    name={t("admin.maternityFund.parental")}
                                    fill="hsl(270, 50%, 55%)"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="w-[140px] border-primary/30 bg-primary/5 font-medium">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle år</SelectItem>
                        {years.map((y) => (
                            <SelectItem key={y} value={y.toString()}>
                                {y}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle typer</SelectItem>
                        <SelectItem value="maternity">
                            {t("admin.maternityFund.maternity")}
                        </SelectItem>
                        <SelectItem value="paternity">
                            {t("admin.maternityFund.paternity")}
                        </SelectItem>
                        <SelectItem value="parental">
                            {t("admin.maternityFund.parental")}
                        </SelectItem>
                    </SelectContent>
                </Select>
                <Input
                    placeholder={t("common.search")}
                    className="w-[220px]"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="ml-auto">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv}>
                        <Download className="h-3.5 w-3.5" />
                        Eksporter
                    </Button>
                </div>
            </div>

            {/* Table */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("admin.maternityFund.member")}</TableHead>
                            <TableHead>{t("admin.maternityFund.type")}</TableHead>
                            <TableHead>{t("admin.maternityFund.period")}</TableHead>
                            <TableHead className="text-right">{t("admin.maternityFund.weeks")}</TableHead>
                            <TableHead className="text-right">{t("admin.maternityFund.weeklyAmount")}</TableHead>
                            <TableHead className="text-right">{t("admin.maternityFund.totalAmount")}</TableHead>
                            <TableHead>{t("admin.maternityFund.status")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredEntries.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                                    {t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredEntries.map((entry) => (
                                <TableRow key={entry.id}>
                                    <TableCell>
                                        <div>
                                            <p className="font-medium">{entry.memberName}</p>
                                            {entry.notes && (
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {entry.notes}
                                                </p>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>{leaveTypeBadge(entry.leaveType)}</TableCell>
                                    <TableCell className="tabular-nums text-sm">
                                        <div>
                                            {new Date(entry.startDate).toLocaleDateString("da-DK")}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            → {new Date(entry.endDate).toLocaleDateString("da-DK")}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {entry.weeksApproved > 0 ? entry.weeksApproved : "—"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {entry.weeklyAmount > 0 ? formatKr(entry.weeklyAmount) : "—"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums font-medium">
                                        {entry.totalAmount > 0 ? formatKr(entry.totalAmount) : "—"}
                                    </TableCell>
                                    <TableCell>{statusBadge(entry.status)}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* New Application Dialog */}
            <Dialog open={showNewDialog} onOpenChange={(o) => { if (!o) { setShowNewDialog(false); resetForm() } }}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Baby className="h-5 w-5" />
                            {t("admin.maternityFund.newApplication")}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Medlem *</Label>
                            <Input placeholder="Medlemsnavn" value={formName} onChange={(e) => setFormName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Barselstype *</Label>
                            <Select value={formType} onValueChange={(v) => setFormType(v as LeaveType)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="maternity">{t("admin.maternityFund.maternity")}</SelectItem>
                                    <SelectItem value="paternity">{t("admin.maternityFund.paternity")}</SelectItem>
                                    <SelectItem value="parental">{t("admin.maternityFund.parental")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Startdato *</Label>
                                <Input type="date" value={formStart} onChange={(e) => setFormStart(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Slutdato *</Label>
                                <Input type="date" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Ugentlig beløb (kr.) *</Label>
                            <Input type="number" placeholder="0" value={formWeekly} onChange={(e) => setFormWeekly(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowNewDialog(false); resetForm() }}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleNewApplication}>
                            {t("admin.maternityFund.newApplication")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
