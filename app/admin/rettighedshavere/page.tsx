"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Fragment, type ReactNode } from "react"
import Image from "next/image"
import { Search, Plus, Pencil, UserCheck, UserX, X, Loader2, Mail, KeyRound, Link, LogIn, RotateCcw, Trash2, ArchiveRestore, ArrowUpDown, GitMerge, FlaskConical, Send } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import {
    setMemberStatus,
    setAffiliationEnd,
    type RettighedshaverWithAffiliation,
} from "@/lib/db/rettighedshavere"
import { cancelRightsHolderOnboarding, createRettighedshaverSecure, getAdminRightsHolderProfile, getAdminRightsHolders, requireRightsHolderOnboarding, updateRettighedshaverSecure, type AdminRightsHolderListItem } from "@/app/actions/rettighedshavere"
import { PageHeader } from "@/components/page-header"
import { AdminListTools } from "@/components/admin/admin-list-tools"
import { ExpandableListTrigger, MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import { archiveRightsHolders, mergeDuplicateRightsHolders, permanentlyDeleteRightsHolders, restoreRightsHolders } from "@/app/actions/rights-holder-admin"
import { ListSkeleton, TableSkeleton } from "@/components/ui/data-skeletons"
import { RightsHolderRelations } from "@/components/admin/rights-holder-relations"
import { ListResultSummary } from "@/components/list-result-summary"
import { rightsHolderInvitationState, rightsHolderPortalAction } from "@/lib/admin-rights-holder-invitation"
import { createAdminBetaTesterMessage, getBetaTestAdminSummary, removeBetaTester } from "@/app/actions/beta-test"
import { addCalendarDays } from "@/lib/beta-test"

type Filter = "alle" | "medlemmer" | "ikke-medlemmer" | "betatestere" | "inviteret" | "afventer" | "ikke-inviteret" | "registreret" | "alle-kontrakter-valideret" | "arkiverede"
type SortKey = "name" | "email" | "member_no" | "contracts" | "works" | "status" | "portal" | "validated"
type AdminUserResponse = {
    error?: string
    invite_url?: string
    reset_url?: string
    user_id?: string
    email_sent?: boolean
    email_error?: string
    link_type?: "invite" | "recovery"
    subject?: string
    bodyText?: string
    works?: Array<{ id: string; title: string; year: number | null; sources: string[]; verification: "linked" | "external_candidate" }>
    work_lookup?: {
        counts: { local: number; external: number; total: number }
        sourceStatus: { local: "ok" | "none"; dfi: "ok" | "none" | "ambiguous" | "unavailable"; tmdb: "ok" | "none" | "ambiguous" | "unavailable" }
        warnings: string[]
    }
}
type BetaInviteResult = {
    marked: number
    sent: number
    failed: number
    emailError?: string
    manualLink?: string
    workLookupIssues: number
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
type ImportMatchFilter = "all" | "new" | "existing" | "ambiguous"
type ImportMembershipFilter = "all" | "active" | "resigned"
type ImportSortKey = "name" | "member_no" | "email" | "membership" | "match"
type PortalActionType = "invite" | "reminder" | "login" | "reset"

function ImportSortHeader({
    sort,
    activeSort,
    direction,
    onSort,
    children,
}: {
    sort: ImportSortKey
    activeSort: ImportSortKey
    direction: "asc" | "desc"
    onSort: (sort: ImportSortKey) => void
    children: ReactNode
}) {
    return (
        <button type="button" className="inline-flex items-center gap-1 whitespace-nowrap font-medium" onClick={() => onSort(sort)}>
            {children}
            <ArrowUpDown className={`h-3.5 w-3.5 ${activeSort === sort ? "text-foreground" : "text-muted-foreground"}`} />
            <span className="sr-only">{activeSort === sort ? (direction === "asc" ? "sorteret stigende" : "sorteret faldende") : "sortér kolonne"}</span>
        </button>
    )
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Fejl"
}

function formatInvitationDate(value: string | null | undefined) {
    if (!value) return null
    return new Date(value).toLocaleString("da-DK", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function getAffiliation(rh: RettighedshaverWithAffiliation, orgId: string) {
    return rh.org_affiliations?.find(a => a.org_id === orgId) ?? null
}

function getVisibleAffiliation(rh: RettighedshaverWithAffiliation, orgId: string, canSeeAllOrganisations: boolean) {
    if (!canSeeAllOrganisations) return getAffiliation(rh, orgId)
    return rh.org_affiliations?.find(affiliation => affiliation.is_member && !affiliation.valid_to)
        ?? rh.org_affiliations?.[0]
        ?? null
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

function hasPortalAccess(rh: RettighedshaverWithAffiliation) {
    return Boolean(rh.user_id || rh.onboarding_completed_at)
}

function invitationStatus(rh: RettighedshaverWithAffiliation) {
    const state = rightsHolderInvitationState(rh)
    if (state === "active") return { state, label: "Aktiv" }
    if (state === "invited") return { state, label: `Inviteret ${formatInvitationDate(rh.invite_sent_at)}` }
    return { state: "not_invited" as const, label: "Ikke inviteret" }
}

const EMPTY_FORM = {
    full_name: "", email: "", phone: "", address: "", cpr_no: "", bank_account: "", member_no: "", is_member: false,
    gender: "", opt_out_statistics: false, send_invite: false,
    alternative_names: "", portrait_url: "", professional_start_year: "", primary_profession_type_id: "",
    secondary_profession_type_ids: [] as string[], usual_work_mode: "", primary_work_region_code: "",
    external_dfi: "", external_tmdb: "", external_wikidata: "", external_imdb: "",
}

function parseList(value: string) {
    return [...new Set(value.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean))]
}

export default function RettighedshavereAdminPage() {
    const [orgId, setOrgId] = useState<string | null>(null)
    const [rows, setRows] = useState<AdminRightsHolderListItem[]>([])
    const [canSeeAllOrganisations, setCanSeeAllOrganisations] = useState(false)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const loadAllPromiseRef = useRef<Promise<void> | null>(null)
    const loadRequestRef = useRef(0)
    const searchReadyRef = useRef(false)
    const lastLoadedSearchRef = useRef<string | null>(null)
    const [expandedRightsHolderId, setExpandedRightsHolderId] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [filteredResultCount, setFilteredResultCount] = useState(0)
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState<Filter>("alle")
    const [sortKey, setSortKey] = useState<SortKey>("name")
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

    const [createOpen, setCreateOpen] = useState(false)
    const [createSaving, setCreateSaving] = useState(false)
    const [bulkSendingInvitations, setBulkSendingInvitations] = useState(false)
    const [inviteConfirmOpen, setInviteConfirmOpen] = useState(false)
    const [betaInviteTargets, setBetaInviteTargets] = useState<RettighedshaverWithAffiliation[]>([])
    const [betaInviteOpen, setBetaInviteOpen] = useState(false)
    const [betaInviteStartDate, setBetaInviteStartDate] = useState("")
    const [betaInviteEndDate, setBetaInviteEndDate] = useState("")
    const [betaInviteSending, setBetaInviteSending] = useState(false)
    const [betaInviteResult, setBetaInviteResult] = useState<BetaInviteResult | null>(null)
    const [betaInvitePreview, setBetaInvitePreview] = useState<AdminUserResponse | null>(null)
    const [betaInvitePreviewLoading, setBetaInvitePreviewLoading] = useState(false)
    const [betaTesterCount, setBetaTesterCount] = useState(0)
    const [betaMessageOpen, setBetaMessageOpen] = useState(false)
    const [betaMessageSending, setBetaMessageSending] = useState(false)
    const [betaMessage, setBetaMessage] = useState({ subject: "", body: "" })
    const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
    const [createForm, setCreateForm] = useState({ ...EMPTY_FORM })
    const [createMemberNoTouched, setCreateMemberNoTouched] = useState(false)

    const [editTarget, setEditTarget] = useState<RettighedshaverWithAffiliation | null>(null)
    const [editSaving, setEditSaving] = useState(false)
    const [editLoading, setEditLoading] = useState(false)
    const [editForm, setEditForm] = useState({ ...EMPTY_FORM })
    const [editMemberNoTouched, setEditMemberNoTouched] = useState(false)
    const [editProfessionTypes, setEditProfessionTypes] = useState<Array<{ id: string; name: string }>>([])
    const [editWorkRegions, setEditWorkRegions] = useState<Array<{ code: string; name_da: string; name_en: string }>>([])
    const [onboardingAction, setOnboardingAction] = useState<{ type: "require" | "cancel"; rh: RettighedshaverWithAffiliation } | null>(null)
    const [onboardingActionLoading, setOnboardingActionLoading] = useState(false)

    // Portal-adgang
    const [portalAction, setPortalAction] = useState<{ rh: RettighedshaverWithAffiliation; type: PortalActionType } | null>(null)
    const [portalLoading, setPortalLoading] = useState(false)
    const [portalLink, setPortalLink] = useState<string | null>(null)
    const [portalEmailStatus, setPortalEmailStatus] = useState<{ sent: boolean; error?: string } | null>(null)
    const [portalInvitePreview, setPortalInvitePreview] = useState<AdminUserResponse | null>(null)
    const [portalInvitePreviewLoading, setPortalInvitePreviewLoading] = useState(false)

    const [syncingMembers, setSyncingMembers] = useState(false)
    const [memberSyncStatus, setMemberSyncStatus] = useState<{ count: number; syncedAt: string | null } | null>(null)
    const [rightsHolderSummary, setRightsHolderSummary] = useState({ total: 0, invited: 0, onboardingCompleted: 0 })
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
    const [mergeOpen, setMergeOpen] = useState(false)
    const [mergePrimaryId, setMergePrimaryId] = useState("")
    const [mergeConfirmation, setMergeConfirmation] = useState("")
    const [merging, setMerging] = useState(false)
    const [importOpen, setImportOpen] = useState(false)
    const [importLoading, setImportLoading] = useState(false)
    const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([])
    const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set())
    const [importingMembers, setImportingMembers] = useState(false)
    const [importSearch, setImportSearch] = useState("")
    const [importMatchFilter, setImportMatchFilter] = useState<ImportMatchFilter>("all")
    const [importMembershipFilter, setImportMembershipFilter] = useState<ImportMembershipFilter>("active")
    const [importSortKey, setImportSortKey] = useState<ImportSortKey>("name")
    const [importSortDirection, setImportSortDirection] = useState<"asc" | "desc">("asc")

    const load = useCallback(async (query: string, includeSummary = true) => {
        const requestId = ++loadRequestRef.current
        setLoading(true)
        try {
            const result = await getAdminRightsHolders({ search: query, includeSummary })
            if (requestId !== loadRequestRef.current) return null
            setRows(result.rows)
            setCountsByRightsHolder(result.countsByRightsHolder)
            setOrgId(result.orgId)
            setCanSeeAllOrganisations(result.canSeeAllOrganisations)
            setHasMore(result.hasMore)
            setFilteredResultCount(result.filteredCount)
            lastLoadedSearchRef.current = query
            if (result.summary) setRightsHolderSummary(result.summary)
            return result
        } catch (error) {
            toast.error(errorMessage(error))
            return null
        } finally {
            if (requestId === loadRequestRef.current) setLoading(false)
        }
    }, [])

    useEffect(() => {
        const initialSearch = new URLSearchParams(window.location.search).get("search") ?? ""
        setSearch(initialSearch)
        void load(initialSearch, true).then(result => {
            if (!result) return
            void loadDfksMembers(result.orgId)
            void refreshMemberSyncStatus()
            void refreshBetaSummary()
        }).finally(() => {
            searchReadyRef.current = true
        })
    }, [load])

    useEffect(() => {
        if (!searchReadyRef.current) return
        if (search.trim() === lastLoadedSearchRef.current) return
        const timer = window.setTimeout(() => {
            void load(search.trim(), false)
        }, 300)
        return () => window.clearTimeout(timer)
    }, [load, search])

    async function loadMore() {
        setLoadingMore(true)
        try {
            const result = await getAdminRightsHolders({ offset: rows.length, limit: 100, search: search.trim(), includeSummary: false })
            setRows(current => [...current, ...result.rows.filter(row => !current.some(existing => existing.id === row.id))])
            setCountsByRightsHolder(current => ({ ...current, ...result.countsByRightsHolder }))
            setHasMore(result.hasMore)
            setFilteredResultCount(result.filteredCount)
        } catch (error) {
            toast.error(errorMessage(error))
        } finally { setLoadingMore(false) }
    }

    function loadAllRightsHolders() {
        if (loadAllPromiseRef.current) return loadAllPromiseRef.current
        const promise = (async () => {
            setLoadingMore(true)
            try {
                let accumulatedRows = [...rows]
                let accumulatedCounts = { ...countsByRightsHolder }
                let more = hasMore
                while (more) {
                    const result = await getAdminRightsHolders({ offset: accumulatedRows.length, limit: 200, search: search.trim(), includeSummary: false })
                    accumulatedRows = [...accumulatedRows, ...result.rows.filter(row => !accumulatedRows.some(existing => existing.id === row.id))]
                    accumulatedCounts = { ...accumulatedCounts, ...result.countsByRightsHolder }
                    more = result.hasMore
                }
                setRows(accumulatedRows)
                setCountsByRightsHolder(accumulatedCounts)
                setHasMore(false)
            } catch (error) {
                toast.error(errorMessage(error))
            }
        })().finally(() => {
            setLoadingMore(false)
            loadAllPromiseRef.current = null
        })
        loadAllPromiseRef.current = promise
        return promise
    }

    function applyListFilter(nextFilter: Filter, clearSearch = false) {
        if (clearSearch) setSearch("")
        setFilter(nextFilter)
        if (hasMore) void loadAllRightsHolders()
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

    async function refreshMemberSyncStatus() {
        const status = await getDfksMembersSyncStatus()
        if (status.success) {
            setMemberSyncStatus({ count: status.count ?? 0, syncedAt: status.syncedAt ?? null })
        }
    }

    async function refreshBetaSummary() {
        try {
            const summary = await getBetaTestAdminSummary()
            setBetaTesterCount(summary.count)
        } catch {
            setBetaTesterCount(0)
        }
    }

    async function handleSyncDfksMembers() {
        setSyncingMembers(true)
        try {
            const result = await syncDfksMembers()
            if (!result.success) {
                toast.error(result.error ?? "Kunne ikke opdatere DFKS medlemslisten")
                return
            }
            toast.success(`${result.count ?? 0} aktive medlemmer hentet fra den aktive organisation. ${result.updatedExisting ?? 0} eksisterende rettighedshavere opdateret${result.removedCount ? `, ${result.removedCount} gamle cacheposter fjernet` : ""}.`)
            setMemberSyncStatus({ count: result.count ?? 0, syncedAt: result.syncedAt ?? new Date().toISOString() })
            setMemberSyncSummary({
                updated: result.updatedExisting ?? 0,
                newCount: result.newCount ?? 0,
                ambiguous: result.ambiguousCount ?? 0,
                source: result.source ?? null,
            })
            if (orgId) await loadDfksMembers(orgId)
            await refreshImportPreview()
        } catch {
            toast.error("Forbindelsen til medlemslisten blev afbrudt. Prøv igen.")
        } finally {
            setSyncingMembers(false)
        }
    }

    async function refreshImportPreview() {
        setImportLoading(true)
        try {
            const preview = await getDfksMemberImportPreview()
            if (!preview.success) {
                toast.error(preview.error ?? "Kunne ikke hente importlisten")
                return
            }
            setImportCandidates(preview.candidates)
            setSelectedImportIds(new Set())
        } catch {
            toast.error("Medlemslisten kunne ikke hentes. Prøv igen.")
        } finally {
            setImportLoading(false)
        }
    }

    async function openImportDialog() {
        setImportOpen(true)
        setImportMembershipFilter("active")
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
        await load(search.trim())
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

    useEffect(() => {
        let cancelled = false
        setPortalInvitePreview(null)
        if (portalAction?.type !== "invite") {
            setPortalInvitePreviewLoading(false)
            return
        }
        setPortalInvitePreviewLoading(true)
        void fetch("/api/admin/user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "preview_invite", rhId: portalAction.rh.id }),
        }).then(async response => {
            const result = await response.json() as AdminUserResponse
            if (!response.ok) throw new Error(result.error)
            if (!cancelled) setPortalInvitePreview(result)
        }).catch(error => {
            if (!cancelled) toast.error(`Invitationen kunne ikke forhåndsvises: ${errorMessage(error)}`)
        }).finally(() => {
            if (!cancelled) setPortalInvitePreviewLoading(false)
        })
        return () => { cancelled = true }
    }, [portalAction])

    useEffect(() => {
        let cancelled = false
        setBetaInvitePreview(null)
        if (!betaInviteOpen || betaInviteTargets.length === 0 || !betaInviteEndDate) {
            setBetaInvitePreviewLoading(false)
            return
        }
        setBetaInvitePreviewLoading(true)
        void fetch("/api/admin/user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "preview_invite", invitationType: "beta", rhId: betaInviteTargets[0].id, betaEndDate: betaInviteEndDate }),
        }).then(async response => {
            const result = await response.json() as AdminUserResponse
            if (!response.ok) throw new Error(result.error)
            if (!cancelled) setBetaInvitePreview(result)
        }).catch(error => {
            if (!cancelled) toast.error(`Betainvitationen kunne ikke forhåndsvises: ${errorMessage(error)}`)
        }).finally(() => {
            if (!cancelled) setBetaInvitePreviewLoading(false)
        })
        return () => { cancelled = true }
    }, [betaInviteEndDate, betaInviteOpen, betaInviteTargets])

    const visibleImportCandidates = useMemo(() => {
        const query = normalizeName(importSearch)
        const direction = importSortDirection === "asc" ? 1 : -1
        const matchRank: Record<ImportCandidate["match"], number> = { new: 0, existing: 1, ambiguous: 2 }
        const membershipRank: Record<string, number> = { active: 0, resigned: 1 }

        return importCandidates
            .filter(candidate => {
                if (importMatchFilter !== "all" && candidate.match !== importMatchFilter) return false
                if (importMembershipFilter !== "all" && candidate.status !== importMembershipFilter) return false
                if (!query) return true
                return [candidate.full_name, candidate.email, candidate.display_id, candidate.phone, candidate.address]
                    .some(value => normalizeName(value ?? "").includes(query))
            })
            .sort((left, right) => {
                let result = 0
                if (importSortKey === "name") result = left.full_name.localeCompare(right.full_name, "da")
                if (importSortKey === "member_no") result = (left.display_id ?? "").localeCompare(right.display_id ?? "", "da", { numeric: true })
                if (importSortKey === "email") result = (left.email ?? "").localeCompare(right.email ?? "", "da")
                if (importSortKey === "membership") result = (membershipRank[left.status] ?? 9) - (membershipRank[right.status] ?? 9)
                if (importSortKey === "match") result = matchRank[left.match] - matchRank[right.match]
                return result * direction
            })
    }, [importCandidates, importMatchFilter, importMembershipFilter, importSearch, importSortDirection, importSortKey])

    const selectableVisibleImportIds = visibleImportCandidates
        .filter(candidate => candidate.match !== "ambiguous" && candidate.status !== "resigned")
        .map(candidate => candidate.id)
    const selectedVisibleImportCount = selectableVisibleImportIds.filter(id => selectedImportIds.has(id)).length
    const allVisibleImportSelected = selectableVisibleImportIds.length > 0 && selectedVisibleImportCount === selectableVisibleImportIds.length

    function setImportSort(nextSort: ImportSortKey) {
        if (nextSort === importSortKey) {
            setImportSortDirection(direction => direction === "asc" ? "desc" : "asc")
            return
        }
        setImportSortKey(nextSort)
        setImportSortDirection("asc")
    }

    function toggleAllVisibleImports(checked: boolean) {
        setSelectedImportIds(current => {
            const next = new Set(current)
            for (const id of selectableVisibleImportIds) {
                if (checked) next.add(id)
                else next.delete(id)
            }
            return next
        })
    }

    const visible = useMemo(() => {
        const q = search.toLowerCase().trim()
        const list = rows.filter(rh => {
            const aff = orgId ? getVisibleAffiliation(rh, orgId, canSeeAllOrganisations) : null
            const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
            const archived = Boolean(rh.archived_at)
            if (filter === "arkiverede") {
                if (!archived) return false
            } else if (archived) {
                return false
            }
            if (filter === "medlemmer" && !aff?.is_member) return false
            if (filter === "ikke-medlemmer" && aff?.is_member) return false
            if (filter === "betatestere" && !aff?.beta_tester_since) return false
            if (filter === "inviteret" && !rh.user_id) return false
            if (filter === "alle-kontrakter-valideret" && !counts.allContractsValidated) return false
            const invStatus = rh.onboarding_completed_at && !rh.onboarding_required_at ? "registreret" : rh.user_id ? "afventer" : "ikke-inviteret"
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
            const affA = orgId ? getVisibleAffiliation(a, orgId, canSeeAllOrganisations) : null
            const affB = orgId ? getVisibleAffiliation(b, orgId, canSeeAllOrganisations) : null
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
    }, [rows, orgId, filter, search, countsByRightsHolder, sortKey, sortDirection, canSeeAllOrganisations])
    const selectedMergeHolders = useMemo(
        () => visible.filter(holder => selectedIds.has(holder.id)),
        [visible, selectedIds],
    )
    const mergeHasConflictingUsers = selectedMergeHolders.length === 2
        && Boolean(selectedMergeHolders[0].user_id)
        && Boolean(selectedMergeHolders[1].user_id)
        && selectedMergeHolders[0].user_id !== selectedMergeHolders[1].user_id
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
            setCreateOpen(false); void load(search.trim())
        } else {
            setCreateSaving(false)
            toast.error(result.error ?? "Kunne ikke oprette rettighedshaver")
        }
    }

    function inviteTargetSummary() {
        const selected = visible.filter(rh => selectedIds.has(rh.id))
        const targets = selected.filter(rh => rh.email)
        const loginLinks = targets.filter(hasPortalAccess)
        const invitationTargets = targets.filter(rh => !hasPortalAccess(rh))
        return {
            selected,
            targets,
            invitationTargets,
            loginLinks,
            firstInvites: invitationTargets.filter(rh => !rh.invite_sent_at).length,
            repeatInvites: invitationTargets.filter(rh => rh.invite_sent_at).length,
            missingEmail: selected.filter(rh => !rh.email).length,
        }
    }

    function handleBulkSendInvitation() {
        if (!orgId) return
        if (selectedIds.size === 0) return
        if (inviteTargetSummary().targets.length === 0) { toast.info("Ingen adgangslinks at sende — de valgte mangler email."); return }
        setInviteConfirmOpen(true)
    }

    async function confirmBulkSendInvitation() {
        const summary = inviteTargetSummary()
        const targets = summary.targets
        if (targets.length === 0) { setInviteConfirmOpen(false); return }
        setBulkSendingInvitations(true)
        let sent = 0
        const emailErrors: string[] = []
        for (const rh of targets) {
            let json: AdminUserResponse | null
            if (hasPortalAccess(rh)) {
                json = await sendReminderFor(rh.id, rh.email!, rh.full_name)
            } else if (rh.invite_sent_at) {
                json = await sendReminderFor(rh.id, rh.email!, rh.full_name)
            } else {
                json = await sendInviteFor(rh.id, rh.email!, rh.full_name)
            }
            if (json?.email_sent) sent++
            else if (json?.email_error) emailErrors.push(json.email_error)
        }
        setBulkSendingInvitations(false)
        setInviteConfirmOpen(false)
        if (sent > 0) toast.success(`${sent} af ${targets.length} adgangslinks sendt`)
        if (sent < targets.length) {
            toast.warning(`${targets.length - sent} adgangslink(s) blev ikke sendt${emailErrors[0] ? `: ${emailErrors[0]}` : "."}`)
        }
        void load(search.trim())
    }

    async function openBetaInvite(targets: RettighedshaverWithAffiliation[]) {
        const eligible = targets.filter(holder => holder.email).slice(0, 50)
        if (!eligible.length) { toast.info("Ingen af de valgte har en emailadresse."); return }
        if (targets.length > 50) { toast.error("Der kan højst sendes 50 betainvitationer ad gangen."); return }
        if (eligible.length < targets.length) toast.warning(`${targets.length - eligible.length} valgt(e) springes over, fordi de mangler email.`)
        try {
            const summary = await getBetaTestAdminSummary()
            setBetaInviteTargets(eligible)
            setBetaInviteStartDate(summary.startDate)
            setBetaInviteEndDate(summary.suggestedEndDate)
            setBetaInviteResult(null)
            setBetaInvitePreview(null)
            setBetaInviteOpen(true)
        } catch (error) {
            toast.error(errorMessage(error))
        }
    }

    async function confirmBetaInvite() {
        setBetaInviteSending(true)
        let sent = 0
        let marked = 0
        let failed = 0
        const emailErrors: string[] = []
        const manualLinks: string[] = []
        let workLookupIssues = 0
        const batchSize = 3
        for (let index = 0; index < betaInviteTargets.length; index += batchSize) {
            const batch = betaInviteTargets.slice(index, index + batchSize)
            const results = await Promise.all(batch.map(async holder => {
                try {
                    const response = await fetch("/api/admin/user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "beta_invite", rhId: holder.id, betaEndDate: betaInviteEndDate }) })
                    const result = await response.json() as AdminUserResponse
                    if (!response.ok) throw new Error(result.error)
                    return { ok: true as const, result }
                } catch (error) {
                    return { ok: false as const, error }
                }
            }))
            for (const delivery of results) {
                if (!delivery.ok) {
                    failed += 1
                    emailErrors.push(errorMessage(delivery.error))
                    continue
                }
                const result = delivery.result
                if ((result.work_lookup?.warnings.length ?? 0) > 0) workLookupIssues += 1
                marked += 1
                if (result.email_sent) sent += 1
                else {
                    if (result.email_error) emailErrors.push(result.email_error)
                    if (result.invite_url) manualLinks.push(result.invite_url)
                }
            }
        }
        setBetaInviteSending(false)
        const result = {
            marked,
            sent,
            failed,
            emailError: emailErrors[0],
            manualLink: betaInviteTargets.length === 1 ? manualLinks[0] : undefined,
            workLookupIssues,
        }
        setBetaInviteResult(result)
        if (sent === betaInviteTargets.length) {
            setBetaInviteOpen(false)
            toast.success(`${sent} betatest-invitation${sent === 1 ? "" : "er"} sendt`)
            if (workLookupIssues > 0) toast.warning(`${workLookupIssues} værksopslag havde tvetydige matches eller en utilgængelig kilde.`)
        } else {
            toast.warning(`${marked} markeret som betatestere · ${sent} mails sendt · ${marked - sent + failed} kræver opfølgning`)
        }
        setSelectedIds(new Set())
        await Promise.all([load(search.trim()), refreshBetaSummary()])
    }

    async function sendBetaTesterMessage() {
        setBetaMessageSending(true)
        const result = await createAdminBetaTesterMessage(betaMessage)
        setBetaMessageSending(false)
        if (!result.success) { toast.error(result.error ?? "Beskeden kunne ikke sendes."); return }
        toast.success(`${result.count ?? 0} portalbeskeder og ${result.emailSent ?? 0} mails oprettet`)
        if ((result.failed ?? 0) > 0 || (result.skippedWithoutPortalUser ?? 0) > 0) toast.warning(`${(result.failed ?? 0) + (result.skippedWithoutPortalUser ?? 0)} modtagere blev helt eller delvist sprunget over.`)
        setBetaMessageOpen(false)
        setBetaMessage({ subject: "", body: "" })
    }

    function handleArchiveSelected() {
        if (!orgId || selectedIds.size === 0) return
        setArchiveConfirmOpen(true)
    }

    async function confirmArchiveSelected() {
        setArchivingSelected(true)
        const result = await archiveRightsHolders(Array.from(selectedIds))
        setArchivingSelected(false)
        setArchiveConfirmOpen(false)
        if (!result.success) {
            toast.error(result.error ?? "Rettighedshavere kunne ikke arkiveres")
            return
        }
        if (result.archivedCount > 0) toast.success(`${result.archivedCount} rettighedshaver(e) arkiveret`)
        if (result.blocked.length > 0) {
            toast.warning(`${result.blocked.length} kunne ikke arkiveres: ${result.blocked.slice(0, 3).map(item => item.name).join(", ")}`)
        }
        setSelectedIds(new Set())
        await load(search.trim())
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
        await load(search.trim())
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
        toast.success(`${result.deletedCount} rettighedshaver(e) og ${result.deletedUsers} loginbruger(e) slettet permanent. ${result.deletedContracts} kontrakter og ${result.deletedWorks} værker slettet.`)
        if (result.authDeleteFailures.length > 0) {
            toast.warning(`Rettighedshaveren blev slettet, men ${result.authDeleteFailures.length} loginbruger(e) kunne ikke slettes. Kontroller om brugeren ejer filer i Storage.`)
        }
        setPermanentDeleteOpen(false)
        setDeleteConfirmation("")
        setSelectedIds(new Set())
        await load(search.trim())
    }

    function openMergeSelected() {
        if (selectedMergeHolders.length !== 2) return
        setMergePrimaryId(selectedMergeHolders[0].id)
        setMergeConfirmation("")
        setMergeOpen(true)
    }

    async function handleMergeSelected() {
        const duplicate = selectedMergeHolders.find(holder => holder.id !== mergePrimaryId)
        if (!duplicate || mergeConfirmation !== "SAMMENLÆG") return
        setMerging(true)
        const result = await mergeDuplicateRightsHolders(mergePrimaryId, duplicate.id)
        setMerging(false)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("Rettighedshaverprofilerne er sammenlagt")
        setMergeOpen(false)
        setMergeConfirmation("")
        setSelectedIds(new Set())
        await load(search.trim())
    }

    function openEdit(rh: RettighedshaverWithAffiliation) {
        const aff = orgId ? getVisibleAffiliation(rh, orgId, canSeeAllOrganisations) : null
        const extra = rh as { gender?: string | null; opt_out_statistics?: boolean | null }
        setEditForm({ ...EMPTY_FORM, full_name: rh.full_name, email: rh.email ?? "", phone: rh.phone ?? "", address: rh.address ?? "", member_no: aff?.member_no ?? "", is_member: aff?.is_member ?? false, gender: extra.gender ?? "", opt_out_statistics: Boolean(extra.opt_out_statistics) })
        setEditMemberNoTouched(false)
        setEditProfessionTypes([])
        setEditWorkRegions([])
        setEditTarget(rh)
        if (!orgId) return
        setEditLoading(true)
        void getAdminRightsHolderProfile(rh.id, orgId).then(profile => {
            setEditForm(form => ({
                ...form,
                is_member: profile.is_member,
                opt_out_statistics: profile.is_member ? false : profile.opt_out_statistics,
                cpr_no: profile.cpr_no,
                bank_account: profile.bank_account,
                alternative_names: profile.alternative_names.join("\n"),
                portrait_url: profile.portrait_url ?? "",
                professional_start_year: profile.professional_start_year ? String(profile.professional_start_year) : "",
                primary_profession_type_id: profile.primary_profession_type_id ?? "",
                secondary_profession_type_ids: [],
                usual_work_mode: profile.usual_work_mode ?? "",
                primary_work_region_code: profile.primary_work_region_code ?? "",
                external_dfi: profile.external_identities.dfi.join("\n"),
                external_tmdb: profile.external_identities.tmdb.join("\n"),
                external_wikidata: profile.external_identities.wikidata.join("\n"),
                external_imdb: profile.external_identities.imdb.join("\n"),
            }))
            setEditProfessionTypes(profile.profession_types)
            setEditWorkRegions(profile.work_regions)
        }).catch(error => {
            toast.error(errorMessage(error))
            setEditTarget(null)
        }).finally(() => setEditLoading(false))
    }

    async function handleEdit() {
        if (!editTarget || !orgId) return
        setEditSaving(true)
        const optOutStatistics = editForm.is_member ? false : editForm.opt_out_statistics
        const updateResult = await updateRettighedshaverSecure(editTarget.id, orgId, {
            full_name: editForm.full_name.trim(),
            email: editForm.email || null,
            phone: editForm.phone || null,
            address: editForm.address || null,
            cpr_no: editForm.cpr_no || null,
            bank_account: editForm.bank_account || null,
            gender: editForm.gender || null,
            is_member: editForm.is_member,
            opt_out_statistics: optOutStatistics,
            alternative_names: parseList(editForm.alternative_names),
            portrait_url: editForm.portrait_url || null,
            professional_start_year: editForm.professional_start_year ? Number(editForm.professional_start_year) : null,
            primary_profession_type_id: editForm.primary_profession_type_id || null,
            secondary_profession_type_ids: [],
            usual_work_mode: editForm.usual_work_mode || null,
            primary_work_region_code: editForm.primary_work_region_code || null,
            external_identities: {
                dfi: parseList(editForm.external_dfi),
                tmdb: parseList(editForm.external_tmdb),
                wikidata: parseList(editForm.external_wikidata),
                imdb: parseList(editForm.external_imdb),
            },
        })
        if (!updateResult.success) {
            setEditSaving(false)
            toast.error(updateResult.error ?? "Kunne ikke gemme")
            return
        }
        await setMemberStatus(editTarget.id, orgId, editForm.is_member, editForm.member_no || undefined)
        setEditSaving(false)
        toast.success("Gemt")
        setEditTarget(null)
        void load(search.trim())
    }

    async function handleOnboardingAction() {
        if (!onboardingAction || !orgId) return
        setOnboardingActionLoading(true)
        const result = onboardingAction.type === "require"
            ? await requireRightsHolderOnboarding(onboardingAction.rh.id, orgId)
            : await cancelRightsHolderOnboarding(onboardingAction.rh.id, orgId)
        setOnboardingActionLoading(false)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success(onboardingAction.type === "require" ? "Ny onboarding kræves ved næste login" : "Kravet om ny onboarding er annulleret")
        window.dispatchEvent(new Event("onboarding-requirement-changed"))
        setOnboardingAction(null)
        setEditTarget(null)
        await load(search.trim())
    }

    async function toggleMember(rh: RettighedshaverWithAffiliation) {
        if (!orgId) return
        const aff = getVisibleAffiliation(rh, orgId, canSeeAllOrganisations)
        const next = !aff?.is_member
        await setMemberStatus(rh.id, orgId, next, aff?.member_no ?? undefined)
        if (!next) await setAffiliationEnd(rh.id, orgId, new Date().toISOString().slice(0, 10))
        toast.success(next ? `${rh.full_name} er nu medlem` : `${rh.full_name} er udmeldt`)
        void load(search.trim())
    }

    async function handlePortalAction() {
        if (!portalAction) return
        const { rh, type } = portalAction
        if (!rh.email) { toast.error("Email er påkrævet for at sende invitationslink"); return }
        const invitationAction = type === "login" ? "reminder" : type === "invite" && rh.invite_sent_at ? "reminder" : type
        setPortalLoading(true)
        try {
            const res = await fetch("/api/admin/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    invitationAction === "invite"
                        ? { action: "invite", email: rh.email, name: rh.full_name, rhId: rh.id }
                        : invitationAction === "reminder"
                            ? { action: "reminder", email: rh.email, name: rh.full_name, rhId: rh.id }
                        : { action: "reset", rhId: rh.id }
                ),
            })
            const json = await res.json() as AdminUserResponse
            if (!res.ok) throw new Error(json.error)
            const link = invitationAction === "invite" || invitationAction === "reminder" ? json.invite_url : json.reset_url
            setPortalLink(link ?? null)
            if (invitationAction === "invite" || invitationAction === "reminder") {
                setPortalEmailStatus({ sent: Boolean(json.email_sent), error: json.email_error })
                const inviteSentAt = json.email_sent ? new Date().toISOString() : rh.invite_sent_at ?? null
                setRows(prev => prev.map(r => r.id === rh.id ? { ...r, user_id: json.user_id ?? null, invite_sent_at: inviteSentAt } : r))
                if (json.email_sent) toast.success(type === "login" ? `Loginlink sendt til ${rh.email}` : invitationAction === "reminder" ? `2. invitation sendt til ${rh.email}` : `Invitation sendt til ${rh.email}`)
                else toast.warning(`Bruger oprettet, men mailen kunne ikke sendes (${json.email_error ?? "ukendt"}). Kopiér linket manuelt.`)
            }
        } catch (e: unknown) {
            toast.error(errorMessage(e))
        } finally {
            setPortalLoading(false)
        }
    }

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

    const bulkInviteSummary = inviteTargetSummary()

    return (
        <div className="space-y-6">
            <PageHeader
                title="Rettighedshavere"
                subtitle={canSeeAllOrganisations ? "Rettighedshavere på tværs af alle organisationer" : "Rettighedshavere tilknyttet organisationen"}
                actions={
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        <div className="flex flex-col items-start gap-1 sm:items-end">
                            <Button size="sm" variant="outline" onClick={openImportDialog} disabled={syncingMembers || importLoading}>
                                {syncingMembers || importLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                                Hent fra medlemssystem
                            </Button>
                            {memberSyncStatus && (
                                <span className="text-xs text-muted-foreground">
                                    Medlemsliste: {memberSyncStatus.count} · {memberSyncStatus.syncedAt ? new Date(memberSyncStatus.syncedAt).toLocaleString("da-DK") : "aldrig"}
                                </span>
                            )}
                        </div>
                        <Button size="sm" onClick={() => { setCreateForm({ ...EMPTY_FORM }); setCreateMemberNoTouched(false); setCreateOpen(true) }}>
                            <Plus className="h-4 w-4 mr-1" />Indtast rettighedshaver manuelt
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setBetaMessageOpen(true)} disabled={betaTesterCount === 0}>
                            <Send className="mr-1 h-4 w-4" />Besked til betatestere ({betaTesterCount})
                        </Button>
                    </div>
                }
            />

            {/* Stats strip */}
            {!loading && (
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {[
                        { label: "Rettighedshavere", value: rightsHolderSummary.total, targetFilter: "alle" as Filter },
                        { label: "Inviteret", value: rightsHolderSummary.invited, targetFilter: "inviteret" as Filter },
                        { label: "Færdiggjort onboarding", value: rightsHolderSummary.onboardingCompleted, targetFilter: "registreret" as Filter },
                    ].map(s => (
                        <button
                            type="button"
                            key={s.label}
                            aria-pressed={filter === s.targetFilter && !search}
                            onClick={() => applyListFilter(s.targetFilter, true)}
                            className={`min-w-0 rounded-lg border px-2.5 py-2 text-left text-card-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 sm:py-4 ${filter === s.targetFilter && !search ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"}`}
                        >
                            <p className="mb-0.5 text-[11px] font-medium leading-tight text-muted-foreground sm:mb-1 sm:text-sm">{s.label}</p>
                            <p className="text-lg font-bold text-foreground tabular-nums sm:text-2xl">{s.value}</p>
                        </button>
                    ))}
                </div>
            )}

            {/* Command Strip & Filters */}
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input placeholder="Søg navn, email, tlf..." className="h-8 pl-8 pr-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
                        {search && <button type="button" aria-label="Ryd søgning" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSearch("")}><X className="h-3.5 w-3.5" /></button>}
                    </div>
                    <Select value={filter} onValueChange={v => applyListFilter(v as Filter)}>
                        <SelectTrigger className="h-8 text-xs w-full sm:w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="alle">Alle</SelectItem>
                            <SelectItem value="medlemmer">Kun medlemmer</SelectItem>
                            <SelectItem value="ikke-medlemmer">Ikke-medlemmer</SelectItem>
                            <SelectItem value="betatestere">Betatestere</SelectItem>
                            <SelectItem value="inviteret">Inviteret</SelectItem>
                            <SelectItem value="afventer">Afventer onboarding</SelectItem>
                            <SelectItem value="ikke-inviteret">Ikke inviteret</SelectItem>
                            <SelectItem value="registreret">Færdiggjort onboarding</SelectItem>
                            <SelectItem value="alle-kontrakter-valideret">Alle kontrakter valideret</SelectItem>
                            <SelectItem value="arkiverede">Arkiverede</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs sm:hidden"
                        onClick={() => toggleAllVisible(!allVisibleSelected)}
                        disabled={visibleIds.length === 0}
                    >
                        {allVisibleSelected ? "Fravælg alle viste" : "Vælg alle viste"}
                    </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground sm:justify-end">
                    <ListResultSummary
                        filteredCount={filter === "alle" ? filteredResultCount : visible.length}
                        totalCount={Math.max(rightsHolderSummary.total, visible.length)}
                        selectedCount={selectedIds.size}
                        loading={loadingMore}
                        className="text-xs"
                    />
                    <AdminListTools className="flex shrink-0 flex-nowrap" pageKey="rights-holders" title="Rettighedshavere" columns={[{id:"select",label:"Vælg",index:1,required:true},{id:"name",label:"Navn",index:2,required:true},...(canSeeAllOrganisations?[{id:"organisation",label:"Organisation",index:3}]:[]),{id:"email",label:"E-mail",index:canSeeAllOrganisations?4:3},{id:"phone",label:"Telefon",index:canSeeAllOrganisations?5:4},{id:"member",label:"Medlemsnr.",index:canSeeAllOrganisations?6:5},{id:"contracts",label:"Kontrakter",index:canSeeAllOrganisations?7:6},{id:"works",label:"Værker",index:canSeeAllOrganisations?8:7},{id:"status",label:"Status",index:canSeeAllOrganisations?9:8},{id:"portal",label:"Portaladgang",index:canSeeAllOrganisations?10:9},{id:"onboarding",label:"Onboarding",index:canSeeAllOrganisations?11:10}]} />
                </div>
            </div>

            {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                    <div className="text-sm font-medium">{selectedIds.size} valgt</div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>Ryd valg</Button>
                        {canSeeAllOrganisations && selectedIds.size === 2 && (
                            <Button size="sm" variant="outline" onClick={openMergeSelected}>
                                <GitMerge className="mr-1 h-4 w-4" />Sammenlæg dubletter
                            </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={handleBulkSendInvitation} disabled={bulkSendingInvitations}>
                            {bulkSendingInvitations ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Mail className="mr-1 h-4 w-4" />}
                            Send {selectedIds.size} {selectedIds.size === 1 ? "invitation" : "invitationer"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void openBetaInvite(visible.filter(holder => selectedIds.has(holder.id)))} disabled={betaInviteSending || selectedIds.size > 50}>
                            <FlaskConical className="mr-1 h-4 w-4" />Send {selectedIds.size} {selectedIds.size === 1 ? "betainvitation" : "betainvitationer"}
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
                    <ListSkeleton items={6} />
                ) : visible.length === 0 ? (
                    <MobileDataCard>
                        <p className="py-6 text-center text-sm text-muted-foreground">Ingen rettighedshavere fundet</p>
                    </MobileDataCard>
                ) : visible.map(rh => {
                    const aff = orgId ? getVisibleAffiliation(rh, orgId, canSeeAllOrganisations) : null
                    const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
                    const relationsExpanded = expandedRightsHolderId === rh.id
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
                                    <ExpandableListTrigger expanded={relationsExpanded} onToggle={() => setExpandedRightsHolderId(current => current === rh.id ? null : rh.id)} label={relationsExpanded ? `Skjul værker og kontrakter for ${rh.full_name}` : `Vis værker og kontrakter for ${rh.full_name}`} className="mt-0.5" />
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
                                        <DropdownMenuItem onClick={() => toggleMember(rh)}>
                                            {aff?.is_member
                                                ? <><UserX className="h-3.5 w-3.5 mr-2 text-amber-500" />Udmeld</>
                                                : <><UserCheck className="h-3.5 w-3.5 mr-2 text-green-600" />Indmeld</>}
                                        </DropdownMenuItem>
                                        {rh.email && !rh.onboarding_completed_at && (
                                            <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: rh.invite_sent_at ? "reminder" : "invite" }); setPortalLink(null); setPortalEmailStatus(null) }}>
                                                <Mail className="mr-2 h-3.5 w-3.5" />{rh.invite_sent_at ? "Gensend velkomstmail" : "Send invitation"}
                                            </DropdownMenuItem>
                                        )}
                                        {rh.email && rh.onboarding_completed_at && (
                                            <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "login" }); setPortalLink(null); setPortalEmailStatus(null) }}>
                                                <KeyRound className="mr-2 h-3.5 w-3.5" />Send loginlink
                                            </DropdownMenuItem>
                                        )}
                                        {rh.email && <DropdownMenuItem onClick={() => void openBetaInvite([rh])}><FlaskConical className="mr-2 h-3.5 w-3.5" />Send betainvitation</DropdownMenuItem>}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {canSeeAllOrganisations && <MobileMetaRow label="Organisation">{rh.organisation_names.join(", ") || "Uden tilknytning"}</MobileMetaRow>}
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
                                        {aff?.beta_tester_since && <Badge className="bg-violet-600 text-white text-xs">Betatester</Badge>}
                                        {counts.allContractsValidated && <Badge className="bg-emerald-600 text-white text-xs">Alle kontrakter valideret</Badge>}
                                    </div>
                                </MobileMetaRow>
                                <MobileMetaRow label="Portaladgang">
                                    {(() => {
                                        const status = invitationStatus(rh)
                                        return status.state === "active"
                                            ? <Badge className="gap-1 bg-emerald-600 text-xs text-white"><LogIn className="h-3 w-3" />{status.label}</Badge>
                                            : status.state === "invited"
                                                ? <Badge variant="outline" className="border-amber-300 text-xs text-amber-700">{status.label}</Badge>
                                                : <Badge variant="outline" className="text-xs text-muted-foreground">{status.label}</Badge>
                                    })()}
                                </MobileMetaRow>
                            </div>
                            {relationsExpanded && <div className="mt-4 border-t pt-3"><RightsHolderRelations rightsHolderId={rh.id} workCount={counts.works} contractCount={counts.contracts} /></div>}
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
                            {canSeeAllOrganisations && <TableHead>Organisation</TableHead>}
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
                            <TableRow><TableCell colSpan={canSeeAllOrganisations ? 12 : 11}><TableSkeleton columns={canSeeAllOrganisations ? 12 : 11} rows={6} /></TableCell></TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow><TableCell colSpan={canSeeAllOrganisations ? 12 : 11} className="py-10 text-center text-muted-foreground">Ingen rettighedshavere fundet</TableCell></TableRow>
                        ) : visible.map(rh => {
                            const aff = orgId ? getVisibleAffiliation(rh, orgId, canSeeAllOrganisations) : null
                            const hasLogin = !!rh.user_id
                            const counts = countsByRightsHolder[rh.id] ?? { contracts: 0, works: 0, allContractsValidated: false }
                            const relationsExpanded = expandedRightsHolderId === rh.id
                            return (
                                <Fragment key={rh.id}>
                                <TableRow>
                                    <TableCell>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(rh.id)}
                                            onChange={event => toggleSelected(rh.id, event.target.checked)}
                                            aria-label={`Vælg ${rh.full_name}`}
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium"><div className="flex items-center gap-2"><ExpandableListTrigger expanded={relationsExpanded} onToggle={() => setExpandedRightsHolderId(current => current === rh.id ? null : rh.id)} label={relationsExpanded ? `Skjul værker og kontrakter for ${rh.full_name}` : `Vis værker og kontrakter for ${rh.full_name}`} /><button type="button" className="text-left hover:text-blue-600 hover:underline" onClick={() => openEdit(rh)}>{rh.full_name}</button></div></TableCell>
                                    {canSeeAllOrganisations && <TableCell className="text-sm text-muted-foreground">{rh.organisation_names.join(", ") || "Uden tilknytning"}</TableCell>}
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
                                            {aff?.beta_tester_since && <Badge className="bg-violet-600 text-white text-xs">Betatester</Badge>}
                                            {counts.allContractsValidated && <Badge className="bg-emerald-600 text-white text-xs">Alle kontrakter valideret</Badge>}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                            {(() => {
                                                const status = invitationStatus(rh)
                                                return status.state === "active"
                                                    ? <Badge className="gap-1 bg-emerald-600 text-xs text-white"><LogIn className="h-3 w-3" />{status.label}</Badge>
                                                    : status.state === "invited"
                                                        ? <Badge variant="outline" className="border-amber-300 text-xs text-amber-700">{status.label}</Badge>
                                                        : <Badge variant="outline" className="text-xs text-muted-foreground">{status.label}</Badge>
                                            })()}
                                    </TableCell>
                                    <TableCell>
                                        {!hasLogin
                                            ? <span className="text-xs text-muted-foreground">—</span>
                                            : rh.onboarding_required_at
                                                ? <Badge variant="outline" className="border-amber-300 text-xs text-amber-700">Planlagt igen</Badge>
                                                : rh.onboarding_completed_at
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
                                                {rh.archived_at && (
                                                    <DropdownMenuItem onClick={async () => {
                                                        const result = await restoreRightsHolders([rh.id])
                                                        if (result.success) {
                                                            toast.success("Rettighedshaver gendannet")
                                                            if (orgId) void load(search.trim())
                                                        } else {
                                                            toast.error(result.error ?? "Kunne ikke gendanne")
                                                        }
                                                    }}>
                                                        <ArchiveRestore className="h-3.5 w-3.5 mr-2" />Gendan
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator />
                                                {rh.email && !rh.onboarding_completed_at && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: rh.invite_sent_at ? "reminder" : "invite" }); setPortalLink(null); setPortalEmailStatus(null) }}>
                                                        <Mail className="h-3.5 w-3.5 mr-2" />{rh.invite_sent_at ? "Gensend velkomstmail" : "Send invitation"}
                                                    </DropdownMenuItem>
                                                )}
                                                {rh.email && rh.onboarding_completed_at && (
                                                    <DropdownMenuItem onClick={() => { setPortalAction({ rh, type: "login" }); setPortalLink(null); setPortalEmailStatus(null) }}>
                                                        <KeyRound className="h-3.5 w-3.5 mr-2" />Send loginlink
                                                    </DropdownMenuItem>
                                                )}
                                                {rh.email && <DropdownMenuItem onClick={() => void openBetaInvite([rh])}><FlaskConical className="mr-2 h-3.5 w-3.5" />Send betainvitation</DropdownMenuItem>}
                                                <DropdownMenuSeparator />
                                                {rh.archived_at ? (
                                                    <DropdownMenuItem onClick={async () => {
                                                        const result = await restoreRightsHolders([rh.id])
                                                        if (result.success) {
                                                            toast.success("Rettighedshaver gendannet")
                                                            if (orgId) void load(search.trim())
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
                                                            if (orgId) void load(search.trim())
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
                                {relationsExpanded && <TableRow><TableCell colSpan={canSeeAllOrganisations ? 12 : 11} className="bg-muted/10 p-4"><RightsHolderRelations rightsHolderId={rh.id} workCount={counts.works} contractCount={counts.contracts} /></TableCell></TableRow>}
                                </Fragment>
                            )
                        })}
                    </TableBody>
                </Table>
            </ResponsiveTableFrame>
            {hasMore && <div className="flex justify-center"><Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Indlæs flere rettighedshavere</Button></div>}

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
                    {editLoading && <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter onboardingoplysninger…</div>}
                    <div className={`space-y-4 py-2 ${editLoading ? "pointer-events-none opacity-50" : ""}`}>
                        <div className="space-y-1"><Label>Fuldt navn *</Label><Input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} /></div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1"><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
                            <div className="space-y-1"><Label>Telefon</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
                        </div>
                        {editTarget && (
                            <section className="space-y-3 rounded-lg border p-3 sm:p-4">
                                <div>
                                    <h3 className="font-semibold">Portaladgang</h3>
                                    <p className="text-xs text-muted-foreground">
                                        {editTarget.onboarding_completed_at
                                            ? "Send et nyt loginlink uden at oprette en ekstra bruger."
                                            : editTarget.invite_sent_at
                                                ? `Invitation sendt ${formatInvitationDate(editTarget.invite_sent_at)}. Du kan gensende velkomstmailen med et nyt sikkert link.`
                                                : "Send en invitation, så rettighedshaveren kan oprette sin adgang."}
                                    </p>
                                </div>
                                {(!editForm.email.trim() || editForm.email.trim() !== (editTarget.email ?? "").trim() || editForm.full_name.trim() !== editTarget.full_name.trim()) && (
                                    <p className="text-xs text-amber-700">
                                        {!editForm.email.trim() ? "Tilføj og gem en emailadresse først." : "Gem ændringer til navn eller email, før du sender et nyt link."}
                                    </p>
                                )}
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                        editSaving
                                        || !editForm.email.trim()
                                        || editForm.email.trim() !== (editTarget.email ?? "").trim()
                                        || editForm.full_name.trim() !== editTarget.full_name.trim()
                                    }
                                    onClick={() => {
                                        setPortalLink(null)
                                        setPortalEmailStatus(null)
                                        setPortalAction({
                                            rh: editTarget,
                                            type: rightsHolderPortalAction(editTarget),
                                        })
                                    }}
                                >
                                    {editTarget.onboarding_completed_at ? <KeyRound className="mr-2 h-4 w-4" /> : <Mail className="mr-2 h-4 w-4" />}
                                    {editTarget.onboarding_completed_at
                                        ? "Send nyt loginlink"
                                        : editTarget.invite_sent_at ? "Gensend velkomstmail" : "Send invitation"}
                                </Button>
                                {portalAction?.rh.id === editTarget.id && portalLink && (
                                    <p className="break-all rounded-md bg-muted px-3 py-2 text-xs">{portalLink}</p>
                                )}
                                {orgId && getAffiliation(editTarget, orgId)?.beta_tester_since && (
                                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30">
                                        <div><Badge className="bg-violet-600 text-white">Betatester</Badge><p className="mt-1 text-xs text-muted-foreground">Markeringen udløber ikke automatisk.</p></div>
                                        <Button type="button" size="sm" variant="outline" onClick={async () => {
                                            const result = await removeBetaTester(editTarget.id)
                                            if (!result.success) { toast.error(result.error); return }
                                            toast.success("Betatesterstatus fjernet. Portaladgangen er uændret.")
                                            setEditTarget(null)
                                            await Promise.all([load(search.trim()), refreshBetaSummary()])
                                        }}>Fjern betatesterstatus</Button>
                                    </div>
                                )}
                            </section>
                        )}
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
                                        <SelectItem value="non_binary">Non-binær</SelectItem>
                                        <SelectItem value="other">Andet</SelectItem>
                                        <SelectItem value="prefer_not_to_say">Vil ikke oplyse</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {editForm.is_member ? (
                                <div className="flex items-end pb-2 text-sm text-muted-foreground">
                                    Aktive medlemmer indgår i foreningens statistikarbejde.
                                </div>
                            ) : (
                                <div className="flex items-end gap-2 pb-2">
                                    <input type="checkbox" id="edit-opt-out" checked={editForm.opt_out_statistics} onChange={e => setEditForm(f => ({ ...f, opt_out_statistics: e.target.checked }))} className="h-4 w-4" />
                                    <Label htmlFor="edit-opt-out" className="cursor-pointer">Fravalgt anonym markedsstatistik</Label>
                                </div>
                            )}
                        </div>

                        <section className="space-y-3 rounded-lg border p-3 sm:p-4">
                            <div>
                                <h3 className="font-semibold">Onboarding og statistikprofil</h3>
                                <p className="text-xs text-muted-foreground">Oplysningerne stammer fra onboarding og kan også ændres af medlemmet på Min profil.</p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <Label>Professionelt startår</Label>
                                    <Input type="number" min={1940} max={new Date().getFullYear()} value={editForm.professional_start_year} onChange={e => setEditForm(f => ({ ...f, professional_start_year: e.target.value }))} placeholder="Fx 2004" />
                                    <p className="text-xs text-muted-foreground">Året hvor personen begyndte at arbejde professionelt i organisationens fag.</p>
                                </div>
                                <div className="space-y-1">
                                    <Label>Primær faggruppe</Label>
                                    <Select value={editForm.primary_profession_type_id || "__none__"} onValueChange={value => setEditForm(form => ({ ...form, primary_profession_type_id: value === "__none__" ? "" : value, secondary_profession_type_ids: [] }))}>
                                        <SelectTrigger className="w-full"><SelectValue placeholder="Ikke angivet" /></SelectTrigger>
                                        <SelectContent><SelectItem value="__none__">Ikke angivet</SelectItem>{editProfessionTypes.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <Label>Typisk arbejdsform</Label>
                                    <Select value={editForm.usual_work_mode || "__none__"} onValueChange={value => setEditForm(form => ({ ...form, usual_work_mode: value === "__none__" ? "" : value }))}>
                                        <SelectTrigger className="w-full"><SelectValue placeholder="Ikke angivet" /></SelectTrigger>
                                        <SelectContent><SelectItem value="__none__">Ikke angivet</SelectItem><SelectItem value="employee">A-lønmodtager</SelectItem><SelectItem value="company">Gennem eget selskab</SelectItem><SelectItem value="both">Begge dele</SelectItem><SelectItem value="other">Andet</SelectItem><SelectItem value="prefer_not_to_say">Vil ikke oplyse</SelectItem></SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Primært arbejdsområde</Label>
                                    <Select value={editForm.primary_work_region_code || "__none__"} onValueChange={value => setEditForm(form => ({ ...form, primary_work_region_code: value === "__none__" ? "" : value }))}>
                                        <SelectTrigger className="w-full"><SelectValue placeholder="Ikke angivet" /></SelectTrigger>
                                        <SelectContent><SelectItem value="__none__">Ikke angivet</SelectItem>{editWorkRegions.map(option => <SelectItem key={option.code} value={option.code}>{option.name_da}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </section>

                        <section className="space-y-3 rounded-lg border p-3 sm:p-4">
                            <div><h3 className="font-semibold">Navneprofil og portræt</h3><p className="text-xs text-muted-foreground">Navnevarianter og portræt blev valgt under onboardingens personsøgning.</p></div>
                            <div className="space-y-1"><Label>Navnevarianter</Label><Textarea rows={3} value={editForm.alternative_names} onChange={event => setEditForm(form => ({ ...form, alternative_names: event.target.value }))} placeholder="Ét navn pr. linje" /></div>
                            <div className="space-y-1"><Label>Portræt-URL</Label><Input type="url" value={editForm.portrait_url} onChange={event => setEditForm(form => ({ ...form, portrait_url: event.target.value }))} placeholder="https://…" /></div>
                            {editForm.portrait_url && <div className="flex items-center gap-3 rounded-md bg-muted p-2"><Image src={editForm.portrait_url} alt={`Portræt af ${editForm.full_name}`} width={64} height={64} unoptimized className="h-16 w-16 rounded-md object-cover" /><span className="min-w-0 break-all text-xs text-muted-foreground">Aktuelt portræt</span></div>}
                        </section>

                        <section className="space-y-3 rounded-lg border p-3 sm:p-4">
                            <div><h3 className="font-semibold">Eksterne person-id&apos;er</h3><p className="text-xs text-muted-foreground">Flere id&apos;er fra samme kilde skrives på hver sin linje. Id&apos;er kontrolleres for format og dubletter ved gemning.</p></div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1"><Label>DFI person-id</Label><Textarea rows={2} value={editForm.external_dfi} onChange={event => setEditForm(form => ({ ...form, external_dfi: event.target.value }))} placeholder="12345" /></div>
                                <div className="space-y-1"><Label>TMDB person-id</Label><Textarea rows={2} value={editForm.external_tmdb} onChange={event => setEditForm(form => ({ ...form, external_tmdb: event.target.value }))} placeholder="12345" /></div>
                                <div className="space-y-1"><Label>Wikidata-id</Label><Textarea rows={2} value={editForm.external_wikidata} onChange={event => setEditForm(form => ({ ...form, external_wikidata: event.target.value }))} placeholder="Q12345" /></div>
                                <div className="space-y-1"><Label>IMDb person-id</Label><Textarea rows={2} value={editForm.external_imdb} onChange={event => setEditForm(form => ({ ...form, external_imdb: event.target.value }))} placeholder="nm1234567" /></div>
                            </div>
                        </section>
                        <div className="flex items-center gap-2 pt-1">
                            <input type="checkbox" id="edit-is-member" checked={editForm.is_member} onChange={e => setEditForm(f => ({ ...f, is_member: e.target.checked, opt_out_statistics: e.target.checked ? false : f.opt_out_statistics }))} className="h-4 w-4" />
                            <Label htmlFor="edit-is-member" className="cursor-pointer">Aktivt medlem</Label>
                        </div>
                        {editTarget?.user_id && <div className="space-y-3 rounded-lg border p-3 sm:p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-medium">Onboardingstatus</p>
                                    {!editTarget.onboarding_completed_at ? (
                                        <p className="text-xs text-muted-foreground">Afventer første onboarding. Dette krav kan ikke annulleres.</p>
                                    ) : editTarget.onboarding_required_at ? (
                                        <p className="text-xs text-muted-foreground">Ny onboarding er planlagt til næste login. Den nuværende session fortsætter indtil logout.</p>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">Senest gennemført {new Date(editTarget.onboarding_completed_at).toLocaleString("da-DK")}.</p>
                                    )}
                                </div>
                                <Badge variant={editTarget.onboarding_required_at || !editTarget.onboarding_completed_at ? "secondary" : "outline"}>
                                    {!editTarget.onboarding_completed_at ? "Første onboarding" : editTarget.onboarding_required_at ? "Planlagt" : "Gennemført"}
                                </Badge>
                            </div>
                            {editTarget.onboarding_completed_at && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setOnboardingAction({ type: editTarget.onboarding_required_at ? "cancel" : "require", rh: editTarget })}
                                >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    {editTarget.onboarding_required_at ? "Annuller krav" : "Kræv onboarding igen"}
                                </Button>
                            )}
                        </div>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditTarget(null)}>Annuller</Button>
                        <Button onClick={handleEdit} disabled={editLoading || editSaving || !editForm.full_name.trim()}>
                            {editSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Gem
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!onboardingAction} onOpenChange={open => { if (!open && !onboardingActionLoading) setOnboardingAction(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{onboardingAction?.type === "require" ? "Kræv onboarding igen?" : "Annuller krav om onboarding?"}</DialogTitle>
                        <DialogDescription>
                            {onboardingAction?.type === "require"
                                ? "Rettighedshaverens eksisterende oplysninger bevares. Kravet aktiveres ved næste login, og portal- samt administratoradgang er derefter blokeret, indtil hele onboardingforløbet er afsluttet."
                                : "Rettighedshaveren beholder sin senest gennemførte onboarding og får igen normal adgang ved næste sideindlæsning."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOnboardingAction(null)} disabled={onboardingActionLoading}>Tilbage</Button>
                        <Button type="button" variant={onboardingAction?.type === "require" ? "default" : "outline"} onClick={handleOnboardingAction} disabled={onboardingActionLoading}>
                            {onboardingActionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {onboardingAction?.type === "require" ? "Kræv onboarding" : "Annuller krav"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Import members dialog */}
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogContent className="w-[min(1040px,calc(100vw-2rem))] !max-w-none sm:!max-w-none">
                    <DialogHeader>
                        <DialogTitle>Hent og importér medlemmer</DialogTitle>
                        <DialogDescription>
                            Den senest synkroniserede liste vises med det samme. Vælg “Hent igen” for at hente friske data fra medlemssystemet. Eksisterende matches får opdateret medlemsstatus og medlemsnummer; nye personer oprettes først, når du importerer de valgte. Systemet kontrollerer igen ved import, om personen allerede er oprettet.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm text-muted-foreground">
                                {importCandidates.filter(candidate => candidate.status === "active").length} aktive medlemmer · {importCandidates.filter(candidate => candidate.status === "resigned").length} udmeldte · {importCandidates.filter(candidate => candidate.match === "new" && candidate.status !== "resigned").length} nye aktive
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
                        <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px_180px]">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={importSearch}
                                    onChange={event => setImportSearch(event.target.value)}
                                    placeholder="Søg navn, e-mail eller medlemsnr."
                                    className="pl-8"
                                />
                            </div>
                            <Select value={importMatchFilter} onValueChange={value => setImportMatchFilter(value as ImportMatchFilter)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Alle importstatusser</SelectItem>
                                    <SelectItem value="new">Ikke importeret</SelectItem>
                                    <SelectItem value="existing">Allerede importeret</SelectItem>
                                    <SelectItem value="ambiguous">Kræver afklaring</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={importMembershipFilter} onValueChange={value => setImportMembershipFilter(value as ImportMembershipFilter)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Alle medlemsstatusser</SelectItem>
                                    <SelectItem value="active">Aktivt medlemskab</SelectItem>
                                    <SelectItem value="resigned">Udmeldt</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">
                                Viser {visibleImportCandidates.length} af {importCandidates.length}
                            </span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => toggleAllVisibleImports(!allVisibleImportSelected)}
                                disabled={selectableVisibleImportIds.length === 0}
                            >
                                {allVisibleImportSelected ? "Fravælg alle viste" : `Vælg alle viste (${selectableVisibleImportIds.length})`}
                            </Button>
                        </div>
                        <div className="max-h-[420px] overflow-auto rounded-md border">
                            {importLoading ? (
                                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />Henter medlemsliste...
                                </div>
                            ) : visibleImportCandidates.length === 0 ? (
                                <p className="py-10 text-center text-sm text-muted-foreground">Ingen medlemmer matcher filtrene.</p>
                            ) : (
                                <Table>
                                    <TableHeader className="sticky top-0 z-10 bg-background">
                                        <TableRow>
                                            <TableHead className="w-10">
                                                <input
                                                    type="checkbox"
                                                    aria-label="Vælg alle viste medlemmer"
                                                    checked={allVisibleImportSelected}
                                                    onChange={event => toggleAllVisibleImports(event.target.checked)}
                                                    disabled={selectableVisibleImportIds.length === 0}
                                                    className="h-4 w-4"
                                                />
                                            </TableHead>
                                            <TableHead><ImportSortHeader sort="name" activeSort={importSortKey} direction={importSortDirection} onSort={setImportSort}>Navn</ImportSortHeader></TableHead>
                                            <TableHead><ImportSortHeader sort="member_no" activeSort={importSortKey} direction={importSortDirection} onSort={setImportSort}>Medlemsnr.</ImportSortHeader></TableHead>
                                            <TableHead><ImportSortHeader sort="email" activeSort={importSortKey} direction={importSortDirection} onSort={setImportSort}>E-mail</ImportSortHeader></TableHead>
                                            <TableHead><ImportSortHeader sort="membership" activeSort={importSortKey} direction={importSortDirection} onSort={setImportSort}>Medlemsstatus</ImportSortHeader></TableHead>
                                            <TableHead><ImportSortHeader sort="match" activeSort={importSortKey} direction={importSortDirection} onSort={setImportSort}>Importstatus</ImportSortHeader></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {visibleImportCandidates.map(candidate => {
                                            const disabled = candidate.match === "ambiguous" || candidate.status === "resigned"
                                            return (
                                                <TableRow key={candidate.id} className={disabled ? "text-muted-foreground" : undefined}>
                                                    <TableCell>
                                                        <input
                                                            type="checkbox"
                                                            aria-label={`Vælg ${candidate.full_name}`}
                                                            className="h-4 w-4"
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
                                                    </TableCell>
                                                    <TableCell className="min-w-48 font-medium">
                                                        {candidate.full_name}
                                                        {(candidate.phone || candidate.address) && (
                                                            <span className="mt-1 block max-w-64 truncate text-xs font-normal text-muted-foreground" title={[candidate.phone, candidate.address].filter(Boolean).join(" · ")}>
                                                                {[candidate.phone, candidate.address].filter(Boolean).join(" · ")}
                                                            </span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">{candidate.display_id ?? "—"}</TableCell>
                                                    <TableCell>{candidate.email ?? "—"}</TableCell>
                                                    <TableCell>
                                                        {candidate.status === "resigned"
                                                            ? <Badge variant="outline">Udmeldt</Badge>
                                                            : <Badge className="bg-emerald-600 text-white">Aktiv</Badge>}
                                                    </TableCell>
                                                    <TableCell>
                                                        {candidate.match === "new" && <Badge>Ikke importeret</Badge>}
                                                        {candidate.match === "existing" && <Badge variant="outline">Allerede importeret</Badge>}
                                                        {candidate.match === "ambiguous" && <Badge variant="destructive">Kræver afklaring</Badge>}
                                                        {candidate.match_reason && <span className="mt-1 block text-xs text-muted-foreground">{candidate.match_reason}</span>}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}
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

            {/* Send invitation dialog */}
            <Dialog open={inviteConfirmOpen} onOpenChange={open => { if (!bulkSendingInvitations) setInviteConfirmOpen(open) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Send adgangslinks</DialogTitle>
                        <DialogDescription>
                            Send adgangslink til {bulkInviteSummary.targets.length} valgt(e) person(er)?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                        <div>Første invitation: {bulkInviteSummary.firstInvites}</div>
                        <div>Allerede inviteret, får nyt link/2. invitation: {bulkInviteSummary.repeatInvites}</div>
                        <div>Registreret, får loginlink: {bulkInviteSummary.loginLinks.length}</div>
                        {bulkInviteSummary.missingEmail > 0 && (
                            <div className="text-muted-foreground">Springes over på grund af manglende email: {bulkInviteSummary.missingEmail}</div>
                        )}
                    </div>
                    {bulkInviteSummary.repeatInvites > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                            Nogle af de valgte rettighedshavere har allerede fået en invitation. Hvis du fortsætter, får de et nyt link.
                        </div>
                    )}
                    {bulkInviteSummary.loginLinks.length > 0 && (
                        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100">
                            Registrerede rettighedshavere får et loginlink, så de kan vælge et nyt password og logge ind igen. Der oprettes ikke en ny bruger.
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setInviteConfirmOpen(false)} disabled={bulkSendingInvitations}>Annuller</Button>
                        <Button onClick={confirmBulkSendInvitation} disabled={bulkSendingInvitations}>
                            {bulkSendingInvitations && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Send adgangslinks
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={betaInviteOpen} onOpenChange={open => { if (!betaInviteSending) { setBetaInviteOpen(open); if (!open) setBetaInviteResult(null) } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Send betatest-invitation</DialogTitle>
                        <DialogDescription>
                            Du sender individuelle betatest-invitationer til {betaInviteTargets.length} {betaInviteTargets.length === 1 ? "rettighedshaver" : "rettighedshavere"}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                            <span>Valgte modtagere</span>
                            <Badge variant="secondary">{betaInviteTargets.length}</Badge>
                        </div>
                        <div className="space-y-1"><Label>Startdato</Label><Input type="date" value={betaInviteStartDate} disabled /></div>
                        <div className="space-y-1"><Label htmlFor="beta-end-date">Slutdato i invitationsteksten</Label><Input id="beta-end-date" type="date" min={betaInviteStartDate ? addCalendarDays(betaInviteStartDate, 1) : undefined} value={betaInviteEndDate} onChange={event => setBetaInviteEndDate(event.target.value)} /></div>
                        <p className="text-xs text-muted-foreground">Slutdatoen er kun information. Betatesterstatus og adgang fortsætter, indtil en administrator ændrer dem.</p>
                        {betaInviteTargets.length > 0 && (
                            <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                                <p className="font-medium">
                                    {betaInviteTargets.length === 1
                                        ? "Forhåndsvisning og værksopslag"
                                        : `Eksempelmail til ${betaInviteTargets[0].full_name}`}
                                </p>
                                {betaInviteTargets.length > 1 && (
                                    <p className="text-xs text-muted-foreground">
                                        Kun én eksempelmail vises. Når du sender, får alle {betaInviteTargets.length} valgte deres egen mail med eget navn, invitationslink og værker.
                                    </p>
                                )}
                                {betaInvitePreviewLoading ? (
                                    <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter mulige krediteringer fra Portal, DFI og TMDb…</p>
                                ) : betaInvitePreview ? (
                                    <>
                                        <p className="font-medium">{betaInvitePreview.subject}</p>
                                        <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{betaInvitePreview.bodyText}</p>
                                        <p className="text-xs">{betaInvitePreview.work_lookup?.counts.local ?? 0} lokale · {betaInvitePreview.work_lookup?.counts.external ?? 0} eksterne mulige krediteringer</p>
                                        {betaInvitePreview.work_lookup?.warnings.map(warning => <p key={warning} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
                                    </>
                                ) : <p className="text-xs text-muted-foreground">Ingen forhåndsvisning tilgængelig.</p>}
                            </div>
                        )}
                        {betaInviteTargets.length > 1 && <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">Værker hentes sikkert for hver modtager ved udsendelsen. Mails sendes enkeltvis, så modtagerne aldrig kan se hinandens oplysninger. Resultatet opsummeres bagefter.</p>}
                        {betaInviteResult && betaInviteResult.sent < betaInviteTargets.length && (
                            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
                                <p className="font-medium">Betatesterstatus er gemt, men ikke alle mails blev sendt.</p>
                                <p>{betaInviteResult.sent} sendt · {betaInviteResult.marked - betaInviteResult.sent} mailfejl · {betaInviteResult.failed} øvrige fejl.</p>
                                {betaInviteResult.emailError && <p>{betaInviteResult.emailError}</p>}
                                {betaInviteResult.workLookupIssues > 0 && <p>{betaInviteResult.workLookupIssues} værksopslag havde tvetydige matches eller en utilgængelig kilde.</p>}
                                {betaInviteResult.manualLink && (
                                    <div className="space-y-2">
                                        <Label htmlFor="beta-manual-link">Manuelt invitationslink</Label>
                                        <div className="flex gap-2">
                                            <Input id="beta-manual-link" value={betaInviteResult.manualLink} readOnly className="font-mono text-xs" />
                                            <Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(betaInviteResult.manualLink ?? ""); toast.success("Link kopieret") }}>Kopiér</Button>
                                        </div>
                                        <p className="text-xs">Generér helst et nyt link ved genudsendelse, når mailopsætningen er rettet.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBetaInviteOpen(false)} disabled={betaInviteSending}>{betaInviteResult ? "Luk" : "Annuller"}</Button>
                        <Button onClick={confirmBetaInvite} disabled={betaInviteSending || !betaInviteEndDate}>{betaInviteSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{betaInviteResult ? "Prøv at sende igen" : `Send ${betaInviteTargets.length} ${betaInviteTargets.length === 1 ? "invitation" : "invitationer"}`}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={betaMessageOpen} onOpenChange={open => { if (!betaMessageSending) setBetaMessageOpen(open) }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>Besked til alle betatestere</DialogTitle><DialogDescription>Opretter en privat portalbesked og sender en individuel driftsmail til op til {betaTesterCount} betatestere i organisationen.</DialogDescription></DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1"><Label htmlFor="beta-message-subject">Emne</Label><Input id="beta-message-subject" maxLength={200} value={betaMessage.subject} onChange={event => setBetaMessage(current => ({ ...current, subject: event.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="beta-message-body">Besked</Label><Textarea id="beta-message-body" rows={8} maxLength={10000} value={betaMessage.body} onChange={event => setBetaMessage(current => ({ ...current, body: event.target.value }))} /></div>
                        <p className="text-xs text-muted-foreground">Mailen er driftskommunikation om betaprogrammet og sendes individuelt. Modtagerne kan ikke se hinandens adresser.</p>
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setBetaMessageOpen(false)} disabled={betaMessageSending}>Annuller</Button><Button onClick={sendBetaTesterMessage} disabled={betaMessageSending || !betaMessage.subject.trim() || !betaMessage.body.trim()}>{betaMessageSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send til {betaTesterCount}</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Arkivér dialog */}
            <Dialog open={archiveConfirmOpen} onOpenChange={open => { if (!archivingSelected) setArchiveConfirmOpen(open) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Arkivér rettighedshavere</DialogTitle>
                        <DialogDescription>
                            Arkivér {selectedIds.size} rettighedshaver(e)? De skjules i listen, men kan gendannes.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-40 overflow-y-auto rounded-md border px-3 py-2 text-sm">
                        {visible.filter(rh => selectedIds.has(rh.id)).slice(0, 12).map(rh => (
                            <div key={rh.id}>{rh.full_name}</div>
                        ))}
                        {selectedIds.size > 12 && <div className="text-muted-foreground">…og {selectedIds.size - 12} flere</div>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)} disabled={archivingSelected}>Annuller</Button>
                        <Button variant="destructive" onClick={confirmArchiveSelected} disabled={archivingSelected}>
                            {archivingSelected && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Arkivér
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
            <Dialog open={mergeOpen} onOpenChange={open => { if (!open && !merging) setMergeOpen(false) }}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Sammenlæg dubletprofiler</DialogTitle>
                        <DialogDescription>
                            Vælg den profil, der skal bevares. Relationer og manglende oplysninger flyttes til den valgte profil; den anden profil slettes permanent.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {selectedMergeHolders.map(holder => {
                            const status = invitationStatus(holder)
                            return (
                                <label key={holder.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${mergePrimaryId === holder.id ? "border-primary bg-primary/5" : ""}`}>
                                    <input type="radio" name="merge-primary" value={holder.id} checked={mergePrimaryId === holder.id} onChange={() => setMergePrimaryId(holder.id)} className="mt-1" />
                                    <span className="min-w-0">
                                        <span className="block font-medium">{holder.full_name}</span>
                                        <span className="block truncate text-sm text-muted-foreground">{holder.email ?? "Ingen e-mail"}</span>
                                        <span className="block text-xs text-muted-foreground">{holder.organisation_names.join(", ") || "Ingen organisation"} · {status.label}</span>
                                    </span>
                                </label>
                            )
                        })}
                        {mergeHasConflictingUsers ? (
                                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                                    Begge profiler har hver sin loginbruger. De kan ikke sammenlægges automatisk.
                                </p>
                            ) : null}
                        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                            Kontrakter, værker, medlemskaber og sikre relationer bevares. Sammenlægningen afvises uden ændringer ved modstridende login-, CPR-, bank-, person-id-, medlems-, arve-, økonomi- eller fordelingsdata.
                        </div>
                        <div className="space-y-1">
                            <Label>Skriv SAMMENLÆG for at bekræfte</Label>
                            <Input value={mergeConfirmation} onChange={event => setMergeConfirmation(event.target.value)} autoComplete="off" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" disabled={merging} onClick={() => setMergeOpen(false)}>Annuller</Button>
                        <Button
                            variant="destructive"
                            disabled={merging || mergeConfirmation !== "SAMMENLÆG" || mergeHasConflictingUsers}
                            onClick={() => void handleMergeSelected()}
                        >
                            {merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Sammenlæg profiler
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!portalAction} onOpenChange={open => { if (!open) { setPortalAction(null); setPortalLink(null); setPortalEmailStatus(null) } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {portalAction?.type === "login"
                                ? "Send loginlink"
                                : portalAction?.type === "reminder" ? "Gensend velkomstmail" : portalAction?.type === "invite" ? "Inviter til portal" : "Nulstil password"}
                        </DialogTitle>
                        <DialogDescription>
                            {portalAction?.type === "login"
                                ? `Send et nyt loginlink til ${portalAction.rh.full_name} (${portalAction.rh.email}). Personen kan vælge et nyt password og logge ind igen.`
                                : portalAction?.type === "invite" || portalAction?.type === "reminder"
                                ? `${portalAction.type === "reminder" ? "Gensend velkomstmailen" : "Send en invitation"} til ${portalAction.rh.full_name} (${portalAction.rh.email}). Hvis mailen ikke kan sendes, vises linket til manuel deling.`
                                : `Generér et nulstillingslink til ${portalAction?.rh.full_name}. Del linket med dem direkte.`}
                        </DialogDescription>
                        {(portalAction?.type === "invite" || portalAction?.type === "reminder") && portalAction.rh.invite_sent_at && !portalLink && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                                Denne rettighedshaver har allerede fået sendt en invitation den {formatInvitationDate(portalAction.rh.invite_sent_at)}.
                                Hvis du sender igen, får personen et nyt link.
                            </div>
                        )}
                    </DialogHeader>

                    {portalLink ? (
                        <div className="space-y-3 py-2">
                            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                                <Link className="h-4 w-4" />
                                {portalAction?.type === "reset"
                                    ? "Nulstillingslink genereret"
                                    : portalAction?.type === "login"
                                        ? portalEmailStatus?.sent
                                            ? "Loginlink sendt"
                                            : "Loginlink genereret – mail ikke sendt"
                                    : portalEmailStatus?.sent
                                        ? "Invitation sendt"
                                        : "Invitationslink genereret – mail ikke sendt"}
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
                            {portalEmailStatus && !portalEmailStatus.sent && (
                                <p className="text-sm text-destructive">{portalEmailStatus.error ?? "Mailen kunne ikke sendes."}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                {portalEmailStatus?.sent
                                    ? `Mailen er sendt til ${portalAction?.rh.email}. Linket kan også kopieres herfra.`
                                    : "Linket er gyldigt i 24 timer og kan kopieres og sendes manuelt."}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-muted-foreground">
                                {portalAction?.rh.email
                                    ? `Email: ${portalAction.rh.email}`
                                    : <span className="text-destructive">Ingen email registreret — tilføj email først</span>}
                            </p>
                            {portalAction?.type === "invite" && (
                                <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                                    <p className="font-medium">Forhåndsvisning og værksopslag</p>
                                    {portalInvitePreviewLoading ? (
                                        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter mulige krediteringer…</p>
                                    ) : portalInvitePreview ? (
                                        <>
                                            <p className="font-medium">{portalInvitePreview.subject}</p>
                                            <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{portalInvitePreview.bodyText}</p>
                                            <p className="text-xs">{portalInvitePreview.work_lookup?.counts.local ?? 0} lokale · {portalInvitePreview.work_lookup?.counts.external ?? 0} eksterne mulige krediteringer</p>
                                            {portalInvitePreview.work_lookup?.warnings.map(warning => <p key={warning} className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
                                        </>
                                    ) : <p className="text-xs text-muted-foreground">Ingen forhåndsvisning tilgængelig.</p>}
                                </div>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setPortalAction(null); setPortalLink(null); setPortalEmailStatus(null) }}>
                            {portalLink ? "Luk" : "Annuller"}
                        </Button>
                        {!portalLink && (
                            <Button onClick={handlePortalAction} disabled={portalLoading || !portalAction?.rh.email}>
                                {portalLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {portalAction?.type === "login"
                                    ? "Send loginlink"
                                    : portalAction?.type === "reminder" ? "Gensend velkomstmail" : portalAction?.type === "invite" ? "Send invitation" : "Generér nulstillingslink"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}
