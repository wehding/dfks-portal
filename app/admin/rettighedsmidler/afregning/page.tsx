"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft, Plus, CheckCircle2, Clock, Ban, Wallet,
    AlertTriangle, Settings, RotateCcw, ChevronDown, ChevronUp,
    Download, ExternalLink
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs"
import { toast } from "sonner"
import {
    getSettlements, createSettlement, advanceSettlementStatus,
    getSettlementItems, getOrgPayoutThreshold, setOrgPayoutThreshold,
    getPayrollReferences,
    type Settlement, type SettlementItem, type SettlementStatus,
    type PayrollExportBatch, type PayrollRecipientReference,
} from "@/app/actions/rights-settlements"
import { getRightsFunds } from "@/app/actions/rights-funds"
import { getCalculationRuns } from "@/app/actions/rights-calculation"
import { getExportBatches } from "@/app/actions/rights-export"
import type { RightsFund } from "@/app/actions/rights-funds"
import type { CalculationRun } from "@/app/actions/rights-calculation"

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function fmt(amount: number, currency = "DKK") {
    return (amount / 100).toLocaleString("da-DK", { style: "currency", currency, minimumFractionDigits: 2 })
}

function fmtDate(iso: string | null | undefined) {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
}

const STATUS_CONFIG: Record<SettlementStatus, {
    label: string; variant: "default" | "secondary" | "outline"; icon: React.ElementType
}> = {
    draft:     { label: "Kladde",     variant: "outline",   icon: Clock },
    prepared:  { label: "Forberedt",  variant: "secondary", icon: Clock },
    approved:  { label: "Godkendt",   variant: "default",   icon: CheckCircle2 },
    paid_out:  { label: "Udbetalt",   variant: "default",   icon: Wallet },
    cancelled: { label: "Annulleret", variant: "outline",   icon: Ban },
}

type AdvanceableStatus = "prepared" | "approved" | "paid_out" | "cancelled"
const NEXT_STATUS: Record<string, AdvanceableStatus> = {
    draft: "prepared", prepared: "approved", approved: "paid_out",
}
const NEXT_LABEL: Record<string, string> = {
    prepared: "Markér forberedt", approved: "Godkend", paid_out: "Markér udbetalt",
}

// ── Tærskel-dialog ────────────────────────────────────────────────────────────

