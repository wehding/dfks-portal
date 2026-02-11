"use client"

import { useI18n } from "@/lib/i18n"
import { mockPayments } from "@/lib/mock-data"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

function formatKr(amount: number): string {
    return amount.toLocaleString("da-DK") + " kr."
}

export default function OkonomiPage() {
    const { t } = useI18n()

    const totalAmount = mockPayments.reduce((s, p) => s + p.amount, 0)
    const totalFee = mockPayments.reduce((s, p) => s + p.adminFee, 0)
    const totalNet = mockPayments.reduce((s, p) => s + p.netAmount, 0)

    const bySource = (source: string) =>
        mockPayments
            .filter((p) => p.source === source)
            .reduce((s, p) => s + p.netAmount, 0)

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("econ.title")}
                subtitle={t("econ.subtitle")}
            />

            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            {t("econ.totalPaid")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-semibold tabular-nums">
                            {formatKr(totalAmount)}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            {t("econ.adminFee")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-semibold tabular-nums text-muted-foreground">
                            −{formatKr(totalFee)}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            {t("econ.netPaid")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-semibold tabular-nums">
                            {formatKr(totalNet)}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Source breakdown */}
            <div className="grid gap-4 sm:grid-cols-3">
                {(["svod", "copydan", "royalties"] as const).map((source) => (
                    <Card key={source}>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {t(`econ.${source}`)}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-lg font-semibold tabular-nums">
                                {formatKr(bySource(source))}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Detail tabs */}
            <Tabs defaultValue="history">
                <TabsList>
                    <TabsTrigger value="history">{t("econ.history")}</TabsTrigger>
                    <TabsTrigger value="byWork">{t("econ.byWork")}</TabsTrigger>
                </TabsList>

                <TabsContent value="history" className="mt-4">
                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("works.workTitle")}</TableHead>
                                    <TableHead>{t("econ.bySource")}</TableHead>
                                    <TableHead className="text-right">{t("admin.payouts.amount")}</TableHead>
                                    <TableHead className="text-right">{t("econ.adminFee")}</TableHead>
                                    <TableHead className="text-right">{t("econ.netPaid")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {mockPayments.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell className="font-medium">{p.workTitle}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-normal uppercase text-xs">
                                                {p.source}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {formatKr(p.amount)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums text-muted-foreground">
                                            −{formatKr(p.adminFee)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">
                                            {formatKr(p.netAmount)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                <TabsContent value="byWork" className="mt-4">
                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("works.workTitle")}</TableHead>
                                    <TableHead className="text-right">{t("econ.netPaid")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.entries(
                                    mockPayments.reduce(
                                        (acc, p) => ({
                                            ...acc,
                                            [p.workTitle]: (acc[p.workTitle] || 0) + p.netAmount,
                                        }),
                                        {} as Record<string, number>
                                    )
                                ).map(([title, amount]) => (
                                    <TableRow key={title}>
                                        <TableCell className="font-medium">{title}</TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">
                                            {formatKr(amount)}
                                        </TableCell>
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
