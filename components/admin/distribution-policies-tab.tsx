"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, ChevronDown, ChevronRight, CheckCircle2, Clock, Archive, Eye, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import { toast } from "sonner"
import {
    getRightsFunds,
    getDistributionPolicies,
    createDistributionPolicy,
    getPolicyVersions,
    createPolicyVersion,
    activatePolicyVersion,
} from "@/app/actions/rights-funds"
import { computePolicyPreview } from "@/lib/rights-policy-preview"
import type {
    RightsFund,
    DistributionPolicy,
    PolicyVersionWithComponents,
    PolicyComponent,
} from "@/app/actions/rights-funds"

// ── Hjælpere ─────────────────────────────────────────────────────────────────

const VERSION_STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    draft:      { label: "Kladde",    variant: "outline" },
    preview:    { label: "Preview",   variant: "secondary" },
    active:     { label: "Aktiv",     variant: "default" },
    superseded: { label: "Erstattet", variant: "outline" },
    archived:   { label: "Arkiveret", variant: "outline" },
}

const COMPONENT_TYPE_LABELS: Record<string, string> = {
    CLAIM_RESERVE:            "Kravshensættelse",
    SKU_DIRECT:               "Socialt bidrag (direkte)",
    SKU_FROM_RESERVE:         "Socialt bidrag (fra hensættelse)",
    STATUTORY_COLLECTIVE_SHARE: "Lovbestemt kollektiv andel",
}

const BASIS_LABELS: Record<string, string> = {
    GROSS:                 "Bruttovederlag",
    AFTER_ADMIN:           "Efter administration",
    ORIGINAL_CLAIM_RESERVE: "Samlet hensættelse (uopdelt)",
    REMAINING_INDIVIDUAL:  "Resterende individuelt",
}

function bpsToPercent(bps: number): string {
    return (bps / 100).toFixed(2) + " %"
}

function formatMinor(amount: number): string {
    return (amount / 100).toLocaleString("da-DK", { style: "currency", currency: "DKK" })
}

// ── Beregningspreview ─────────────────────────────────────────────────────────

function PolicyPreview({
    admin_rate_bps,
    components,
}: {
    admin_rate_bps: number
    components: Omit<PolicyComponent, "id" | "org_id" | "policy_version_id">[]
}) {
    const [grossInput, setGrossInput] = useState("100000")
    const gross = Math.round(parseFloat(grossInput.replace(",", ".")) * 100) || 0
    const preview = computePolicyPreview(gross, admin_rate_bps, components as PolicyComponent[])

    const row = (label: string, amount: number, indent = false, muted = false) => (
        <div className={`flex justify-between text-sm py-0.5 ${indent ? "pl-4" : ""} ${muted ? "text-muted-foreground" : ""}`}>
            <span>{label}</span>
            <span className="font-mono">{formatMinor(amount)}</span>
        </div>
    )

    return (
        <div className="space-y-3 rounded-md border p-4 bg-muted/30">
            <div className="flex items-center gap-2">
                <Label className="text-xs">Beregningspreview — bruttobeløb (kr.)</Label>
                <Input
                    className="w-32 h-7 text-sm"
                    value={grossInput}
                    onChange={e => setGrossInput(e.target.value)}
                />
            </div>
            <div className="divide-y">
                {row("Bruttobeløb", preview.gross)}
                {row("− Administration", preview.admin, true, true)}
                {row("= Fordelingsgrundlag", preview.distribution_basis)}
                {row("− Samlet hensættelse", preview.claim_reserve, true, true)}
                {preview.sku_from_reserve > 0 && row("  heraf social andel (SKU fra hensættelse)", preview.sku_from_reserve, true, true)}
                {row("  heraf ren kravshensættelse", preview.net_claim_reserve, true, true)}
                {preview.sku_direct > 0 && row("− Direkte socialt bidrag", preview.sku_direct, true, true)}
                {preview.statutory_collective > 0 && row("− Lovbestemt kollektiv andel", preview.statutory_collective, true, true)}
                {row("= Individuel fordeling", preview.individual)}
            </div>
            {!preview.invariant_ok && (
                <p className="text-xs text-destructive">
                    Advarsel: beløbene summerer ikke til brutto — tjek afrunding og satser.
                </p>
            )}
        </div>
    )
}

