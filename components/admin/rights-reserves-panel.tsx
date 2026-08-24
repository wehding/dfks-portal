"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, CheckCircle2, XCircle, Clock, AlertTriangle, ArrowRightLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import {
    getReserveEntries, getRightsClaims, getUndistributableActions,
    createRightsClaim, reviewRightsClaim, createUndistributableAction,
    type ReserveEntry, type RightsClaim, type UndistributableAction,
} from "@/app/actions/rights-reserves"

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function fmt(amount: number, currency = "DKK") {
    return (amount / 100).toLocaleString("da-DK", { style: "currency", currency, minimumFractionDigits: 2 })
}

function fmtDate(iso: string | null | undefined) {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
    claim_reserve:           "Kravsreserve",
    sku_reserve:             "SKU-reserve",
    statutory_collective:    "Lovpligtig kollektiv",
    undistributable_transfer:"Udistrib. overførsel",
    release:                 "Frigivelse",
}

const CLAIM_STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    submitted:    { label: "Indsendt",        icon: Clock,         variant: "secondary" },
    under_review: { label: "Under behandling",icon: Clock,         variant: "secondary" },
    approved:     { label: "Godkendt",        icon: CheckCircle2,  variant: "default"   },
    rejected:     { label: "Afvist",          icon: XCircle,       variant: "destructive"},
    paid_out:     { label: "Udbetalt",        icon: CheckCircle2,  variant: "default"   },
}

const UNDISTRIB_LABELS: Record<string, string> = {
    transfer_to_collective: "Overført til kollektiv pulje",
    return_to_pool:         "Returneret til pulje",
    hold:                   "Beholdt i reserve",
}

// ── Sagsbehandlings-dialog ────────────────────────────────────────────────────

