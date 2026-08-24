"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, ChevronRight, CheckCircle2, Clock, Ban, BookOpen, RotateCcw } from "lucide-react"
import { PageHeader } from "@/components/page-header"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { getRightsFunds, getPolicyVersions } from "@/app/actions/rights-funds"
import type { RightsFund, PolicyVersionWithComponents } from "@/app/actions/rights-funds"
import {
    getCalculationRuns,
    createCalculationRun,
    advanceCalculationRunStatus,
} from "@/app/actions/rights-calculation"
import type { CalculationRun, CalculationRunStatus } from "@/app/actions/rights-calculation"

// ── Hjælpere ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<CalculationRunStatus, {
    label: string
    variant: "default" | "secondary" | "outline"
    icon: React.ElementType
}> = {
    draft:             { label: "Kladde",            variant: "outline",    icon: Clock },
    calculated:        { label: "Beregnet",          variant: "secondary",  icon: CheckCircle2 },
    awaiting_approval: { label: "Afventer godkend.", variant: "secondary",  icon: Clock },
    approved:          { label: "Godkendt",          variant: "default",    icon: CheckCircle2 },
    booked:            { label: "Booket",            variant: "default",    icon: BookOpen },
    cancelled:         { label: "Annulleret",        variant: "outline",    icon: Ban },
}

function formatMinor(amount: number | bigint, currency = "DKK"): string {
    return (Number(amount) / 100).toLocaleString("da-DK", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
    })
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
}

// ── Ny beregningsrunde-dialog ─────────────────────────────────────────────────