// ── Komponent-editor ──────────────────────────────────────────────────────────

const EMPTY_COMPONENT: Omit<PolicyComponent, "id" | "org_id" | "policy_version_id"> = {
    component_type: "CLAIM_RESERVE",
    sort_order: 1,
    rate_bps: 0,
    calculation_basis: "AFTER_ADMIN",
    is_statutory_collective: false,
    label: null,
    description: null,
    active: true,
}

function ComponentEditor({
    components,
    onChange,
}: {
    components: Omit<PolicyComponent, "id" | "org_id" | "policy_version_id">[]
    onChange: (components: Omit<PolicyComponent, "id" | "org_id" | "policy_version_id">[]) => void
}) {
    const add = () => {
        onChange([...components, { ...EMPTY_COMPONENT, sort_order: components.length + 1 }])
    }

    const remove = (i: number) => {
        onChange(components.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, sort_order: idx + 1 })))
    }

    const update = (i: number, patch: Partial<typeof EMPTY_COMPONENT>) => {
        onChange(components.map((c, idx) => idx === i ? { ...c, ...patch } : c))
    }

    return (
        <div className="space-y-3">
            {components.map((c, i) => (
                <div key={i} className="rounded-md border p-3 space-y-2 bg-background">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Komponent {i + 1}</span>
                        <Button variant="ghost" size="sm" onClick={() => remove(i)}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label className="text-xs">Type</Label>
                            <Select
                                value={c.component_type}
                                onValueChange={v => update(i, {
                                    component_type: v as typeof c.component_type,
                                    calculation_basis: v === "SKU_FROM_RESERVE" ? "ORIGINAL_CLAIM_RESERVE" : "AFTER_ADMIN",
                                    is_statutory_collective: v === "STATUTORY_COLLECTIVE_SHARE",
                                })}
                            >
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(COMPONENT_TYPE_LABELS).map(([k, v]) => (
                                        <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Beregningsgrundlag</Label>
                            <Select
                                value={c.calculation_basis}
                                onValueChange={v => update(i, { calculation_basis: v as typeof c.calculation_basis })}
                                disabled={c.component_type === "SKU_FROM_RESERVE"}
                            >
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(BASIS_LABELS).map(([k, v]) => (
                                        <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Sats (bps — 100 bps = 1 %)</Label>
                            <Input
                                className="h-8 text-xs"
                                type="number"
                                min={0}
                                max={10000}
                                value={c.rate_bps}
                                onChange={e => update(i, { rate_bps: parseInt(e.target.value) || 0 })}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Label (valgfri)</Label>
                            <Input
                                className="h-8 text-xs"
                                placeholder="fx Uddannelsesfond"
                                value={c.label ?? ""}
                                onChange={e => update(i, { label: e.target.value || null })}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {bpsToPercent(c.rate_bps)} af {BASIS_LABELS[c.calculation_basis]}
                    </p>
                </div>
            ))}
            <Button variant="outline" size="sm" onClick={add} className="w-full">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Tilføj komponent
            </Button>
        </div>
    )
}

// ── Politikversion-dialog ─────────────────────────────────────────────────────

function NewVersionDialog({
    open,
    onClose,
    policyId,
    onCreated,
}: {
    open: boolean
    onClose: () => void
    policyId: string
    onCreated: () => void
}) {
    const [adminRateBps, setAdminRateBps] = useState(150)
    const [components, setComponents] = useState<Omit<PolicyComponent, "id" | "org_id" | "policy_version_id">[]>([])
    const [notes, setNotes] = useState("")
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        try {
            const res = await createPolicyVersion({
                policy_id: policyId,
                admin_rate_bps: adminRateBps,
                notes: notes || null,
                components,
            })
            if (!res.success) throw new Error(res.error)
            toast.success("Ny version oprettet som kladde")
            onCreated()
            onClose()
        } catch (err) {
            toast.error("Kunne ikke oprette version: " + String(err))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Ny politikversion</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <Label>Administrationsfradrag (bps — 100 bps = 1 %)</Label>
                        <Input
                            type="number"
                            min={0}
                            max={10000}
                            value={adminRateBps}
                            onChange={e => setAdminRateBps(parseInt(e.target.value) || 0)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Beregnes af brutto. {bpsToPercent(adminRateBps)}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>Komponenter</Label>
                        <ComponentEditor components={components} onChange={setComponents} />
                    </div>

                    <PolicyPreview admin_rate_bps={adminRateBps} components={components} />

                    <div className="space-y-1">
                        <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Opretter…" : "Opret kladde"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Policy-panel ──────────────────────────────────────────────────────────────

function PolicyPanel({ policy }: { policy: DistributionPolicy }) {
    const [expanded, setExpanded] = useState(false)
    const [versions, setVersions] = useState<PolicyVersionWithComponents[]>([])
    const [loadingVersions, setLoadingVersions] = useState(false)
    const [newVersionOpen, setNewVersionOpen] = useState(false)
    const [activating, setActivating] = useState<string | null>(null)

    const loadVersions = useCallback(async () => {
        setLoadingVersions(true)
        const res = await getPolicyVersions(policy.id)
        if (res.success) setVersions(res.versions)
        else toast.error("Kunne ikke hente versioner")
        setLoadingVersions(false)
    }, [policy.id])

    useEffect(() => {
        if (expanded) loadVersions()
    }, [expanded, loadVersions])

    const handleActivate = async (versionId: string) => {
        setActivating(versionId)
        const res = await activatePolicyVersion(versionId, policy.id)
        if (res.success) {
            toast.success("Version aktiveret")
            loadVersions()
        } else {
            toast.error(res.error ?? "Kunne ikke aktivere version")
        }
        setActivating(null)
    }

    return (
        <div className="rounded-md border">
            <button
                className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
                onClick={() => setExpanded(e => !e)}
            >
                <div>
                    <p className="font-medium text-sm">{policy.name}</p>
                    <p className="text-xs text-muted-foreground">
                        Gyldig fra {policy.valid_from}{policy.valid_to ? ` til ${policy.valid_to}` : " (løbende)"}
                        {" · "}{policy.claim_period_years} års kravsfrist
                    </p>
                </div>
                {expanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
            </button>

            {expanded && (
                <div className="border-t p-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Versioner</p>
                        <Button size="sm" variant="outline" onClick={() => setNewVersionOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Ny version
                        </Button>
                    </div>

                    {loadingVersions ? (
                        <p className="text-xs text-muted-foreground">Henter versioner…</p>
                    ) : versions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Ingen versioner endnu — opret den første.</p>
                    ) : (
                        <div className="space-y-2">
                            {versions.map(v => {
                                const cfg = VERSION_STATUS_CONFIG[v.status] ?? { label: v.status, variant: "outline" as const }
                                return (
                                    <div key={v.id} className="rounded border p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium">v{v.version_number}</span>
                                                <Badge variant={cfg.variant}>{cfg.label}</Badge>
                                                {v.used_in_calculation && (
                                                    <Badge variant="outline" className="text-xs">Brugt i beregning</Badge>
                                                )}
                                            </div>
                                            {(v.status === "draft" || v.status === "preview") && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleActivate(v.id)}
                                                    disabled={activating === v.id}
                                                >
                                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                                    {activating === v.id ? "Aktiverer…" : "Aktivér"}
                                                </Button>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground space-y-0.5">
                                            <p>Administration: {bpsToPercent(v.admin_rate_bps)}</p>
                                            {v.components.map((c, i) => (
                                                <p key={i} className="pl-3">
                                                    {COMPONENT_TYPE_LABELS[c.component_type] ?? c.component_type}
                                                    {c.label ? ` (${c.label})` : ""}: {bpsToPercent(c.rate_bps)} af {BASIS_LABELS[c.calculation_basis]}
                                                </p>
                                            ))}
                                        </div>
                                        <PolicyPreview
                                            admin_rate_bps={v.admin_rate_bps}
                                            components={v.components}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    <NewVersionDialog
                        open={newVersionOpen}
                        onClose={() => setNewVersionOpen(false)}
                        policyId={policy.id}
                        onCreated={loadVersions}
                    />
                </div>
            )}
        </div>
    )
}

// ── Hoved-tab ─────────────────────────────────────────────────────────────────

export function DistributionPoliciesTab() {
    const [funds, setFunds] = useState<RightsFund[]>([])
    const [selectedFundId, setSelectedFundId] = useState<string | null>(null)
    const [policies, setPolicies] = useState<DistributionPolicy[]>([])
    const [loadingFunds, setLoadingFunds] = useState(true)
    const [loadingPolicies, setLoadingPolicies] = useState(false)
    const [newPolicyOpen, setNewPolicyOpen] = useState(false)
    const [policyForm, setPolicyForm] = useState({
        name: "",
        valid_from: new Date().toISOString().slice(0, 10),
        valid_to: "",
        claim_period_years: 3,
        undistributable_treatment: "redistribute_by_work" as DistributionPolicy["undistributable_treatment"],
        approval_body: "",
        notes: "",
    })
    const [savingPolicy, setSavingPolicy] = useState(false)

    useEffect(() => {
        getRightsFunds().then(res => {
            if (res.success) {
                const active = res.funds.filter(f => f.active)
                setFunds(active)
                if (active.length > 0) setSelectedFundId(active[0].id)
            }
            setLoadingFunds(false)
        })
    }, [])

    const loadPolicies = useCallback(async (fundId: string) => {
        setLoadingPolicies(true)
        const res = await getDistributionPolicies(fundId)
        if (res.success) setPolicies(res.policies)
        else toast.error("Kunne ikke hente politikker")
        setLoadingPolicies(false)
    }, [])

    useEffect(() => {
        if (selectedFundId) loadPolicies(selectedFundId)
    }, [selectedFundId, loadPolicies])

    const handleCreatePolicy = async () => {
        if (!selectedFundId || !policyForm.name.trim() || !policyForm.valid_from) {
            toast.error("Navn og gyldig-fra dato er påkrævet")
            return
        }
        setSavingPolicy(true)
        try {
            const res = await createDistributionPolicy({
                fund_id: selectedFundId,
                name: policyForm.name,
                valid_from: policyForm.valid_from,
                valid_to: policyForm.valid_to || null,
                claim_period_years: policyForm.claim_period_years,
                undistributable_treatment: policyForm.undistributable_treatment,
                approval_body: policyForm.approval_body || null,
                notes: policyForm.notes || null,
            })
            if (!res.success) throw new Error(res.error)
            toast.success("Fordelingspolitik oprettet")
            setNewPolicyOpen(false)
            loadPolicies(selectedFundId)
        } catch (err) {
            toast.error("Kunne ikke oprette: " + String(err))
        } finally {
            setSavingPolicy(false)
        }
    }

    const selectedFund = funds.find(f => f.id === selectedFundId)

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Fordelingspolitikker definerer administrationsfradrag, hensættelsesprocent og SKU-komponenter
                pr. rettighedskasse og gyldighedsperiode. Satser snapshot'es ved aktivering og kan ikke
                ændres bagefter.
            </p>

            {loadingFunds ? (
                <p className="text-sm text-muted-foreground">Henter kasser…</p>
            ) : funds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    Ingen aktive rettighedskasser — opret en kasse under "Rettighedskasser" først.
                </p>
            ) : (
                <>
                    <div className="flex items-center gap-3">
                        <Label className="shrink-0">Rettighedskasse</Label>
                        <Select value={selectedFundId ?? ""} onValueChange={setSelectedFundId}>
                            <SelectTrigger className="w-64">
                                <SelectValue placeholder="Vælg kasse…" />
                            </SelectTrigger>
                            <SelectContent>
                                {funds.map(f => (
                                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedFund && (
                            <Badge variant="outline" className="text-xs">
                                {selectedFund.calculation_method === "pool_weighted" ? "Pulje" :
                                 selectedFund.calculation_method === "individual_work" ? "Individuelt" : "Royalty"}
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                            {policies.length === 0 ? "Ingen politikker endnu" : `${policies.length} politik${policies.length !== 1 ? "ker" : ""}`}
                        </p>
                        <Button size="sm" onClick={() => setNewPolicyOpen(true)} disabled={!selectedFundId}>
                            <Plus className="h-4 w-4 mr-1" />
                            Ny politik
                        </Button>
                    </div>

                    {loadingPolicies ? (
                        <p className="text-sm text-muted-foreground">Henter politikker…</p>
                    ) : (
                        <div className="space-y-2">
                            {policies.map(p => <PolicyPanel key={p.id} policy={p} />)}
                        </div>
                    )}
                </>
            )}

            {/* Ny politik-dialog */}
            <Dialog open={newPolicyOpen} onOpenChange={setNewPolicyOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Ny fordelingspolitik</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1">
                            <Label>Navn</Label>
                            <Input
                                placeholder="fx Copydan Verdens TV 2025"
                                value={policyForm.name}
                                onChange={e => setPolicyForm(f => ({ ...f, name: e.target.value }))}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Gyldig fra</Label>
                                <Input
                                    type="date"
                                    value={policyForm.valid_from}
                                    onChange={e => setPolicyForm(f => ({ ...f, valid_from: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label>Gyldig til <span className="text-muted-foreground text-xs">(tom = løbende)</span></Label>
                                <Input
                                    type="date"
                                    value={policyForm.valid_to}
                                    onChange={e => setPolicyForm(f => ({ ...f, valid_to: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label>Kravsfristperiode (år)</Label>
                            <Input
                                type="number"
                                min={1}
                                max={10}
                                value={policyForm.claim_period_years}
                                onChange={e => setPolicyForm(f => ({ ...f, claim_period_years: parseInt(e.target.value) || 3 }))}
                            />
                            <p className="text-xs text-muted-foreground">
                                DFKS standard: 3 år fra udgangen af udnyttelsesåret
                            </p>
                        </div>
                        <div className="space-y-1">
                            <Label>Behandling af ufordelbare midler</Label>
                            <Select
                                value={policyForm.undistributable_treatment}
                                onValueChange={v => setPolicyForm(f => ({ ...f, undistributable_treatment: v as typeof f.undistributable_treatment }))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="redistribute_by_work">Genfordel efter original værkfordeling</SelectItem>
                                    <SelectItem value="transfer_to_collective">Overfør til kollektive midler</SelectItem>
                                    <SelectItem value="individual_redistribution">Individuel genfordeling</SelectItem>
                                    <SelectItem value="manual_decision">Manuel beslutning</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Godkendelsesorgan <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                placeholder="fx Bestyrelsen"
                                value={policyForm.approval_body}
                                onChange={e => setPolicyForm(f => ({ ...f, approval_body: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                value={policyForm.notes}
                                onChange={e => setPolicyForm(f => ({ ...f, notes: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNewPolicyOpen(false)}>Annuller</Button>
                        <Button onClick={handleCreatePolicy} disabled={savingPolicy}>
                            {savingPolicy ? "Opretter…" : "Opret politik"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
