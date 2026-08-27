"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
    ArrowLeft, Plus, CheckCircle2, Clock, Ban, BookOpen,
    AlertTriangle, RotateCcw, ChevronDown, ChevronUp
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { getCalculationRun, advanceCalculationRunStatus, getWorkAllocations } from "@/app/actions/rights-calculation"
import type { CalculationRun, WorkAllocation } from "@/app/actions/rights-calculation"
import { RightsAllocationsPanel } from "@/components/admin/rights-allocations-panel"
import { RightsReservesPanel } from "@/components/admin/rights-reserves-panel"
import { createRightsAllocations, type AllocationInput } from "@/app/actions/rights-allocations"
import Link from "next/link"

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function formatMinor(amount: number | bigint, currency = "DKK"): string {
    return (Number(amount) / 100).toLocaleString("da-DK", {
        style: "currency", currency, minimumFractionDigits: 2,
    })
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
}

const STATUS_CONFIG: Record<string, {
    label: string; variant: "default" | "secondary" | "outline"; icon: React.ElementType
}> = {
    draft:             { label: "Kladde",            variant: "outline",   icon: Clock },
    calculated:        { label: "Beregnet",          variant: "secondary", icon: CheckCircle2 },
    awaiting_approval: { label: "Afventer godkend.", variant: "secondary", icon: Clock },
    approved:          { label: "Godkendt",          variant: "default",   icon: CheckCircle2 },
    booked:            { label: "Booket",            variant: "default",   icon: BookOpen },
    cancelled:         { label: "Annulleret",        variant: "outline",   icon: Ban },
}

const NEXT_STATUS: Record<string, string> = {
    draft: "calculated", calculated: "awaiting_approval",
    awaiting_approval: "approved", approved: "booked",
}

const NEXT_LABEL: Record<string, string> = {
    calculated: "Markér beregnet", awaiting_approval: "Send til godkendelse",
    approved: "Godkend", booked: "Bogfør",
}

// ── Fordel-dialog (hurtigfordeling til enkelt person) ─────────────────────────