function NewRunDialog({
    open,
    onClose,
    onCreated,
}: {
    open: boolean
    onClose: () => void
    onCreated: () => void
}) {
    const [funds, setFunds] = useState<RightsFund[]>([])
    const [selectedFundId, setSelectedFundId] = useState("")
    const [versions, setVersions] = useState<PolicyVersionWithComponents[]>([])
    const [selectedVersionId, setSelectedVersionId] = useState("")
    const [form, setForm] = useState({
        period_label: "",
        period_from: "",
        period_to: "",
        gross_kr: "",          // indtastes i kroner, konverteres til øre
        source_batch_ref: "",
        notes: "",
    })
    const [saving, setSaving] = useState(false)
    const [loadingVersions, setLoadingVersions] = useState(false)

    useEffect(() => {
        getRightsFunds().then(res => {
            if (res.success) setFunds(res.funds.filter(f => f.active))
        })
    }, [])

    useEffect(() => {
        if (!selectedFundId) { setVersions([]); return }
        // Find politikker for kassen og hent aktive versioner
        setLoadingVersions(true)
        setSelectedVersionId("")
        // Vi har ikke getDistributionPolicies direkte her — henter via fund_id
        // ved at søge på tværs af alle politikker for kassen
        import("@/app/actions/rights-funds").then(async ({ getDistributionPolicies, getPolicyVersions }) => {
            const pRes = await getDistributionPolicies(selectedFundId)
            if (!pRes.success || pRes.policies.length === 0) {
                setVersions([])
                setLoadingVersions(false)
                return
            }
            // Saml alle aktive versioner på tværs af politikker
            const allActive: PolicyVersionWithComponents[] = []
            for (const policy of pRes.policies) {
                const vRes = await getPolicyVersions(policy.id)
                if (vRes.success) {
                    allActive.push(...vRes.versions.filter(v => v.status === "active"))
                }
            }
            setVersions(allActive)
            if (allActive.length === 1) setSelectedVersionId(allActive[0].id)
            setLoadingVersions(false)
        })
    }, [selectedFundId])

    const handleSave = async () => {
        if (!selectedFundId || !selectedVersionId || !form.period_label || !form.gross_kr) {
            toast.error("Kasse, politikversion, periodemærkat og bruttobeløb er påkrævet")
            return
        }
        const gross = Math.round(parseFloat(form.gross_kr.replace(",", ".")) * 100)
        if (isNaN(gross) || gross <= 0) {
            toast.error("Bruttobeløb skal være et positivt tal")
            return
        }
        setSaving(true)
        try {
            const res = await createCalculationRun({
                fund_id: selectedFundId,
                policy_version_id: selectedVersionId,
                period_label: form.period_label,
                period_from: form.period_from || null,
                period_to: form.period_to || null,
                gross_amount_minor: gross,
                source_batch_ref: form.source_batch_ref || null,
                notes: form.notes || null,
            })
            if (!res.success) throw new Error(res.error)
            toast.success("Beregningsrunde oprettet som kladde")
            onCreated()
            onClose()
        } catch (err) {
            toast.error("Kunne ikke oprette: " + String(err))
        } finally {
            setSaving(false)
        }
    }

    const selectedVersion = versions.find(v => v.id === selectedVersionId)
    const selectedFund = funds.find(f => f.id === selectedFundId)

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Ny beregningsrunde</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <Label>Rettighedskasse</Label>
                        <Select value={selectedFundId} onValueChange={setSelectedFundId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Vælg kasse…" />
                            </SelectTrigger>
                            <SelectContent>
                                {funds.map(f => (
                                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label>Politikversion (aktiv)</Label>
                        {loadingVersions ? (
                            <p className="text-xs text-muted-foreground">Henter versioner…</p>
                        ) : versions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                {selectedFundId
                                    ? "Ingen aktive politikversioner — aktivér en version under Stamdata → Fordelingspolitikker"
                                    : "Vælg en kasse først"}
                            </p>
                        ) : (
                            <Select value={selectedVersionId} onValueChange={setSelectedVersionId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Vælg version…" />
                                </SelectTrigger>
                                <SelectContent>
                                    {versions.map(v => (
                                        <SelectItem key={v.id} value={v.id}>
                                            v{v.version_number} — admin {(v.admin_rate_bps / 100).toFixed(2)} %
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {selectedVersion && (
                        <div className="rounded-md border p-3 text-xs space-y-1 bg-muted/30">
                            <p className="font-medium">Satser i denne version</p>
                            <p>Administration: {(selectedVersion.admin_rate_bps / 100).toFixed(2)} %</p>
                            {selectedVersion.components.filter(c => c.active).map((c, i) => (
                                <p key={i} className="pl-2 text-muted-foreground">
                                    {c.label ?? c.component_type}: {(c.rate_bps / 100).toFixed(2)} %
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label>Periodemærkat</Label>
                        <Input
                            placeholder="fx Copydan Verdens TV 2024"
                            value={form.period_label}
                            onChange={e => setForm(f => ({ ...f, period_label: e.target.value }))}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>Periode fra <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                type="date"
                                value={form.period_from}
                                onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Periode til <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                type="date"
                                value={form.period_to}
                                onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label>Bruttobeløb (kr.)</Label>
                        <Input
                            placeholder="fx 125000.00"
                            value={form.gross_kr}
                            onChange={e => setForm(f => ({ ...f, gross_kr: e.target.value }))}
                        />
                        <p className="text-xs text-muted-foreground">
                            Beløbet fordeles automatisk efter den valgte politikversion.
                            {selectedFund && ` Valuta: ${selectedFund.currency}`}
                        </p>
                    </div>

                    <div className="space-y-1">
                        <Label>Kildereference <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input
                            placeholder="fx Copydan-afregning 2024"
                            value={form.source_batch_ref}
                            onChange={e => setForm(f => ({ ...f, source_batch_ref: e.target.value }))}
                        />
                    </div>

                    <div className="space-y-1">
                        <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input
                            value={form.notes}
                            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving || versions.length === 0}>
                        {saving ? "Opretter…" : "Opret kladde"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Beregningsrunde-række ─────────────────────────────────────────────────────

function RunRow({ run, onRefresh }: { run: CalculationRun; onRefresh: () => void }) {
    const router = useRouter()
    const [advancing, setAdvancing] = useState(false)
    const cfg = STATUS_CONFIG[run.status] ?? { label: run.status, variant: "outline" as const, icon: Clock }
    const Icon = cfg.icon

    const nextStatus = (): Exclude<CalculationRunStatus, "draft"> | null => {
        switch (run.status) {
            case "draft":             return "calculated"
            case "calculated":        return "awaiting_approval"
            case "awaiting_approval": return "approved"
            case "approved":          return "booked"
            default:                  return null
        }
    }

    const nextLabel: Record<string, string> = {
        calculated:        "Markér beregnet",
        awaiting_approval: "Send til godkendelse",
        approved:          "Godkend",
        booked:            "Bogfør",
    }

    const handleAdvance = async () => {
        const next = nextStatus()
        if (!next) return
        setAdvancing(true)
        const res = await advanceCalculationRunStatus(run.id, next)
        if (res.success) {
            toast.success("Status opdateret")
            onRefresh()
        } else {
            toast.error(res.error ?? "Kunne ikke opdatere status")
        }
        setAdvancing(false)
    }

    const handleCancel = async () => {
        if (run.status === "booked") return
        setAdvancing(true)
        const res = await advanceCalculationRunStatus(run.id, "cancelled")
        if (res.success) {
            toast.success("Runde annulleret")
            onRefresh()
        } else {
            toast.error(res.error ?? "Kunne ikke annullere")
        }
        setAdvancing(false)
    }

    const next = nextStatus()

    return (
        <TableRow
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => router.push(`/admin/rettighedsmidler/${run.id}`)}
        >
            <TableCell>
                <div>
                    <p className="font-medium text-sm">{run.period_label}</p>
                    {run.source_batch_ref && (
                        <p className="text-xs text-muted-foreground">{run.source_batch_ref}</p>
                    )}
                </div>
            </TableCell>
            <TableCell className="text-sm">{run.fund_name ?? run.fund_code}</TableCell>
            <TableCell className="text-sm">v{run.policy_version_number}</TableCell>
            <TableCell>
                <Badge variant={cfg.variant} className="gap-1">
                    <Icon className="h-3 w-3" />
                    {cfg.label}
                </Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-sm">
                {formatMinor(run.gross_amount, run.currency)}
            </TableCell>
            <TableCell className="text-right font-mono text-sm">
                {formatMinor(run.individual_amount, run.currency)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
                {formatDate(run.created_at)}
            </TableCell>
            <TableCell className="text-right space-x-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                {next && run.status !== "cancelled" && (
                    <Button size="sm" variant="outline" onClick={handleAdvance} disabled={advancing}>
                        {advancing ? "…" : nextLabel[next] ?? next}
                    </Button>
                )}
                {run.status !== "booked" && run.status !== "cancelled" && (
                    <Button size="sm" variant="ghost" onClick={handleCancel} disabled={advancing}>
                        <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                )}
            </TableCell>
        </TableRow>
    )
}

// ── Hoved-side ────────────────────────────────────────────────────────────────

export default function RettighedsmidlerPage() {
    const [runs, setRuns] = useState<CalculationRun[]>([])
    const [loading, setLoading] = useState(true)
    const [newRunOpen, setNewRunOpen] = useState(false)
    const [filterStatus, setFilterStatus] = useState<string>("active")

    const load = useCallback(async () => {
        setLoading(true)
        const res = await getCalculationRuns()
        if (res.success) setRuns(res.runs)
        else toast.error("Kunne ikke hente beregningsrunder")
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])

    const activeRuns = runs.filter(r => !["booked", "cancelled"].includes(r.status))
    const completedRuns = runs.filter(r => r.status === "booked")
    const cancelledRuns = runs.filter(r => r.status === "cancelled")

    const displayedRuns = filterStatus === "active"
        ? activeRuns
        : filterStatus === "booked"
        ? completedRuns
        : cancelledRuns

    return (
        <div className="space-y-6">
            <PageHeader
                title="Rettighedsmidler"
                subtitle="Beregningsrunder, værkbeløb og personfordeling"
            />

            {/* Overblik-kort */}
            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Aktive runder</p>
                    <p className="text-2xl font-bold">{activeRuns.length}</p>
                </div>
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Bookede runder</p>
                    <p className="text-2xl font-bold">{completedRuns.length}</p>
                </div>
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Samlet individuelt (bookede)</p>
                    <p className="text-2xl font-bold">
                        {formatMinor(
                            completedRuns.reduce((s, r) => s + Number(r.individual_amount), 0)
                        )}
                    </p>
                </div>
            </div>

            {/* Handlinger */}
            <div className="flex items-center justify-between">
                <div className="flex gap-2">
                    {(["active", "booked", "cancelled"] as const).map(s => (
                        <Button
                            key={s}
                            size="sm"
                            variant={filterStatus === s ? "default" : "outline"}
                            onClick={() => setFilterStatus(s)}
                        >
                            {s === "active" ? `Aktive (${activeRuns.length})`
                             : s === "booked" ? `Bookede (${completedRuns.length})`
                             : `Annullerede (${cancelledRuns.length})`}
                        </Button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => router.push("/admin/rettighedsmidler/afregning")}>
                        Afregning
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => router.push("/admin/rettighedsmidler/efterlysninger")}>
                        Efterlysninger
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => router.push("/admin/rettighedsmidler/notifikationer")}>
                        Notifikationer
                    </Button>
                    <Button size="sm" variant="outline" onClick={load}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        Opdater
                    </Button>
                    <Button size="sm" onClick={() => setNewRunOpen(true)}>
                        <Plus className="h-4 w-4 mr-1" />
                        Ny beregningsrunde
                    </Button>
                </div>
            </div>

            {/* Tabel */}
            {loading ? (
                <p className="text-sm text-muted-foreground py-4">Henter beregningsrunder…</p>
            ) : displayedRuns.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                    <p className="text-sm text-muted-foreground">
                        {filterStatus === "active"
                            ? "Ingen aktive beregningsrunder. Opret den første ved at klikke \"Ny beregningsrunde\"."
                            : "Ingen runder i denne kategori."}
                    </p>
                    {filterStatus === "active" && (
                        <p className="text-xs text-muted-foreground mt-2">
                            Kræver mindst én aktiv rettighedskasse og én aktiv politikversion under{" "}
                            <Link href="/admin/stamdata" className="underline">Stamdata</Link>.
                        </p>
                    )}
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Periode</TableHead>
                            <TableHead>Kasse</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Brutto</TableHead>
                            <TableHead className="text-right">Individuelt</TableHead>
                            <TableHead>Oprettet</TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {displayedRuns.map(run => (
                            <RunRow key={run.id} run={run} onRefresh={load} />
                        ))}
                    </TableBody>
                </Table>
            )}

            <NewRunDialog
                open={newRunOpen}
                onClose={() => setNewRunOpen(false)}
                onCreated={load}
            />
        </div>
    )
}