function ThresholdDialog({
    current,
    currency,
    onClose,
    onSaved,
}: {
    current: number
    currency: string
    onClose: () => void
    onSaved: () => void
}) {
    const [valueKr, setValueKr] = useState((current / 100).toFixed(2))
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        const minor = Math.round(parseFloat(valueKr.replace(",", ".")) * 100)
        if (isNaN(minor) || minor < 0) { toast.error("Angiv et gyldigt beløb"); return }
        setSaving(true)
        const res = await setOrgPayoutThreshold(minor)
        if (res.success) { toast.success("Tærskel opdateret"); onSaved(); onClose() }
        else toast.error(res.error ?? "Fejl")
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Minumimstærskel for udbetaling</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <p className="text-sm text-muted-foreground">
                        Beløb under tærsklen udbetales ikke i denne runde men overføres til næste afregning.
                    </p>
                    <div className="space-y-1">
                        <Label>Tærskel (kr.)</Label>
                        <Input
                            value={valueKr}
                            onChange={e => setValueKr(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Gemmer…" : "Gem tærskel"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Ny afregning-dialog ───────────────────────────────────────────────────────

function NewSettlementDialog({
    onClose,
    onSaved,
}: {
    onClose: () => void
    onSaved: () => void
}) {
    const [funds, setFunds] = useState<RightsFund[]>([])
    const [runs, setRuns] = useState<CalculationRun[]>([])
    const [selectedFundId, setSelectedFundId] = useState("")
    const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
    const [label, setLabel] = useState("")
    const [notes, setNotes] = useState("")
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        getRightsFunds().then(r => { if (r.success) setFunds(r.funds.filter(f => f.active)) })
        getCalculationRuns().then(r => { if (r.success) setRuns(r.runs.filter(r => r.status === "booked")) })
    }, [])

    const fundRuns = runs.filter(r => !selectedFundId || r.fund_id === selectedFundId)
    const toggleRun = (id: string) => setSelectedRunIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )

    const handleSave = async () => {
        if (!selectedFundId) { toast.error("Vælg en rettighedskasse"); return }
        if (selectedRunIds.length === 0) { toast.error("Vælg mindst én beregningsrunde"); return }
        if (!label.trim()) { toast.error("Angiv en betegnelse"); return }
        setSaving(true)
        const res = await createSettlement({
            fund_id: selectedFundId,
            label,
            run_ids: selectedRunIds,
            notes: notes || null,
        })
        if (res.success) {
            toast.success("Afregning oprettet")
            onSaved()
            onClose()
        } else {
            toast.error(res.error ?? "Fejl")
        }
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Ny afregning</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <Label>Betegnelse</Label>
                        <Input
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            placeholder="fx Copydan Verdens TV 2024 — afregning"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Rettighedskasse</Label>
                        <Select value={selectedFundId} onValueChange={v => { setSelectedFundId(v); setSelectedRunIds([]) }}>
                            <SelectTrigger><SelectValue placeholder="Vælg kasse…" /></SelectTrigger>
                            <SelectContent>
                                {funds.map(f => (
                                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Beregningsrunder (bookede)</Label>
                        {fundRuns.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                {selectedFundId
                                    ? "Ingen bookede runder for denne kasse."
                                    : "Vælg en kasse for at se runder."}
                            </p>
                        ) : (
                            <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                                {fundRuns.map(r => (
                                    <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                                        <input
                                            type="checkbox"
                                            checked={selectedRunIds.includes(r.id)}
                                            onChange={() => toggleRun(r.id)}
                                            className="rounded"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{r.period_label}</p>
                                            <p className="text-xs text-muted-foreground">
                                                Individuelt: {fmt(Number(r.individual_amount), r.currency)}
                                            </p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                        {selectedRunIds.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {selectedRunIds.length} runde{selectedRunIds.length !== 1 ? "r" : ""} valgt
                            </p>
                        )}
                    </div>
                    <div className="space-y-1">
                        <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving || selectedRunIds.length === 0}>
                        {saving ? "Opretter…" : "Opret afregning"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Afregningsdetalje (collapsible) ──────────────────────────────────────────

function SettlementRow({
    settlement,
    onRefresh,
}: {
    settlement: Settlement
    onRefresh: () => void
}) {
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<SettlementItem[]>([])
    const [loadingItems, setLoadingItems] = useState(false)
    const [advancing, setAdvancing] = useState(false)

    const cfg = STATUS_CONFIG[settlement.status]
    const Icon = cfg.icon
    const next = NEXT_STATUS[settlement.status]

    const loadItems = async () => {
        setLoadingItems(true)
        const res = await getSettlementItems(settlement.id)
        if (res.success) setItems(res.items)
        setLoadingItems(false)
    }

    const handleToggle = (newOpen: boolean) => {
        setOpen(newOpen)
        if (newOpen && items.length === 0) loadItems()
    }

    const handleAdvance = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!next) return
        setAdvancing(true)
        const res = await advanceSettlementStatus(settlement.id, next)
        if (res.success) { toast.success("Status opdateret"); onRefresh() }
        else toast.error(res.error ?? "Fejl")
        setAdvancing(false)
    }

    const handleCancel = async (e: React.MouseEvent) => {
        e.stopPropagation()
        setAdvancing(true)
        const res = await advanceSettlementStatus(settlement.id, "cancelled")
        if (res.success) { toast.success("Afregning annulleret"); onRefresh() }
        else toast.error(res.error ?? "Fejl")
        setAdvancing(false)
    }

    const handleExport = (e: React.MouseEvent) => {
        e.stopPropagation()
        window.location.href = `/api/rettighedsmidler/eksport?settlement_id=${settlement.id}&system=datalon`
        toast.success("Download starter…")
        // Giv siden et øjeblik til at opdatere eksporthistorik
        setTimeout(() => onRefresh(), 2000)
    }

    const aboveThreshold = items.filter(i => !i.below_threshold)
    const belowThreshold = items.filter(i => i.below_threshold)

    return (
        <Collapsible open={open} onOpenChange={handleToggle}>
            <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/40 rounded-lg border">
                    <div className="flex items-center gap-3">
                        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        <div>
                            <p className="font-medium text-sm">{settlement.label}</p>
                            <p className="text-xs text-muted-foreground">
                                {settlement.fund_name} · Oprettet {fmtDate(settlement.created_at)}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                            <p className="text-sm font-mono font-medium">{fmt(settlement.total_payable, settlement.currency)}</p>
                            {settlement.total_below_threshold > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    + {fmt(settlement.total_below_threshold, settlement.currency)} under tærskel
                                </p>
                            )}
                        </div>
                        <Badge variant={cfg.variant} className="gap-1">
                            <Icon className="h-3 w-3" />
                            {cfg.label}
                        </Badge>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            {["approved", "paid_out"].includes(settlement.status) && (
                                <Button size="sm" variant="outline" onClick={handleExport}>
                                    <Download className="h-3.5 w-3.5 mr-1" />
                                    DataLøn CSV
                                </Button>
                            )}
                            {next && settlement.status !== "cancelled" && (
                                <Button size="sm" variant="outline" onClick={handleAdvance} disabled={advancing}>
                                    {advancing ? "…" : NEXT_LABEL[next] ?? next}
                                </Button>
                            )}
                            {!["paid_out", "cancelled"].includes(settlement.status) && (
                                <Button size="sm" variant="ghost" onClick={handleCancel} disabled={advancing}>
                                    <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="border border-t-0 rounded-b-lg overflow-hidden">
                    {/* Tærskel-advarsel */}
                    {settlement.total_below_threshold > 0 && (
                        <div className="flex items-start gap-2 px-4 py-3 bg-amber-50/60 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-400 border-b">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>
                                {fmt(settlement.total_below_threshold, settlement.currency)} holdes tilbage — under tærsklen på {fmt(settlement.payout_threshold_minor, settlement.currency)}.
                                Disse modtagere medtages i næste afregning.
                            </span>
                        </div>
                    )}
                    {loadingItems ? (
                        <p className="text-sm text-muted-foreground p-4">Henter poster…</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>Periode / værk</TableHead>
                                    <TableHead className="text-right">Individuelt</TableHead>
                                    <TableHead className="text-right">Udbetales</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {aboveThreshold.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            <p className="font-medium text-sm">{item.rights_holder_name ?? "—"}</p>
                                            {item.member_number && <p className="text-xs text-muted-foreground">#{item.member_number}</p>}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {item.run_label}{item.work_title ? ` · ${item.work_title}` : ""}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {fmt(item.individual_net, item.currency)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm font-medium">
                                            {fmt(item.payable_amount, item.currency)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary" className="text-xs">Udbetales</Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {belowThreshold.map(item => (
                                    <TableRow key={item.id} className="opacity-50">
                                        <TableCell>
                                            <p className="font-medium text-sm">{item.rights_holder_name ?? "—"}</p>
                                            {item.member_number && <p className="text-xs text-muted-foreground">#{item.member_number}</p>}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {item.run_label}{item.work_title ? ` · ${item.work_title}` : ""}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {fmt(item.individual_net, item.currency)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                                            —
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="text-xs text-muted-foreground">Under tærskel</Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}

// ── Hoved-side ────────────────────────────────────────────────────────────────

export default function AfregningPage() {
    const router = useRouter()
    const [settlements, setSettlements] = useState<Settlement[]>([])
    const [batches, setBatches] = useState<PayrollExportBatch[]>([])
    const [references, setReferences] = useState<PayrollRecipientReference[]>([])
    const [threshold, setThreshold] = useState(50000)
    const [currency, setCurrency] = useState("DKK")
    const [loading, setLoading] = useState(true)
    const [newOpen, setNewOpen] = useState(false)
    const [thresholdOpen, setThresholdOpen] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const [sRes, bRes, rRes, tRes] = await Promise.all([
            getSettlements(),
            getExportBatches(),
            getPayrollReferences(),
            getOrgPayoutThreshold(),
        ])
        if (sRes.success) setSettlements(sRes.settlements)
        if (bRes.success) setBatches(bRes.batches)
        if (rRes.success) setReferences(rRes.references)
        if (tRes.success) { setThreshold(tRes.threshold_minor); setCurrency(tRes.currency) }
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])

    const activeSettlements = settlements.filter(s => !["paid_out", "cancelled"].includes(s.status))
    const completedSettlements = settlements.filter(s => s.status === "paid_out")
    const totalPaid = completedSettlements.reduce((s, a) => s + a.total_payable, 0)

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => router.push("/admin/rettighedsmidler")}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Rettighedsmidler
                </Button>
            </div>

            <div className="flex items-start justify-between">
                <PageHeader
                    title="Afregning & udbetalinger"
                    subtitle="Saml beregningsrunder til afregninger og styr udbetalingsflow"
                />
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setThresholdOpen(true)}
                    className="shrink-0 mt-1"
                >
                    <Settings className="h-3.5 w-3.5 mr-1" />
                    Tærskel: {fmt(threshold, currency)}
                </Button>
            </div>

            {/* Overblik */}
            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Aktive afregninger</p>
                    <p className="text-2xl font-bold">{activeSettlements.length}</p>
                </div>
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Udbetalt i alt</p>
                    <p className="text-2xl font-bold">{totalPaid > 0 ? fmt(totalPaid, currency) : "—"}</p>
                </div>
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Eksportbatches</p>
                    <p className="text-2xl font-bold">{batches.length}</p>
                </div>
            </div>

            <Tabs defaultValue="afregninger">
                <div className="flex items-center justify-between">
                    <TabsList>
                        <TabsTrigger value="afregninger">
                            Afregninger ({settlements.length})
                        </TabsTrigger>
                        <TabsTrigger value="eksport">
                            Eksporthistorik ({batches.length})
                        </TabsTrigger>
                        <TabsTrigger value="referencer">
                            DataLøn-referencer ({references.length})
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={load}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Opdater
                        </Button>
                        <Button size="sm" onClick={() => setNewOpen(true)}>
                            <Plus className="h-4 w-4 mr-1" />
                            Ny afregning
                        </Button>
                    </div>
                </div>

                {/* Afregninger */}
                <TabsContent value="afregninger" className="mt-4 space-y-3">
                    {loading ? (
                        <p className="text-sm text-muted-foreground py-4">Henter afregninger…</p>
                    ) : settlements.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-8 text-center">
                            <Wallet className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">
                                Ingen afregninger endnu. Opret en ved at samle bookede beregningsrunder.
                            </p>
                        </div>
                    ) : (
                        <>
                            {activeSettlements.length > 0 && (
                                <div className="space-y-2">
                                    <h3 className="text-sm font-medium text-muted-foreground">Aktive</h3>
                                    {activeSettlements.map(s => (
                                        <SettlementRow key={s.id} settlement={s} onRefresh={load} />
                                    ))}
                                </div>
                            )}
                            {completedSettlements.length > 0 && (
                                <div className="space-y-2">
                                    <h3 className="text-sm font-medium text-muted-foreground">Udbetalte</h3>
                                    {completedSettlements.map(s => (
                                        <SettlementRow key={s.id} settlement={s} onRefresh={load} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </TabsContent>

                {/* Eksporthistorik */}
                <TabsContent value="eksport" className="mt-4">
                    {batches.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">
                            Ingen eksporter endnu. Eksportfunktionen aktiveres under trin 9 (DataLøn-integration).
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Afregning</TableHead>
                                    <TableHead>System</TableHead>
                                    <TableHead>Eksporteret</TableHead>
                                    <TableHead className="text-right">Rækker</TableHead>
                                    <TableHead>Filreference</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {batches.map(b => (
                                    <TableRow key={b.id}>
                                        <TableCell className="text-sm">{(b as any).settlement_label ?? "—"}</TableCell>
                                        <TableCell className="text-sm font-mono">{b.export_system}</TableCell>
                                        <TableCell className="text-sm">{fmtDate(b.exported_at)}</TableCell>
                                        <TableCell className="text-right">{b.row_count}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground font-mono">{b.file_reference ?? "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant={b.status === "exported" ? "default" : b.status === "error" ? "destructive" : "secondary"}>
                                                {b.status === "exported" ? "Eksporteret" : b.status === "error" ? "Fejl" : "Afventer"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 px-2 text-xs"
                                                onClick={() => {
                                                    window.location.href = `/api/rettighedsmidler/eksport?batch_id=${b.id}`
                                                }}
                                            >
                                                <Download className="mr-1 h-3 w-3" />
                                                Download
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>

                {/* DataLøn-referencer */}
                <TabsContent value="referencer" className="mt-4">
                    {references.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">
                            Ingen DataLøn-referencer registreret. Tilføj modtager-ID'er fra lønsystemet for at aktivere eksport.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>System</TableHead>
                                    <TableHead>Modtager-ID</TableHead>
                                    <TableHead>Aktiv</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {references.map(r => (
                                    <TableRow key={r.id} className={r.active ? "" : "opacity-50"}>
                                        <TableCell className="font-medium text-sm">{r.rights_holder_name ?? "—"}</TableCell>
                                        <TableCell className="text-sm font-mono">{r.system}</TableCell>
                                        <TableCell className="text-sm font-mono">{r.recipient_id}</TableCell>
                                        <TableCell>
                                            <Badge variant={r.active ? "default" : "outline"}>
                                                {r.active ? "Aktiv" : "Inaktiv"}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>
            </Tabs>

            {newOpen && (
                <NewSettlementDialog onClose={() => setNewOpen(false)} onSaved={load} />
            )}
            {thresholdOpen && (
                <ThresholdDialog
                    current={threshold}
                    currency={currency}
                    onClose={() => setThresholdOpen(false)}
                    onSaved={load}
                />
            )}
        </div>
    )
}
