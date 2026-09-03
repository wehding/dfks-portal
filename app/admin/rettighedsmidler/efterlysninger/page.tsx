"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft, Plus, Search, Clock,
    MessageSquare, X, ShieldCheck, UserSearch, Users
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
    Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import {
    getSearchPublications, createSearchPublication,
    updateSearchPublicationStatus, getInheritanceRelations,
    createInheritanceRelation, verifyInheritanceRelation,
    type SearchPublication, type SearchPublicationStatus,
    type InheritanceRelation,
} from "@/app/actions/rights-search"

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
}

function fmtMinor(amount: number | null, currency = "DKK") {
    if (amount == null) return "—"
    return (amount / 100).toLocaleString("da-DK", { style: "currency", currency, minimumFractionDigits: 2 })
}

const STATUS_CONFIG: Record<SearchPublicationStatus, {
    label: string; variant: "default" | "secondary" | "outline"; icon: React.ElementType
}> = {
    draft:     { label: "Kladde",     variant: "outline",   icon: Clock },
    published: { label: "Publiceret", variant: "secondary", icon: Search },
    responded: { label: "Svar modtaget", variant: "default", icon: MessageSquare },
    closed:    { label: "Lukket",     variant: "outline",   icon: X },
}

// ── Ny efterlysning-dialog ────────────────────────────────────────────────────

function NewPublicationDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [form, setForm] = useState({
        known_name: "",
        known_alias: "",
        known_work_titles_raw: "",   // komma-separeret
        known_period_from: "",
        known_period_to: "",
        description: "",
        withheld_amount_kr: "",
        claim_deadline: "",
    })
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        if (!form.description.trim()) { toast.error("Beskrivelse er påkrævet"); return }
        setSaving(true)
        const titles = form.known_work_titles_raw
            .split(",").map(s => s.trim()).filter(Boolean)
        const amount = form.withheld_amount_kr
            ? Math.round(parseFloat(form.withheld_amount_kr.replace(",", ".")) * 100)
            : null
        const res = await createSearchPublication({
            known_name: form.known_name || null,
            known_alias: form.known_alias || null,
            known_work_titles: titles.length > 0 ? titles : null,
            known_period_from: form.known_period_from || null,
            known_period_to: form.known_period_to || null,
            description: form.description,
            withheld_amount: amount,
            claim_deadline: form.claim_deadline || null,
        })
        if (res.success) {
            toast.success("Efterlysning oprettet som kladde")
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
                    <DialogTitle>Ny efterlysning</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>Kendt navn <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                value={form.known_name}
                                onChange={e => setForm(f => ({ ...f, known_name: e.target.value }))}
                                placeholder="fx Hans Jensen"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Kaldenavn / alias <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                value={form.known_alias}
                                onChange={e => setForm(f => ({ ...f, known_alias: e.target.value }))}
                                placeholder="fx H.J."
                            />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>Kendte værkstitler <span className="text-muted-foreground text-xs">(komma-separeret)</span></Label>
                        <Input
                            value={form.known_work_titles_raw}
                            onChange={e => setForm(f => ({ ...f, known_work_titles_raw: e.target.value }))}
                            placeholder="fx Sommeren 92, Nat i byen"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>Aktiv i perioden fra <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input type="date" value={form.known_period_from} onChange={e => setForm(f => ({ ...f, known_period_from: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                            <Label>Til <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input type="date" value={form.known_period_to} onChange={e => setForm(f => ({ ...f, known_period_to: e.target.value }))} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>Beskrivelse</Label>
                        <textarea
                            className="w-full min-h-[80px] text-sm rounded border px-3 py-2 bg-background resize-none"
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="Beskriv hvad der vides om den søgte person, og hvad DFKS ønsker svar på."
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>Tilbageholdt beløb (kr.) <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input
                                value={form.withheld_amount_kr}
                                onChange={e => setForm(f => ({ ...f, withheld_amount_kr: e.target.value }))}
                                placeholder="fx 8500.00"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Kravfrist <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input type="date" value={form.claim_deadline} onChange={e => setForm(f => ({ ...f, claim_deadline: e.target.value }))} />
                        </div>
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

// ── Svar-modtaget-dialog ──────────────────────────────────────────────────────

function RespondedDialog({
    pub,
    onClose,
    onSaved,
}: {
    pub: SearchPublication
    onClose: () => void
    onSaved: () => void
}) {
    const [notes, setNotes] = useState("")
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        const res = await updateSearchPublicationStatus(pub.id, "responded", { response_notes: notes })
        if (res.success) { toast.success("Svar registreret"); onSaved(); onClose() }
        else toast.error(res.error ?? "Fejl")
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Registrér svar på efterlysning</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <p className="text-sm text-muted-foreground">
                        {pub.known_name ?? "Ukendt"} — {fmtMinor(pub.withheld_amount, pub.currency)}
                    </p>
                    <div className="space-y-1">
                        <Label>Svarbemærkninger <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <textarea
                            className="w-full min-h-[80px] text-sm rounded border px-3 py-2 bg-background resize-none"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Hvad oplyste den der henvendte sig?"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Gemmer…" : "Registrér svar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Ny arving-dialog ──────────────────────────────────────────────────────────

function NewHeirDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [rightsHolders, setRightsHolders] = useState<{ id: string; full_name: string }[]>([])
    const [form, setForm] = useState({
        rights_holder_id: "",
        heir_name: "",
        heir_relation: "",
        heir_address: "",
        heir_contact_email: "",
        heir_contact_phone: "",
        valid_from: new Date().toISOString().slice(0, 10),
        valid_to: "",
        notes: "",
    })
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        import("@/lib/supabase/client").then(async ({ createClient }) => {
            const db = createClient()
            const { data } = await db.from("rettighedshavere").select("id, full_name").order("full_name")
            setRightsHolders(data ?? [])
        })
    }, [])

    const handleSave = async () => {
        if (!form.rights_holder_id || !form.heir_name || !form.heir_relation) {
            toast.error("Rettighedshaver, arvings navn og relation er påkrævet")
            return
        }
        setSaving(true)
        const res = await createInheritanceRelation({
            rights_holder_id: form.rights_holder_id,
            heir_name: form.heir_name,
            heir_relation: form.heir_relation,
            heir_address: form.heir_address || null,
            heir_contact_email: form.heir_contact_email || null,
            heir_contact_phone: form.heir_contact_phone || null,
            valid_from: form.valid_from,
            valid_to: form.valid_to || null,
            notes: form.notes || null,
        })
        if (res.success) { toast.success("Arvingsprofil oprettet"); onSaved(); onClose() }
        else toast.error(res.error ?? "Fejl")
        setSaving(false)
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Registrér arving</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1">
                        <Label>Rettighedshaver (den afdøde / utilregnelige)</Label>
                        <select
                            className="w-full text-sm rounded border px-2 py-2 bg-background"
                            value={form.rights_holder_id}
                            onChange={e => setForm(f => ({ ...f, rights_holder_id: e.target.value }))}
                        >
                            <option value="">Vælg…</option>
                            {rightsHolders.map(rh => (
                                <option key={rh.id} value={rh.id}>{rh.full_name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>Arvings fulde navn</Label>
                            <Input value={form.heir_name} onChange={e => setForm(f => ({ ...f, heir_name: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                            <Label>Relation</Label>
                            <Input
                                value={form.heir_relation}
                                onChange={e => setForm(f => ({ ...f, heir_relation: e.target.value }))}
                                placeholder="fx ægtefælle, barn, juridisk arving"
                            />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>Adresse <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input value={form.heir_address} onChange={e => setForm(f => ({ ...f, heir_address: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>E-mail <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input type="email" value={form.heir_contact_email} onChange={e => setForm(f => ({ ...f, heir_contact_email: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                            <Label>Telefon <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input value={form.heir_contact_phone} onChange={e => setForm(f => ({ ...f, heir_contact_phone: e.target.value }))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>Gyldig fra</Label>
                            <Input type="date" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                            <Label>Gyldig til <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                            <Input type="date" value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>Noter <span className="text-muted-foreground text-xs">(valgfri)</span></Label>
                        <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Gemmer…" : "Registrér arving"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ── Hoved-side ────────────────────────────────────────────────────────────────

export default function EfterlysningerPage() {
    const router = useRouter()
    const [publications, setPublications] = useState<SearchPublication[]>([])
    const [relations, setRelations] = useState<InheritanceRelation[]>([])
    const [loading, setLoading] = useState(true)
    const [newPubOpen, setNewPubOpen] = useState(false)
    const [newHeirOpen, setNewHeirOpen] = useState(false)
    const [respondDialog, setRespondDialog] = useState<SearchPublication | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const [pRes, rRes] = await Promise.all([
            getSearchPublications(),
            getInheritanceRelations(),
        ])
        if (pRes.success) setPublications(pRes.publications)
        if (rRes.success) setRelations(rRes.relations)
        setLoading(false)
    }, [])

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timer)
    }, [load])

    const handleAdvancePub = async (pub: SearchPublication, next: SearchPublicationStatus) => {
        if (next === "responded") { setRespondDialog(pub); return }
        const res = await updateSearchPublicationStatus(pub.id, next)
        if (res.success) { toast.success("Status opdateret"); load() }
        else toast.error(res.error ?? "Fejl")
    }

    const handleVerifyHeir = async (id: string) => {
        const res = await verifyInheritanceRelation(id)
        if (res.success) { toast.success("Arvingsprofil verificeret"); load() }
        else toast.error(res.error ?? "Fejl")
    }

    const activePublications = publications.filter(p => ["draft", "published"].includes(p.status))
    const closedPublications = publications.filter(p => ["responded", "closed"].includes(p.status))

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => router.push("/admin/rettighedsmidler")}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Rettighedsmidler
                </Button>
            </div>

            <PageHeader
                title="Efterlysninger & arvingeprofiler"
                subtitle="Søg efter ukendte rettighedshavere og registrér legale arvinger"
            />

            {/* Overblik */}
            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Aktive efterlysninger</p>
                    <p className="text-2xl font-bold">{activePublications.length}</p>
                </div>
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Svar modtaget</p>
                    <p className="text-2xl font-bold">
                        {publications.filter(p => p.status === "responded").length}
                    </p>
                </div>
                <div className="rounded-lg border p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Arvingeprofiler</p>
                    <p className="text-2xl font-bold">{relations.length}</p>
                </div>
            </div>

            <Tabs defaultValue="efterlysninger">
                <div className="flex items-center justify-between">
                    <TabsList>
                        <TabsTrigger value="efterlysninger">
                            <UserSearch className="h-3.5 w-3.5 mr-1.5" />
                            Efterlysninger ({publications.length})
                        </TabsTrigger>
                        <TabsTrigger value="arvinger">
                            <Users className="h-3.5 w-3.5 mr-1.5" />
                            Arvingeprofiler ({relations.length})
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setNewHeirOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Ny arving
                        </Button>
                        <Button size="sm" onClick={() => setNewPubOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Ny efterlysning
                        </Button>
                    </div>
                </div>

                {/* Efterlysninger */}
                <TabsContent value="efterlysninger" className="mt-4">
                    {loading ? (
                        <p className="text-sm text-muted-foreground py-4">Henter efterlysninger…</p>
                    ) : publications.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-8 text-center">
                            <UserSearch className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">
                                Ingen efterlysninger endnu. Opret en når der er tilbageholdte midler til en ukendt rettighedshaver.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Aktive */}
                            {activePublications.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-muted-foreground mb-2">Aktive</h3>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Søgt person</TableHead>
                                                <TableHead>Beskrivelse</TableHead>
                                                <TableHead>Kravfrist</TableHead>
                                                <TableHead className="text-right">Beløb</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {activePublications.map(pub => {
                                                const cfg = STATUS_CONFIG[pub.status]
                                                const Icon = cfg.icon
                                                return (
                                                    <TableRow key={pub.id}>
                                                        <TableCell>
                                                            <p className="font-medium text-sm">{pub.known_name ?? "Ukendt"}</p>
                                                            {pub.known_alias && (
                                                                <p className="text-xs text-muted-foreground">{pub.known_alias}</p>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-sm max-w-xs truncate text-muted-foreground">
                                                            {pub.description}
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {fmtDate(pub.claim_deadline)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-sm">
                                                            {fmtMinor(pub.withheld_amount, pub.currency)}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant={cfg.variant} className="gap-1">
                                                                <Icon className="h-3 w-3" />
                                                                {cfg.label}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right space-x-1 whitespace-nowrap">
                                                            {pub.status === "draft" && (
                                                                <Button size="sm" variant="outline"
                                                                    onClick={() => handleAdvancePub(pub, "published")}>
                                                                    Publicér
                                                                </Button>
                                                            )}
                                                            {pub.status === "published" && (
                                                                <>
                                                                    <Button size="sm" variant="outline"
                                                                        onClick={() => handleAdvancePub(pub, "responded")}>
                                                                        Svar modtaget
                                                                    </Button>
                                                                    <Button size="sm" variant="ghost"
                                                                        onClick={() => handleAdvancePub(pub, "closed")}>
                                                                        <X className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}

                            {/* Lukkede */}
                            {closedPublications.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-muted-foreground mb-2">Afsluttede</h3>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Søgt person</TableHead>
                                                <TableHead>Afsluttet</TableHead>
                                                <TableHead className="text-right">Beløb</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Svarbemærkninger</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {closedPublications.map(pub => {
                                                const cfg = STATUS_CONFIG[pub.status]
                                                const Icon = cfg.icon
                                                return (
                                                    <TableRow key={pub.id} className="opacity-70">
                                                        <TableCell className="font-medium text-sm">
                                                            {pub.known_name ?? "Ukendt"}
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {fmtDate(pub.response_received_at ?? pub.closed_at)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-sm">
                                                            {fmtMinor(pub.withheld_amount, pub.currency)}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant={cfg.variant} className="gap-1">
                                                                <Icon className="h-3 w-3" />
                                                                {cfg.label}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                                                            {pub.response_notes ?? "—"}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </div>
                    )}
                </TabsContent>

                {/* Arvingeprofiler */}
                <TabsContent value="arvinger" className="mt-4">
                    {loading ? (
                        <p className="text-sm text-muted-foreground py-4">Henter arvingeprofiler…</p>
                    ) : relations.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-8 text-center">
                            <Users className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">
                                Ingen arvingeprofiler registreret. Opret en når en rettighedshaver er afgået ved døden og der er kendte arvinger.
                            </p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rettighedshaver</TableHead>
                                    <TableHead>Arving</TableHead>
                                    <TableHead>Relation</TableHead>
                                    <TableHead>Kontakt</TableHead>
                                    <TableHead>Gyldig fra</TableHead>
                                    <TableHead>Verificeret</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {relations.map(r => (
                                    <TableRow key={r.id}>
                                        <TableCell>
                                            <p className="font-medium text-sm">{r.rights_holder_name ?? "—"}</p>
                                            {r.member_number && (
                                                <p className="text-xs text-muted-foreground">#{r.member_number}</p>
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium text-sm">{r.heir_name}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{r.heir_relation}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {r.heir_contact_email ?? r.heir_contact_phone ?? "—"}
                                        </TableCell>
                                        <TableCell className="text-sm">{fmtDate(r.valid_from)}</TableCell>
                                        <TableCell>
                                            {r.verified_at ? (
                                                <Badge variant="default" className="gap-1">
                                                    <ShieldCheck className="h-3 w-3" />
                                                    {fmtDate(r.verified_at)}
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="gap-1 text-muted-foreground">
                                                    <Clock className="h-3 w-3" />
                                                    Uverificeret
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {!r.verified_at && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleVerifyHeir(r.id)}
                                                >
                                                    <ShieldCheck className="h-3 w-3 mr-1" />
                                                    Verificér
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

            {newPubOpen && (
                <NewPublicationDialog onClose={() => setNewPubOpen(false)} onSaved={load} />
            )}
            {newHeirOpen && (
                <NewHeirDialog onClose={() => setNewHeirOpen(false)} onSaved={load} />
            )}
            {respondDialog && (
                <RespondedDialog
                    pub={respondDialog}
                    onClose={() => setRespondDialog(null)}
                    onSaved={load}
                />
            )}
        </div>
    )
}
