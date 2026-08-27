"use client"

import { AlertTriangle, CheckCircle2, Clock, CoinsIcon } from "lucide-react"
import { PortalPageHeader } from "@/components/portal/portal-page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import type { MemberAllocation, MemberEntitlementCase } from "@/app/actions/member-rights"
import Link from "next/link"

function formatMinor(amount: number, currency = "DKK"): string {
    return (amount / 100).toLocaleString("da-DK", {
        style: "currency", currency, minimumFractionDigits: 2,
    })
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
}

function StatusBadge({ status, runStatus }: { status: string; runStatus: string }) {
    if (runStatus === "booked" && status === "distributed") {
        return <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />Udbetalt</Badge>
    }
    if (status === "partially_withheld" || status === "fully_withheld") {
        return <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500"><AlertTriangle className="h-3 w-3" />Tilbageholdt</Badge>
    }
    if (runStatus === "booked") {
        return <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />Bogført</Badge>
    }
    return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Under behandling</Badge>
}

export function OkonomiClient({ allocations, entitlementCases }: { allocations: MemberAllocation[]; entitlementCases: MemberEntitlementCase[] }) {
    const booked = allocations.filter(a => a.run_status === "booked")
    const pending = allocations.filter(a => a.run_status !== "booked" && a.run_status !== "cancelled")
    const withheld = entitlementCases.filter(item => !["confirmed", "rejected", "administratively_closed"].includes(item.status))

    const totalBooked = booked.reduce((s, a) => s + a.individual_net, 0)
    const totalPending = pending.reduce((s, a) => s + a.individual_net, 0)

    // Gruppér bookede efter run
    const bookedByRun = booked.reduce<Record<string, MemberAllocation[]>>((acc, a) => {
        if (!acc[a.run_id]) acc[a.run_id] = []
        acc[a.run_id].push(a)
        return acc
    }, {})

    return (
        <div className="space-y-6 max-w-4xl">
            <PortalPageHeader
                title="Økonomi & Rettigheder"
                subtitle="Dine rettighedsmidler fra Copydan, SVOD og øvrige kollektive ordninger"
            />

            {/* Overblikskort */}
            <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Bogførte midler
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-bold">
                                {booked.length > 0 ? formatMinor(totalBooked) : "—"}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Fra {booked.length > 0
                                ? new Set(booked.map(a => a.run_id)).size
                                : 0} afregningsrunder
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Under behandling
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className="text-2xl font-bold">
                            {pending.length > 0 ? formatMinor(totalPending) : "—"}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {pending.length} tildeling{pending.length !== 1 ? "er" : ""} afventer bogføring
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Tilbageholdt
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <div className={`text-2xl font-bold ${withheld.length > 0 ? "text-amber-500" : ""}`}>
                            {withheld.length > 0
                                ? formatMinor(withheld.reduce((s, item) => s + item.withheld_amount, 0), withheld[0]?.currency)
                                : "—"}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {withheld.length > 0
                                ? "Kontakt DFKS for mere information"
                                : "Ingen tilbageholdte midler"}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {allocations.length === 0 && entitlementCases.length === 0 ? (
                <div className="rounded-lg border border-dashed p-10 text-center">
                    <CoinsIcon className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium">Ingen rettighedsmidler endnu</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        Når DFKS bogfører en afregningsrunde med dine værker, vil beløbene vises her.
                    </p>
                </div>
            ) : (
                <Tabs defaultValue={booked.length > 0 ? "bogforte" : pending.length > 0 ? "under-behandling" : "tilbageholdt"}>
                    <TabsList>
                        <TabsTrigger value="bogforte">
                            Bogførte ({booked.length})
                        </TabsTrigger>
                        <TabsTrigger value="under-behandling">
                            Under behandling ({pending.length})
                        </TabsTrigger>
                        {withheld.length > 0 && (
                            <TabsTrigger value="tilbageholdt">
                                Tilbageholdt ({withheld.length})
                            </TabsTrigger>
                        )}
                    </TabsList>

                    {/* Bogførte — grupperet per afregningsrunde */}
                    <TabsContent value="bogforte" className="mt-4">
                        {booked.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4">Ingen bogførte midler endnu.</p>
                        ) : (
                            <div className="space-y-6">
                                {Object.values(bookedByRun).map(runAllocations => {
                                    const first = runAllocations[0]
                                    const runTotal = runAllocations.reduce((s, a) => s + a.individual_net, 0)
                                    return (
                                        <div key={first.run_id} className="rounded-lg border overflow-hidden">
                                            <div className="flex items-center justify-between bg-muted/40 px-4 py-3">
                                                <div>
                                                    <p className="font-medium text-sm">{first.period_label}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {first.fund_name} · Bogført {formatDate(first.booked_at)}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-sm">{formatMinor(runTotal, first.currency)}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {runAllocations.length} {runAllocations.length === 1 ? "tildeling" : "tildelinger"}
                                                    </p>
                                                </div>
                                            </div>
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Værk / afsnit</TableHead>
                                                        <TableHead>Rolle</TableHead>
                                                        <TableHead className="text-right">Andel</TableHead>
                                                        <TableHead className="text-right">Beløb</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {runAllocations.map(a => (
                                                        <TableRow key={a.id}>
                                                            <TableCell className="text-sm">
                                                                {a.episode_title ?? a.work_title ?? "—"}
                                                            </TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">
                                                                {a.role_label ?? "—"}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-xs">
                                                                {(a.share_bps / 100).toFixed(0)} %
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-sm font-medium">
                                                                {formatMinor(a.individual_net, a.currency)}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </TabsContent>

                    {/* Under behandling */}
                    <TabsContent value="under-behandling" className="mt-4">
                        {pending.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4">Ingen midler under behandling.</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Periode</TableHead>
                                        <TableHead>Kasse</TableHead>
                                        <TableHead>Værk / afsnit</TableHead>
                                        <TableHead>Rolle</TableHead>
                                        <TableHead className="text-right">Forventet beløb</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pending.map(a => (
                                        <TableRow key={a.id}>
                                            <TableCell className="text-sm">{a.period_label}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{a.fund_name}</TableCell>
                                            <TableCell className="text-sm">
                                                {a.episode_title ?? a.work_title ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {a.role_label ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-sm">
                                                {formatMinor(a.individual_net, a.currency)}
                                            </TableCell>
                                            <TableCell>
                                                <StatusBadge status={a.status} runStatus={a.run_status} />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </TabsContent>

                    {/* Tilbageholdt */}
                    {withheld.length > 0 && (
                        <TabsContent value="tilbageholdt" className="mt-4">
                            <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/10 p-4 mb-4">
                                <div className="flex gap-2 text-sm text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                    <p>
                                        Dokumentation for rettighedsforbehold mangler. Åbn den konkrete sag for at
                                        uploade kontrakt, allonge, producenterklæring eller anden dokumentation og skrive til administrator.
                                    </p>
                                </div>
                            </div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Periode</TableHead>
                                        <TableHead>Værk / afsnit</TableHead>
                                        <TableHead>Årsag</TableHead>
                                        <TableHead className="text-right">Beløb</TableHead>
                                        <TableHead className="text-right">Handling</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {withheld.map(a => (
                                        <TableRow key={a.id}>
                                            <TableCell className="text-sm">{formatDate(a.opened_at)}</TableCell>
                                            <TableCell className="text-sm">
                                                {a.episode_title ?? a.work_title ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                Dokumentation for {a.right_type.toUpperCase()}-forbehold mangler
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-sm">
                                                {formatMinor(a.withheld_amount, a.currency)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Link className="text-xs font-medium text-primary underline" href={`/portal/okonomi/rettighedssager/${a.id}`}>
                                                    Se sag og dokumentér
                                                </Link>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TabsContent>
                    )}
                </Tabs>
            )}
        </div>
    )
}
