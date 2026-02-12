"use client"

import { useState } from "react"
import { Plus, Download, Trash2, Settings } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { mockPayouts, mockWorks, mockPortalSettings } from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

function formatKr(n: number) {
    return n.toLocaleString("da-DK") + " kr."
}

export default function AdminUdbetalingerPage() {
    const { t } = useI18n()
    const [adminFeePercent] = useState(mockPortalSettings.adminFeePercent)
    const [poolAmount, setPoolAmount] = useState(0)
    const [distributions, setDistributions] = useState([
        { name: "", percent: 0 },
    ])

    const computedAdminFee = Math.round(poolAmount * (adminFeePercent / 100))

    const addDistribution = () =>
        setDistributions([...distributions, { name: "", percent: 0 }])

    const removeDistribution = (i: number) =>
        setDistributions(distributions.filter((_, idx) => idx !== i))

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.payouts.title")}
                subtitle={t("admin.payouts.subtitle")}
                actions={
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="sm" className="gap-1.5">
                                <Plus className="h-4 w-4" />
                                {t("admin.payouts.newPayout")}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                            <DialogHeader>
                                <DialogTitle>{t("admin.payouts.newPayout")}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.payouts.work")}</Label>
                                    <Select>
                                        <SelectTrigger>
                                            <SelectValue placeholder={t("admin.payouts.work")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {mockWorks.map((w) => (
                                                <SelectItem key={w.id} value={w.id}>
                                                    {w.title}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.payouts.pool")}</Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={poolAmount || ""}
                                            onChange={(e) => setPoolAmount(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payouts.adminFee")}
                                        </Label>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm tabular-nums flex-1">
                                                <Settings className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                                                <span className="font-medium">{adminFeePercent}%</span>
                                                <span className="text-muted-foreground ml-auto">
                                                    = {formatKr(computedAdminFee)}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">
                                            Styres centralt fra Stamdata
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-xs">{t("admin.payouts.distribution")}</Label>
                                    {distributions.map((d, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <Input
                                                placeholder={t("admin.payouts.member")}
                                                className="flex-1"
                                                value={d.name}
                                                onChange={(e) => {
                                                    const next = [...distributions]
                                                    next[i].name = e.target.value
                                                    setDistributions(next)
                                                }}
                                            />
                                            <Input
                                                type="number"
                                                placeholder="%"
                                                className="w-20"
                                                value={d.percent || ""}
                                                onChange={(e) => {
                                                    const next = [...distributions]
                                                    next[i].percent = Number(e.target.value)
                                                    setDistributions(next)
                                                }}
                                            />
                                            <span className="text-sm text-muted-foreground">%</span>
                                            {distributions.length > 1 && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0"
                                                    onClick={() => removeDistribution(i)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={addDistribution}
                                        className="gap-1"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        {t("admin.payouts.addMember")}
                                    </Button>
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <Button className="flex-1">{t("admin.payouts.calculate")}</Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                }
            />

            {/* Existing payouts */}
            <div className="space-y-4">
                {mockPayouts.map((payout) => (
                    <Card key={payout.id}>
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-base font-medium">
                                    {payout.workTitle}
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    {payout.exported && (
                                        <Badge variant="outline" className="font-normal text-xs">
                                            Eksporteret
                                        </Badge>
                                    )}
                                    <Button variant="outline" size="sm" className="gap-1.5">
                                        <Download className="h-3.5 w-3.5" />
                                        {t("admin.payouts.export")}
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="mb-4 flex gap-6 text-sm">
                                <div>
                                    <span className="text-muted-foreground">{t("admin.payouts.pool")}:</span>{" "}
                                    <span className="font-medium tabular-nums">
                                        {formatKr(payout.poolAmount)}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">{t("admin.payouts.adminFee")}:</span>{" "}
                                    <span className="font-medium tabular-nums">
                                        −{formatKr(payout.adminFee)}
                                    </span>
                                    <span className="text-xs text-muted-foreground ml-1">
                                        ({adminFeePercent}%)
                                    </span>
                                </div>
                            </div>

                            <div className="rounded-lg border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t("admin.payouts.member")}</TableHead>
                                            <TableHead className="text-right">
                                                {t("admin.payouts.share")}
                                            </TableHead>
                                            <TableHead className="text-right">
                                                {t("admin.payouts.amount")}
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {payout.distributions.map((d) => (
                                            <TableRow key={d.userId}>
                                                <TableCell>{d.userName}</TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {d.sharePercent}%
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums font-medium">
                                                    {formatKr(d.amount)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