function QuickAllocateDialog({
    workAllocation,
    runId,
    currency,
    onClose,
    onSaved,
}: {
    workAllocation: WorkAllocation
    runId: string
    currency: string
    onClose: () => void
    onSaved: () => void
}) {
    const [rightsHolders, setRightsHolders] = useState<{ id: string; full_name: string }[]>([])
    const [rhId, setRhId] = useState("")
    const [roleLabel, setRoleLabel] = useState("Klipper")
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        import("@/lib/supabase/client").then(async ({ createClient }) => {
            const db = createClient()
            const { data } = await db.from("rettighedshavere").select("id, full_name").order("full_name")
            setRightsHolders(data ?? [])
        })
    }, [])

    const handleSave = async () => {
        if (!rhId) { toast.error("Vælg en rettighedshaver"); return }
        setSaving(true)
        const items: AllocationInput[] = [{ work_allocation_id: workAllocation.id, rights_holder_id: rhId, role_label: roleLabel, share_bps: 10000 }]
        const res = await createRightsAllocations(runId, workAllocation.id, items)
        if (res.success) {
            toast.success(res.withheldCount
                ? "Positionen er tilbageholdt, indtil rettighedsforbeholdet er dokumenteret"
                : "Fordeling gemt")
            onSaved(); onClose()
        }
        else toast.error(res.error ?? "Fejl")
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Tildel til rettighedshaver</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                        {workAllocation.work_title ?? workAllocation.episode_title ?? "Ukendt"}
                        {" — "}
                        {formatMinor(workAllocation.individual_net, currency)} individuelt
                    </p>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <Label>Rettighedshaver</Label>
                        <select
                            className="w-full text-sm rounded border px-2 py-2 bg-background"
                            value={rhId}
                            onChange={e => setRhId(e.target.value)}
                        >
                            <option value="">Vælg…</option>
                            {rightsHolders.map(rh => (
                                <option key={rh.id} value={rh.id}>{rh.full_name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-muted-foreground">Hele beløbet tildeles denne person (100%).</p>
                    </div>
                    <div className="space-y-1">
                        <Label>Rolle</Label>
                        <Input value={roleLabel} onChange={e => setRoleLabel(e.target.value)} placeholder="Klipper" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving || !rhId}>
                        {saving ? "Gemmer…" : "Gem tildeling"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Beregningsrunde-detaljer ──────────────────────────────────────────────────

export default function CalculationRunDetailPage() {
    const params = useParams()
    const router = useRouter()
    const runId = params.id as string

    const [run, setRun] = useState<CalculationRun | null>(null)
    const [allocations, setAllocations] = useState<WorkAllocation[]>([])
    const [loading, setLoading] = useState(true)
    const [advancing, setAdvancing] = useState(false)
    const [breakdownOpen, setBreakdownOpen] = useState(false)
    const [quickAllocate, setQuickAllocate] = useState<WorkAllocation | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const [runRes, wRes] = await Promise.all([
            getCalculationRun(runId),
            getWorkAllocations(runId),
        ])
        if (runRes.success && runRes.run) setRun(runRes.run)
        else toast.error("Kunne ikke hente beregningsrunde")
        if (wRes.success) setAllocations(wRes.allocations)
        setLoading(false)
    }, [runId])

    useEffect(() => { load() }, [load])

    const handleAdvance = async () => {
        if (!run) return
        const next = NEXT_STATUS[run.status]
        if (!next) return
        setAdvancing(true)
        const res = await advanceCalculationRunStatus(run.id, next as any)
        if (res.success) { toast.success("Status opdateret"); load() }
        else toast.error(res.error ?? "Fejl")
        setAdvancing(false)
    }

    const handleCancel = async () => {
        if (!run || run.status === "booked") return
        setAdvancing(true)
        const res = await advanceCalculationRunStatus(run.id, "cancelled")
        if (res.success) { toast.success("Runde annulleret"); router.push("/admin/rettighedsmidler") }
        else toast.error(res.error ?? "Fejl")
        setAdvancing(false)
    }

    if (loading) return (
        <div className="space-y-4">
            <PageHeader title="Beregningsrunde" subtitle="Henter…" />
        </div>
    )

    if (!run) return (
        <div className="space-y-4">
            <PageHeader title="Beregningsrunde" subtitle="Ikke fundet" />
            <Button variant="outline" onClick={() => router.push("/admin/rettighedsmidler")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Tilbage
            </Button>
        </div>
    )

    const cfg = STATUS_CONFIG[run.status] ?? { label: run.status, variant: "outline" as const, icon: Clock }
    const StatusIcon = cfg.icon
    const nextStatus = NEXT_STATUS[run.status]
    const canEdit = !["booked", "cancelled"].includes(run.status)

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => router.push("/admin/rettighedsmidler")}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Rettighedsmidler
                </Button>
            </div>

            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{run.period_label}</h1>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-sm text-muted-foreground">
                            {run.fund_name ?? run.fund_code} · v{run.policy_version_number}
                        </p>
                        <Badge variant={cfg.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {cfg.label}
                        </Badge>
                    </div>
                    {run.source_batch_ref && (
                        <p className="text-xs text-muted-foreground mt-0.5">{run.source_batch_ref}</p>
                    )}
                </div>
                <div className="flex gap-2">
                    {run.status !== "booked" && run.status !== "cancelled" && (
                        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={advancing}>
                            <Ban className="h-3.5 w-3.5 mr-1" />
                            Annullér
                        </Button>
                    )}
                    {nextStatus && (
                        <Button size="sm" onClick={handleAdvance} disabled={advancing}>
                            {advancing ? "…" : NEXT_LABEL[nextStatus] ?? nextStatus}
                        </Button>
                    )}
                </div>
            </div>

            {/* Beløbsnedbrydning */}
            <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
                <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1">
                        {breakdownOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        Beløbsnedbrydning
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="mt-3 rounded-md border p-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                        {[
                            ["Bruttobeløb", run.gross_amount],
                            ["Administration", run.admin_amount],
                            ["Fordelingsgrundlag", run.distribution_basis],
                            ["SKU direkte", run.sku_direct_amount],
                            ["Kravsreserve", run.claim_reserve_amount],
                            ["SKU fra reserve", run.sku_from_reserve_amount],
                            ["Lovpligtig kollektiv", run.statutory_collective_amount],
                            ["Netto kravsreserve", run.net_claim_reserve_amount],
                            ["Individuelt", run.individual_amount],
                        ].map(([label, amount]) => (
                            <div key={label as string} className="flex justify-between border-b py-1 last:border-0">
                                <span className="text-muted-foreground">{label}</span>
                                <span className="font-mono">{formatMinor(amount as bigint, run.currency)}</span>
                            </div>
                        ))}
                    </div>
                </CollapsibleContent>
            </Collapsible>

            <Separator />

            {/* Værkbeløb */}
            <div>
                <h2 className="text-lg font-semibold mb-3">
                    Værkbeløb ({allocations.length})
                </h2>
                {allocations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Ingen værkbeløb endnu. Importér dem via API.
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Værk / episode</TableHead>
                                <TableHead>Brugsår</TableHead>
                                <TableHead>Kravfrist</TableHead>
                                <TableHead className="text-right">Brutto</TableHead>
                                <TableHead className="text-right">Individuelt</TableHead>
                                <TableHead>Status</TableHead>
                                {canEdit && <TableHead />}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {allocations.map(wa => (
                                <TableRow key={wa.id}>
                                    <TableCell className="font-medium text-sm">
                                        {wa.episode_title ?? wa.work_title ?? (wa.source_ref ?? "—")}
                                    </TableCell>
                                    <TableCell className="text-sm">{wa.usage_year}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {formatDate(wa.claim_deadline)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {formatMinor(wa.gross_share, wa.currency)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {formatMinor(wa.individual_net, wa.currency)}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={wa.status === "distributed" ? "default" : "secondary"}>
                                            {wa.status === "pending" ? "Afventer"
                                             : wa.status === "distributed" ? "Fordelt"
                                             : wa.status}
                                        </Badge>
                                    </TableCell>
                                    {canEdit && (
                                        <TableCell className="text-right">
                                            {wa.status === "pending" && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setQuickAllocate(wa)}
                                                >
                                                    <Plus className="h-3 w-3 mr-1" />
                                                    Tildel
                                                </Button>
                                            )}
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <Separator />

            {/* Personfordeling */}
            <div>
                <h2 className="text-lg font-semibold mb-3">Personfordeling</h2>
                <RightsAllocationsPanel
                    runId={runId}
                    currency={run.currency}
                    runStatus={run.status}
                />
            </div>

            <Separator />

            {/* Reserve og krav */}
            <div>
                <h2 className="text-lg font-semibold mb-3">Reserve & krav</h2>
                <RightsReservesPanel
                    runId={runId}
                    fundId={run.fund_id}
                    currency={run.currency}
                    runStatus={run.status}
                />
            </div>

            {quickAllocate && (
                <QuickAllocateDialog
                    workAllocation={quickAllocate}
                    runId={runId}
                    currency={run.currency}
                    onClose={() => setQuickAllocate(null)}
                    onSaved={load}
                />
            )}
        </div>
    )
}
