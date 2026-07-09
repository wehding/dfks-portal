"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Plus, Pencil, UserCheck, UserX, X, Loader2, Mail, KeyRound, Link, Link2Off, LogIn, RotateCcw, Trash2, UserMinus, Eye, FileText } from "lucide-react"
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
import { getDfksMembersSyncStatus, syncDfksMembers } from "@/app/actions/dfks-members"

type Filter = "alle" | "medlemmer" | "ikke-medlemmer"
type ConfirmAction =
    | { type: "unlink-contract"; id: string; title: string; description: string; destructive?: false }
    | { type: "delete-contract"; id: string; title: string; description: string; destructive: true }
    | { type: "remove-assignment"; id: string; title: string; description: string; destructive?: false }
    | { type: "delete-work"; id: string; title: string; description: string; destructive: true }
    | { type: "delete-all-works"; title: string; description: string; destructive: true }

type DetailContract = {
    id: string
    title: string
    type: string | null
    status: string | null
    created_at: string | null
    employer_name: string | null
}

type DetailWork = {
    id: string
    title: string
    type: string
    year: number | null
    director: string | null
    status: string | null
}

type DetailWorkAssignment = {
    id: string
    role: string | null
    share_percent: number | null
    works: DetailWork | null
}

type AdminUserResponse = {
    error?: string
    invite_url?: string
    reset_url?: string
    user_id?: string
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Fejl"
}

function getAffiliation(rh: RettighedshaverWithAffiliation, orgId: string) {
    return rh.org_affiliations?.find(a => a.org_id === orgId) ?? null
}

