"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, AlertTriangle, CheckCircle2, Unlock, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import { toast } from "sonner"
import {
    getRightsAllocations,
    getRightsHolderSummary,
    getWithheldPositions,
    createRightsAllocations,
    resolveWithheldPosition,
    type RightsAllocation,
    type RightsHolderSummary,
    type WithheldPosition,
    type AllocationInput,
} from "@/app/actions/rights-allocations"

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function formatMinor(amount: number, currency = "DKK"): string {
    return (amount / 100).toLocaleString("da-DK", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
    })
}

// ── Tildelingsredigering-dialog ───────────────────────────────────────────────

type AllocationRow = {
    rights_holder_id: string
    rights_holder_name: string
    role_label: string
    share_pct: string   // brugerinput i procent, fx "50"
}

function AddAllocationsDialog({
    open,
    onClose,
    onSaved,
    runId,
    workAllocationId,
    workTitle,
    grossShare,
    currency,
}: {
    open: boolean
    onClose: () => void
    onSaved: () => void
    runId: string
    workAllocationId: string
    workTitle: string
    grossShare: number
    currency: string
}) {
    const [rows, setRows] = useState<AllocationRow[]>([
        { rights_holder_id: "", rights_holder_name: "", role_label: "Klipper", share_pct: "100" },
    ])
    const [rightsHolders, setRightsHolders] = useState<{ id: string; full_name: string }[]>([])
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!open) return
        import("@/lib/supabase/client").then(async ({ createClient }) => {
            const supabase = createClient()
            const { data } = await supabase
                .from("rettighedshavere")
                .select("id, full_name")
                .order("full_name")
            setRightsHolders(data ?? [])
        })
    }, [open])

    const totalPct = rows.reduce((s, r) => s + (parseFloat(r.share_pct.replace(",", ".")) || 0), 0)
    const totalOk = Math.abs(totalPct - 100) < 0.01

    const addRow = () =>
        setRows(rs => [...rs, { rights_holder_id: "", rights_holder_name: "", role_label: "Klipper", share_pct: "0" }])

    const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i))

    const updateRow = (i: number, patch: Partial<AllocationRow>) =>
        setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))

    const handleSave = async () => {
        if (!totalOk) { toast.error("Andele skal summere til 100 %"); return }
        for (const r of rows) {
            if (!r.rights_holder_id) { toast.error("Vælg en rettighedshaver på alle rækker"); return }
        }
        setSaving(true)
        const items: AllocationInput[] = rows.map(r => ({
            work_allocation_id: workAllocationId,
            rights_holder_id: r.rights_holder_id,
            role_label: r.role_label || null,
            share_bps: Math.round(parseFloat(r.share_pct.replace(",", ".")) * 100),
        }))
        const res = await createRightsAllocations(runId, workAllocationId, items)
        if (res.success) {
            toast.success(`${res.count} tildelinger gemt`)
            onSaved()
            onClose()
        } else {
            toast.error(res.error ?? "Kunne ikke gemme tildelinger")
        }
        setSaving(false)
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Fordel værkbeløb</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                        {workTitle} — {formatMinor(grossShare, currency)} brutto
                    </p>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>Rolle</TableHead>
                                    <TableHead className="w-28">Andel (%)</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((row, i) => (
                                    <TableRow key={i}>
                                        <TableCell>
                                            <select
                                                className="w-full text-sm rounded border px-2 py-1 bg-background"
                                                value={row.rights_holder_id}
                                                onChange={e => {
                                                    const rh = rightsHolders.find(r => r.id === e.target.value)
                                                    updateRow(i, {
                                                        rights_holder_id: e.target.value,
                                                        rights_holder_name: rh?.full_name ?? "",
                                                    })
                                                }}
                                            >
                                                <option value="">Vælg…</option>
                                                {rightsHolders.map(rh => (
                                                    <option key={rh.id} value={rh.id}>{rh.full_name}</option>
                                                ))}
                                            </select>
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                className="h-8 text-sm"
                                                value={row.role_label}
                                                onChange={e => updateRow(i, { role_label: e.target.value })}
                                                placeholder="Klipper"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                className="h-8 text-sm font-mono"
                                                value={row.share_pct}
                                                onChange={e => updateRow(i, { share_pct: e.target.value })}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            {rows.length > 1 && (
                                                <Button variant="ghost" size="sm" onClick={() => removeRow(i)}>
                                                    <Minus className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="flex items-center justify-between">
                        <Button variant="outline" size="sm" onClick={addRow}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Tilføj rettighedshaver
                        </Button>
                        <span className={`text-sm font-mono ${totalOk ? "text-green-600" : "text-destructive"}`}>
                            Sum: {totalPct.toFixed(2)} %
                        </span>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving || !totalOk}>
                        {saving ? "Gemmer…" : "Gem fordeling"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Frigiv-tilbageholdt-dialog ────────────────────────────────────────────────

function ResolveWithheldDialog({
    position,
    onClose,
    onResolved,
}: {
    position: WithheldPosition
    onClose: () => void
    onResolved: () => void
}) {
    const [notes, setNotes] = useState("")
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        if (!notes.trim()) { toast.error("Angiv årsag til frigivelse"); return }
        setSaving(true)
        const res = await resolveWithheldPosition(position.id, notes)
        if (res.success) {
            toast.success("Position frigivet")
            onResolved()
            onClose()
        } else {
            toast.error(res.error ?? "Kunne ikke frigive position")
        }
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Frigiv tilbageholdt position</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="rounded-md border p-3 text-sm space-y-1">
                        <p><span className="text-muted-foreground">Rettighedshaver:</span> {position.rights_holder_name}</p>
                        <p><span className="text-muted-foreground">Tilbageholdt beløb:</span> {formatMinor(position.withheld_amount)}</p>
                        <p><span className="text-muted-foreground">Årsag:</span> {position.withheld_reason}</p>
                    </div>
                    <div className="space-y-1">
                        <Label>Årsag til frigivelse</Label>
                        <Input
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="fx Rettighedshaver fundet og verificeret"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Frigiver…" : "Frigiv position"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Hoved-panel ───────────────────────────────────────────────────────────────

export function RightsAllocationsPanel({
    runId,
    currency = "DKK",
    runStatus,
}: {
    runId: string
    currency?: string
    runStatus: string
}) {
    const [summary, setSummary] = useState<RightsHolderSummary[]>([])
    const [allocations, setAllocations] = useState<RightsAllocation[]>([])
    const [withheld, setWithheld] = useState<WithheldPosition[]>([])
    const [loading, setLoading] = useState(true)
    const [addDialog, setAddDialog] = useState<{
        workAllocationId: string
        workTitle: string
        grossShare: number
    } | null>(null)
    const [resolveDialog, setResolveDialog] = useState<WithheldPosition | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const [sRes, aRes, wRes] = await Promise.all([
            getRightsHolderSummary(runId),
            getRightsAllocations(runId),
            getWithheldPositions(runId),
        ])
        if (sRes.success) setSummary(sRes.summary)
        if (aRes.success) setAllocations(aRes.allocations)
        if (wRes.success) setWithheld(wRes.positions)
        setLoading(false)
    }, [runId])

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timer)
    }, [load])

    const canEdit = !["booked", "cancelled"].includes(runStatus)

    const totalNet = summary.reduce((s, r) => s + r.total_individual_net, 0)
    const withheldTotal = withheld.filter(w => !w.resolved_at)
        .reduce((s, w) => s + w.withheld_amount, 0)

    if (loading) return <p className="text-sm text-muted-foreground py-4">Henter tildelinger…</p>

    return (
        <div className="space-y-4">
            {/* Overblik */}
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Rettighedshavere</p>
                    <p className="text-xl font-bold">{summary.length}</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Samlet individuelt</p>
                    <p className="text-xl font-bold">{formatMinor(totalNet, currency)}</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Tilbageholdt</p>
                    <p className={`text-xl font-bold ${withheldTotal > 0 ? "text-amber-500" : ""}`}>
                        {formatMinor(withheldTotal, currency)}
                    </p>
                </div>
            </div>

            <Tabs defaultValue="personer">
                <TabsList>
                    <TabsTrigger value="personer">
                        Personoversigt ({summary.length})
                    </TabsTrigger>
                    <TabsTrigger value="tildelinger">
                        Tildelinger ({allocations.length})
                    </TabsTrigger>
                    <TabsTrigger value="tilbageholdt">
                        Tilbageholdt ({withheld.filter(w => !w.resolved_at).length})
                    </TabsTrigger>
                </TabsList>

                {/* Personoversigt */}
                <TabsContent value="personer" className="mt-3">
                    {summary.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">
                            Ingen tildelinger endnu. Fordel værkbeløb under fanen &quot;Tildelinger&quot;.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>Medlemsnr.</TableHead>
                                    <TableHead className="text-right">Tildelinger</TableHead>
                                    <TableHead className="text-right">Individuelt netto</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {summary.map(rh => (
                                    <TableRow key={rh.rights_holder_id}>
                                        <TableCell className="font-medium">{rh.rights_holder_name}</TableCell>
                                        <TableCell className="text-muted-foreground font-mono text-xs">
                                            {rh.member_number ?? "—"}
                                        </TableCell>
                                        <TableCell className="text-right">{rh.allocation_count}</TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatMinor(rh.total_individual_net, currency)}
                                        </TableCell>
                                        <TableCell>
                                            {rh.has_withheld && (
                                                <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    Tilbageholdt
                                                </Badge>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>

                {/* Tildelinger pr. værkbeløb */}
                <TabsContent value="tildelinger" className="mt-3">
                    {allocations.length === 0 ? (
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Ingen tildelinger endnu.
                            </p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>Værk / episode</TableHead>
                                    <TableHead>Rolle</TableHead>
                                    <TableHead className="text-right">Andel</TableHead>
                                    <TableHead className="text-right">Individuelt</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {allocations.map(a => (
                                    <TableRow key={a.id}>
                                        <TableCell className="font-medium">{a.rights_holder_name ?? "—"}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {a.episode_title ?? a.work_title ?? "—"}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{a.role_label ?? "—"}</TableCell>
                                        <TableCell className="text-right font-mono text-xs">
                                            {(a.share_bps / 100).toFixed(2)} %
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {formatMinor(a.individual_net, currency)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={
                                                a.status === "distributed" ? "default" :
                                                a.status === "partially_withheld" || a.status === "fully_withheld" ? "outline" :
                                                "secondary"
                                            }>
                                                {a.status === "pending" ? "Afventer"
                                                 : a.status === "distributed" ? "Fordelt"
                                                 : a.status === "partially_withheld" ? "Delvist tilbageh."
                                                 : a.status === "fully_withheld" ? "Fuldt tilbageh."
                                                 : a.status}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>

                {/* Tilbageholdte positioner */}
                <TabsContent value="tilbageholdt" className="mt-3">
                    {withheld.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">Ingen tilbageholdte positioner.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>Årsag</TableHead>
                                    <TableHead className="text-right">Beløb</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {withheld.map(w => (
                                    <TableRow key={w.id} className={w.resolved_at ? "opacity-50" : ""}>
                                        <TableCell className="font-medium">{w.rights_holder_name ?? "—"}</TableCell>
                                        <TableCell className="text-sm">{w.withheld_reason}</TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {formatMinor(w.withheld_amount, currency)}
                                        </TableCell>
                                        <TableCell>
                                            {w.resolved_at ? (
                                                <Badge variant="default" className="gap-1">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Frigivet
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    Afventer
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {!w.resolved_at && canEdit && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-1"
                                                    onClick={() => setResolveDialog(w)}
                                                >
                                                    <Unlock className="h-3 w-3" />
                                                    Frigiv
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>
            </Tabs>

            {addDialog && (
                <AddAllocationsDialog
                    open
                    onClose={() => setAddDialog(null)}
                    onSaved={load}
                    runId={runId}
                    workAllocationId={addDialog.workAllocationId}
                    workTitle={addDialog.workTitle}
                    grossShare={addDialog.grossShare}
                    currency={currency}
                />
            )}

            {resolveDialog && (
                <ResolveWithheldDialog
                    position={resolveDialog}
                    onClose={() => setResolveDialog(null)}
                    onResolved={load}
                />
            )}
        </div>
    )
}
