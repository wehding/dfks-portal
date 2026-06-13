"use client"

import { useEffect, useState } from "react"
import { Search, Plus, Pencil, UserCheck, UserX, X, Loader2, Mail, KeyRound, Link, LogIn, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import {
    getRettighedshavere,
    createRettighedshaver,
    updateRettighedshaver,
    setMemberStatus,
    setAffiliationEnd,
    type RettighedshaverWithAffiliation,
} from "@/lib/db/rettighedshavere"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"

type Filter = "alle" | "medlemmer" | "ikke-medlemmer"

function getAffiliation(rh: RettighedshaverWithAffiliation, orgId: string) {
    return rh.org_affiliations?.find(a => a.org_id === orgId) ?? null
}

const EMPTY_FORM = {
    full_name: "", email: "", phone: "", address: "", cpr_no: "", member_no: "", is_member: false,
}

export default function RettighedshavereAdminPage() {
    const [orgId, setOrgId] = useState<string | null>(null)
    const [rows, setRows] = useState<RettighedshaverWithAffiliation[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState<Filter>("alle")

    const [createOpen, setCreateOpen] = useState(false)
    const [createSaving, setCreateSaving] = useState(false)
    const [createForm, setCreateForm] = useState({ ...EMPTY_FORM })

    const [editTarget, setEditTarget] = useState<RettighedshaverWithAffiliation | null>(null)
    const [editSaving, setEditSaving] = useState(false)
    const [editForm, setEditForm] = useState({ ...EMPTY_FORM })

    // Portal-adgang
    const [portalAction, setPortalAction] = useState<{ rh: RettighedshaverWithAffiliation; type: "invite" | "reset" } | null>(null)
    const [portalLoading, setPortalLoading] = useState(false)
    const [portalLink, setPortalLink] = useState<string | null>(null)

    useEffect(() => {
        const supabase = createClient()
        supabase.auth.getUser().then(({ data: { user } }) => {
            const oid = user?.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
            setOrgId(oid)
            load(oid)
        })
    }, [])

    async function load(oid: string) {
        setLoading(true)
        const data = await getRettighedshavere(oid)
        setRows(data)
        setLoading(false)
    }

    const visible = rows.filter(rh => {
        const aff = orgId ? getAffiliation(rh, orgId) : null
        if (filter === "medlemmer" && !aff?.is_member) return false
        if (filter === "ikke-medlemmer" && aff?.is_member) return false
        if (search) {
            const q = search.toLowerCase()
            return (
                rh.full_name.toLowerCase().includes(q) ||
                rh.email?.toLowerCase().includes(q) ||
                rh.phone?.toLowerCase().includes(q) ||
                aff?.member_no?.toLowerCase().includes(q)
            )
        }
        return true
    })

    async function handleCreate() {
        if (!orgId || !createForm.full_name.trim()) return
        setCreateSaving(true)
        const result = await createRettighedshaver(
            { full_name: createForm.full_name.trim(), email: createForm.email || null, phone: createForm.phone || null, address: createForm.address || null, cpr_no: createForm.cpr_no || null },
            orgId, createForm.is_member, createForm.member_no || undefined
        )
        setCreateSaving(false)
        if (result) { toast.success(`${createForm.full_name} er oprettet`); setCreateOpen(false); load(orgId) }
        else toast.error("Kunne ikke oprette rettighedshaver")
    }

    function openEdit(rh: RettighedshaverWithAffiliation) {
        const aff = orgId ? getAffiliation(rh, orgId) : null
        setEditForm({ full_name: rh.full_name, email: rh.email ?? "", phone: rh.phone ?? "", address: rh.address ?? "", cpr_no: rh.cpr_no ?? "", member_no: aff?.member_no ?? "", is_member: aff?.is_member ?? false })
        setEditTarget(rh)
    }

    async function handleEdit() {
        if (!editTarget || !orgId) return
        setEditSaving(true)
        await updateRettighedshaver(editTarget.id, { full_name: editForm.full_name.trim(), email: editForm.email || null, phone: editForm.phone || null, address: editForm.address || null, cpr_no: editForm.cpr_no || null })
        await setMemberStatus(editTarget.id, orgId, editForm.is_member, editForm.member_no || undefined)
        setEditSaving(false)
        toast.success("Gemt")
        setEditTarget(null)
        load(orgId)
    }

    async function toggleMember(rh: RettighedshaverWithAffiliation) {
        if (!orgId) return
        const aff = getAffiliation(rh, orgId)
        const next = !aff?.is_member
        await setMemberStatus(rh.id, orgId, next, aff?.member_no ?? undefined)
        if (!next) await setAffiliationEnd(rh.id, orgId, new Date().toISOString().slice(0, 10))
        toast.success(next ? `${rh.full_name} er nu medlem` : `${rh.full_name} er udmeldt`)
        load(orgId)
    }

    async function handlePortalAction() {
        if (!portalAction) return
        const { rh, type } = portalAction
        if (!rh.email) { toast.error("Email er påkrævet for at sende invitationslink"); return }
        setPortalLoading(true)
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    type === "invite"
                        ? { action: "invite", email: rh.email, name: rh.full_name, rhId: rh.id }
                        : { action: "reset", userId: rh.user_id, email: rh.email }
                ),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            const link = type === "invite" ? json.invite_url : json.reset_url
            setPortalLink(link)
            if (type === "invite") {
                // Opdater lokal state med ny user_id
                setRows(prev => prev.map(r => r.id === rh.id ? { ...r, user_id: json.user_id } : r))
            }
        } catch (e: any) {
            toast.error(e.message ?? "Fejl")
        } finally {
            setPortalLoading(false)
        }
    }

    async function handleResetOnboarding(rh: RettighedshaverWithAffiliation) {
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reset-onboarding", rhId: rh.id }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast.success(`Onboarding nulstillet for ${rh.full_name}`)
            setRows(prev => prev.map(r => r.id === rh.id ? { ...r, onboarding_completed: false } : r))
        } catch (e: any) {
            toast.error(e.message ?? "Fejl")
        }
    }

    const memberCount    = rows.filter(rh => orgId && getAffiliation(rh, orgId)?.is_member).length
    const nonMemberCount = rows.filter(rh => orgId && !getAffiliation(rh, orgId)?.is_member).length
    const portalCount    = rows.filter(rh => rh.user_id).length

    return (
        <div className="space-y-6">
            <PageHeader
                title="Rettighedshavere"
                subtitle="Klippere tilknyttet organisationen"
                actions={
                    <Button size="sm" onClick={() => { setCreateForm({ ...EMPTY_FORM }); setCreateOpen(true) }}>
                        <Plus className="h-4 w-4 mr-1" />Opret ny
                    </Button>
                }
            />

            {/* Stats strip */}
            {!loading && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { label: "I alt",             value: rows.length    },
                        { label: "Aktive medlemmer",  value: memberCount    },
                        { label: "Ikke-medlemmer",    value: nonMemberCount },
                        { label: "Med portal-adgang", value: portalCount    },
                    ].map(s => (
                        <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-5 py-4">
                            <p className="text-sm font-medium text-gray-500 mb-1">{s.label}</p>
                            <p className="text-2xl font-bold text-gray-900 tabular-nums">{s.value}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex gap-2 items-center">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Søg navn, email, telefon..." className="pl-8" value={search} onChange={e => setSearch(e.target.value)} />
                    {search && <button className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}><X className="h-4 w-4" /></button>}
                </div>
                <Select value={filter} onValueChange={v => setFilter(v as Filter)}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="alle">Alle</SelectItem>
                        <SelectItem value="medlemmer">Kun medlemmer</SelectItem>
                        <SelectItem value="ikke-medlemmer">Ikke-medlemmer</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Navn</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Telefon</TableHead>
                            <TableHead>Medlemsnr.</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Portal</TableHead>
                            <TableHead>Onboarding</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Henter...</TableCell></TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Ingen rettighedshavere fundet</TableCell></TableRow>
                        ) : visible.map(rh => {
                            const aff = orgId ? getAffiliation(rh, orgId) : null
                            const hasLogin = !!rh.user_id
                            return (
                                <TableRow key={rh.id}>
                                    <TableCell className="font-medium">{rh.full_name}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{rh.email ?? "—"}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{rh.phone ?? "—"}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{aff?.member_no ?? "—"}</TableCell>
                                    <TableCell>
                                        {aff?.is_member
                                            ? <Badge className="bg-green-600 text-white text-xs">Medlem</Badge>
                                            : <Badge variant="outline" className="text-muted-foreground text-xs">Ikke-medlem</Badge>}
                                    </TableCell>
                                    <TableCell>
                                        {hasLogin
                                            ? <Badge variant="secondary" className="gap-1 text-xs"><LogIn className="h-3 w-3" />Aktiv</Badge>
                                            : <span className="text-xs text-muted-foreground">Ingen adgang</span>}
                                    </TableCell>
                                    <TableCell>
                                        {!hasLogin
                                            ? <span className="text-xs text-muted-foreground">—</span>
                                            : rh.onboarding_completed
                                                ? <Badge className="bg-emerald-600 text-white text-xs gap-1">✓ Gennemført</Badge>
                                                : <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">Ikke påbegyndt</Badge>}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => openEdit(rh)}>
                                                    <Pencil className="h-3.5 w-3.5 mr-2" />Rediger
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => toggleMember(rh)}>
                                                    {aff?.is_member
                                                        ? <><UserX className="h-3.5 w-3.5 mr-2 text-amber-500" />Udmeld</>
                                                        : <><UserCheck className="h-3.5 w-3.5 mr-2 text-green-600" />Indmeld</>}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                {!hasLogin && rh.email && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "invite" }); setPortalLink(null) }}>
                                                        <Mail className="h-3.5 w-3.5 mr-2" />Inviter til portal
                                                    </DropdownMenuItem>
                                                )}
                                                {hasLogin && rh.email && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "reset" }); setPortalLink(null) }}>
                                                        <KeyRound className="h-3.5 w-3.5 mr-2" />Nulstil password
                                                    </DropdownMenuItem>
                                                )}
                                                {hasLogin && rh.onboarding_completed && (
                                                    <DropdownMenuItem
                                                        className="text-amber-600 focus:text-amber-600"
                                                        onClick={() => handleResetOnboarding(rh)}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5 mr-2" />Nulstil onboarding
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Create dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Opret rettighedshaver</DialogTitle>
                        <DialogDescription>Tilføj en ny person. De kan inviteres til portal-login efterfølgende.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1">
                            <Label>Fuldt navn *</Label>
                            <Input value={createForm.full_name} onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Fornavn Efternavn" autoFocus />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1"><Label>Email</Label><Input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.dk" /></div>
                            <div className="space-y-1"><Label>Telefon</Label><Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} placeholder="+45 12 34 56 78" /></div>
                        </div>
                        <div className="space-y-1"><Label>Adresse</Label><Input value={createForm.address} onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))} placeholder="Gade 1, 2100 København Ø" /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1"><Label>CPR-nr.</Label><Input value={createForm.cpr_no} onChange={e => setCreateForm(f => ({ ...f, cpr_no: e.target.value }))} placeholder="DDMMÅÅ-XXXX" /></div>
                            <div className="space-y-1"><Label>Medlemsnr.</Label><Input value={createForm.member_no} onChange={e => setCreateForm(f => ({ ...f, member_no: e.target.value }))} placeholder="F.eks. 1042" /></div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            <input type="checkbox" id="create-is-member" checked={createForm.is_member} onChange={e => setCreateForm(f => ({ ...f, is_member: e.target.checked }))} className="h-4 w-4" />
                            <Label htmlFor="create-is-member" className="cursor-pointer">Registrér som aktivt medlem</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuller</Button>
                        <Button onClick={handleCreate} disabled={createSaving || !createForm.full_name.trim()}>
                            {createSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Opret
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit dialog */}
            <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rediger rettighedshaver</DialogTitle>
                        <DialogDescription>{editTarget?.full_name}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1"><Label>Fuldt navn *</Label><Input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1"><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>Telefon</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
                        </div>
                        <div className="space-y-1"><Label>Adresse</Label><Input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1"><Label>CPR-nr.</Label><Input value={editForm.cpr_no} onChange={e => setEditForm(f => ({ ...f, cpr_no: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>Medlemsnr.</Label><Input value={editForm.member_no} onChange={e => setEditForm(f => ({ ...f, member_no: e.target.value }))} /></div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            <input type="checkbox" id="edit-is-member" checked={editForm.is_member} onChange={e => setEditForm(f => ({ ...f, is_member: e.target.checked }))} className="h-4 w-4" />
                            <Label htmlFor="edit-is-member" className="cursor-pointer">Aktivt medlem</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditTarget(null)}>Annuller</Button>
                        <Button onClick={handleEdit} disabled={editSaving || !editForm.full_name.trim()}>
                            {editSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Gem
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Portal adgang dialog */}
            <Dialog open={!!portalAction} onOpenChange={open => { if (!open) { setPortalAction(null); setPortalLink(null) } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {portalAction?.type === "invite" ? "Inviter til portal" : "Nulstil password"}
                        </DialogTitle>
                        <DialogDescription>
                            {portalAction?.type === "invite"
                                ? `Generér et invitationslink til ${portalAction.rh.full_name} (${portalAction.rh.email}). De kan herefter logge ind og sætte et password.`
                                : `Generér et nulstillingslink til ${portalAction?.rh.full_name}. Del linket med dem direkte.`}
                        </DialogDescription>
                    </DialogHeader>

                    {portalLink ? (
                        <div className="space-y-3 py-2">
                            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                                <Link className="h-4 w-4" />
                                {portalAction?.type === "invite" ? "Invitationslink genereret" : "Nulstillingslink genereret"}
                            </div>
                            <div className="flex gap-2">
                                <Input value={portalLink} readOnly className="font-mono text-xs" />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        navigator.clipboard.writeText(portalLink)
                                        toast.success("Kopieret!")
                                    }}
                                >
                                    Kopiér
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Linket er gyldigt i 24 timer. Del det direkte med personen via email eller besked.
                            </p>
                        </div>
                    ) : (
                        <div className="py-2">
                            <p className="text-sm text-muted-foreground">
                                {portalAction?.rh.email
                                    ? `Email: ${portalAction.rh.email}`
                                    : <span className="text-destructive">Ingen email registreret — tilføj email først</span>}
                            </p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setPortalAction(null); setPortalLink(null) }}>
                            {portalLink ? "Luk" : "Annuller"}
                        </Button>
                        {!portalLink && (
                            <Button onClick={handlePortalAction} disabled={portalLoading || !portalAction?.rh.email}>
                                {portalLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {portalAction?.type === "invite" ? "Generér invitationslink" : "Generér nulstillingslink"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
