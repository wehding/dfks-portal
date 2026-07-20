"use client"

import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Search, Plus, Pencil, UserCheck, UserX, X, Loader2, Mail, KeyRound, Link, LogIn, RotateCcw, Eye, FileText, Trash2, ArchiveRestore, ArrowUpDown } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import {
    getRettighedshavere,
    setMemberStatus,
    setAffiliationEnd,
    type RettighedshaverWithAffiliation,
} from "@/lib/db/rettighedshavere"
import { createRettighedshaverSecure, updateRettighedshaverSecure } from "@/app/actions/rettighedshavere"
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
import { getDfksMemberImportPreview, getDfksMembersSyncStatus, importDfksMembersToRightsHolders, syncDfksMembers } from "@/app/actions/dfks-members"
import { archiveRightsHolders, permanentlyDeleteRightsHolders, restoreRightsHolders } from "@/app/actions/rights-holder-admin"

type Filter = "alle" | "medlemmer" | "ikke-medlemmer" | "afventer" | "ikke-inviteret" | "registreret" | "alle-kontrakter-valideret" | "arkiverede"
type SortKey = "name" | "email" | "member_no" | "contracts" | "works" | "status" | "portal" | "validated"
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
    allContractsValidated: boolean
}
type ImportCandidate = {
    id: string
    full_name: string
    email: string | null
    display_id: string | null
    status: string
    phone: string | null
    address: string | null
    match: "new" | "existing" | "ambiguous"
    rights_holder_id: string | null
    match_reason: string | null
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
    const [sortKey, setSortKey] = useState<SortKey>("name")
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

    const [createOpen, setCreateOpen] = useState(false)
    const [createSaving, setCreateSaving] = useState(false)
    const [bulkSendingInvitations, setBulkSendingInvitations] = useState(false)
    const [createForm, setCreateForm] = useState({ ...EMPTY_FORM })
    const [createMemberNoTouched, setCreateMemberNoTouched] = useState(false)

    const [editTarget, setEditTarget] = useState<RettighedshaverWithAffiliation | null>(null)
    const [editSaving, setEditSaving] = useState(false)
    const [editForm, setEditForm] = useState({ ...EMPTY_FORM })
    const [editMemberNoTouched, setEditMemberNoTouched] = useState(false)

    // Portal-adgang
    const [portalAction, setPortalAction] = useState<{ rh: RettighedshaverWithAffiliation; type: "invite" | "reminder" | "reset" } | null>(null)
    const [portalLoading, setPortalLoading] = useState(false)
    const [portalLink, setPortalLink] = useState<string | null>(null)

    const [syncingMembers, setSyncingMembers] = useState(false)
    const [memberSyncStatus, setMemberSyncStatus] = useState<{ count: number; syncedAt: string | null } | null>(null)
    const [memberSyncSummary, setMemberSyncSummary] = useState<{ updated: number; newCount: number; ambiguous: number; source: "org" | "env" | null } | null>(null)
    const [dfksMembers, setDfksMembers] = useState<DfksMemberOption[]>([])
    const [countsByRightsHolder, setCountsByRightsHolder] = useState<Record<string, RightsHolderCounts>>({})
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [archivingSelected, setArchivingSelected] = useState(false)
    const [restoringSelected, setRestoringSelected] = useState(false)
    const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false)
    const [permanentDeleting, setPermanentDeleting] = useState(false)
    const [deleteContracts, setDeleteContracts] = useState(false)
    const [deleteUnsharedWorks, setDeleteUnsharedWorks] = useState(true)
    const [deleteConfirmation, setDeleteConfirmation] = useState("")
    const [importOpen, setImportOpen] = useState(false)
    const [importLoading, setImportLoading] = useState(false)
    const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([])
    const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set())
    const [importingMembers, setImportingMembers] = useState(false)

    useEffect(() => {
        const supabase = createClient()
        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) return
            const { data: roleRow } = await supabase
                .from("user_org_roles")
                .select("org_id")
                .eq("user_id", user.id)
                .limit(1)
                .maybeSingle()
            const oid = roleRow?.org_id
            if (!oid) {
                toast.error("Din bruger er ikke knyttet til en organisation.")
                return
            }
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
                .select("rights_holder_id, status")
                .eq("org_id", oid)
                .not("rights_holder_id", "is", null),
            supabase
                .from("work_assignments")
                .select("rights_holder_id")
                .eq("org_id", oid)
                .not("rights_holder_id", "is", null),
        ])

        const next: Record<string, RightsHolderCounts> = {}
        const contractStatuses: Record<string, string[]> = {}
        for (const row of (contracts ?? []) as Array<{ rights_holder_id: string | null; status?: string | null }>) {
            if (!row.rights_holder_id) continue
            next[row.rights_holder_id] ??= { contracts: 0, works: 0, allContractsValidated: false }
            next[row.rights_holder_id].contracts += 1
            contractStatuses[row.rights_holder_id] ??= []
            contractStatuses[row.rights_holder_id].push(row.status ?? "")
        }
        for (const row of (assignments ?? []) as Array<{ rights_holder_id: string | null }>) {
            if (!row.rights_holder_id) continue
            next[row.rights_holder_id] ??= { contracts: 0, works: 0, allContractsValidated: false }
            next[row.rights_holder_id].works += 1
        }
        for (const [rightsHolderId, statuses] of Object.entries(contractStatuses)) {
            next[rightsHolderId].allContractsValidated = statuses.length > 0 && statuses.every(status => ["valideret", "validated", "arkiveret"].includes(status))
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
        toast.success(`${result.count ?? 0} medlemmer hentet. ${result.updatedExisting ?? 0} eksisterende rettighedshavere opdateret.`)
        setMemberSyncStatus({ count: result.count ?? 0, syncedAt: result.syncedAt ?? new Date().toISOString() })
        setMemberSyncSummary({
            updated: result.updatedExisting ?? 0,
            newCount: result.newCount ?? 0,
            ambiguous: result.ambiguousCount ?? 0,
            source: result.source ?? null,
        })
        if (orgId) await loadDfksMembers(orgId)
        await refreshImportPreview()
    }

    async function refreshImportPreview() {
        setImportLoading(true)
        const preview = await getDfksMemberImportPreview()
        setImportLoading(false)
        if (!preview.success) {
            toast.error(preview.error ?? "Kunne ikke hente importlisten")
            return
        }
        setImportCandidates(preview.candidates)
        setSelectedImportIds(new Set(preview.candidates.filter(candidate => candidate.match === "new" && candidate.status !== "resigned").map(candidate => candidate.id)))
    }

    async function openImportDialog() {
        setImportOpen(true)
        setImportLoading(true)
        const result = await syncDfksMembers()
        if (!result.success) {
            toast.error(result.error ?? "Kunne ikke hente medlemslisten")
            setImportLoading(false)
            await refreshImportPreview()
            return
        }
        setMemberSyncStatus({ count: result.count ?? 0, syncedAt: result.syncedAt ?? new Date().toISOString() })
        setMemberSyncSummary({
            updated: result.updatedExisting ?? 0,
            newCount: result.newCount ?? 0,
            ambiguous: result.ambiguousCount ?? 0,
            source: result.source ?? null,
        })
        if (orgId) await loadDfksMembers(orgId)
        await refreshImportPreview()
    }

    async function handleImportSelectedMembers() {
        if (!orgId || selectedImportIds.size === 0) return
        setImportingMembers(true)
        const result = await importDfksMembersToRightsHolders(Array.from(selectedImportIds))
        setImportingMembers(false)
        if (!result.success) {
            toast.error(result.error ?? "Kunne ikke importere medlemmer")
            return
        }
        toast.success(`${result.created} oprettet, ${result.updated} opdateret, ${result.skipped} sprunget over`)
        setImportOpen(false)
        setSelectedImportIds(new Set())
        await load(orgId)
        await loadOverviewCounts(orgId)
        await refreshMemberSyncStatus()
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

    const visible = useMemo(() => {
        const q = search.toLowerCase().trim()
        const list = rows.filter(rh => {
            const aff = orgId ? getAffiliation(rh, orgId) : null
            const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
            const archived = Boolean(rh.archived_at)
            if (filter === "arkiverede") {
                if (!archived) return false
            } else if (archived) {
                return false
            }
            if (filter === "medlemmer" && !aff?.is_member) return false
            if (filter === "ikke-medlemmer" && aff?.is_member) return false
            if (filter === "alle-kontrakter-valideret" && !counts.allContractsValidated) return false
            const invStatus = rh.onboarding_completed ? "registreret" : rh.invite_sent_at ? "afventer" : "ikke-inviteret"
            if ((filter === "afventer" || filter === "ikke-inviteret" || filter === "registreret") && invStatus !== filter) return false
            if (q) {
                return (
                    rh.full_name.toLowerCase().includes(q) ||
                    rh.email?.toLowerCase().includes(q) ||
                    rh.phone?.toLowerCase().includes(q) ||
                    aff?.member_no?.toLowerCase().includes(q)
                )
            }
            return true
        })

        return list.sort((a, b) => {
            const affA = orgId ? getAffiliation(a, orgId) : null
            const affB = orgId ? getAffiliation(b, orgId) : null
            const countsA = countsByRightsHolder[a.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
            const countsB = countsByRightsHolder[b.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
            const direction = sortDirection === "asc" ? 1 : -1
            const textCompare = (left: string | null | undefined, right: string | null | undefined) =>
                (left ?? "").localeCompare(right ?? "", "da")
            let result = 0
            if (sortKey === "name") result = textCompare(a.full_name, b.full_name)
            if (sortKey === "email") result = textCompare(a.email, b.email)
            if (sortKey === "member_no") result = textCompare(affA?.member_no, affB?.member_no)
            if (sortKey === "contracts") result = countsA.contracts - countsB.contracts
            if (sortKey === "works") result = countsA.works - countsB.works
            if (sortKey === "status") result = Number(Boolean(affA?.is_member)) - Number(Boolean(affB?.is_member))
            if (sortKey === "portal") result = Number(Boolean(a.user_id)) - Number(Boolean(b.user_id))
            if (sortKey === "validated") result = Number(countsA.allContractsValidated) - Number(countsB.allContractsValidated)
            return result * direction
        })
    }, [rows, orgId, filter, search, countsByRightsHolder, sortKey, sortDirection])
    const visibleIds = visible.map(rh => rh.id)
    const selectedVisibleCount = visibleIds.filter(id => selectedIds.has(id)).length
    const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length

    function toggleSelected(id: string, checked: boolean) {
        setSelectedIds(current => {
            const next = new Set(current)
            if (checked) next.add(id)
            else next.delete(id)
            return next
        })
    }

    function toggleAllVisible(checked: boolean) {
        setSelectedIds(current => {
            const next = new Set(current)
            for (const id of visibleIds) {
                if (checked) next.add(id)
                else next.delete(id)
            }
            return next
        })
    }

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

    async function sendReminderFor(rhId: string, email: string, name: string): Promise<AdminUserResponse | null> {
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reminder", email, name, rhId }),
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
        const result = await createRettighedshaverSecure(
            { full_name: createForm.full_name.trim(), email: createForm.email || null, phone: createForm.phone || null, address: createForm.address || null, cpr_no: createForm.cpr_no || null, bank_account: createForm.bank_account || null },
            orgId, createForm.is_member, createForm.member_no || undefined
        )
        if (result.success && result.rightsHolder) {
            toast.success(`${createForm.full_name} er oprettet`)
            // Send invitationsmail med det samme, hvis valgt og email er angivet
            if (createForm.send_invite && createForm.email.trim()) {
                const json = await sendInviteFor(result.rightsHolder.id, createForm.email.trim(), createForm.full_name.trim())
                if (json?.email_sent) toast.success(`Invitation sendt til ${createForm.email.trim()}`)
                else if (json) toast.warning("Oprettet, men invitationsmailen kunne ikke sendes.")
            }
            setCreateSaving(false)
            setCreateOpen(false); load(orgId); loadOverviewCounts(orgId)
        } else {
            setCreateSaving(false)
            toast.error(result.error ?? "Kunne ikke oprette rettighedshaver")
        }
    }

    async function handleBulkSendInvitation() {
        if (!orgId) return
        if (selectedIds.size === 0) return
        const targets = visible.filter(rh => selectedIds.has(rh.id) && rh.email && !rh.onboarding_completed)
        if (targets.length === 0) { toast.info("Ingen at invitere — de valgte er enten registreret eller mangler email."); return }
        if (!confirm(`Send invitation til ${targets.length} valgt(e) person(er)? Personer der allerede har fået en invitation får en 2. invitation.`)) return
        setBulkSendingInvitations(true)
        let sent = 0
        for (const rh of targets) {
            const json = rh.invite_sent_at
                ? await sendReminderFor(rh.id, rh.email!, rh.full_name)
                : await sendInviteFor(rh.id, rh.email!, rh.full_name)
            if (json?.email_sent) sent++
        }
        setBulkSendingInvitations(false)
        toast.success(`${sent} af ${targets.length} invitationer sendt`)
        load(orgId)
    }

    async function handleArchiveSelected() {
        if (!orgId || selectedIds.size === 0) return
        const names = visible.filter(rh => selectedIds.has(rh.id)).map(rh => rh.full_name)
        if (!confirm(`Arkivér ${selectedIds.size} rettighedshaver(e)? De skjules i listen, men kan gendannes.\n\n${names.slice(0, 8).join("\n")}${names.length > 8 ? "\n..." : ""}`)) return
        setArchivingSelected(true)
        const result = await archiveRightsHolders(Array.from(selectedIds))
        setArchivingSelected(false)
        if (!result.success) {
            toast.error(result.error ?? "Rettighedshavere kunne ikke arkiveres")
            return
        }
        if (result.archivedCount > 0) toast.success(`${result.archivedCount} rettighedshaver(e) arkiveret`)
        if (result.blocked.length > 0) {
            toast.warning(`${result.blocked.length} kunne ikke arkiveres: ${result.blocked.slice(0, 3).map(item => item.name).join(", ")}`)
        }
        setSelectedIds(new Set())
        await load(orgId)
        await loadOverviewCounts(orgId)
    }

    async function handleRestoreSelected() {
        if (!orgId || selectedIds.size === 0) return
        setRestoringSelected(true)
        const result = await restoreRightsHolders(Array.from(selectedIds))
        setRestoringSelected(false)
        if (!result.success) {
            toast.error(result.error ?? "Rettighedshavere kunne ikke gendannes")
            return
        }
        toast.success(`${result.restoredCount} rettighedshaver(e) gendannet`)
        setSelectedIds(new Set())
        await load(orgId)
    }

    async function handlePermanentDeleteSelected() {
        if (!orgId || selectedIds.size === 0 || deleteConfirmation !== "SLET") return
        setPermanentDeleting(true)
        const result = await permanentlyDeleteRightsHolders(Array.from(selectedIds), { deleteContracts, deleteUnsharedWorks })
        setPermanentDeleting(false)
        if (!result.success) {
            toast.error(result.error ?? "Rettighedshavere kunne ikke slettes permanent")
            return
        }
        toast.success(`${result.deletedCount} slettet permanent. ${result.deletedContracts} kontrakter og ${result.deletedWorks} værker slettet.`)
        setPermanentDeleteOpen(false)
        setDeleteConfirmation("")
        setSelectedIds(new Set())
        await load(orgId)
        await loadOverviewCounts(orgId)
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
        const updateResult = await updateRettighedshaverSecure(editTarget.id, orgId, { full_name: editForm.full_name.trim(), email: editForm.email || null, phone: editForm.phone || null, address: editForm.address || null, cpr_no: editForm.cpr_no || null, bank_account: editForm.bank_account || null, gender: editForm.gender || null, opt_out_statistics: editForm.opt_out_statistics })
        if (!updateResult.success) {
            setEditSaving(false)
            toast.error(updateResult.error ?? "Kunne ikke gemme")
            return
        }
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
                        : type === "reminder"
                            ? { action: "reminder", email: rh.email, name: rh.full_name, rhId: rh.id }
                        : { action: "reset", userId: rh.user_id, email: rh.email }
                ),
            })
            const json = await res.json() as AdminUserResponse
            if (!res.ok) throw new Error(json.error)
            const link = type === "invite" || type === "reminder" ? json.invite_url : json.reset_url
            setPortalLink(link ?? null)
            if (type === "invite" || type === "reminder") {
                const inviteSentAt = json.email_sent ? new Date().toISOString() : rh.invite_sent_at ?? null
                setRows(prev => prev.map(r => r.id === rh.id ? { ...r, user_id: json.user_id ?? null, invite_sent_at: inviteSentAt } : r))
                if (json.email_sent) toast.success(type === "reminder" ? `2. invitation sendt til ${rh.email}` : `Invitation sendt til ${rh.email}`)
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
    const validatedCount = rows.filter(rh => countsByRightsHolder[rh.id]?.allContractsValidated).length

    function setSort(nextKey: SortKey) {
        if (sortKey === nextKey) {
            setSortDirection(direction => direction === "asc" ? "desc" : "asc")
            return
        }
        setSortKey(nextKey)
        setSortDirection("asc")
    }

    function SortHeader({ sort, children }: { sort: SortKey; children: ReactNode }) {
        return (
            <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => setSort(sort)}>
                {children}
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Rettighedshavere"
                subtitle="Klippere tilknyttet organisationen"
                actions={
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        {memberSyncStatus && (
                            <span className="text-xs text-muted-foreground">
                                Medlemsliste: {memberSyncStatus.count} · {memberSyncStatus.syncedAt ? new Date(memberSyncStatus.syncedAt).toLocaleString("da-DK") : "aldrig"}
                            </span>
                        )}
                        <Button size="sm" variant="outline" onClick={openImportDialog} disabled={syncingMembers || importLoading}>
                            {syncingMembers || importLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                            Hent fra medlemssystem
                        </Button>
                        <Button size="sm" onClick={() => { setCreateForm({ ...EMPTY_FORM }); setCreateMemberNoTouched(false); setCreateOpen(true) }}>
                            <Plus className="h-4 w-4 mr-1" />Indtast medlem manuelt
                        </Button>
                    </div>
                }
            />

            {/* Stats strip */}
            {!loading && (
                <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-5">
                    {[
                        { label: "I alt",             value: rows.length    },
                        { label: "Aktive medlemmer",  value: memberCount    },
                        { label: "Ikke-medlemmer",    value: nonMemberCount },
                        { label: "Med portal-adgang", value: portalCount    },
                        { label: "Kontrakter valideret", value: validatedCount },
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
                        <SelectItem value="alle-kontrakter-valideret">Alle kontrakter valideret</SelectItem>
                        <SelectItem value="arkiverede">Arkiverede</SelectItem>
                    </SelectContent>
                </Select>
                <Button
                    type="button"
                    variant="outline"
                    className="sm:hidden"
                    onClick={() => toggleAllVisible(!allVisibleSelected)}
                    disabled={visibleIds.length === 0}
                >
                    {allVisibleSelected ? "Fravælg alle viste" : "Vælg alle viste"}
                </Button>
            </div>

            {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                    <div className="text-sm font-medium">{selectedIds.size} valgt</div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>Ryd valg</Button>
                        <Button size="sm" variant="outline" onClick={handleBulkSendInvitation} disabled={bulkSendingInvitations}>
                            {bulkSendingInvitations ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />}
                            Send invitation
                        </Button>
                        {filter === "arkiverede" ? (
                            <Button size="sm" variant="outline" onClick={handleRestoreSelected} disabled={restoringSelected}>
                                {restoringSelected ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-1 h-4 w-4" />}
                                Gendan valgte
                            </Button>
                        ) : (
                            <Button size="sm" variant="outline" onClick={handleArchiveSelected} disabled={archivingSelected}>
                                {archivingSelected ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
                                Arkivér valgte
                            </Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => setPermanentDeleteOpen(true)}>
                            Slet permanent
                        </Button>
                    </div>
                </div>
            )}

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
                    const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
                    return (
                        <MobileDataCard key={rh.id}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 gap-3">
                                    <input
                                        type="checkbox"
                                        className="mt-1 h-4 w-4 shrink-0"
                                        checked={selectedIds.has(rh.id)}
                                        onChange={event => toggleSelected(rh.id, event.target.checked)}
                                        aria-label={`Vælg ${rh.full_name}`}
                                    />
                                    <button className="min-w-0 text-left" onClick={() => openEdit(rh)}>
                                        <p className="truncate font-medium">{rh.full_name}</p>
                                        <p className="mt-1 truncate text-sm text-muted-foreground">{rh.email ?? "Ingen email"}</p>
                                    </button>
                                </div>
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
                                    <div className="flex flex-wrap gap-1">
                                        {rh.archived_at && <Badge variant="outline" className="text-xs">Arkiveret</Badge>}
                                        {aff?.is_member
                                            ? <Badge className="bg-green-600 text-white text-xs">Medlem</Badge>
                                            : <Badge variant="outline" className="text-muted-foreground text-xs">Ikke-medlem</Badge>}
                                        {counts.allContractsValidated && <Badge className="bg-emerald-600 text-white text-xs">Alle kontrakter valideret</Badge>}
                                    </div>
                                </MobileMetaRow>
                                <MobileMetaRow label="Portaladgang">
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
                            <TableHead className="w-10">
                                <input
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    onChange={event => toggleAllVisible(event.target.checked)}
                                    aria-label="Vælg alle synlige"
                                />
                            </TableHead>
                            <TableHead><SortHeader sort="name">Navn</SortHeader></TableHead>
                            <TableHead><SortHeader sort="email">Email</SortHeader></TableHead>
                            <TableHead>Telefon</TableHead>
                            <TableHead><SortHeader sort="member_no">DFKS medlemsnr.</SortHeader></TableHead>
                            <TableHead><SortHeader sort="contracts">Kontrakter</SortHeader></TableHead>
                            <TableHead><SortHeader sort="works">Værker</SortHeader></TableHead>
                            <TableHead><SortHeader sort="status">Status</SortHeader></TableHead>
                            <TableHead><SortHeader sort="portal">Portaladgang</SortHeader></TableHead>
                            <TableHead><SortHeader sort="validated">Onboarding</SortHeader></TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={11} className="py-10 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Henter...</TableCell></TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow><TableCell colSpan={11} className="py-10 text-center text-muted-foreground">Ingen rettighedshavere fundet</TableCell></TableRow>
                        ) : visible.map(rh => {
                            const aff = orgId ? getAffiliation(rh, orgId) : null
                            const hasLogin = !!rh.user_id
                            const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
                            return (
                                <TableRow key={rh.id}>
                                    <TableCell>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(rh.id)}
                                            onChange={event => toggleSelected(rh.id, event.target.checked)}
                                            aria-label={`Vælg ${rh.full_name}`}
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium cursor-pointer hover:text-blue-600 hover:underline" onClick={() => openEdit(rh)}>{rh.full_name}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{rh.email ?? "—"}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{rh.phone ?? "—"}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{aff?.member_no ?? "—"}</TableCell>
                                    <TableCell className="text-sm tabular-nums">{counts.contracts}</TableCell>
                                    <TableCell className="text-sm tabular-nums">{counts.works}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {rh.archived_at && <Badge variant="outline" className="text-xs">Arkiveret</Badge>}
                                            {aff?.is_member
                                                ? <Badge className="bg-green-600 text-white text-xs">Medlem</Badge>
                                                : <Badge variant="outline" className="text-muted-foreground text-xs">Ikke-medlem</Badge>}
                                            {counts.allContractsValidated && <Badge className="bg-emerald-600 text-white text-xs">Alle kontrakter valideret</Badge>}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {rh.onboarding_completed
                                            ? <Badge variant="secondary" className="gap-1 text-xs"><LogIn className="h-3 w-3" />Registreret</Badge>
                                            : rh.invite_sent_at
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
                                                {rh.archived_at && (
                                                    <DropdownMenuItem onClick={async () => {
                                                        const result = await restoreRightsHolders([rh.id])
                                                        if (result.success) {
                                                            toast.success("Rettighedshaver gendannet")
                                                            if (orgId) load(orgId)
                                                        } else {
                                                            toast.error(result.error ?? "Kunne ikke gendanne")
                                                        }
                                                    }}>
                                                        <ArchiveRestore className="h-3.5 w-3.5 mr-2" />Gendan
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator />
                                                {!rh.onboarding_completed && rh.email && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "invite" }); setPortalLink(null) }}>
                                                        <Mail className="h-3.5 w-3.5 mr-2" />{rh.invite_sent_at ? "Gensend invitation" : "Send invitation"}
                                                    </DropdownMenuItem>
                                                )}
                                                {hasLogin && rh.email && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "reset" }); setPortalLink(null) }}>
                                                        <KeyRound className="h-3.5 w-3.5 mr-2" />Nulstil password
                                                    </DropdownMenuItem>
                                                )}
                                                {rh.invite_sent_at && !rh.onboarding_completed && rh.email && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "reminder" }); setPortalLink(null) }}>
                                                        <Mail className="h-3.5 w-3.5 mr-2" />Send 2. invitation
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
                                                <DropdownMenuSeparator />
                                                {rh.archived_at ? (
                                                    <DropdownMenuItem onClick={async () => {
                                                        const result = await restoreRightsHolders([rh.id])
                                                        if (result.success) {
                                                            toast.success("Rettighedshaver gendannet")
                                                            if (orgId) load(orgId)
                                                        } else {
                                                            toast.error(result.error ?? "Kunne ikke gendanne")
                                                        }
                                                    }}>
                                                        <ArchiveRestore className="h-3.5 w-3.5 mr-2" />Gendan
                                                    </DropdownMenuItem>
                                                ) : (
                                                    <DropdownMenuItem onClick={async () => {
                                                        const result = await archiveRightsHolders([rh.id])
                                                        if (result.success) {
                                                            toast.success("Rettighedshaver arkiveret")
                                                            if (orgId) load(orgId)
                                                        } else {
                                                            toast.error(result.error ?? "Kunne ikke arkivere")
                                                        }
                                                    }}>
                                                        <Trash2 className="h-3.5 w-3.5 mr-2" />Arkivér
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

            {/* Import members dialog */}
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogContent className="w-[min(760px,calc(100vw-2rem))] !max-w-none sm:!max-w-none">
                    <DialogHeader>
                        <DialogTitle>Hent og importér medlemmer</DialogTitle>
                        <DialogDescription>
                            Listen hentes fra medlemssystemet. Eksisterende matches får opdateret medlemsstatus og medlemsnummer; nye personer oprettes først, når du importerer de valgte.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm text-muted-foreground">
                                {importCandidates.length} medlemmer i listen · {importCandidates.filter(candidate => candidate.match === "new" && candidate.status !== "resigned").length} nye aktive
                                {memberSyncSummary && (
                                    <span className="block text-xs">
                                        {memberSyncSummary.updated} eksisterende opdateret · {memberSyncSummary.ambiguous} kræver afklaring
                                        {memberSyncSummary.source ? ` · ${memberSyncSummary.source === "org" ? "organisationens login" : "fælles systemlogin"}` : ""}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={handleSyncDfksMembers} disabled={syncingMembers}>
                                    {syncingMembers && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                                    Hent igen
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={refreshImportPreview} disabled={importLoading}>
                                    {importLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                                    Opdatér visning
                                </Button>
                            </div>
                        </div>
                        <div className="max-h-[420px] overflow-auto rounded-md border">
                            {importLoading ? (
                                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />Henter medlemsliste...
                                </div>
                            ) : importCandidates.length === 0 ? (
                                <p className="py-10 text-center text-sm text-muted-foreground">Ingen medlemmer i importlisten.</p>
                            ) : importCandidates.map(candidate => {
                                const disabled = candidate.match === "ambiguous" || candidate.status === "resigned"
                                return (
                                    <label key={candidate.id} className="flex cursor-pointer items-start gap-3 border-b px-3 py-3 last:border-b-0">
                                        <input
                                            type="checkbox"
                                            className="mt-1 h-4 w-4"
                                            checked={selectedImportIds.has(candidate.id)}
                                            disabled={disabled}
                                            onChange={event => {
                                                setSelectedImportIds(current => {
                                                    const next = new Set(current)
                                                    if (event.target.checked) next.add(candidate.id)
                                                    else next.delete(candidate.id)
                                                    return next
                                                })
                                            }}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium">{candidate.full_name}</span>
                                                {candidate.match === "new" && candidate.status !== "resigned" && <Badge className="text-xs">Ny</Badge>}
                                                {candidate.match === "existing" && <Badge variant="outline" className="text-xs">Matcher eksisterende</Badge>}
                                                {candidate.match === "ambiguous" && <Badge variant="destructive" className="text-xs">Kræver manuel afklaring</Badge>}
                                                {candidate.status === "resigned" && <Badge variant="outline" className="text-xs">Udmeldt</Badge>}
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {candidate.email ?? "Ingen email"} · Medlemsnr. {candidate.display_id ?? "—"}
                                                {candidate.match_reason ? ` · ${candidate.match_reason}` : ""}
                                            </p>
                                            {(candidate.phone || candidate.address) && (
                                                <p className="mt-1 text-xs text-muted-foreground">{[candidate.phone, candidate.address].filter(Boolean).join(" · ")}</p>
                                            )}
                                        </div>
                                    </label>
                                )
                            })}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setImportOpen(false)}>Luk</Button>
                        <Button onClick={handleImportSelectedMembers} disabled={importingMembers || selectedImportIds.size === 0}>
                            {importingMembers && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Importer {selectedImportIds.size} valgte
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Permanent delete dialog */}
            <Dialog open={permanentDeleteOpen} onOpenChange={open => { setPermanentDeleteOpen(open); if (!open) setDeleteConfirmation("") }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Slet rettighedshavere permanent</DialogTitle>
                        <DialogDescription>
                            Permanent sletning kan ikke fortrydes. Brug arkivering, hvis personen blot skal skjules.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <p className="text-sm text-muted-foreground">
                            Du er ved at slette {selectedIds.size} rettighedshaver(e). Vælg hvad der skal ske med tilknyttede data.
                        </p>
                        <label className="flex items-start gap-3 rounded-md border p-3">
                            <input type="checkbox" className="mt-1 h-4 w-4" checked={deleteContracts} onChange={event => setDeleteContracts(event.target.checked)} />
                            <span>
                                <span className="block text-sm font-medium">Slet medlemmets kontrakter</span>
                                <span className="text-xs text-muted-foreground">Hvis ikke valgt, fjernes personen fra kontrakterne, men kontrakterne beholdes.</span>
                            </span>
                        </label>
                        <label className="flex items-start gap-3 rounded-md border p-3">
                            <input type="checkbox" className="mt-1 h-4 w-4" checked={deleteUnsharedWorks} onChange={event => setDeleteUnsharedWorks(event.target.checked)} />
                            <span>
                                <span className="block text-sm font-medium">Slet værker der kun tilhører denne person</span>
                                <span className="text-xs text-muted-foreground">Værker med andre rettighedshavere beholdes.</span>
                            </span>
                        </label>
                        <div className="space-y-1">
                            <Label>Skriv SLET for at bekræfte</Label>
                            <Input value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPermanentDeleteOpen(false)}>Annuller</Button>
                        <Button variant="destructive" onClick={handlePermanentDeleteSelected} disabled={permanentDeleting || deleteConfirmation !== "SLET"}>
                            {permanentDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Slet permanent
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Portal adgang dialog */}
            <Dialog open={!!portalAction} onOpenChange={open => { if (!open) { setPortalAction(null); setPortalLink(null) } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {portalAction?.type === "invite" ? "Inviter til portal" : portalAction?.type === "reminder" ? "Send 2. invitation" : "Nulstil password"}
                        </DialogTitle>
                        <DialogDescription>
                            {portalAction?.type === "invite"
                                ? `Generér et invitationslink til ${portalAction.rh.full_name} (${portalAction.rh.email}). De kan herefter logge ind og sætte et password.`
                                : portalAction?.type === "reminder"
                                    ? `Send en 2. invitation med nyt invitationslink til ${portalAction.rh.full_name} (${portalAction.rh.email}).`
                                : `Generér et nulstillingslink til ${portalAction?.rh.full_name}. Del linket med dem direkte.`}
                        </DialogDescription>
                    </DialogHeader>

                    {portalLink ? (
                        <div className="space-y-3 py-2">
                            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                                <Link className="h-4 w-4" />
                                {portalAction?.type === "reset" ? "Nulstillingslink genereret" : "Invitationslink genereret"}
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
                                {portalAction?.type === "invite" ? "Generér invitationslink" : portalAction?.type === "reminder" ? "Send 2. invitation" : "Generér nulstillingslink"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}
