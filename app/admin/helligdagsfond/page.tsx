"use client"

import { useState, useMemo } from "react"
import { CalendarHeart, Download, TrendingUp, Users, Coins, Search } from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { mockHolidayFundEntries as initialEntries, mockHolidayFundSummaries } from "@/lib/mock-data"
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
import type { HolidayFundEntry } from "@/lib/types"
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

export default function AdminHelligdagsfondPage() {
    const { t } = useI18n()
    const [entries, setEntries] = useState<HolidayFundEntry[]>(initialEntries)
    const [selectedYear, setSelectedYear] = useState<string>("all")
    const [searchQuery, setSearchQuery] = useState("")
    const [showPaymentDialog, setShowPaymentDialog] = useState(false)
    const [paymentMember, setPaymentMember] = useState("")
    const [paymentAmount, setPaymentAmount] = useState("")

    const years = [...new Set(entries.map((e) => e.year))].sort((a, b) => b - a)
    const yearNum = selectedYear === "all" ? null : Number(selectedYear)

    const filteredEntries = useMemo(() => {
        let list = entries
        if (yearNum) list = list.filter((e) => e.year === yearNum)
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            list = list.filter((e) => e.memberName.toLowerCase().includes(q))
        }
        return list
    }, [entries, yearNum, searchQuery])

    const handleRegisterPayment = () => {
        if (!paymentMember.trim() || !paymentAmount.trim()) {
            toast.error("Udfyld alle felter")
            return
        }
        const amount = Number(paymentAmount)
        if (isNaN(amount) || amount <= 0) {
            toast.error("Ugyldigt beløb")
            return
        }
        const newEntry: HolidayFundEntry = {
            id: `hf${Date.now()}`,
            memberId: `u${Date.now()}`,
            memberName: paymentMember.trim(),
            year: new Date().getFullYear(),
            contributionRate: 12.5,
            totalContribution: amount,
            totalPaid: 0,
            balance: amount,
            status: "active",
        }
        setEntries((prev) => [newEntry, ...prev])
        toast.success(`Udbetaling registreret for ${paymentMember}`)
        setShowPaymentDialog(false)
        setPaymentMember("")
        setPaymentAmount("")
    }

    const exportCsv = () => {
        const headers = ["Medlem", "År", "Sats %", "Indbetalt", "Udbetalt", "Saldo", "Status"]
        const rows = filteredEntries.map((e) =>
            [e.memberName, e.year, e.contributionRate, e.totalContribution, e.totalPaid, e.balance, e.status].join(";")
        )
        const csv = [headers.join(";"), ...rows].join("\n")
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `helligdagsfond_${new Date().toISOString().split("T")[0]}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast.success("CSV eksporteret")
    }

    // Summary for selected year or latest
    const summary = yearNum
        ? mockHolidayFundSummaries.find((s) => s.year === yearNum)
        : mockHolidayFundSummaries[0]

    // Chart data
    const chartData = [...mockHolidayFundSummaries]
        .reverse()
        .map((s) => ({
            year: s.year.toString(),
            contributions: s.totalContributions,
            paidOut: s.totalPaidOut,
            balance: s.balance,
        }))

    const statusBadge = (status: string) => {
        switch (status) {
            case "active":
                return (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15">
                        {t("admin.holidayFund.active")}
                    </Badge>
                )
            case "closed":
                return (
                    <Badge variant="secondary">
                        {t("admin.holidayFund.closed")}
                    </Badge>
                )
            case "pending":
                return (
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/15">
                        {t("admin.holidayFund.pending")}
                    </Badge>
                )
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.holidayFund.title")}
                subtitle={t("admin.holidayFund.subtitle")}
                actions={
                    <Button size="sm" className="gap-1.5" onClick={() => setShowPaymentDialog(true)}>
                        <CalendarHeart className="h-4 w-4" />
                        {t("admin.holidayFund.registerPayment")}
                    </Button>
                }
            />

            {/* Summary Cards */}
            {summary && (
                <div className="hidden gap-4 sm:grid sm:grid-cols-4">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                                    <Coins className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.holidayFund.totalContributions")}
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {formatKr(summary.totalContributions)}
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
                                        {t("admin.holidayFund.totalPaid")}
                                    </p>
                                    <p className="text-xl font-bold tabular-nums text-emerald-600">
                                        {formatKr(summary.totalPaidOut)}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                                    <Coins className="h-5 w-5 text-amber-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("admin.holidayFund.balance")}
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {formatKr(summary.balance)}
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
                                        {t("admin.holidayFund.members")}
                                    </p>
                                    <p className="text-xl font-bold tabular-nums">
                                        {summary.memberCount}
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
                        Indbetalinger vs. udbetalinger pr. år
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
                                    dataKey="contributions"
                                    name={t("admin.holidayFund.contribution")}
                                    fill="hsl(210, 65%, 55%)"
                                    radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                    dataKey="paidOut"
                                    name={t("admin.holidayFund.paid")}
                                    fill="hsl(160, 50%, 50%)"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Filters */}
            <div className="grid gap-3 sm:flex sm:flex-wrap">
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="w-full border-primary/30 bg-primary/5 font-medium sm:w-[140px]">
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
                <Input
                    placeholder={t("common.search")}
                    className="w-full sm:w-[220px]"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="sm:ml-auto">
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
                            <TableHead>{t("admin.holidayFund.member")}</TableHead>
                            <TableHead>{t("admin.holidayFund.year")}</TableHead>
                            <TableHead className="text-right">{t("admin.holidayFund.rate")}</TableHead>
                            <TableHead className="text-right">{t("admin.holidayFund.contribution")}</TableHead>
                            <TableHead className="text-right">{t("admin.holidayFund.paid")}</TableHead>
                            <TableHead className="text-right">{t("admin.holidayFund.balance")}</TableHead>
                            <TableHead>{t("admin.holidayFund.status")}</TableHead>
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
                                    <TableCell className="font-medium">{entry.memberName}</TableCell>
                                    <TableCell className="tabular-nums">{entry.year}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {entry.contributionRate}%
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {formatKr(entry.totalContribution)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-emerald-600">
                                        {formatKr(entry.totalPaid)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums font-medium">
                                        {formatKr(entry.balance)}
                                    </TableCell>
                                    <TableCell>{statusBadge(entry.status)}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
            {/* Register Payment Dialog */}
            <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CalendarHeart className="h-5 w-5" />
                            {t("admin.holidayFund.registerPayment")}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Medlem</Label>
                            <Input
                                placeholder="Medlemsnavn"
                                value={paymentMember}
                                onChange={(e) => setPaymentMember(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Beløb (kr.)</Label>
                            <Input
                                type="number"
                                placeholder="0"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleRegisterPayment}>
                            {t("admin.holidayFund.registerPayment")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