const EMPTY_FORM = {
    full_name: "", email: "", phone: "", address: "", cpr_no: "", bank_account: "", member_no: "", is_member: false,
    gender: "", opt_out_statistics: false,
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
    const [createForm, setCreateForm] = useState({ ...EMPTY_FORM })

    const [editTarget, setEditTarget] = useState<RettighedshaverWithAffiliation | null>(null)
    const [editSaving, setEditSaving] = useState(false)
    const [editForm, setEditForm] = useState({ ...EMPTY_FORM })

    // Portal-adgang
    const [portalAction, setPortalAction] = useState<{ rh: RettighedshaverWithAffiliation; type: "invite" | "reset" } | null>(null)
    const [portalLoading, setPortalLoading] = useState(false)
    const [portalLink, setPortalLink] = useState<string | null>(null)

    // Rettighedshaver detaljer dialog states
    const [detailsTarget, setDetailsTarget] = useState<RettighedshaverWithAffiliation | null>(null)
    const [contracts, setContracts] = useState<DetailContract[]>([])
    const [works, setWorks] = useState<DetailWorkAssignment[]>([])
    const [detailsLoading, setDetailsLoading] = useState(false)

    const [contractSearch, setContractSearch] = useState("")
    const [contractSort, setContractSort] = useState<"date" | "title" | "status">("date")
    const [contractFilter, setContractFilter] = useState<string>("alle")

    const [workSearch, setWorkSearch] = useState("")
    const [workSort, setWorkSort] = useState<"title" | "year">("title")
    const [syncingMembers, setSyncingMembers] = useState(false)
    const [memberSyncStatus, setMemberSyncStatus] = useState<{ count: number; syncedAt: string | null } | null>(null)
    const [workFilter, setWorkFilter] = useState<string>("alle")
    const [activeTab, setActiveTab] = useState<"contracts" | "works">("contracts")
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

    useEffect(() => {
        const supabase = createClient()
        supabase.auth.getUser().then(({ data: { user } }) => {
            const oid = user?.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
            setOrgId(oid)
            load(oid)
            refreshMemberSyncStatus()
        })
    }, [])

    useEffect(() => {
        if (detailsTarget) {
            loadDetails(detailsTarget.id)
        } else {
            setContracts([])
            setWorks([])
        }
    }, [detailsTarget])

    async function loadDetails(rhId: string) {
        setDetailsLoading(true)
        const supabase = createClient()
        
        const { data: cData } = await supabase
            .from("contracts")
            .select("id, working_title, type, status, created_at, work_id, employers(name)")
            .eq("rights_holder_id", rhId)
            .order("created_at", { ascending: false })

        type ContractRow = { id: string; working_title?: string | null; type?: string | null; status?: string | null; created_at?: string | null; employers?: { name?: string | null } | { name?: string | null }[] | null }
        setContracts(((cData ?? []) as ContractRow[]).map(c => ({
            id: c.id,
            title: c.working_title ?? "Kontrakt",
            type: c.type ?? null,
            status: c.status ?? null,
            created_at: c.created_at ?? null,
            employer_name: (Array.isArray(c.employers) ? c.employers[0]?.name : c.employers?.name) ?? null,
        })))

        const { data: wData } = await supabase
            .from("work_assignments")
            .select("id, role, share_percent, works(id, title, type, year, director, status)")
            .eq("rights_holder_id", rhId)
            
        setWorks((wData ?? []) as unknown as DetailWorkAssignment[])
        setDetailsLoading(false)
    }

    function handleUnlinkContract(contractId: string) {
        setConfirmAction({
            type: "unlink-contract",
            id: contractId,
            title: "Fjern kontrakttilknytning?",
            description: "Kontrakten fjernes fra dette medlem, men slettes ikke og forbliver i kontraktadministrationen.",
        })
    }

    async function unlinkContract(contractId: string) {
        const supabase = createClient()
        const { error } = await supabase.from("contracts").update({ rights_holder_id: null }).eq("id", contractId)
        if (error) {
            toast.error("Kunne ikke fjerne tilknytning: " + error.message)
        } else {
            toast.success("Tilknytning fjernet")
            if (detailsTarget) loadDetails(detailsTarget.id)
        }
    }

    function handleDeleteContract(contractId: string) {
        setConfirmAction({
            type: "delete-contract",
            id: contractId,
            title: "Slet kontrakt permanent?",
            description: "Kontrakten slettes permanent fra systemet. Denne handling kan ikke fortrydes.",
            destructive: true,
        })
    }

    async function deleteContract(contractId: string) {
        const supabase = createClient()
        await supabase.from("work_assignments").update({ contract_id: null }).eq("contract_id", contractId)
        
        const { error } = await supabase.from("contracts").delete().eq("id", contractId)
        
        if (error) {
            toast.error("Kunne ikke slette kontrakt: " + error.message)
        } else {
            toast.success("Kontrakt slettet")
            if (detailsTarget) loadDetails(detailsTarget.id)
        }
    }

    function handleRemoveAssignment(assignmentId: string) {
        setConfirmAction({
            type: "remove-assignment",
            id: assignmentId,
            title: "Fjern værktildeling?",
            description: "Medlemmets tildeling til værket fjernes. Selve værket slettes ikke.",
        })
    }

    async function removeAssignment(assignmentId: string) {
        const supabase = createClient()
        const { error } = await supabase.from("work_assignments").delete().eq("id", assignmentId)
        
        if (error) {
            toast.error("Kunne ikke fjerne tildeling: " + error.message)
        } else {
            toast.success("Tildeling fjernet")
            if (detailsTarget) loadDetails(detailsTarget.id)
        }
    }

    function handleDeleteWork(workId: string) {
        setConfirmAction({
            type: "delete-work",
            id: workId,
            title: "Slet værk permanent?",
            description: "Værket slettes permanent fra hele systemet og fjernes for alle tilknyttede brugere.",
            destructive: true,
        })
    }

    async function deleteWork(workId: string) {
        const supabase = createClient()
        await supabase.from("contracts").update({ work_id: null }).eq("work_id", workId)
        
        const { error } = await supabase.from("works").delete().eq("id", workId)
        
        if (error) {
            toast.error("Kunne ikke slette værk: " + error.message)
        } else {
            toast.success("Værk slettet permanent")
            if (detailsTarget) loadDetails(detailsTarget.id)
        }
    }

    function handleDeleteAllWorks() {
        if (works.length === 0) return
        setConfirmAction({
            type: "delete-all-works",
            title: "Slet alle værker permanent?",
            description: `Du er ved at slette alle ${works.length} værker permanent fra systemet, som dette medlem er tilknyttet. Værkerne slettes helt.`,
            destructive: true,
        })
    }

    async function deleteAllWorks() {
        const supabase = createClient()
        const workIds = works.map(w => w.works?.id).filter(Boolean)
        
        if (workIds.length === 0) return
        
        await supabase.from("contracts").update({ work_id: null }).in("work_id", workIds)
        
        const { error } = await supabase.from("works").delete().in("id", workIds)
        
        if (error) {
            toast.error("Kunne ikke slette alle værker: " + error.message)
        } else {
            toast.success("Alle værker slettet")
            if (detailsTarget) loadDetails(detailsTarget.id)
        }
    }

    async function confirmPendingAction() {
        if (!confirmAction) return
        const action = confirmAction
        setConfirmAction(null)
        if (action.type === "unlink-contract") await unlinkContract(action.id)
        if (action.type === "delete-contract") await deleteContract(action.id)
        if (action.type === "remove-assignment") await removeAssignment(action.id)
        if (action.type === "delete-work") await deleteWork(action.id)
        if (action.type === "delete-all-works") await deleteAllWorks()
    }

    async function load(oid: string) {
        setLoading(true)
        const data = await getRettighedshavere(oid)
        setRows(data)
        setLoading(false)
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
            { full_name: createForm.full_name.trim(), email: createForm.email || null, phone: createForm.phone || null, address: createForm.address || null, cpr_no: createForm.cpr_no || null, bank_account: createForm.bank_account || null },
            orgId, createForm.is_member, createForm.member_no || undefined
        )
        setCreateSaving(false)
        if (result) { toast.success(`${createForm.full_name} er oprettet`); setCreateOpen(false); load(orgId) }
        else toast.error("Kunne ikke oprette rettighedshaver")
    }

    function openEdit(rh: RettighedshaverWithAffiliation) {
        const aff = orgId ? getAffiliation(rh, orgId) : null
        const extra = rh as { gender?: string | null; opt_out_statistics?: boolean | null }
        setEditForm({ full_name: rh.full_name, email: rh.email ?? "", phone: rh.phone ?? "", address: rh.address ?? "", cpr_no: rh.cpr_no ?? "", bank_account: rh.bank_account ?? "", member_no: aff?.member_no ?? "", is_member: aff?.is_member ?? false, gender: extra.gender ?? "", opt_out_statistics: Boolean(extra.opt_out_statistics) })
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
                // Opdater lokal state med ny user_id
                setRows(prev => prev.map(r => r.id === rh.id ? { ...r, user_id: json.user_id ?? null } : r))
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
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {memberSyncStatus && (
                            <span className="text-xs text-muted-foreground">
                                DFKS liste: {memberSyncStatus.count} · {memberSyncStatus.syncedAt ? new Date(memberSyncStatus.syncedAt).toLocaleString("da-DK") : "aldrig"}
                            </span>
                        )}
                        <Button size="sm" variant="outline" onClick={handleSyncDfksMembers} disabled={syncingMembers}>
                            {syncingMembers ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                            Opdater DFKS medlemsliste
                        </Button>
                        <Button size="sm" onClick={() => { setCreateForm({ ...EMPTY_FORM }); setCreateOpen(true) }}>
                            <Plus className="h-4 w-4 mr-1" />Opret ny
                        </Button>
                    </div>
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
                            <TableHead>DFKS medlemsnr.</TableHead>
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
                                    <TableCell className="font-medium cursor-pointer hover:text-blue-600 hover:underline" onClick={() => openEdit(rh)}>{rh.full_name}</TableCell>
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
                                                <DropdownMenuItem onClick={() => setDetailsTarget(rh)}>
                                                    <Eye className="h-3.5 w-3.5 mr-2" />Vis detaljer
                                                </DropdownMenuItem>
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
                            <div className="space-y-1"><Label>Bankkonto</Label><Input autoComplete="off" value={createForm.bank_account} onChange={e => setCreateForm(f => ({ ...f, bank_account: e.target.value }))} placeholder="Reg.nr. og kontonr." /></div>
                            <div className="space-y-1"><Label>DFKS medlemsnr.</Label><Input value={createForm.member_no} onChange={e => setCreateForm(f => ({ ...f, member_no: e.target.value }))} placeholder="F.eks. 1042" /></div>
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
                <DialogContent className="w-[min(720px,calc(100vw-2rem))] !max-w-none sm:!max-w-none">
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
                            <div className="space-y-1"><Label>Bankkonto</Label><Input autoComplete="off" value={editForm.bank_account} onChange={e => setEditForm(f => ({ ...f, bank_account: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>DFKS medlemsnr.</Label><Input value={editForm.member_no} onChange={e => setEditForm(f => ({ ...f, member_no: e.target.value }))} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
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
                        <Button type="button" variant="outline" className="w-full gap-2" onClick={() => { if (editTarget) setDetailsTarget(editTarget) }}>
                            <Eye className="h-4 w-4" />Tilknyttede værker og kontrakter
                        </Button>
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

            {/* Medlem detaljer dialog (Kontrakter & Værker) */}
            <Dialog open={!!detailsTarget} onOpenChange={open => { if (!open) setDetailsTarget(null) }}>
                <DialogContent className="w-[min(1100px,calc(100vw-2rem))] !max-w-none sm:!max-w-none max-h-[85vh] flex flex-col p-6 overflow-hidden">
                    <DialogHeader className="flex-shrink-0">
                        <DialogTitle className="text-xl font-bold flex items-center justify-between">
                            <span>{detailsTarget?.full_name}</span>
                            <Badge variant="outline" className="text-xs ml-2">
                                {detailsTarget?.email ?? "Ingen email"}
                            </Badge>
                        </DialogTitle>
                        <DialogDescription>
                            Oversigt og administration af medlemmets tilknyttede kontrakter og værker.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Fanevælger */}
                    <div className="flex border-b border-gray-200 mt-4 flex-shrink-0">
                        <button
                          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === "contracts" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
                          onClick={() => setActiveTab("contracts")}
                        >
                          Kontrakter ({contracts.length})
                        </button>
                        <button
                          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === "works" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
                          onClick={() => setActiveTab("works")}
                        >
                          Værker ({works.length})
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto py-4">
                        {detailsLoading ? (
                            <div className="py-20 text-center text-muted-foreground"><Loader2 className="inline h-6 w-6 animate-spin mr-2" />Henter data...</div>
                        ) : activeTab === "contracts" ? (
                            // Fanen: Kontrakter
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2 items-center justify-between bg-gray-50 p-3 rounded-lg">
                                    <div className="flex gap-2 items-center flex-1 min-w-[200px]">
                                        <Search className="h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Søg kontrakt..."
                                            value={contractSearch}
                                            onChange={e => setContractSearch(e.target.value)}
                                            className="h-8 text-xs bg-white"
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <Select value={contractFilter} onValueChange={setContractFilter}>
                                            <SelectTrigger className="h-8 text-xs w-28 bg-white"><SelectValue placeholder="Filter" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="alle">Alle</SelectItem>
                                                <SelectItem value="godkendt">Godkendt</SelectItem>
                                                <SelectItem value="til_godkendelse">Til godkendelse</SelectItem>
                                                <SelectItem value="kladde">Kladde</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={contractSort} onValueChange={v => setContractSort(v as "date" | "title" | "status")}>
                                            <SelectTrigger className="h-8 text-xs w-32 bg-white"><SelectValue placeholder="Sorter" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="date">Nyeste først</SelectItem>
                                                <SelectItem value="title">Titel A-Å</SelectItem>
                                                <SelectItem value="status">Status</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {(() => {
                                    const filteredContracts = contracts
                                        .filter(c => {
                                            if (contractFilter !== "alle" && c.status !== contractFilter) return false
                                            if (contractSearch) {
                                                const q = contractSearch.toLowerCase()
                                                return (
                                                    c.title?.toLowerCase().includes(q) ||
                                                    c.employer_name?.toLowerCase().includes(q)
                                                )
                                            }
                                            return true
                                        })
                                        .sort((a, b) => {
                                            if (contractSort === "title") return (a.title || "").localeCompare(b.title || "")
                                            if (contractSort === "status") return (a.status || "").localeCompare(b.status || "")
                                            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
                                        });

                                    if (filteredContracts.length === 0) {
                                        return <p className="text-center text-sm py-10 text-muted-foreground">Ingen kontrakter fundet</p>;
                                    }

                                    return (
                                        <div className="border rounded-lg overflow-hidden bg-white">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="text-xs">Titel / Selskab</TableHead>
                                                        <TableHead className="text-xs">Type</TableHead>
                                                        <TableHead className="text-xs">Oprettet</TableHead>
                                                        <TableHead className="text-xs">Status</TableHead>
                                                        <TableHead className="w-16"></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {filteredContracts.map(c => (
                                                        <TableRow key={c.id}>
                                                            <TableCell>
                                                                <button type="button" onClick={() => router.push(`/admin/kontrakter?edit=${c.id}`)} className="text-left">
                                                                    <div className="font-semibold text-xs text-gray-900 hover:text-blue-600 hover:underline">{c.title}</div>
                                                                    <div className="text-[10px] text-gray-500">{c.employer_name || "Ukendt producent"}</div>
                                                                </button>
                                                            </TableCell>
                                                            <TableCell className="text-xs capitalize">{c.type}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">{c.created_at ? new Date(c.created_at).toLocaleDateString("da-DK") : "—"}</TableCell>
                                                            <TableCell>
                                                                <Badge variant={c.status === "godkendt" ? "default" : c.status === "til_godkendelse" ? "secondary" : "outline"} className="text-[10px] py-0.5">
                                                                    {c.status}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-1">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                                        title="Fjern tilknytning (behold kontrakt)"
                                                                        onClick={() => handleUnlinkContract(c.id)}
                                                                    >
                                                                        <Link2Off className="h-4 w-4" />
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                                        title="Slet kontrakt helt"
                                                                        onClick={() => handleDeleteContract(c.id)}
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    );
                                })()}
                            </div>
                        ) : (
                            // Fanen: Værker
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2 items-center justify-between bg-gray-50 p-3 rounded-lg">
                                    <div className="flex gap-2 items-center flex-1 min-w-[200px]">
                                        <Search className="h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Søg værk..."
                                            value={workSearch}
                                            onChange={e => setWorkSearch(e.target.value)}
                                            className="h-8 text-xs bg-white"
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <Select value={workFilter} onValueChange={workFilter => setWorkFilter(workFilter)}>
                                            <SelectTrigger className="h-8 text-xs w-28 bg-white"><SelectValue placeholder="Filter" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="alle">Alle</SelectItem>
                                                <SelectItem value="film">Kun film</SelectItem>
                                                <SelectItem value="serie">Kun serier</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={workSort} onValueChange={v => setWorkSort(v as "title" | "year")}>
                                            <SelectTrigger className="h-8 text-xs w-32 bg-white"><SelectValue placeholder="Sorter" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="title">Titel A-Å</SelectItem>
                                                <SelectItem value="year">Årstal</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {works.length > 0 && (
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                className="h-8 text-xs gap-1"
                                                onClick={handleDeleteAllWorks}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Slet alle værker helt
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {(() => {
                                    const filteredWorks = works
                                        .filter(wa => {
                                            const w = wa.works
                                            if (!w) return false
                                            if (workFilter === "film" && w.type.includes("serie")) return false
                                            if (workFilter === "serie" && !w.type.includes("serie")) return false
                                            if (workSearch) {
                                                const q = workSearch.toLowerCase()
                                                return (
                                                    w.title?.toLowerCase().includes(q) ||
                                                    w.director?.toLowerCase().includes(q) ||
                                                    wa.role?.toLowerCase().includes(q)
                                                )
                                            }
                                            return true
                                        })
                                        .sort((a, b) => {
                                            const wa = a.works
                                            const wb = b.works
                                            if (!wa || !wb) return 0
                                            if (workSort === "year") return (wb.year ?? 0) - (wa.year ?? 0)
                                            return (wa.title || "").localeCompare(wb.title || "")
                                        });

                                    if (filteredWorks.length === 0) {
                                        return <p className="text-center text-sm py-10 text-muted-foreground">Ingen værker fundet</p>;
                                    }

                                    return (
                                        <div className="border rounded-lg overflow-hidden bg-white">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="text-xs">Titel</TableHead>
                                                        <TableHead className="text-xs">Type</TableHead>
                                                        <TableHead className="text-xs">Rolle / Varighed</TableHead>
                                                        <TableHead className="text-xs">Status</TableHead>
                                                        <TableHead className="w-20"></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {filteredWorks.map(wa => {
                                                        const w = wa.works;
                                                        if (!w) return null;
                                                        return (
                                                            <TableRow key={wa.id}>
                                                                <TableCell>
                                                                    <button type="button" onClick={() => router.push(`/admin/vaerker?edit=${w.id}`)} className="text-left">
                                                                        <div className="font-semibold text-xs text-gray-900 hover:text-blue-600 hover:underline">{w.title}</div>
                                                                        <div className="text-[10px] text-gray-500">
                                                                            {w.director ? `Instruktør: ${w.director}` : ""} {w.year ? `(${w.year})` : ""}
                                                                        </div>
                                                                    </button>
                                                                </TableCell>
                                                                <TableCell className="text-xs capitalize">{w.type}</TableCell>
                                                                <TableCell>
                                                                    <div className="text-xs font-semibold text-blue-700">{wa.role || "Klipper"}</div>
                                                                    <div className="text-[10px] text-muted-foreground">{wa.share_percent ? `Ejerandel: ${wa.share_percent}%` : ""}</div>
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Badge variant={w.status === "godkendt" ? "default" : w.status === "til_godkendelse" ? "secondary" : "outline"} className="text-[10px] py-0.5">
                                                                        {w.status || "aktiv"}
                                                                    </Badge>
                                                                </TableCell>
                                                                <TableCell>
                                                                    <div className="flex gap-1">
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                                                                            title="Fjern kun tildeling"
                                                                            onClick={() => handleRemoveAssignment(wa.id)}
                                                                        >
                                                                            <UserMinus className="h-4 w-4" />
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                                            title="Slet værk helt fra databasen"
                                                                            onClick={() => handleDeleteWork(w.id)}
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(confirmAction)} onOpenChange={open => !open && setConfirmAction(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{confirmAction?.title}</DialogTitle>
                        <DialogDescription>{confirmAction?.description}</DialogDescription>
                    </DialogHeader>
                    {confirmAction?.destructive && (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                            Denne handling kan ikke fortrydes fra denne side.
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmAction(null)}>
                            Annuller
                        </Button>
                        <Button variant={confirmAction?.destructive ? "destructive" : "default"} onClick={confirmPendingAction}>
                            {confirmAction?.destructive ? "Slet permanent" : "Fjern tilknytning"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