function ReviewClaimDialog({
    claim,
    onClose,
    onReviewed,
}: {
    claim: RightsClaim
    onClose: () => void
    onReviewed: () => void
}) {
    const [decision, setDecision] = useState<"approved" | "rejected">("approved")
    const [notes, setNotes] = useState("")
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        if (!notes.trim()) { toast.error("Angiv en begrundelse"); return }
        setSaving(true)
        const res = await reviewRightsClaim(claim.id, decision, notes)
        if (res.success) {
            toast.success(decision === "approved" ? "Krav godkendt" : "Krav afvist")
            onReviewed()
            onClose()
        } else {
            toast.error(res.error ?? "Fejl")
        }
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Behandl krav</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2 text-sm">
                    <div className="rounded-md border p-3 space-y-1">
                        <p><span className="text-muted-foreground">Rettighedshaver:</span> {claim.rights_holder_name}</p>
                        <p><span className="text-muted-foreground">Beløb:</span> {fmt(claim.claim_amount, claim.currency)}</p>
                        <p><span className="text-muted-foreground">Indsendt:</span> {fmtDate(claim.submitted_at)}</p>
                        <p className="flex items-center gap-1">
                            <span className="text-muted-foreground">Rettidigt:</span>
                            {claim.is_timely
                                ? <span className="text-green-600 font-medium">Ja</span>
                                : <span className="text-destructive font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Nej — for sent</span>}
                        </p>
                    </div>
                    <div className="space-y-1">
                        <Label>Afgørelse</Label>
                        <Select value={decision} onValueChange={v => setDecision(v as typeof decision)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="approved">Godkend</SelectItem>
                                <SelectItem value="rejected">Afvis</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Begrundelse</Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Fx: Krav modtaget inden for fristen og verificeret" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button
                        onClick={handleSave}
                        disabled={saving}
                        variant={decision === "rejected" ? "destructive" : "default"}
                    >
                        {saving ? "Gemmer…" : decision === "approved" ? "Godkend" : "Afvis"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Nyt krav-dialog ───────────────────────────────────────────────────────────

function NewClaimDialog({
    runId,
    fundId,
    currency,
    onClose,
    onSaved,
}: {
    runId: string
    fundId: string
    currency: string
    onClose: () => void
    onSaved: () => void
}) {
    const [rightsHolders, setRightsHolders] = useState<{ id: string; full_name: string }[]>([])
    const [rhId, setRhId] = useState("")
    const [amountKr, setAmountKr] = useState("")
    const [notes, setNotes] = useState("")
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
        const amount = Math.round(parseFloat(amountKr.replace(",", ".")) * 100)
        if (isNaN(amount) || amount <= 0) { toast.error("Angiv et gyldigt beløb"); return }
        setSaving(true)
        const res = await createRightsClaim({
            fund_id: fundId,
            run_id: runId,
            rights_holder_id: rhId,
            claim_amount: amount,
            currency,
            notes: notes || null,
        })
        if (res.success) { toast.success("Krav registreret"); onSaved(); onClose() }
        else toast.error(res.error ?? "Fejl")
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Registrér krav</DialogTitle>
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
                    </div>
                    <div className="space-y-1">
                        <Label>Beløb (kr.)</Label>
                        <Input
                            value={amountKr}
                            onChange={e => setAmountKr(e.target.value)}
                            placeholder="fx 5000.00"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Gemmer…" : "Registrér krav"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Udistribueret-dialog ──────────────────────────────────────────────────────

function UndistributableDialog({
    runId,
    fundId,
    currency,
    onClose,
    onSaved,
}: {
    runId: string
    fundId: string
    currency: string
    onClose: () => void
    onSaved: () => void
}) {
    const [actionType, setActionType] = useState<"transfer_to_collective" | "return_to_pool" | "hold">("transfer_to_collective")
    const [amountKr, setAmountKr] = useState("")
    const [notes, setNotes] = useState("")
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        const amount = Math.round(parseFloat(amountKr.replace(",", ".")) * 100)
        if (isNaN(amount) || amount <= 0) { toast.error("Angiv et gyldigt beløb"); return }
        setSaving(true)
        const res = await createUndistributableAction({
            fund_id: fundId,
            run_id: runId,
            action_type: actionType,
            amount,
            currency,
            notes: notes || null,
        })
        if (res.success) { toast.success("Handling registreret"); onSaved(); onClose() }
        else toast.error(res.error ?? "Fejl")
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Registrér udistribueret handling</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <Label>Handlingstype</Label>
                        <Select value={actionType} onValueChange={v => setActionType(v as typeof actionType)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="transfer_to_collective">Overfør til kollektiv pulje</SelectItem>
                                <SelectItem value="return_to_pool">Returner til pulje</SelectItem>
                                <SelectItem value="hold">Behold i reserve</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Beløb (kr.)</Label>
                        <Input value={amountKr} onChange={e => setAmountKr(e.target.value)} placeholder="fx 12500.00" />
                    </div>
                    <div className="space-y-1">
                        <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Gemmer…" : "Registrér"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Hoved-panel ───────────────────────────────────────────────────────────────

export function RightsReservesPanel({
    runId,
    fundId,
    currency = "DKK",
    runStatus,
}: {
    runId: string
    fundId: string
    currency?: string
    runStatus: string
}) {
    const [entries, setEntries] = useState<ReserveEntry[]>([])
    const [claims, setClaims] = useState<RightsClaim[]>([])
    const [undistrib, setUndistrib] = useState<UndistributableAction[]>([])
    const [loading, setLoading] = useState(true)
    const [reviewClaim, setReviewClaim] = useState<RightsClaim | null>(null)
    const [newClaimOpen, setNewClaimOpen] = useState(false)
    const [undistribOpen, setUndistribOpen] = useState(false)

    const canEdit = !["cancelled"].includes(runStatus)

    const load = useCallback(async () => {
        setLoading(true)
        const [eRes, cRes, uRes] = await Promise.all([
            getReserveEntries(runId),
            getRightsClaims(undefined, runId),
            getUndistributableActions(runId),
        ])
        if (eRes.success) setEntries(eRes.entries)
        if (cRes.success) setClaims(cRes.claims)
        if (uRes.success) setUndistrib(uRes.actions)
        setLoading(false)
    }, [runId])

    useEffect(() => { load() }, [load])

    const pendingClaims = claims.filter(c => ["submitted", "under_review"].includes(c.status))
    const totalReserve = entries
        .filter(e => e.entry_type !== "release")
        .reduce((s, e) => s + e.amount, 0)
    const totalReleased = entries
        .filter(e => e.entry_type === "release")
        .reduce((s, e) => s + e.amount, 0)

    if (loading) return <p className="text-sm text-muted-foreground py-4">Henter reserve og krav…</p>

    return (
        <div className="space-y-4">
            {/* Overblik */}
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Hensatte midler</p>
                    <p className="text-xl font-bold">{fmt(totalReserve, currency)}</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Frigivet</p>
                    <p className="text-xl font-bold">{fmt(totalReleased, currency)}</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Afventende krav</p>
                    <p className={`text-xl font-bold ${pendingClaims.length > 0 ? "text-amber-500" : ""}`}>
                        {pendingClaims.length}
                    </p>
                </div>
            </div>

            <Tabs defaultValue="krav">
                <TabsList>
                    <TabsTrigger value="krav">
                        Krav ({claims.length})
                        {pendingClaims.length > 0 && (
                            <span className="ml-1.5 rounded-full bg-amber-500 text-white text-xs px-1.5">
                                {pendingClaims.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="hensaettelser">
                        Hensættelsesposter ({entries.length})
                    </TabsTrigger>
                    <TabsTrigger value="udistribuerede">
                        Udistribuerede ({undistrib.length})
                    </TabsTrigger>
                </TabsList>

                {/* Krav */}
                <TabsContent value="krav" className="mt-3">
                    <div className="flex justify-end mb-3">
                        {canEdit && (
                            <Button size="sm" onClick={() => setNewClaimOpen(true)}>
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                Registrér krav
                            </Button>
                        )}
                    </div>
                    {claims.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">Ingen krav registreret.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>Indsendt</TableHead>
                                    <TableHead>Rettidigt</TableHead>
                                    <TableHead className="text-right">Beløb</TableHead>
                                    <TableHead>Status</TableHead>
                                    {canEdit && <TableHead />}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {claims.map(c => {
                                    const cfg = CLAIM_STATUS_CONFIG[c.status] ?? { label: c.status, icon: Clock, variant: "outline" as const }
                                    const Icon = cfg.icon
                                    return (
                                        <TableRow key={c.id}>
                                            <TableCell className="font-medium text-sm">
                                                {c.rights_holder_name ?? "—"}
                                                {c.member_number && (
                                                    <span className="text-xs text-muted-foreground ml-1">#{c.member_number}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm">{fmtDate(c.submitted_at)}</TableCell>
                                            <TableCell>
                                                {c.is_timely
                                                    ? <span className="text-green-600 text-xs font-medium">Ja</span>
                                                    : <span className="text-destructive text-xs font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Nej</span>}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-sm">
                                                {fmt(c.claim_amount, c.currency)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={cfg.variant} className="gap-1">
                                                    <Icon className="h-3 w-3" />
                                                    {cfg.label}
                                                </Badge>
                                            </TableCell>
                                            {canEdit && (
                                                <TableCell className="text-right">
                                                    {["submitted", "under_review"].includes(c.status) && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => setReviewClaim(c)}
                                                        >
                                                            Behandl
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>

                {/* Hensættelsesposter */}
                <TabsContent value="hensaettelser" className="mt-3">
                    {entries.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">
                            Ingen hensættelsesposter. De oprettes automatisk ved bogføring af beregningsrunden.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Referencedato</TableHead>
                                    <TableHead>Kravfrist</TableHead>
                                    <TableHead className="text-right">Beløb</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {entries.map(e => (
                                    <TableRow key={e.id}>
                                        <TableCell className="text-sm">
                                            {ENTRY_TYPE_LABELS[e.entry_type] ?? e.entry_type}
                                        </TableCell>
                                        <TableCell className="text-sm">{fmtDate(e.reference_date)}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {fmtDate(e.claim_deadline)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {fmt(e.amount, e.currency)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>

                {/* Udistribuerede */}
                <TabsContent value="udistribuerede" className="mt-3">
                    <div className="flex justify-end mb-3">
                        {canEdit && runStatus === "booked" && (
                            <Button size="sm" variant="outline" onClick={() => setUndistribOpen(true)}>
                                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                                Registrér handling
                            </Button>
                        )}
                    </div>
                    {undistrib.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">
                            Ingen registrerede handlinger på udistribuerede midler.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Handling</TableHead>
                                    <TableHead>Dato</TableHead>
                                    <TableHead className="text-right">Beløb</TableHead>
                                    <TableHead>Noter</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {undistrib.map(u => (
                                    <TableRow key={u.id}>
                                        <TableCell className="text-sm">
                                            {UNDISTRIB_LABELS[u.action_type] ?? u.action_type}
                                        </TableCell>
                                        <TableCell className="text-sm">{fmtDate(u.actioned_at)}</TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {fmt(u.amount, u.currency)}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {u.notes ?? "—"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TabsContent>
            </Tabs>

            {reviewClaim && (
                <ReviewClaimDialog
                    claim={reviewClaim}
                    onClose={() => setReviewClaim(null)}
                    onReviewed={load}
                />
            )}
            {newClaimOpen && (
                <NewClaimDialog
                    runId={runId}
                    fundId={fundId}
                    currency={currency}
                    onClose={() => setNewClaimOpen(false)}
                    onSaved={load}
                />
            )}
            {undistribOpen && (
                <UndistributableDialog
                    runId={runId}
                    fundId={fundId}
                    currency={currency}
                    onClose={() => setUndistribOpen(false)}
                    onSaved={load}
                />
            )}
        </div>
    )
}
