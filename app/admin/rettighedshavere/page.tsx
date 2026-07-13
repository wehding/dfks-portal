"use client"

import { useEffect, useMemo, useState } from "react"
import { DEFAULT_ORG_ID } from "@/lib/org"
import { useRouter } from "next/navigation"
import { Search, Plus, Pencil, UserCheck, UserX, X, Loader2, Mail, KeyRound, Link, LogIn, RotateCcw, Eye, FileText } from "lucide-react"
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
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view"
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
import { getDfksMembersSyncStatus, syncDfksMembers } from "@/app/actions/dfks-members"

type Filter = "alle" | "medlemmer" | "ikke-medlemmer" | "afventer" | "ikke-inviteret" | "registreret"
type AdminUserResponse = {
    error?: string
    invite_url?: string
    reset_url?: string
    user_id?: string
    email_sent?: boolean
    email_error?: string
}
type DfksMemberOption = {
    display_id: string | null
    full_name: string
}
type RightsHolderCounts = {
    contracts: number
    works: number
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Fejl"
}

function getAffiliation(rh: RettighedshaverWithAffiliation, orgId: string) {
    return rh.org_affiliations?.find(a => a.org_id === orgId) ?? null
}

function normalizeName(value: string) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
}

function findDfksMemberNo(name: string, members: DfksMemberOption[]) {
    const normalized = normalizeName(name)
    if (!normalized) return ""
    const match = members.find(member => normalizeName(member.full_name) === normalized)
    return match?.display_id ?? ""
}

const EMPTY_FORM = {
    full_name: "", email: "", phone: "", address: "", cpr_no: "", bank_account: "", member_no: "", is_member: false,
    gender: "", opt_out_statistics: false, send_invite: false,
}

export default function RettighedshavereAdminPage() {
    const [orgId, setOrgId] = useState<string | null>(null)
    const [rows, setRows] = useState<RettighedshaverWithAffiliation[]>([])
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState<Filter>("alle")

    const [createOpen, setCreateOpen] = useState(false)
    const [createSaving, setCreateSaving] = useState(false)
    const [bulkInviting, setBulkInviting] = useState(false)
    const [createForm, setCreateForm] = useState({ ...EMPTY_FORM })
    const [createMemberNoTouched, setCreateMemberNoTouched] = useState(false)

    const [editTarget, setEditTarget] = useState<RettighedshaverWithAffiliation | null>(null)
    const [editSaving, setEditSaving] = useState(false)
    const [editForm, setEditForm] = useState({ ...EMPTY_FORM })
    const [editMemberNoTouched, setEditMemberNoTouched] = useState(false)

    // Portal-adgang
    const [portalAction, setPortalAction] = useState<{ rh: RettighedshaverWithAffiliation; type: "invite" | "reset" } | null>(null)
    const [portalLoading, setPortalLoading] = useState(false)
    const [portalLink, setPortalLink] = useState<string | null>(null)

    const [syncingMembers, setSyncingMembers] = useState(false)
    const [memberSyncStatus, setMemberSyncStatus] = useState<{ count: number; syncedAt: string | null } | null>(null)
    const [dfksMembers, setDfksMembers] = useState<DfksMemberOption[]>([])
    const [countsByRightsHolder, setCountsByRightsHolder] = useState<Record<string, RightsHolderCounts>>({})

    useEffect(() => {
        const supabase = createClient()
        supabase.auth.getUser().then(({ data: { user } }) => {
            const oid = user?.user_metadata?.org_id ?? DEFAULT_ORG_ID
            setOrgId(oid)
            load(oid)
            loadDfksMembers(oid)
            loadOverviewCounts(oid)
            refreshMemberSyncStatus()
        })
    }, [])

    async function load(oid: string) {
        setLoading(true)
        const data = await getRettighedshavere(oid)
        setRows(data)
        setLoading(false)
    }

    async function loadDfksMembers(oid: string) {
        const supabase = createClient()
        const { data } = await supabase
            .from("dfks_members")
            .select("display_id, full_name")
            .eq("org_id", oid)
            .eq("status", "active")
            .order("full_name")

        setDfksMembers((data as DfksMemberOption[] | null) ?? [])
    }

    async function loadOverviewCounts(oid: string) {
        const supabase = createClient()
        const [{ data: contracts }, { data: assignments }] = await Promise.all([
            supabase
                .from("contracts")
                .select("rights_holder_id")
                .eq("org_id", oid)
                .not("rights_holder_id", "is", null),
            supabase
                .from("work_assignments")
                .select("rights_holder_id")
                .eq("org_id", oid)
                .not("rights_holder_id", "is", null),
        ])

        const next: Record<string, RightsHolderCounts> = {}
        for (const row of (contracts ?? []) as Array<{ rights_holder_id: string | null }>) {
            if (!row.rights_holder_id) continue
            next[row.rights_holder_id] ??= { contracts: 0, works: 0 }
            next[row.rights_holder_id].contracts += 1
        }
        for (const row of (assignments ?? []) as Array<{ rights_holder_id: string | null }>) {
            if (!row.rights_holder_id) continue
            next[row.rights_holder_id] ??= { contracts: 0, works: 0 }
            next[row.rights_holder_id].works += 1
        }
        setCountsByRightsHolder(next)
    }

    async function refreshMemberSyncStatus() {
        const status = await getDfksMembersSyncStatus()
        if (status.success) {
            setMemberSyncStatus({ count: status.count ?? 0, syncedAt: status.syncedAt ?? null })
        }
    }

    async function handleSyncDfksMembers() {
        setSyncingMembers(true)
        const result = await syncDfksMembers()
        setSyncingMembers(false)
        if (!result.success) {
            toast.error(result.error ?? "Kunne ikke opdatere DFKS medlemslisten")
            return
        }
        toast.success(`${result.count ?? 0} medlemmer opdateret fra DFKS medlemslisten`)
        setMemberSyncStatus({ count: result.count ?? 0, syncedAt: result.syncedAt ?? new Date().toISOString() })
        if (orgId) loadDfksMembers(orgId)
    }

    const createMatchedMemberNo = useMemo(
        () => findDfksMemberNo(createForm.full_name, dfksMembers),
        [createForm.full_name, dfksMembers]
    )
    const editMatchedMemberNo = useMemo(
        () => findDfksMemberNo(editForm.full_name, dfksMembers),
        [editForm.full_name, dfksMembers]
    )

    useEffect(() => {
        if (!createOpen || createMemberNoTouched || createForm.member_no.trim() || !createMatchedMemberNo) return
        setCreateForm(form => ({ ...form, member_no: createMatchedMemberNo, is_member: true }))
    }, [createMatchedMemberNo, createForm.member_no, createMemberNoTouched, createOpen])

    useEffect(() => {
        if (!editTarget || editMemberNoTouched || editForm.member_no.trim() || !editMatchedMemberNo) return
        setEditForm(form => ({ ...form, member_no: editMatchedMemberNo, is_member: true }))
    }, [editMatchedMemberNo, editForm.member_no, editMemberNoTouched, editTarget])

    const visible = rows.filter(rh => {
        const aff = orgId ? getAffiliation(rh, orgId) : null
        if (filter === "medlemmer" && !aff?.is_member) return false
        if (filter === "ikke-medlemmer" && aff?.is_member) return false
        // Invitationsstatus
        const invStatus = rh.onboarding_completed ? "registreret" : (rh.invite_sent_at || rh.user_id) ? "afventer" : "ikke-inviteret"
        if ((filter === "afventer" || filter === "ikke-inviteret" || filter === "registreret") && invStatus !== filter) return false
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

    // Send invitationsmail til én rettighedshaver. Returnerer true hvis mailen blev sendt.
    async function sendInviteFor(rhId: string, email: string, name: string): Promise<AdminUserResponse | null> {
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "invite", email, name, rhId }),
            })
            const json = await res.json() as AdminUserResponse
            if (!res.ok) throw new Error(json.error)
            return json
        } catch (e: unknown) {
            toast.error(errorMessage(e))
            return null
        }
    }

    async function handleCreate() {
        if (!orgId || !createForm.full_name.trim()) return
        setCreateSaving(true)
        const result = await createRettighedshaver(
            { full_name: createForm.full_name.trim(), email: createForm.email || null, phone: createForm.phone || null, address: createForm.address || null, cpr_no: createForm.cpr_no || null, bank_account: createForm.bank_account || null },
            orgId, createForm.is_member, createForm.member_no || undefined
        )
        if (result) {
            toast.success(`${createForm.full_name} er oprettet`)
            // Send invitationsmail med det samme, hvis valgt og email er angivet
            if (createForm.send_invite && createForm.email.trim()) {
                const json = await sendInviteFor(result.id, createForm.email.trim(), createForm.full_name.trim())
                if (json?.email_sent) toast.success(`Invitation sendt til ${createForm.email.trim()}`)
                else if (json) toast.warning("Oprettet, men invitationsmailen kunne ikke sendes.")
            }
            setCreateSaving(false)
            setCreateOpen(false); load(orgId); loadOverviewCounts(orgId)
        } else {
            setCreateSaving(false)
            toast.error("Kunne ikke oprette rettighedshaver")
        }
    }

    // Masseudsend: invitér alle synlige personer der har email og endnu ikke er registreret.
    async function handleBulkInvite() {
        if (!orgId) return
        const targets = visible.filter(rh => rh.email && !rh.onboarding_completed)
        if (targets.length === 0) { toast.info("Ingen at invitere — alle synlige er enten registreret eller mangler email."); return }
        if (!confirm(`Send invitation til ${targets.length} person(er) der endnu ikke er oprettet?`)) return
        setBulkInviting(true)
        let sent = 0
        for (const rh of targets) {
            const json = await sendInviteFor(rh.id, rh.email!, rh.full_name)
            if (json?.email_sent) sent++
        }
        setBulkInviting(false)
        toast.success(`${sent} af ${targets.length} invitationer sendt`)
        load(orgId)
    }

    function openEdit(rh: RettighedshaverWithAffiliation) {
        const aff = orgId ? getAffiliation(rh, orgId) : null
        const extra = rh as { gender?: string | null; opt_out_statistics?: boolean | null }
        setEditForm({ full_name: rh.full_name, email: rh.email ?? "", phone: rh.phone ?? "", address: rh.address ?? "", cpr_no: rh.cpr_no ?? "", bank_account: rh.bank_account ?? "", member_no: aff?.member_no ?? "", is_member: aff?.is_member ?? false, gender: extra.gender ?? "", opt_out_statistics: Boolean(extra.opt_out_statistics), send_invite: false })
        setEditMemberNoTouched(false)
        setEditTarget(rh)
    }

    async function handleEdit() {
        if (!editTarget || !orgId) return
        setEditSaving(true)
        await updateRettighedshaver(editTarget.id, { full_name: editForm.full_name.trim(), email: editForm.email || null, phone: editForm.phone || null, address: editForm.address || null, cpr_no: editForm.cpr_no || null, bank_account: editForm.bank_account || null, gender: editForm.gender || null, opt_out_statistics: editForm.opt_out_statistics })
        await setMemberStatus(editTarget.id, orgId, editForm.is_member, editForm.member_no || undefined)
        setEditSaving(false)
        toast.success("Gemt")
        setEditTarget(null)
        load(orgId)
        loadOverviewCounts(orgId)
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
            const json = await res.json() as AdminUserResponse
            if (!res.ok) throw new Error(json.error)
            const link = type === "invite" ? json.invite_url : json.reset_url
            setPortalLink(link ?? null)
            if (type === "invite") {
                // Opdater lokal state med ny user_id + invite-tidsstempel, og vis mail-resultat
                const now = new Date().toISOString()
                setRows(prev => prev.map(r => r.id === rh.id ? { ...r, user_id: json.user_id ?? null, invite_sent_at: now } : r))
                if (json.email_sent) toast.success(`Invitation sendt til ${rh.email}`)
                else toast.warning(`Bruger oprettet, men mailen kunne ikke sendes (${json.email_error ?? "ukendt"}). Kopiér linket manuelt.`)
            }
        } catch (e: unknown) {
            toast.error(errorMessage(e))
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
            const json = await res.json() as AdminUserResponse
            if (!res.ok) throw new Error(json.error)
            toast.success(`Onboarding nulstillet for ${rh.full_name}`)
            setRows(prev => prev.map(r => r.id === rh.id ? { ...r, onboarding_completed: false } : r))
        } catch (e: unknown) {
            toast.error(errorMessage(e))
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
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        {memberSyncStatus && (
                            <span className="text-xs text-muted-foreground">
                                DFKS liste: {memberSyncStatus.count} · {memberSyncStatus.syncedAt ? new Date(memberSyncStatus.syncedAt).toLocaleString("da-DK") : "aldrig"}
                            </span>
                        )}
                        <Button size="sm" variant="outline" onClick={handleSyncDfksMembers} disabled={syncingMembers}>
                            {syncingMembers ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                            Opdater DFKS medlemsliste
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleBulkInvite} disabled={bulkInviting}>
                            {bulkInviting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}Send invitation til alle ikke-oprettede
                        </Button>
                        <Button size="sm" onClick={() => { setCreateForm({ ...EMPTY_FORM }); setCreateMemberNoTouched(false); setCreateOpen(true) }}>
                            <Plus className="h-4 w-4 mr-1" />Opret ny
                        </Button>
                    </div>
                }
            />

            {/* Stats strip */}
            {!loading && (
                <div className="hidden gap-3 sm:grid sm:grid-cols-4">
                    {[
                        { label: "I alt",             value: rows.length    },
                        { label: "Aktive medlemmer",  value: memberCount    },
                        { label: "Ikke-medlemmer",    value: nonMemberCount },
                        { label: "Med portal-adgang", value: portalCount    },
                    ].map(s => (
                        <div key={s.label} className="rounded-lg border bg-card px-5 py-4 text-card-foreground">
                            <p className="text-sm font-medium text-muted-foreground mb-1">{s.label}</p>
                            <p className="text-2xl font-bold text-foreground tabular-nums">{s.value}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Søg navn, email, telefon..." className="pl-8" value={search} onChange={e => setSearch(e.target.value)} />
                    {search && <button className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}><X className="h-4 w-4" /></button>}
                </div>
                <Select value={filter} onValueChange={v => setFilter(v as Filter)}>
                    <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="alle">Alle</SelectItem>
                        <SelectItem value="medlemmer">Kun medlemmer</SelectItem>
                        <SelectItem value="ikke-medlemmer">Ikke-medlemmer</SelectItem>
                        <SelectItem value="afventer">Afventer invitation</SelectItem>
                        <SelectItem value="ikke-inviteret">Ikke inviteret</SelectItem>
                        <SelectItem value="registreret">Registreret</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <MobileCardList>
                {loading ? (
                    <MobileDataCard>
                        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />Henter...
                        </div>
                    </MobileDataCard>
                ) : visible.length === 0 ? (
                    <MobileDataCard>
                        <p className="py-6 text-center text-sm text-muted-foreground">Ingen rettighedshavere fundet</p>
                    </MobileDataCard>
                ) : visible.map(rh => {
                    const aff = orgId ? getAffiliation(rh, orgId) : null
                    const hasLogin = !!rh.user_id
                    const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0 }
                    return (
                        <MobileDataCard key={rh.id}>
                            <div className="flex items-start justify-between gap-3">
                                <button className="min-w-0 text-left" onClick={() => openEdit(rh)}>
                                    <p className="truncate font-medium">{rh.full_name}</p>
                                    <p className="mt-1 truncate text-sm text-muted-foreground">{rh.email ?? "Ingen email"}</p>
                                </button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => openEdit(rh)}>
                                            <Pencil className="h-3.5 w-3.5 mr-2" />Rediger
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => router.push(`/admin/kontrakter?rh=${rh.id}`)}>
                                            <FileText className="h-3.5 w-3.5 mr-2" />Se alle kontrakter
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => router.push(`/admin/vaerker?rh=${rh.id}`)}>
                                            <Eye className="h-3.5 w-3.5 mr-2" />Se alle værker
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => toggleMember(rh)}>
                                            {aff?.is_member
                                                ? <><UserX className="h-3.5 w-3.5 mr-2 text-amber-500" />Udmeld</>
                                                : <><UserCheck className="h-3.5 w-3.5 mr-2 text-green-600" />Indmeld</>}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <MobileMetaRow label="Telefon">{rh.phone ?? "—"}</MobileMetaRow>
                                <MobileMetaRow label="DFKS nr.">{aff?.member_no ?? "—"}</MobileMetaRow>
                                <MobileMetaRow label="Kontrakter">{counts.contracts}</MobileMetaRow>
                                <MobileMetaRow label="Værker">{counts.works}</MobileMetaRow>
                                <MobileMetaRow label="Status">
                                    {aff?.is_member
                                        ? <Badge className="bg-green-600 text-white text-xs">Medlem</Badge>
                                        : <Badge variant="outline" className="text-muted-foreground text-xs">Ikke-medlem</Badge>}
                                </MobileMetaRow>
                                <MobileMetaRow label="Portal">
                                    {hasLogin
                                        ? <Badge variant="secondary" className="gap-1 text-xs"><LogIn className="h-3 w-3" />Aktiv</Badge>
                                        : <span className="text-muted-foreground">Ingen adgang</span>}
                                </MobileMetaRow>
                            </div>
                        </MobileDataCard>
                    )
                })}
            </MobileCardList>

            <ResponsiveTableFrame className="rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Navn</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Telefon</TableHead>
                            <TableHead>DFKS medlemsnr.</TableHead>
                            <TableHead>Kontrakter</TableHead>
                            <TableHead>Værker</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Portal</TableHead>
                            <TableHead>Onboarding</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Henter...</TableCell></TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">Ingen rettighedshavere fundet</TableCell></TableRow>
                        ) : visible.map(rh => {
                            const aff = orgId ? getAffiliation(rh, orgId) : null
                            const hasLogin = !!rh.user_id
                            const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0 }
                            return (
                                <TableRow key={rh.id}>
                                    <TableCell className="font-medium cursor-pointer hover:text-blue-600 hover:underline" onClick={() => openEdit(rh)}>{rh.full_name}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{rh.email ?? "—"}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{rh.phone ?? "—"}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{aff?.member_no ?? "—"}</TableCell>
                                    <TableCell className="text-sm tabular-nums">{counts.contracts}</TableCell>
                                    <TableCell className="text-sm tabular-nums">{counts.works}</TableCell>
                                    <TableCell>
                                        {aff?.is_member
                                            ? <Badge className="bg-green-600 text-white text-xs">Medlem</Badge>
                                            : <Badge variant="outline" className="text-muted-foreground text-xs">Ikke-medlem</Badge>}
                                    </TableCell>
                                    <TableCell>
                                        {rh.onboarding_completed
                                            ? <Badge variant="secondary" className="gap-1 text-xs"><LogIn className="h-3 w-3" />Registreret</Badge>
                                            : (rh.invite_sent_at || hasLogin)
                                                ? <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">Afventer</Badge>
                                                : <span className="text-xs text-muted-foreground">Ikke inviteret</span>}
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
                                                <DropdownMenuItem onClick={() => router.push(`/admin/kontrakter?rh=${rh.id}`)}>
                                                    <FileText className="h-3.5 w-3.5 mr-2" />Se alle kontrakter
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => router.push(`/admin/vaerker?rh=${rh.id}`)}>
                                                    <Eye className="h-3.5 w-3.5 mr-2" />Se alle værker
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => toggleMember(rh)}>
                                                    {aff?.is_member
                                                        ? <><UserX className="h-3.5 w-3.5 mr-2 text-amber-500" />Udmeld</>
                                                        : <><UserCheck className="h-3.5 w-3.5 mr-2 text-green-600" />Indmeld</>}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                {!rh.onboarding_completed && rh.email && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "invite" }); setPortalLink(null) }}>
                                                        <Mail className="h-3.5 w-3.5 mr-2" />{rh.invite_sent_at || hasLogin ? "Gensend invitation" : "Send invitation"}
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
            </ResponsiveTableFrame>

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
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1"><Label>Email</Label><Input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.dk" /></div>
                            <div className="space-y-1"><Label>Telefon</Label><Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} placeholder="+45 12 34 56 78" /></div>
                        </div>
                        <div className="space-y-1"><Label>Adresse</Label><Input value={createForm.address} onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))} placeholder="Gade 1, 2100 København Ø" /></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1"><Label>CPR-nr.</Label><Input value={createForm.cpr_no} onChange={e => setCreateForm(f => ({ ...f, cpr_no: e.target.value }))} placeholder="DDMMÅÅ-XXXX" /></div>
                            <div className="space-y-1"><Label>Bankkonto</Label><Input autoComplete="off" value={createForm.bank_account} onChange={e => setCreateForm(f => ({ ...f, bank_account: e.target.value }))} placeholder="Reg.nr. og kontonr." /></div>
                            <div className="space-y-1">
                                <Label>DFKS medlemsnr.</Label>
                                <Input value={createForm.member_no} onChange={e => { setCreateMemberNoTouched(true); setCreateForm(f => ({ ...f, member_no: e.target.value })) }} placeholder="F.eks. 1042" />
                            </div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                            <input type="checkbox" id="create-is-member" checked={createForm.is_member} onChange={e => setCreateForm(f => ({ ...f, is_member: e.target.checked }))} className="h-4 w-4" />
                            <Label htmlFor="create-is-member" className="cursor-pointer">Registrér som aktivt medlem</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="create-send-invite" checked={createForm.send_invite} onChange={e => setCreateForm(f => ({ ...f, send_invite: e.target.checked }))} className="h-4 w-4" disabled={!createForm.email.trim()} />
                            <Label htmlFor="create-send-invite" className="cursor-pointer">Send invitationsmail med link{!createForm.email.trim() && <span className="text-muted-foreground"> (kræver email)</span>}</Label>
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
                <DialogContent className="w-[min(720px,calc(100vw-2rem))] !max-w-none sm:!max-w-none">
                    <DialogHeader>
                        <DialogTitle>Rediger rettighedshaver</DialogTitle>
                        <DialogDescription>{editTarget?.full_name}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1"><Label>Fuldt navn *</Label><Input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} /></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1"><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>Telefon</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
                        </div>
                        <div className="space-y-1"><Label>Adresse</Label><Input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} /></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1"><Label>CPR-nr.</Label><Input value={editForm.cpr_no} onChange={e => setEditForm(f => ({ ...f, cpr_no: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>Bankkonto</Label><Input autoComplete="off" value={editForm.bank_account} onChange={e => setEditForm(f => ({ ...f, bank_account: e.target.value }))} /></div>
                            <div className="space-y-1">
                                <Label>DFKS medlemsnr.</Label>
                                <Input value={editForm.member_no} onChange={e => { setEditMemberNoTouched(true); setEditForm(f => ({ ...f, member_no: e.target.value })) }} />
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label>Køn (statistik)</Label>
                                <Select value={editForm.gender || "__none__"} onValueChange={v => setEditForm(f => ({ ...f, gender: v === "__none__" ? "" : v }))}>
                                    <SelectTrigger><SelectValue placeholder="Ikke angivet" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">Ikke angivet</SelectItem>
                                        <SelectItem value="female">Kvinde</SelectItem>
                                        <SelectItem value="male">Mand</SelectItem>
                                        <SelectItem value="other">Andet</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-end gap-2 pb-2">
                                <input type="checkbox" id="edit-opt-out" checked={editForm.opt_out_statistics} onChange={e => setEditForm(f => ({ ...f, opt_out_statistics: e.target.checked }))} className="h-4 w-4" />
                                <Label htmlFor="edit-opt-out" className="cursor-pointer">Fravalgt statistik</Label>
                            </div>
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
