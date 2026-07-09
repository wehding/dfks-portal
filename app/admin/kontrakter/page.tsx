"use client"

import { useEffect, useState, useMemo, Suspense, useRef } from "react"
import {
    Search, Trash2, Eye, Upload, MoreHorizontal, FileText,
    CheckCircle2, AlertCircle, Loader2, X, Pencil, MessageSquare,
    AlertTriangle, Clock, Archive, Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { addAdminContractComment, deleteAdminContractsPermanently, markContractCommentsRead, createAdminEmployer, checkRightsHolderName } from "@/app/actions/member-contracts"
import { createAdminWork } from "@/app/actions/work-management"
import { ContractAiDataEditor } from "./ContractAiDataEditor"
import { ContractDocViewer } from "./ContractDocViewer"
import { useI18n } from "@/lib/i18n"
import { PdfViewer } from "@/components/pdf-viewer"
import { PageHeader } from "@/components/page-header"
import { ActiveUserFilter } from "@/components/admin/active-user-filter"
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view"
import { ContextualHelp, HelpButton } from "@/components/help/contextual-help"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useActiveRightsHolder } from "@/lib/use-active-rights-holder"

type ContractRow = {
    id: string
    type: string
    overenskomst: string | null
    status: string
    pdf_url: string | null
    contract_date: string | null
    start_date: string | null
    end_date: string | null
    created_at: string
    employer_id: string | null
    employer_name: string | null
    rights_holder_id: string | null
    rights_holder_name: string | null
    work_id: string | null
    working_title: string | null
    work_title: string | null
    work_poster_url: string | null
    contract_comments: ContractComment[]
    validation_data?: Record<string, unknown> | null
    validation_has_credit_clause?: boolean | null
    validation_has_overenskomst_incorporation?: boolean | null
    ai_job_status?: string | null
    ai_job_error?: string | null
}

type ContractComment = {
    id: string
    author_role: "member" | "admin"
    message: string
    created_at: string
    member_read_at?: string | null
    admin_read_at?: string | null
}

type EditForm = {
    type: string
    overenskomst: string
    status: string
    contract_date: string
    start_date: string
    end_date: string
    employer_id: string
    rights_holder_id: string
    work_id: string
    working_title: string
}

type Employer = { id: string; name: string; parent_id: string | null; dfi_company_id: number | null }
type RightsHolder = { id: string; full_name: string }
type WorkOption = { id: string; title: string; year: number | null; poster_url: string | null }
type SortKey = "production" | "rightsHolder" | "employer" | "type" | "overenskomst" | "period" | "status"
type SortDir = "asc" | "desc"
type NavneTjekResult = {
    status: "match" | "delvist-match" | "ikke-fundet"
    navnIKontrakt?: string
    navnIRegister?: string
    idIRegister?: string
}

type UploadItem = {
    file: File
    status: "pending" | "uploading" | "queued" | "extracting" | "done" | "error"
    error?: string
    employerId?: string
    rightsHolderId?: string
}

const STATUS_LABELS: Record<string, string> = {
    kladde: "Kladde",
    valideret: "Valideret",
    arkiveret: "Arkiveret",
}

const STATUS_CLASS: Record<string, string> = {
    kladde: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    valideret: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    arkiveret: "bg-muted text-muted-foreground",
}

const AI_JOB_LABELS: Record<string, string> = {
    queued: "AI-kø",
    processing: "AI-læser",
    done: "AI-læst",
    error: "AI-fejl",
}

const AI_JOB_CLASS: Record<string, string> = {
    queued: "border-amber-300 bg-amber-50 text-amber-700",
    processing: "border-blue-300 bg-blue-50 text-blue-700",
    done: "border-emerald-300 bg-emerald-50 text-emerald-700",
    error: "border-red-300 bg-red-50 text-red-700",
}

const WORK_LINK_CLASS = {
    linked: "border-emerald-300 bg-emerald-50 text-emerald-700",
    missing: "border-red-300 bg-red-50 text-red-700",
}

const OVERENSKOMST_LABELS: Record<string, string> = {
    "de4-fiktion": "De4 (fiktion)",
    "faf": "FAF (fiktion)",
    "faf-dokumentar": "FAF (dokumentar)",
    "dj": "DJ",
    "metal": "Metal",
    "ingen": "Ingen",
}

function normalizeDuplicateKey(value: string | null | undefined) {
    return (value ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9æøå\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function validationData(contract: ContractRow) {
    return contract.validation_data ?? {}
}

function hasTruthyAiField(contract: ContractRow, keys: string[]) {
    const data = validationData(contract)
    return keys.some(key => data[key] === true || data[key] === "ja")
}

function isValidationRecommended(contract: ContractRow) {
    if (contract.status !== "kladde") return false
    const data = validationData(contract)
    const hasSignature = hasTruthyAiField(contract, ["hasSignature", "signature", "signed", "isSigned"])
    const hasCopydan = hasTruthyAiField(contract, ["copydan", "copydanReservation", "copydanforbehold"])
    const hasStreaming = hasTruthyAiField(contract, ["svod", "streaming", "streamingReservation", "streamingforbehold"])
    const hasDe4 = contract.overenskomst === "de4-fiktion" || data.overenskomst === "de4-fiktion" || data.collectiveAgreementName === "de4-fiktion"
    return Boolean(contract.work_id && contract.employer_id && (hasSignature || hasCopydan || hasStreaming || hasDe4))
}

function isMissingOwner(contract: ContractRow) {
    return !contract.rights_holder_id
}

function ContractStatusBadges({ contract, compact = false }: { contract: ContractRow; compact?: boolean }) {
    const badgeClass = compact ? "text-[10px]" : "text-xs"
    return (
        <div className={`flex flex-wrap gap-1.5 ${compact ? "flex-col items-start" : "items-center justify-end"}`}>
            <Badge className={`w-fit font-normal ${badgeClass} ${STATUS_CLASS[contract.status] ?? ""}`}>
                {STATUS_LABELS[contract.status] ?? contract.status}
            </Badge>
            {contract.ai_job_status && contract.ai_job_status !== "done" && (
                <Badge
                    variant="outline"
                    title={contract.ai_job_error ?? undefined}
                    className={`w-fit font-normal ${badgeClass} ${AI_JOB_CLASS[contract.ai_job_status] ?? ""}`}
                >
                    {AI_JOB_LABELS[contract.ai_job_status] ?? contract.ai_job_status}
                </Badge>
            )}
            {isValidationRecommended(contract) && (
                <Badge variant="outline" className={`w-fit border-blue-300 bg-blue-50 font-normal text-blue-700 ${badgeClass}`}>
                    Validering anbefalet
                </Badge>
            )}
            {(contract.status !== "valideret" || !contract.work_id) && (
                <Badge variant="outline" className={`w-fit font-normal ${badgeClass} ${contract.work_id ? WORK_LINK_CLASS.linked : WORK_LINK_CLASS.missing}`}>
                    {contract.work_id ? "Værk tilknyttet" : "Mangler værk"}
                </Badge>
            )}
            {isMissingOwner(contract) && (
                <Badge variant="outline" className={`w-fit border-red-300 bg-red-50 font-normal text-red-700 ${badgeClass}`}>
                    Mangler ejer
                </Badge>
            )}
        </div>
    )
}

function posterUrl(value: string | null) {
    if (!value) return null
    if (value.startsWith("http") || value.startsWith("data:image/")) return value
    if (value.startsWith("/")) return `https://image.tmdb.org/t/p/w92${value}`
    return value
}

function adminContractSummary(contract: ContractRow) {
    return [
        `Titel: ${contract.work_title ?? contract.working_title ?? "ukendt"}`,
        `Rettighedshaver: ${contract.rights_holder_name ?? "ikke tilknyttet"}`,
        `Værk: ${contract.work_title ?? "ikke tilknyttet"}`,
        `Producent: ${contract.employer_name ?? "ikke tilknyttet"}`,
    ].join("\n")
}

function AdminKontrakterContent() {
    const { t } = useI18n()
    const router = useRouter()
    const [contracts, setContracts] = useState<ContractRow[]>([])
    const [employers, setEmployers] = useState<Employer[]>([])
    const [rightsHolders, setRightsHolders] = useState<RightsHolder[]>([])
    const [works, setWorks] = useState<WorkOption[]>([])
    const [orgId, setOrgId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [helpOpen, setHelpOpen] = useState(false)
    const [search, setSearch] = useState("")
    const [filterStatus, setFilterStatus] = useState("all")
    const [filterType, setFilterType] = useState("all")
    const [pageSize, setPageSize] = useState(20)
    const [sortKey, setSortKey] = useState<SortKey>("status")
    const [sortDir, setSortDir] = useState<SortDir>("asc")
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
    const [isSuperadmin, setIsSuperadmin] = useState(false)
    const [bulkDeleteStep, setBulkDeleteStep] = useState(0) // 0 = lukket, 1-3 = advarselstrin
    const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")
    const [duplicatesOpen, setDuplicatesOpen] = useState(false)
    const [archiveEditOpen, setArchiveEditOpen] = useState(false)
    const [deleteEditOpen, setDeleteEditOpen] = useState(false)
    const [missingWorkValidation, setMissingWorkValidation] = useState<{ contractId: string; title: string; openNextAfterSave: boolean } | null>(null)
    const [adminReply, setAdminReply] = useState("")
    const [replySaving, setReplySaving] = useState(false)

    // View dialog
    const [viewContract, setViewContract] = useState<ContractRow | null>(null)
    const [viewPdfUrl, setViewPdfUrl] = useState<string | null>(null)
    const [editDocUrl, setEditDocUrl] = useState<string | null>(null)

    // Edit dialog
    const [editContract, setEditContract] = useState<ContractRow | null>(null)
    const [editForm, setEditForm] = useState<EditForm | null>(null)
    const [editWorkSearch, setEditWorkSearch] = useState("")
    const [editRightsHolderSearch, setEditRightsHolderSearch] = useState("")
    const [editSaving, setEditSaving] = useState(false)
    const [activeHighlight, setActiveHighlight] = useState<string | null>(null)
    const [navneTjekResult, setNavneTjekResult] = useState<NavneTjekResult | null>(null)
    const [navneTjekLoading, setNavneTjekLoading] = useState(false)
    const [creatingEmployer, setCreatingEmployer] = useState(false)

    // Upload flow
    const [showUpload, setShowUpload] = useState(false)
    const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
    const [uploadPhase, setUploadPhase] = useState<"select" | "processing">("select")
    const [uploadRightsHolderId, setUploadRightsHolderId] = useState("")
    const [uploadRightsHolderSearch, setUploadRightsHolderSearch] = useState("")
    const [saving, setSaving] = useState(false)
    const prefillWorkIdRef = useRef<string | null>(null)
    const { activeRh, setActiveRh } = useActiveRightsHolder()

    // Åbn upload-flowet automatisk når man kommer fra "Tilføj kontrakt" (?new=1&work=<id>)
    useEffect(() => {
        if (typeof window === "undefined") return
        const params = new URLSearchParams(window.location.search)
        prefillWorkIdRef.current = params.get("work")
        if (params.get("new") === "1") {
            setShowUpload(true)
            setUploadPhase("select")
            setUploadItems([])
        }
    }, [])

    // Delete
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const validateAndNextRef = useRef<() => void>(() => undefined)
    const editParamHandledRef = useRef(false)
    const rhParamHandledRef = useRef(false)

    // Deep-link: ?edit=<id> åbner Rediger kontrakt automatisk (fx fra rettighedshaver-siden)
    useEffect(() => {
        if (editParamHandledRef.current || contracts.length === 0) return
        const editId = new URLSearchParams(window.location.search).get("edit")
        if (!editId) return
        const c = contracts.find(x => x.id === editId)
        if (c) {
            editParamHandledRef.current = true
            openEdit(c)
            window.history.replaceState(null, "", "/admin/kontrakter")
        }
    }, [contracts]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (rhParamHandledRef.current || rightsHolders.length === 0) return
        const params = new URLSearchParams(window.location.search)
        const rhId = params.get("rh")
        if (!rhId) return
        const rh = rightsHolders.find(x => x.id === rhId)
        if (!rh) return
        rhParamHandledRef.current = true
        setActiveRh({ id: rh.id, name: rh.full_name })
        params.delete("rh")
        const next = params.toString()
        window.history.replaceState(null, "", next ? `/admin/kontrakter?${next}` : "/admin/kontrakter")
    }, [rightsHolders, setActiveRh])

    // ── Load ──────────────────────────────────────────────────

    useEffect(() => {
        const load = async () => {
            try {
                const supabase = createClient()
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) { setLoading(false); return }

                const metaOrgId: string | undefined = user.user_metadata?.org_id
                let resolvedOrgId = metaOrgId ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"

                // Forsøg at slå op i user_org_roles (men blokér ikke hvis tom)
                const { data: roleRows } = await supabase
                    .from("user_org_roles")
                    .select("org_id, role")
                    .eq("user_id", user.id)
                if (roleRows?.[0]?.org_id) resolvedOrgId = roleRows[0].org_id
                setOrgId(resolvedOrgId)
                setIsSuperadmin((roleRows ?? []).some(r => r.role === "superadmin"))

                const [contractsRes, employersRes, rhRes, worksRes] = await Promise.all([
                    supabase
                        .from("contracts")
                        .select(`
                            id, type, overenskomst, status, pdf_url,
                            contract_date, start_date, end_date, created_at,
                            employer_id, rights_holder_id, working_title,
                            employers (name),
                            rettighedshavere (full_name),
                            works (id, title, poster_url),
                            contract_validations (extracted_data, has_credit_clause, has_overenskomst_incorporation)
                        `)
                        .eq("org_id", resolvedOrgId)
                        .order("created_at", { ascending: false }),
                    supabase.from("employers").select("id, name, parent_id, dfi_company_id").order("name"),
                    supabase
                        .from("rettighedshavere")
                        .select("id, full_name, org_affiliations!inner(org_id)")
                        .eq("org_affiliations.org_id", resolvedOrgId)
                        .order("full_name"),
                    supabase
                        .from("works")
                        .select("id, title, year, poster_url")
                        .eq("org_id", resolvedOrgId)
                        .order("title"),
                ])

                if (contractsRes.error) console.error("Kontrakter query fejl:", contractsRes.error.message)
                if (contractsRes.data) {
                    const rawContracts = contractsRes.data as unknown as Array<{ id: string; type: string; overenskomst: string | null; status: string; pdf_url: string; contract_date: string | null; start_date: string | null; end_date: string | null; created_at: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; works?: { id?: string | null; title?: string | null; poster_url?: string | null } | null; contract_validations?: { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null }[] | { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null } | null }>
                    const commentsByContract: Record<string, ContractComment[]> = {}
                    const latestJobByContract: Record<string, { status: string; error_message: string | null; created_at: string }> = {}
                    if (rawContracts.length > 0) {
                        const [commentsRes, jobsRes] = await Promise.all([
                            supabase
                                .from("contract_comments")
                                .select("id, contract_id, author_role, message, created_at, member_read_at, admin_read_at")
                                .in("contract_id", rawContracts.map(r => r.id))
                                .order("created_at", { ascending: true }),
                            supabase
                                .from("contract_ai_jobs")
                                .select("contract_id, status, error_message, created_at")
                                .in("contract_id", rawContracts.map(r => r.id))
                                .order("created_at", { ascending: false }),
                        ])
                        if (commentsRes.data) {
                            for (const comment of commentsRes.data as unknown as Array<ContractComment & { contract_id: string }>) {
                                if (!commentsByContract[comment.contract_id]) commentsByContract[comment.contract_id] = []
                                commentsByContract[comment.contract_id].push(comment)
                            }
                        }
                        if (jobsRes.data) {
                            for (const job of jobsRes.data as Array<{ contract_id: string; status: string; error_message: string | null; created_at: string }>) {
                                if (!latestJobByContract[job.contract_id]) latestJobByContract[job.contract_id] = job
                            }
                        }
                    }
                    setContracts(rawContracts.map((r) => {
                        const validation = Array.isArray(r.contract_validations) ? r.contract_validations[0] : r.contract_validations
                        return ({
                        id: r.id,
                        type: r.type,
                        overenskomst: r.overenskomst,
                        status: r.status,
                        pdf_url: r.pdf_url,
                        contract_date: r.contract_date,
                        start_date: r.start_date,
                        end_date: r.end_date,
                        created_at: r.created_at,
                        employer_id: r.employer_id ?? null,
                        employer_name: r.employers?.name ?? null,
                        rights_holder_id: r.rights_holder_id ?? null,
                        rights_holder_name: r.rettighedshavere?.full_name ?? null,
                        work_id: r.works?.id ?? null,
                        working_title: r.working_title ?? null,
                        work_title: r.works?.title ?? null,
                        work_poster_url: r.works?.poster_url ?? null,
                        contract_comments: commentsByContract[r.id] ?? [],
                        validation_data: validation?.extracted_data ?? null,
                        validation_has_credit_clause: validation?.has_credit_clause ?? null,
                        validation_has_overenskomst_incorporation: validation?.has_overenskomst_incorporation ?? null,
                        ai_job_status: latestJobByContract[r.id]?.status ?? null,
                        ai_job_error: latestJobByContract[r.id]?.error_message ?? null,
                        })
                    }))
                }
                if (employersRes.data) setEmployers(employersRes.data)
                if (rhRes.data) setRightsHolders(rhRes.data.map((r: { id: string; full_name: string }) => ({ id: r.id, full_name: r.full_name })))
                if (worksRes.data) setWorks(worksRes.data as WorkOption[])
            } catch (e) {
                console.error("Load fejl:", e)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

    // ── Live AI-jobstatus ─────────────────────────────────────
    // Så længe kontrakter er i kø/behandling, poll deres jobstatus og opdatér
    // rækkerne uden manuel genindlæsning. Når et job bliver "done", hentes de
    // opdaterede visningsfelter (titel, arbejdsgiver, valideringsflag) med.
    const pendingJobKey = contracts
        .filter(c => c.ai_job_status === "queued" || c.ai_job_status === "processing")
        .map(c => c.id)
        .join(",")
    useEffect(() => {
        const ids = pendingJobKey.split(",").filter(Boolean)
        if (!orgId || ids.length === 0) return
        let cancelled = false
        const supabase = createClient()

        const poll = async () => {
            const { data: jobRows } = await supabase
                .from("contract_ai_jobs")
                .select("contract_id, status, error_message, created_at")
                .in("contract_id", ids)
                .order("created_at", { ascending: false })
            if (cancelled || !jobRows) return

            const latest: Record<string, { status: string; error_message: string | null }> = {}
            for (const j of jobRows as Array<{ contract_id: string; status: string; error_message: string | null }>) {
                if (!latest[j.contract_id]) latest[j.contract_id] = { status: j.status, error_message: j.error_message }
            }

            // Kontrakter der lige er blevet færdige — hent opdaterede visningsfelter
            const doneIds = ids.filter(id => latest[id]?.status === "done")
            const refreshed: Record<string, Partial<ContractRow>> = {}
            if (doneIds.length > 0) {
                const { data: rows } = await supabase
                    .from("contracts")
                    .select(`
                        id, type, overenskomst, status, employer_id, rights_holder_id, working_title,
                        employers (name), rettighedshavere (full_name), works (id, title, poster_url),
                        contract_validations (extracted_data, has_credit_clause, has_overenskomst_incorporation)
                    `)
                    .in("id", doneIds)
                for (const r of (rows ?? []) as unknown as Array<{ id: string; type: string; overenskomst: string | null; status: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; works?: { id?: string | null; title?: string | null; poster_url?: string | null } | null; contract_validations?: { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null }[] | { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null } | null }>) {
                    const validation = Array.isArray(r.contract_validations) ? r.contract_validations[0] : r.contract_validations
                    refreshed[r.id] = {
                        type: r.type,
                        overenskomst: r.overenskomst,
                        status: r.status,
                        employer_id: r.employer_id ?? null,
                        employer_name: r.employers?.name ?? null,
                        rights_holder_id: r.rights_holder_id ?? null,
                        rights_holder_name: r.rettighedshavere?.full_name ?? null,
                        work_id: r.works?.id ?? null,
                        working_title: r.working_title ?? null,
                        work_title: r.works?.title ?? null,
                        work_poster_url: r.works?.poster_url ?? null,
                        validation_data: validation?.extracted_data ?? null,
                        validation_has_credit_clause: validation?.has_credit_clause ?? null,
                        validation_has_overenskomst_incorporation: validation?.has_overenskomst_incorporation ?? null,
                    }
                }
            }
            if (cancelled) return
            setContracts(prev => prev.map(c => {
                const l = latest[c.id]
                if (!l) return c
                return { ...c, ...(refreshed[c.id] ?? {}), ai_job_status: l.status, ai_job_error: l.error_message }
            }))
        }

        void poll()
        const interval = setInterval(() => void poll(), 4000)
        return () => { cancelled = true; clearInterval(interval) }
    }, [orgId, pendingJobKey])

    // ── Signed URL for PDF ────────────────────────────────────

    const openPdf = async (contract: ContractRow) => {
        setViewContract(contract)
        setViewPdfUrl(null)
        if (!contract.pdf_url) return
        const supabase = createClient()
        const { data } = await supabase.storage.from("kontrakter").createSignedUrl(contract.pdf_url, 3600)
        if (data?.signedUrl) setViewPdfUrl(data.signedUrl)
    }

    // ── Upload: file selection ────────────────────────────────

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        if (files.length > 15) {
            toast.error("Du kan maks. uploade 15 kontrakter ad gangen")
            e.target.value = ""
            return
        }
        setUploadItems(files.map(f => ({ file: f, status: "pending" })))
    }

    // ── Upload: gem kontrakter + opret AI-jobs ───────────────────

    const handleExtractAndSave = async () => {
        if (uploadItems.length === 0 || !orgId) return
        if (uploadItems.length > 15) {
            toast.error("Du kan maks. uploade 15 kontrakter ad gangen")
            return
        }
        setUploadPhase("processing")
        setSaving(true)
        const supabase = createClient()
        const saved: ContractRow[] = []
        const updated = [...uploadItems]
        const jobs: { jobId?: string; contractId: string }[] = []

        for (let i = 0; i < updated.length; i++) {
            updated[i] = { ...updated[i], status: "uploading" }
            setUploadItems([...updated])

            try {
                const filePath = `${orgId}/${Date.now()}_${updated[i].file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
                const { error: storageErr } = await supabase.storage.from("kontrakter").upload(filePath, updated[i].file, { contentType: updated[i].file.type })
                if (storageErr) throw new Error(`Upload fejl: ${storageErr.message}`)

                const { data: newContract, error: contractErr } = await supabase.from("contracts").insert({
                    org_id: orgId,
                    type: "a-løn",
                    overenskomst: null,
                    status: "kladde",
                    pdf_url: filePath,
                    working_title: updated[i].file.name.replace(/\.[^.]+$/, ""),
                    work_id: prefillWorkIdRef.current,
                    rights_holder_id: uploadItems.length === 1 && uploadRightsHolderId ? uploadRightsHolderId : null,
                }).select().single()
                if (contractErr) throw new Error(`Kontrakt fejl: ${contractErr.message}`)

                if (newContract) {
                    const { data: job, error: jobErr } = await supabase.from("contract_ai_jobs").insert({
                        contract_id: newContract.id,
                        org_id: orgId,
                        status: "queued",
                        priority: i === 0 ? 0 : 100 + i,
                    }).select("id").single()
                    const useDirectFallback = jobErr && (
                        jobErr.message.includes("contract_ai_jobs") ||
                        jobErr.message.includes("schema cache") ||
                        jobErr.code === "PGRST205" ||
                        jobErr.code === "42P01"
                    )
                    if (jobErr && !useDirectFallback) throw new Error(`AI-job fejl: ${jobErr.message}`)
                    jobs.push({ jobId: job?.id, contractId: newContract.id })
                    saved.push({
                        id: newContract.id, type: newContract.type, overenskomst: newContract.overenskomst,
                        status: newContract.status, pdf_url: newContract.pdf_url,
                        contract_date: newContract.contract_date, start_date: newContract.start_date,
                        end_date: newContract.end_date, created_at: newContract.created_at,
                        employer_id: null, rights_holder_id: uploadItems.length === 1 && uploadRightsHolderId ? uploadRightsHolderId : null,
                        work_id: prefillWorkIdRef.current,
                        working_title: newContract.working_title,
                        employer_name: null,
                        rights_holder_name: uploadItems.length === 1 && uploadRightsHolderId ? rightsHolders.find(r => r.id === uploadRightsHolderId)?.full_name ?? null : null,
                        work_title: null,
                        work_poster_url: null,
                        contract_comments: [],
                        validation_data: null,
                        validation_has_credit_clause: null,
                        validation_has_overenskomst_incorporation: null,
                        ai_job_status: "queued",
                        ai_job_error: null,
                    })
                }

                updated[i] = { ...updated[i], status: "queued" }
            } catch (err: unknown) {
                updated[i] = { ...updated[i], status: "error", error: err instanceof Error ? err.message : String(err) }
            }
            setUploadItems([...updated])
        }

        setContracts(prev => [...saved, ...prev])
        const queuedCount = updated.filter(i => i.status === "queued").length
        const errCount  = updated.filter(i => i.status === "error").length
        if (queuedCount > 0) {
            toast.success(`${queuedCount} kontrakt${queuedCount !== 1 ? "er" : ""} gemt som kladde — AI-læsning starter nu`)
        }
        if (errCount  > 0) toast.error(`${errCount} kontrakt${errCount !== 1 ? "er" : ""} fejlede`)

        if (jobs.length > 0) {
            updated[0] = { ...updated[0], status: "extracting" }
            setUploadItems([...updated])
            try {
                const firstRes = await fetch("/api/contracts/jobs/process", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(jobs[0].jobId ? { jobId: jobs[0].jobId } : { contractId: jobs[0].contractId }),
                })
                const firstJson = await firstRes.json()
                if (!firstRes.ok || !firstJson.ok) throw new Error(firstJson.error ?? "AI-job fejlede")
                updated[0] = { ...updated[0], status: "done" }
                toast.success("Første kontrakt er AI-læst og klar som kladde")
                setShowUpload(false)
                setUploadItems([])
                setUploadPhase("select")
                await refreshContractRow(firstJson.contractId ?? jobs[0].contractId)
            } catch (err: unknown) {
                updated[0] = { ...updated[0], status: "error", error: err instanceof Error ? err.message : String(err) }
                toast.error(err instanceof Error ? err.message : "Første AI-job fejlede")
                setUploadItems([...updated])
            }

            window.dispatchEvent(new CustomEvent("contracts-updated"))
        }
        setSaving(false)
    }

    // ── Upload: extract all files ─────────────────────────────


    // ── Update extracted field in review ──────────────────────



    // ── Save all reviewed contracts ───────────────────────────


    // ── Delete ────────────────────────────────────────────────

    const handleDelete = async () => {
        if (!deleteId) return
        const contract = contracts.find(c => c.id === deleteId)
        const supabase = createClient()
        if (contract?.pdf_url) await supabase.storage.from("kontrakter").remove([contract.pdf_url])
        await supabase.from("contracts").delete().eq("id", deleteId)
        setContracts(prev => prev.filter(c => c.id !== deleteId))
        setDeleteId(null)
        toast.success("Kontrakt slettet")
    }

    const handleMarkSelectedMessagesRead = async () => {
        const toMark = contracts.filter(c => selectedIds.includes(c.id) && c.contract_comments.some(m => m.author_role === "member" && !m.admin_read_at))
        if (toMark.length === 0) { toast.info("Ingen ulæste beskeder blandt de valgte"); return }
        setSaving(true)
        try {
            const results = await Promise.all(toMark.map(c => markContractCommentsRead(c.id, "admin")))
            const failed = results.find(r => !r.success)
            if (failed) throw new Error(failed.error ?? "Kunne ikke markere beskeder læst")
            const now = new Date().toISOString()
            setContracts(prev => prev.map(c => selectedIds.includes(c.id)
                ? { ...c, contract_comments: c.contract_comments.map(m => m.author_role === "member" && !m.admin_read_at ? { ...m, admin_read_at: now } : m) }
                : c))
            toast.success(`Beskeder markeret som læst på ${toMark.length} kontrakt(er)`)
            setSelectedIds([])
            window.dispatchEvent(new CustomEvent("contracts-updated"))
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Kunne ikke markere beskeder læst")
        } finally {
            setSaving(false)
        }
    }

    const handleApproveSelected = async () => {
        if (selectedIds.length === 0) return
        const missingWork = contracts.filter(c => selectedIds.includes(c.id) && !c.work_id)
        if (missingWork.length > 0) {
            toast.error(`${missingWork.length} kontrakt(er) kan ikke valideres, fordi de mangler værktilknytning`)
            return
        }
        setSaving(true)
        const supabase = createClient()
        try {
            const { error } = await supabase
                .from("contracts")
                .update({ status: "valideret" })
                .in("id", selectedIds)
            if (error) throw new Error(error.message)
            setContracts(prev => prev.map(c => selectedIds.includes(c.id) ? { ...c, status: "valideret" } : c))
            toast.success(`${selectedIds.length} kontrakt(er) er valideret`)
            setSelectedIds([])
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Kunne ikke validere kontrakter")
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteSelectedPermanently = async () => {
        if (selectedIds.length === 0) return
        setSaving(true)
        try {
            const idsToDelete = [...selectedIds]
            const res = await deleteAdminContractsPermanently(idsToDelete)
            if (!res.success) throw new Error(res.error ?? "Kunne ikke slette kontrakter")
            setContracts(prev => prev.filter(c => !idsToDelete.includes(c.id)))
            toast.success(`${res.deletedCount ?? idsToDelete.length} kontrakt(er) er slettet permanent`)
            setSelectedIds([])
            setBatchDeleteOpen(false)
            setBulkDeleteStep(0)
            setBulkDeleteConfirmText("")
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Kunne ikke slette kontrakter")
        } finally {
            setSaving(false)
        }
    }

    // ── Edit ──────────────────────────────────────────────────

    // ── Fuzzy match & normalize helpers ──────────────────────
    const normalizeMatchText = (value: unknown) => {
        return String(value ?? "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9æøå]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
    }

    const levenshtein = (a: string, b: string) => {
        const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i])
        for (let j = 1; j <= b.length; j++) matrix[0][j] = j
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                matrix[i][j] = a[i - 1] === b[j - 1]
                    ? matrix[i - 1][j - 1]
                    : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1
            }
        }
        return matrix[a.length][b.length]
    }

    const fuzzyTitleScore = (a: string, b: string) => {
        const left = normalizeMatchText(a)
        const right = normalizeMatchText(b)
        if (!left || !right) return 0
        if (left === right) return 1
        const distance = levenshtein(left, right)
        const similarity = 1 - distance / Math.max(left.length, right.length)
        const leftTokens = new Set(left.split(" "))
        const rightTokens = new Set(right.split(" "))
        const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length / Math.max(1, Math.min(leftTokens.size, rightTokens.size))
        return Math.max(similarity, overlap)
    }

    const findBestEmployerMatch = (extractedName: string | null, employersList: Employer[]) => {
        if (!extractedName) return null
        const normExtracted = normalizeMatchText(extractedName)
        if (!normExtracted) return null

        let bestMatch: Employer | null = null
        let bestScore = 0

        for (const emp of employersList) {
            const score = fuzzyTitleScore(emp.name, normExtracted)
            if (score > bestScore) {
                bestScore = score
                bestMatch = emp
            }
        }

        return bestScore >= 0.6 ? { employer: bestMatch, score: bestScore } : null
    }

    const openEdit = (c: ContractRow) => {
        setEditContract(c)
        setAdminReply("")
        void markAdminCommentsRead(c)
        // Auto-hent dokument-URL så kontrakten vises til venstre uden knap-tryk
        setEditDocUrl(null)
        setActiveHighlight(null)
        setNavneTjekResult(null)

        const rightsHolderName = c.validation_data?.rightsHolderName as string | undefined
        if (rightsHolderName) {
            setNavneTjekLoading(true)
            checkRightsHolderName(rightsHolderName).then(res => {
                if (res.success && res.result) {
                    setNavneTjekResult(res.result)
                }
                setNavneTjekLoading(false)
            }).catch(() => setNavneTjekLoading(false))
        }

        if (c.pdf_url) {
            const supabase = createClient()
            supabase.storage.from("kontrakter").createSignedUrl(c.pdf_url, 3600).then(({ data }) => {
                if (data?.signedUrl) setEditDocUrl(data.signedUrl)
            })
        }
        setEditForm({
            type: c.type,
            overenskomst: c.overenskomst ?? "ingen",
            status: c.status,
            contract_date: c.contract_date ?? "",
            start_date: c.start_date ?? "",
            end_date: c.end_date ?? "",
            employer_id: c.employer_id ?? "",
            rights_holder_id: c.rights_holder_id ?? "",
            work_id: c.work_id ?? "",
            working_title: c.working_title ?? "",
        })
        setEditWorkSearch(c.work_title ?? c.working_title ?? "")
        setEditRightsHolderSearch(c.rights_holder_name ?? "")
    }

    const markAdminCommentsRead = async (c: ContractRow) => {
        const hasUnread = c.contract_comments.some(
            comment => comment.author_role === "member" && !comment.admin_read_at
        )
        if (!hasUnread) return
        const now = new Date().toISOString()
        const patch = (row: ContractRow): ContractRow => ({
            ...row,
            contract_comments: row.contract_comments.map(comment =>
                comment.author_role === "member" && !comment.admin_read_at
                    ? { ...comment, admin_read_at: now }
                    : comment
            ),
        })
        setContracts(prev => prev.map(row => (row.id === c.id ? patch(row) : row)))
        setEditContract(prev => (prev && prev.id === c.id ? patch(prev) : prev))
        const res = await markContractCommentsRead(c.id, "admin")
        if (res.success) window.dispatchEvent(new CustomEvent("contracts-updated"))
    }

    const refreshContractRow = async (contractId: string) => {
        const supabase = createClient()
        const { data } = await supabase
            .from("contracts")
            .select(`
                id, type, overenskomst, status, pdf_url,
                contract_date, start_date, end_date, created_at,
                employer_id, rights_holder_id, working_title,
                employers (name),
                rettighedshavere (full_name),
                works (id, title, poster_url),
                contract_validations (extracted_data, has_credit_clause, has_overenskomst_incorporation)
            `)
            .eq("id", contractId)
            .maybeSingle()
        if (!data) return
        const row = data as unknown as { id: string; type: string; overenskomst: string | null; status: string; pdf_url: string | null; contract_date: string | null; start_date: string | null; end_date: string | null; created_at: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; works?: { id?: string | null; title?: string | null; poster_url?: string | null } | null; contract_validations?: { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null }[] | { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null } | null }
        const validation = Array.isArray(row.contract_validations) ? row.contract_validations[0] : row.contract_validations
        const patch: Partial<ContractRow> = {
            type: row.type,
            overenskomst: row.overenskomst,
            status: row.status,
            contract_date: row.contract_date,
            start_date: row.start_date,
            end_date: row.end_date,
            employer_id: row.employer_id ?? null,
            employer_name: row.employers?.name ?? null,
            rights_holder_id: row.rights_holder_id ?? null,
            rights_holder_name: row.rettighedshavere?.full_name ?? null,
            work_id: row.works?.id ?? null,
            work_title: row.works?.title ?? null,
            work_poster_url: row.works?.poster_url ?? null,
            working_title: row.working_title ?? null,
            validation_data: validation?.extracted_data ?? null,
            validation_has_credit_clause: validation?.has_credit_clause ?? null,
            validation_has_overenskomst_incorporation: validation?.has_overenskomst_incorporation ?? null,
            ai_job_status: "done",
            ai_job_error: null,
        }
        setContracts(prev => prev.map(c => c.id === contractId ? { ...c, ...patch } : c))
        setEditContract(prev => prev?.id === contractId ? { ...prev, ...patch } : prev)
        setEditForm(prev => prev ? {
            ...prev,
            type: patch.type ?? prev.type,
            overenskomst: patch.overenskomst ?? "ingen",
            status: patch.status ?? prev.status,
            contract_date: patch.contract_date ?? "",
            start_date: patch.start_date ?? "",
            end_date: patch.end_date ?? "",
            employer_id: patch.employer_id ?? "",
            rights_holder_id: patch.rights_holder_id ?? "",
            work_id: patch.work_id ?? "",
            working_title: patch.working_title ?? prev.working_title,
        } : prev)
        if (!patch.work_id) setEditWorkSearch(patch.working_title ?? patch.work_title ?? "")
        setEditRightsHolderSearch(patch.rights_holder_name ?? "")
    }

    const openNextValidationContract = (currentId: string) => {
        const next = filtered.find(c => c.id !== currentId && c.status !== "valideret")
            ?? contracts.find(c => c.id !== currentId && c.status !== "valideret")
        if (next) openEdit(next)
        else {
            setEditContract(null)
            setEditForm(null)
        }
    }

    const runAiDataminingForContract = async (contract: ContractRow, automatic = false) => {
        if (!contract || !orgId) return
        if (!contract.pdf_url) {
            toast.error("Kontrakten mangler fil")
            return
        }
        setEditSaving(true)
        const supabase = createClient()
        try {
            const { data: job, error: jobErr } = await supabase.from("contract_ai_jobs").insert({
                contract_id: contract.id,
                org_id: orgId,
                status: "queued",
                priority: 0,
            }).select("id").single()
            const useDirectFallback = jobErr && (
                jobErr.message.includes("contract_ai_jobs") ||
                jobErr.message.includes("schema cache") ||
                jobErr.code === "PGRST205" ||
                jobErr.code === "42P01"
            )
            if (jobErr && !useDirectFallback) throw new Error(jobErr.message)
            setContracts(prev => prev.map(c => c.id === contract.id ? { ...c, ai_job_status: "processing", ai_job_error: null } : c))
            const res = await fetch("/api/contracts/jobs/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(useDirectFallback ? { contractId: contract.id } : { jobId: job?.id }),
            })
            const json = await res.json()
            if (!res.ok || !json.ok) throw new Error(json.error ?? "AI datamining fejlede")
            await refreshContractRow(contract.id)
            toast.success(automatic ? "AI datamining startet automatisk" : "AI datamining gennemført")
        } catch (err: unknown) {
            if (!automatic) toast.error(err instanceof Error ? err.message : "AI datamining fejlede")
            setContracts(prev => prev.map(c => c.id === contract.id ? { ...c, ai_job_status: "error", ai_job_error: err instanceof Error ? err.message : "AI datamining fejlede" } : c))
        } finally {
            setEditSaving(false)
        }
    }

    const handleRunAiDatamining = async () => {
        if (!editContract) return
        await runAiDataminingForContract(editContract)
    }

    const handleSaveEdit = async (
        statusOverride?: "kladde" | "valideret" | "arkiveret",
        options?: { skipMissingWorkConfirm?: boolean; openNextAfterSave?: boolean }
    ) => {
        if (!editContract || !editForm) return false
        const newStatus = statusOverride ?? editForm.status
        let resolvedWorkId = editForm.work_id
        let selectedWork = works.find(w => w.id === resolvedWorkId)
        if (newStatus === "valideret" && !resolvedWorkId && !options?.skipMissingWorkConfirm) {
            const title = (editForm.working_title || editContract.working_title || editContract.work_title || "").trim()
            if (!title) {
                toast.error("Kontrakten kan ikke valideres uden værk eller arbejdstitel.")
                return false
            }
            setMissingWorkValidation({
                contractId: editContract.id,
                title,
                openNextAfterSave: Boolean(options?.openNextAfterSave),
            })
            return false
        }
        setEditSaving(true)
        try {
            if (newStatus === "valideret" && !resolvedWorkId) {
                const title = (editForm.working_title || editContract.working_title || editContract.work_title || "").trim()
                if (!title) throw new Error("Kontrakten kan ikke valideres uden værk eller arbejdstitel.")
                const created = await createAdminWork({
                    data: {
                        title,
                        type: "spillefilm",
                        year: null,
                        duration_minutes: null,
                        season_count: null,
                        episode_count: null,
                        genre: null,
                        director: null,
                        alternative_titles: [],
                        production_countries: [],
                        production_companies: [],
                        dfi_title: null,
                        dfi_danish_title: null,
                        dfi_original_title: null,
                        dfi_category: null,
                        dfi_type: null,
                        description: null,
                        dfi_id: null,
                        tmdb_id: null,
                        poster_url: null,
                        dfi_metadata: null,
                    },
                })
                resolvedWorkId = created.workId
                selectedWork = { id: created.workId, title, year: null, poster_url: null }
                setWorks(prev => prev.some(w => w.id === created.workId) ? prev : [...prev, selectedWork!].sort((a, b) => a.title.localeCompare(b.title, "da-DK")))
            }
            const supabase = createClient()
            const { error } = await supabase
                .from("contracts")
                .update({
                    type: editForm.type,
                    overenskomst: editForm.overenskomst === "ingen" ? null : editForm.overenskomst,
                    status: newStatus,
                    contract_date: editForm.contract_date || null,
                    start_date: editForm.start_date || null,
                    end_date: editForm.end_date || null,
                    employer_id: editForm.employer_id || null,
                    rights_holder_id: editForm.rights_holder_id || null,
                    work_id: resolvedWorkId || null,
                    working_title: editForm.working_title || null,
                })
                .eq("id", editContract.id)
            if (error) throw new Error(error.message)

            const emp = employers.find(e => e.id === editForm.employer_id)
            const rh = rightsHolders.find(r => r.id === editForm.rights_holder_id)
            setContracts(prev => prev.map(c => c.id === editContract.id ? {
                ...c,
                type: editForm.type,
                overenskomst: editForm.overenskomst === "ingen" ? null : editForm.overenskomst,
                status: newStatus,
                contract_date: editForm.contract_date || null,
                start_date: editForm.start_date || null,
                end_date: editForm.end_date || null,
                employer_id: editForm.employer_id || null,
                employer_name: emp?.name ?? c.employer_name,
                rights_holder_id: editForm.rights_holder_id || null,
                rights_holder_name: rh?.full_name ?? c.rights_holder_name,
                work_id: resolvedWorkId || null,
                work_title: selectedWork?.title ?? (resolvedWorkId ? c.work_title : null),
                work_poster_url: selectedWork?.poster_url ?? (resolvedWorkId ? c.work_poster_url : null),
                working_title: editForm.working_title || null,
            } : c))
            setEditContract(null)
            setEditForm(null)
            toast.success(newStatus === "valideret" ? "Kontrakt valideret" : "Kontrakt gemt")
            return true
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Opdatering fejlede")
            return false
        } finally {
            setEditSaving(false)
        }
    }

    const handleValidateAndNext = async () => {
        if (!editContract) return
        const currentId = editContract.id
        const saved = await handleSaveEdit("valideret", { openNextAfterSave: true })
        if (saved) openNextValidationContract(currentId)
    }
    validateAndNextRef.current = handleValidateAndNext

    const handleArchiveEdit = async () => {
        if (!editContract) return
        setArchiveEditOpen(true)
    }

    const confirmArchiveEdit = async () => {
        setArchiveEditOpen(false)
        await handleSaveEdit("arkiveret")
    }

    const handleDeleteEdit = async () => {
        if (!editContract) return
        setDeleteEditOpen(true)
    }

    const confirmDeleteEdit = async () => {
        if (!editContract) return
        setDeleteEditOpen(false)
        const contract = editContract
        const supabase = createClient()
        setEditSaving(true)
        try {
            if (contract.pdf_url) await supabase.storage.from("kontrakter").remove([contract.pdf_url])
            const { error } = await supabase.from("contracts").delete().eq("id", contract.id)
            if (error) throw new Error(error.message)
            setContracts(prev => prev.filter(c => c.id !== contract.id))
            setEditContract(null)
            setEditForm(null)
            toast.success("Kontrakt slettet")
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Kunne ikke slette kontrakt")
        } finally {
            setEditSaving(false)
        }
    }

    const confirmMissingWorkValidation = async () => {
        if (!missingWorkValidation) return
        const pending = missingWorkValidation
        setMissingWorkValidation(null)
        const saved = await handleSaveEdit("valideret", { skipMissingWorkConfirm: true })
        if (saved && pending.openNextAfterSave) openNextValidationContract(pending.contractId)
    }

    useEffect(() => {
        if (!editContract) return
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault()
                void validateAndNextRef.current()
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [editContract])

    const handleAdminReply = async () => {
        if (!editContract || !adminReply.trim()) return
        setReplySaving(true)
        const res = await addAdminContractComment(editContract.id, adminReply)
        setReplySaving(false)
        if (!res.success || !("comment" in res) || !res.comment) {
            toast.error(res.error ?? "Kunne ikke gemme svar")
            return
        }
        const comment = res.comment as ContractComment
        setContracts(prev => prev.map(c => c.id === editContract.id ? {
            ...c,
            contract_comments: [...c.contract_comments, comment],
        } : c))
        setEditContract(prev => prev ? { ...prev, contract_comments: [...prev.contract_comments, comment] } : prev)
        setAdminReply("")
        toast.success("Svar sendt")
        setEditContract(null)
        setEditForm(null)
    }

    // ── Filter ────────────────────────────────────────────────

    const filtered = useMemo(() => {
        let list = [...contracts]
        if (activeRh) list = list.filter(c => c.rights_holder_id === activeRh.id)
        if (filterStatus === "beskeder") list = list.filter(c => c.contract_comments.some(comment => comment.author_role === "member" && !comment.admin_read_at))
        else if (filterStatus === "missingOwner") list = list.filter(isMissingOwner)
        else if (filterStatus === "validationRecommended") list = list.filter(isValidationRecommended)
        else if (filterStatus !== "all") list = list.filter(c => c.status === filterStatus)
        if (filterType !== "all") list = list.filter(c => c.type === filterType)
        if (search) {
            const q = search.toLowerCase()
            list = list.filter(c =>
                c.working_title?.toLowerCase().includes(q) ||
                c.work_title?.toLowerCase().includes(q) ||
                c.rights_holder_name?.toLowerCase().includes(q) ||
                c.employer_name?.toLowerCase().includes(q)
            )
        }
        list.sort((a, b) => {
            const direction = sortDir === "asc" ? 1 : -1
            const period = (c: ContractRow) => c.start_date ?? c.contract_date ?? c.created_at ?? ""
            const values: Record<SortKey, [string, string]> = {
                production: [a.work_title ?? a.working_title ?? "", b.work_title ?? b.working_title ?? ""],
                rightsHolder: [a.rights_holder_name ?? "", b.rights_holder_name ?? ""],
                employer: [a.employer_name ?? "", b.employer_name ?? ""],
                type: [a.type ?? "", b.type ?? ""],
                overenskomst: [OVERENSKOMST_LABELS[a.overenskomst ?? ""] ?? a.overenskomst ?? "", OVERENSKOMST_LABELS[b.overenskomst ?? ""] ?? b.overenskomst ?? ""],
                period: [period(a), period(b)],
                status: [STATUS_LABELS[a.status] ?? a.status, STATUS_LABELS[b.status] ?? b.status],
            }
            const [left, right] = values[sortKey]
            return left.localeCompare(right, "da-DK", { numeric: true, sensitivity: "base" }) * direction
        })
        return list
    }, [contracts, activeRh, filterStatus, filterType, search, sortDir, sortKey])
    const visibleContracts = filtered.slice(0, pageSize)
    const selectedContracts = useMemo(
        () => contracts.filter(contract => selectedIds.includes(contract.id)),
        [contracts, selectedIds]
    )
    const allFilteredSelected = filtered.length > 0 && filtered.every(contract => selectedIds.includes(contract.id))
    const duplicateGroups = useMemo(() => {
        const groups = new Map<string, ContractRow[]>()
        for (const contract of contracts) {
            const titleKey = normalizeDuplicateKey(contract.work_title ?? contract.working_title)
            if (!titleKey) continue
            const key = [
                titleKey,
                normalizeDuplicateKey(contract.rights_holder_name),
                normalizeDuplicateKey(contract.employer_name),
                contract.type ?? "",
            ].join("|")
            const group = groups.get(key) ?? []
            group.push(contract)
            groups.set(key, group)
        }
        return Array.from(groups.values()).filter(group => group.length > 1)
    }, [contracts])

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(dir => dir === "asc" ? "desc" : "asc")
            return
        }
        setSortKey(key)
        setSortDir("asc")
    }

    const sortMark = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""
    const uploadRightsHolderResults = uploadRightsHolderSearch.trim()
        ? rightsHolders.filter(r => r.full_name.toLowerCase().includes(uploadRightsHolderSearch.toLowerCase())).slice(0, 8)
        : rightsHolders.slice(0, 8)
    const editWorkResults = editWorkSearch.trim()
        ? works.filter(w => `${w.title} ${w.year ?? ""}`.toLowerCase().includes(editWorkSearch.toLowerCase())).slice(0, 8)
        : works.slice(0, 8)
    const editRightsHolderResults = editRightsHolderSearch.trim()
        ? rightsHolders.filter(r => r.full_name.toLowerCase().includes(editRightsHolderSearch.toLowerCase())).slice(0, 8)
        : rightsHolders.slice(0, 8)
    const editPreviewContract = editContract && editForm ? {
        ...editContract,
        status: editForm.status,
        employer_id: editForm.employer_id || null,
        rights_holder_id: editForm.rights_holder_id || null,
        work_id: editForm.work_id || null,
    } : editContract
    const toggleSelected = (id: string) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
    }
    const toggleAllFiltered = () => {
        setSelectedIds(allFilteredSelected ? [] : filtered.map(contract => contract.id))
    }

    const SortButton = ({ label, sortId }: { label: string; sortId: SortKey }) => (
        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => handleSort(sortId)}>
            {label}{sortMark(sortId) && <span>{sortMark(sortId)}</span>}
        </button>
    )


    if (loading) return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Henter...</div>

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.contracts.title")}
                subtitle={t("admin.contracts.subtitle")}
                actions={
                    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                        <Button size="sm" className="w-full gap-1.5 sm:w-auto" onClick={() => { setShowUpload(true); setUploadPhase("select"); setUploadItems([]); setUploadRightsHolderId(""); setUploadRightsHolderSearch("") }}>
                            <Upload className="h-4 w-4" />
                            Upload kontrakter
                        </Button>
                        <HelpButton onClick={() => setHelpOpen(true)} />
                    </div>
                }
            />
            <ContextualHelp
                title="Kontraktadministration"
                intro="Her validerer og kobler du kontrakter til rettighedshavere, producenter og værker."
                open={helpOpen}
                onOpenChange={setHelpOpen}
                topics={[
                    {
                        title: "Statusser",
                        body: "Kladde betyder, at kontrakten kræver gennemgang. Valideret betyder, at den kan bruges i systemets videre udbetalings- og statistikflow.",
                    },
                    {
                        title: "Rettighedshaverfilter",
                        body: "Når en aktiv rettighedshaver er valgt, ser du kun den persons kontrakter. Filteret deles med Værksadministration, indtil det ryddes.",
                    },
                    {
                        title: "Batch-handlinger",
                        body: "Marker flere kontrakter, når du vil validere eller rydde beskeder samlet. Permanent sletning bør kun bruges ved dubletter eller fejloprettelser.",
                    },
                ]}
            />

            {/* Filters */}
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                <div className="relative w-full lg:w-auto">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Søg titel, klipper, producent..." className="w-full pl-8 pr-8 lg:w-[280px]" value={search} onChange={e => setSearch(e.target.value)} />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch("")}
                            className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                            aria-label="Tøm søgefelt"
                        >
                            <X className="h-4 w-4 rounded-full border border-current p-0.5" />
                        </button>
                    )}
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-full lg:w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Status</SelectItem>
                        <SelectItem value="kladde">Kladde</SelectItem>
                        <SelectItem value="validationRecommended">Validering anbefalet</SelectItem>
                        <SelectItem value="missingOwner">Mangler ejer</SelectItem>
                        <SelectItem value="valideret">Valideret</SelectItem>
                        <SelectItem value="arkiveret">Arkiveret</SelectItem>
                        <SelectItem value="beskeder">Beskeder</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-full lg:w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle typer</SelectItem>
                        <SelectItem value="a-løn">A-løn</SelectItem>
                        <SelectItem value="leverandør">Leverandør</SelectItem>
                    </SelectContent>
                </Select>
                <ActiveUserFilter rightsHolders={rightsHolders} activeRh={activeRh} onChange={setActiveRh} />
                <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={() => setDuplicatesOpen(true)}>
                    <Search className="h-4 w-4" />
                    Find dubletter
                </Button>
                <label className="flex items-center gap-2 text-sm text-muted-foreground lg:ml-auto">
                    Vis
                    <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                        {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
                    </select>
                </label>
            </div>

            {selectedIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3">
                    <span className="text-sm font-medium">{selectedIds.length} valgt</span>
                    <Button size="sm" variant="outline" className="gap-2" onClick={handleApproveSelected} disabled={saving}>
                        <CheckCircle2 className="h-4 w-4" />
                        Valider valgte
                    </Button>
                    <Button size="sm" variant="outline" className="gap-2" onClick={handleMarkSelectedMessagesRead} disabled={saving}>
                        <MessageSquare className="h-4 w-4" />
                        Besked læst
                    </Button>
                    <Button
                        size="sm"
                        variant="destructive"
                        className="gap-2"
                        onClick={() => {
                            if (selectedIds.length > 20) {
                                if (!isSuperadmin) {
                                    toast.error("Kun superadmin kan slette mere end 20 kontrakter ad gangen.")
                                    return
                                }
                                setBulkDeleteConfirmText("")
                                setBulkDeleteStep(1)
                            } else {
                                setBatchDeleteOpen(true)
                            }
                        }}
                        disabled={saving}
                    >
                        <AlertTriangle className="h-4 w-4" />
                        Slet permanent
                    </Button>
                </div>
            )}

            {/* Table */}
            <MobileCardList>
                {filtered.length === 0 ? (
                    <MobileDataCard>
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            {contracts.length === 0 ? "Ingen kontrakter endnu — upload den første" : t("common.noResults")}
                        </p>
                    </MobileDataCard>
                ) : visibleContracts.map(c => {
                    const unreadMemberComments = c.contract_comments.filter(comment => comment.author_role === "member" && !comment.admin_read_at).length
                    const latestUnread = c.contract_comments.filter(comment => comment.author_role === "member" && !comment.admin_read_at).slice(-1)[0]
                    return (
                        <MobileDataCard key={c.id}>
                            <div className="flex gap-3">
                                <div onClick={event => event.stopPropagation()} className="pt-1">
                                    <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelected(c.id)} className="h-4 w-4" aria-label={`Vælg ${c.work_title ?? c.working_title ?? "kontrakt"}`} />
                                </div>
                                <button type="button" onClick={() => openEdit(c)} className="flex min-w-0 flex-1 gap-3 text-left">
                                    {posterUrl(c.work_poster_url) && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={posterUrl(c.work_poster_url) ?? ""} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-medium leading-snug">{c.work_title ?? c.working_title ?? "—"}</p>
                                            {unreadMemberComments > 0 && (
                                                <Badge variant="outline" className="border-blue-300 bg-blue-100 text-blue-800">
                                                    <MessageSquare className="mr-1 h-3 w-3" />
                                                    {unreadMemberComments}
                                                </Badge>
                                            )}
                                        </div>
                                        {latestUnread && <p className="mt-1 line-clamp-2 text-xs text-blue-700">{latestUnread.message.split("\n")[0]}</p>}
                                    </div>
                                </button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem className="gap-2" onClick={() => openPdf(c)}>
                                            <Eye className="h-3.5 w-3.5" />Se kontrakt
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="gap-2" onClick={() => openEdit(c)}>
                                            <Pencil className="h-3.5 w-3.5" />Rediger
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteId(c.id)}>
                                            <Trash2 className="h-3.5 w-3.5" />Slet
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <MobileMetaRow label="Klipper">{c.rights_holder_name ?? "—"}</MobileMetaRow>
                                <MobileMetaRow label="Producent">{c.employer_name ?? "—"}</MobileMetaRow>
                                <MobileMetaRow label="Type">{c.type === "a-løn" ? "A-løn" : "Leverandør"}</MobileMetaRow>
                                <MobileMetaRow label="Overenskomst">{c.overenskomst ? (OVERENSKOMST_LABELS[c.overenskomst] ?? c.overenskomst) : "—"}</MobileMetaRow>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <ContractStatusBadges contract={c} compact />
                                <span className="text-xs text-muted-foreground">
                                    {c.start_date && c.end_date
                                        ? `${new Date(c.start_date).toLocaleDateString("da-DK")} – ${new Date(c.end_date).toLocaleDateString("da-DK")}`
                                        : c.contract_date ? new Date(c.contract_date).toLocaleDateString("da-DK") : "—"}
                                </span>
                            </div>
                        </MobileDataCard>
                    )
                })}
            </MobileCardList>

            <ResponsiveTableFrame>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-10">
                                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="h-4 w-4" aria-label="Vælg alle kontrakter" />
                            </TableHead>
                            <TableHead><SortButton label="Produktion" sortId="production" /></TableHead>
                            <TableHead><SortButton label="Klipper" sortId="rightsHolder" /></TableHead>
                            <TableHead><SortButton label="Producent" sortId="employer" /></TableHead>
                            <TableHead><SortButton label="Type" sortId="type" /></TableHead>
                            <TableHead><SortButton label="Overenskomst" sortId="overenskomst" /></TableHead>
                            <TableHead><SortButton label="Periode" sortId="period" /></TableHead>
                            <TableHead><SortButton label="Status" sortId="status" /></TableHead>
                            <TableHead className="w-[60px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                                    {contracts.length === 0 ? "Ingen kontrakter endnu — upload den første" : t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            visibleContracts.map(c => {
                                const unreadMemberComments = c.contract_comments.filter(comment => comment.author_role === "member" && !comment.admin_read_at).length
                                const latestUnread = c.contract_comments.filter(comment => comment.author_role === "member" && !comment.admin_read_at).slice(-1)[0]
                                return (
                                <TableRow key={c.id}>
                                    <TableCell>
                                        <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelected(c.id)} className="h-4 w-4" aria-label={`Vælg ${c.work_title ?? c.working_title ?? "kontrakt"}`} />
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            {posterUrl(c.work_poster_url) && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={posterUrl(c.work_poster_url) ?? ""} alt="" className="h-12 w-8 rounded object-cover" />
                                            )}
                                            <button type="button" onClick={() => openEdit(c)} className="text-left underline-offset-4 hover:underline">
                                                {c.work_title ?? c.working_title ?? <span className="text-muted-foreground">—</span>}
                                            </button>
                                            {unreadMemberComments > 0 && (
                                                <Badge variant="outline" className="border-blue-300 bg-blue-100 text-blue-800">
                                                    <MessageSquare className="mr-1 h-3 w-3" />
                                                    {unreadMemberComments}
                                                </Badge>
                                            )}
                                        </div>
                                        {latestUnread && (
                                            <p className="mt-0.5 max-w-[280px] truncate text-xs text-blue-700">{latestUnread.message.split("\n")[0]}</p>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm">{c.rights_holder_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{c.employer_name ?? "—"}</TableCell>
                                    <TableCell className="text-sm">{c.type === "a-løn" ? "A-løn" : "Leverandør"}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {c.overenskomst ? (OVERENSKOMST_LABELS[c.overenskomst] ?? c.overenskomst) : "—"}
                                    </TableCell>
                                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                                        {c.start_date && c.end_date
                                            ? `${new Date(c.start_date).toLocaleDateString("da-DK")} – ${new Date(c.end_date).toLocaleDateString("da-DK")}`
                                            : c.contract_date ? new Date(c.contract_date).toLocaleDateString("da-DK") : "—"}
                                    </TableCell>
                                    <TableCell>
                                        <ContractStatusBadges contract={c} compact />
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem className="gap-2" onClick={() => openPdf(c)}>
                                                    <Eye className="h-3.5 w-3.5" />Se kontrakt
                                                </DropdownMenuItem>
                                                <DropdownMenuItem className="gap-2" onClick={() => openEdit(c)}>
                                                    <Pencil className="h-3.5 w-3.5" />Rediger
                                                </DropdownMenuItem>
                                                <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteId(c.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />Slet
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </ResponsiveTableFrame>

            {/* PDF Viewer */}
            <Dialog open={!!viewContract} onOpenChange={() => { setViewContract(null); setViewPdfUrl(null) }}>
                <DialogContent className="h-[90vh] flex flex-col" style={{ maxWidth: "80vw", width: "80vw" }}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            {viewContract?.work_title ?? viewContract?.working_title ?? "Kontrakt"}
                        </DialogTitle>
                        <DialogDescription>
                            {viewContract?.rights_holder_name} • {viewContract?.employer_name} • {viewContract?.type === "a-løn" ? "A-løn" : "Leverandør"}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden rounded-lg border">
                        {viewPdfUrl ? (
                            <PdfViewer url={viewPdfUrl} />
                        ) : viewContract?.pdf_url ? (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Henter PDF...</div>
                        ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ingen PDF tilknyttet</div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Upload Dialog */}
            <Dialog open={showUpload} onOpenChange={o => { if (!o && !saving) { setShowUpload(false); setUploadItems([]); setUploadPhase("select") } }}>
                <DialogContent
                    className="flex flex-col"
                    style={{ maxWidth: "560px" }}
                    onCloseAutoFocus={e => e.preventDefault()}
                >
                    <DialogHeader className="shrink-0">
                        <DialogTitle className="flex items-center gap-2">
                            <Upload className="h-5 w-5" />
                            Upload kontrakter
                        </DialogTitle>
                        <DialogDescription>
                            {uploadPhase === "select"
                                ? "Vælg op til 15 filer. De gemmes som kladde, og AI-læsning kører i køen."
                                : "Uploader, opretter AI-jobs og læser første kontrakt..."}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Phase: select files */}
                    {uploadPhase === "select" && (
                        <div className="py-2">
                            <Label className="block mb-2">Vælg filer</Label>
                            <div
                                className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 p-10 cursor-pointer hover:border-primary/50 transition-colors text-center"
                                onClick={() => document.getElementById("bulk-file-input")?.click()}
                            >
                                <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                                <p className="text-sm font-medium">Klik for at vælge filer</p>
                                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX eller TXT — maks. 15 filer ad gangen</p>
                                <input id="bulk-file-input" type="file" accept=".pdf,.docx,.txt" multiple className="hidden" onChange={handleFileSelect} />
                            </div>
                            {uploadItems.length > 0 && (
                                <div className="mt-3 space-y-1">
                                    {uploadItems.map((item, i) => (
                                        <div key={i} className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/40">
                                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                            <span className="flex-1 truncate">{item.file.name}</span>
                                            <span className="text-muted-foreground text-xs">{Math.round(item.file.size / 1024)} KB</span>
                                            <button onClick={() => setUploadItems(prev => prev.filter((_, j) => j !== i))}>
                                                <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {uploadItems.length === 1 && (
                                <div className="mt-4 rounded-lg border p-3">
                                    <Label className="text-sm font-medium">Tilknyt bruger</Label>
                                    <p className="mb-2 mt-1 text-xs text-muted-foreground">
                                        Valgfrit. Hvis du ikke vælger en bruger, forsøger AI-jobbet selv at matche kontraktens navn mod brugerne.
                                    </p>
                                    {uploadRightsHolderId ? (
                                        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                                            <span>{rightsHolders.find(r => r.id === uploadRightsHolderId)?.full_name ?? "Valgt bruger"}</span>
                                            <button type="button" onClick={() => setUploadRightsHolderId("")} className="text-muted-foreground hover:text-foreground">
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    value={uploadRightsHolderSearch}
                                                    onChange={e => setUploadRightsHolderSearch(e.target.value)}
                                                    placeholder="Søg bruger..."
                                                    className="h-8 pl-8 text-sm"
                                                />
                                            </div>
                                            <div className="max-h-36 overflow-y-auto space-y-1">
                                                {uploadRightsHolderResults.map(r => (
                                                    <button
                                                        key={r.id}
                                                        type="button"
                                                        onClick={() => { setUploadRightsHolderId(r.id); setUploadRightsHolderSearch("") }}
                                                        className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                                                    >
                                                        {r.full_name}
                                                    </button>
                                                ))}
                                                {uploadRightsHolderResults.length === 0 && (
                                                    <p className="px-2 py-1 text-sm text-muted-foreground">Ingen brugere fundet</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Phase: processing */}
                    {uploadPhase === "processing" && (() => {
                        return (
                            <div className="py-2 space-y-2">
                                {uploadItems.map((item, i) => (
                                    <div key={i} className="flex items-center gap-2.5 rounded-md border p-3">
                                        {item.status === "pending"    && <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                                        {item.status === "uploading"  && <Loader2  className="h-4 w-4 animate-spin text-primary shrink-0" />}
                                        {item.status === "queued"     && <Clock    className="h-4 w-4 text-amber-500 shrink-0" />}
                                        {item.status === "extracting" && <Loader2  className="h-4 w-4 animate-spin text-primary shrink-0" />}
                                        {item.status === "done"       && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                                        {item.status === "error"      && <AlertCircle  className="h-4 w-4 text-destructive shrink-0" />}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{item.file.name}</p>
                                            {item.status === "uploading"  && <p className="text-xs text-muted-foreground">Uploader...</p>}
                                            {item.status === "queued"     && <p className="text-xs text-amber-600">I AI-kø</p>}
                                            {item.status === "extracting" && <p className="text-xs text-muted-foreground">AI-læser...</p>}
                                            {item.status === "done"       && <p className="text-xs text-emerald-600">AI-læst som kladde</p>}
                                            {item.status === "error"      && <p className="text-xs text-destructive">{item.error}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    })()}

                    <DialogFooter className="pt-2 border-t shrink-0">
                        <Button variant="outline" onClick={() => { setShowUpload(false); setUploadItems([]); setUploadPhase("select") }} disabled={saving}>
                            {uploadPhase === "processing" && uploadItems.some(i => i.status === "done") ? "Luk" : "Annuller"}
                        </Button>
                        {uploadPhase === "select" && (
                            <Button onClick={handleExtractAndSave} disabled={uploadItems.length === 0 || uploadItems.length > 15}>
                                {uploadItems.length > 0 ? `Upload og læs (${uploadItems.length})` : "Upload og læs"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit */}
            <Dialog open={!!editContract} onOpenChange={o => { if (!o && !editSaving) { setEditContract(null); setEditForm(null) } }}>
                <DialogContent className="w-[min(1180px,calc(100vw-2rem))] !max-w-none sm:!max-w-none">
                    <DialogHeader>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <DialogTitle className="flex items-center gap-2">
                                    <Pencil className="h-4 w-4" />Rediger kontrakt
                                </DialogTitle>
                                <DialogDescription>{editContract?.work_title ?? editContract?.working_title ?? editContract?.employer_name ?? "Kontrakt"}</DialogDescription>
                            </div>
                            {editPreviewContract && <ContractStatusBadges contract={editPreviewContract} />}
                        </div>
                    </DialogHeader>
                    <div className="flex flex-wrap gap-2 border-b pb-3">
                        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleRunAiDatamining} disabled={editSaving}>
                            {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            AI datamining
                        </Button>
                        <Button type="button" size="sm" className="gap-2" onClick={handleValidateAndNext} disabled={editSaving}>
                            {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Valider (⌘↵)
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleArchiveEdit} disabled={editSaving}>
                            <Archive className="h-4 w-4" />
                            Arkiver
                        </Button>
                        <Button type="button" variant="destructive" size="sm" className="gap-2" onClick={handleDeleteEdit} disabled={editSaving}>
                            <Trash2 className="h-4 w-4" />
                            Slet
                        </Button>
                        {!editForm?.work_id && (
                            <p className="basis-full text-xs text-amber-600">Hvis du validerer uden et værk tilknyttet, bliver du spurgt om der skal oprettes et nyt værk med arbejdstitlen.</p>
                        )}
                    </div>
                    {editForm && (
                        <div className="grid gap-4 md:grid-cols-[1.05fr_1fr]">
                            <div className="hidden h-[72vh] overflow-hidden rounded-md border md:block">
                                {editContract?.pdf_url
                                    ? (() => {
                                        const sources = editContract?.validation_data?._sources as Record<string, string | null> | undefined
                                        const highlights = sources ? Object.values(sources).filter((v): v is string => typeof v === "string" && v.length > 0) : []
                                        return (
                                            <ContractDocViewer
                                                url={editDocUrl}
                                                filename={editContract.pdf_url}
                                                highlights={highlights}
                                                activeHighlight={activeHighlight}
                                            />
                                        )
                                      })()
                                    : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ingen fil på kontrakten</div>}
                            </div>
                            <div className="max-h-[72vh] space-y-4 overflow-y-auto py-2 pr-1">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs">Klipper / rettighedshaver</Label>
                                        {navneTjekLoading && <span className="text-[10px] text-muted-foreground animate-pulse">Tjekker register...</span>}
                                    </div>
                                    <div className="space-y-2">
                                        {!editForm.rights_holder_id && navneTjekResult && (
                                            <div className={`p-2 rounded-md text-xs border ${
                                                navneTjekResult.status === "match" 
                                                    ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                                                    : navneTjekResult.status === "delvist-match" 
                                                    ? "bg-amber-50 border-amber-200 text-amber-800" 
                                                    : "bg-rose-50 border-rose-200 text-rose-800"
                                            }`}>
                                                <div className="font-semibold mb-0.5">
                                                    {navneTjekResult.status === "match" && "✓ Perfekt match fundet"}
                                                    {navneTjekResult.status === "delvist-match" && "⚠ Delvist navnematch fundet"}
                                                    {navneTjekResult.status === "ikke-fundet" && "✗ Navn ikke fundet i medlemsregister"}
                                                </div>
                                                <p className="text-[11px] leading-relaxed">
                                                    {navneTjekResult.status === "match" && `Kontraktens "${navneTjekResult.navnIKontrakt}" matcher medlemsregisteret.`}
                                                    {navneTjekResult.status === "delvist-match" && `Registeret har "${navneTjekResult.navnIRegister}" men kontrakten har "${navneTjekResult.navnIKontrakt}".`}
                                                    {navneTjekResult.status === "ikke-fundet" && `"${navneTjekResult.navnIKontrakt}" kunne ikke findes i registeret.`}
                                                </p>
                                                {navneTjekResult.idIRegister && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="mt-1.5 h-6 text-[10px] bg-white border-gray-200 hover:bg-gray-50"
                                                        onClick={() => {
                                                            const idIRegister = navneTjekResult.idIRegister
                                                            if (!idIRegister) return
                                                            setEditForm(f => f && ({ ...f, rights_holder_id: idIRegister }))
                                                            setEditRightsHolderSearch(navneTjekResult.navnIRegister ?? "")
                                                        }}
                                                    >
                                                        Kobl til {navneTjekResult.navnIRegister}
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                className="h-8 pl-8 text-xs"
                                                placeholder="Søg efter rettighedshaver..."
                                                value={editRightsHolderSearch}
                                                onChange={e => {
                                                    const value = e.target.value
                                                    setEditRightsHolderSearch(value)
                                                    setEditForm(f => f && ({ ...f, rights_holder_id: "" }))
                                                }}
                                            />
                                        </div>
                                        {editForm.rights_holder_id ? (
                                            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs">
                                                <span className="font-medium">{rightsHolders.find(r => r.id === editForm.rights_holder_id)?.full_name ?? editRightsHolderSearch}</span>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 px-2 text-xs"
                                                    onClick={() => {
                                                        setEditForm(f => f && ({ ...f, rights_holder_id: "" }))
                                                        setEditRightsHolderSearch("")
                                                    }}
                                                >
                                                    Fjern
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="max-h-36 space-y-1 overflow-y-auto">
                                                {editRightsHolderResults.map(holder => (
                                                    <button
                                                        key={holder.id}
                                                        type="button"
                                                        className="flex w-full items-center rounded-md border px-3 py-2 text-left text-xs hover:bg-muted"
                                                        onClick={() => {
                                                            setEditForm(f => f && ({ ...f, rights_holder_id: holder.id }))
                                                            setEditRightsHolderSearch(holder.full_name)
                                                        }}
                                                    >
                                                        {holder.full_name}
                                                    </button>
                                                ))}
                                                {editRightsHolderSearch.trim() && editRightsHolderResults.length === 0 && (
                                                    <p className="px-1 py-2 text-xs text-muted-foreground">Ingen rettighedshavere fundet.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs">Producent (juridisk)</Label>
                                        {(() => {
                                            const validation = editContract?.validation_data
                                            const extractedEmployer = (validation?.employerName || validation?.producerName || null) as string | null
                                            if (!extractedEmployer) return null
                                            return (
                                                <Button
                                                    type="button"
                                                    variant="link"
                                                    size="xs"
                                                    className="h-auto p-0 text-[10px] text-primary hover:underline"
                                                    disabled={creatingEmployer}
                                                    onClick={async () => {
                                                        const cvr = window.prompt(`Opret nyt selskab "${extractedEmployer}" i databasen.\n\nIndtast CVR-nummer (valgfrit):`, "")
                                                        if (cvr === null) return
                                                        setCreatingEmployer(true)
                                                        const res = await createAdminEmployer({ name: extractedEmployer, cvr })
                                                        setCreatingEmployer(false)
                                                        if (res.success && res.employer) {
                                                            toast.success(`Selskabet "${extractedEmployer}" er oprettet!`)
                                                            setEmployers(prev => [...prev, res.employer].sort((a,b) => a.name.localeCompare(b.name)))
                                                            setEditForm(f => f && ({ ...f, employer_id: res.employer.id }))
                                                        } else {
                                                            toast.error(res.error ?? "Kunne ikke oprette selskab")
                                                        }
                                                    }}
                                                >
                                                    Opret &quot;{extractedEmployer}&quot;
                                                </Button>
                                            )
                                        })()}
                                    </div>
                                    <Select value={editForm.employer_id || "__none__"} onValueChange={v => setEditForm(f => f && ({ ...f, employer_id: v === "__none__" ? "" : v }))}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vælg..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">—</SelectItem>
                                            {employers.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    {(() => {
                                        const validation = editContract?.validation_data
                                        const extractedEmployer = (validation?.employerName || validation?.producerName || null) as string | null
                                        if (!extractedEmployer || editForm.employer_id) return null
                                        const match = findBestEmployerMatch(extractedEmployer, employers)
                                        if (match && match.employer) {
                                            return (
                                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                                    Forslag:{" "}
                                                    <button
                                                        type="button"
                                                        className="font-medium text-amber-600 hover:underline"
                                                        onClick={() => setEditForm(f => f && ({ ...f, employer_id: match.employer!.id }))}
                                                    >
                                                        {match.employer.name} ({Math.round(match.score * 100)}% match)
                                                    </button>
                                                </p>
                                            )
                                        }
                                        return null
                                    })()}
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Type</Label>
                                    <Select value={editForm.type} onValueChange={v => setEditForm(f => f && ({ ...f, type: v }))}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="a-løn">A-løn</SelectItem>
                                            <SelectItem value="leverandør">Leverandør</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Overenskomst</Label>
                                    <Select value={editForm.overenskomst} onValueChange={v => setEditForm(f => f && ({ ...f, overenskomst: v }))}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="de4-fiktion">De4 (fiktion)</SelectItem>
                                            <SelectItem value="faf">FAF (fiktion)</SelectItem>
                                            <SelectItem value="faf-dokumentar">FAF (dokumentar)</SelectItem>
                                            <SelectItem value="dj">DJ</SelectItem>
                                            <SelectItem value="metal">Metal</SelectItem>
                                            <SelectItem value="ingen">Ingen</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Status</Label>
                                    <Select value={editForm.status} onValueChange={v => setEditForm(f => f && ({ ...f, status: v }))}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="kladde">Kladde</SelectItem>
                                            <SelectItem value="valideret">Valideret</SelectItem>
                                            <SelectItem value="arkiveret">Arkiveret</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Kontraktdato</Label>
                                    <Input type="date" className="h-8 text-xs" value={editForm.contract_date} onChange={e => setEditForm(f => f && ({ ...f, contract_date: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Startdato</Label>
                                    <Input type="date" className="h-8 text-xs" value={editForm.start_date} onChange={e => setEditForm(f => f && ({ ...f, start_date: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Slutdato</Label>
                                    <Input type="date" className="h-8 text-xs" value={editForm.end_date} onChange={e => setEditForm(f => f && ({ ...f, end_date: e.target.value }))} />
                                </div>
                                <div className="col-span-2 space-y-1">
                                    <Label className="text-xs">Arbejdstitel</Label>
                                    <Input className="h-8 text-xs" value={editForm.working_title} placeholder="Produktionens arbejdstitel..." onChange={e => setEditForm(f => f && ({ ...f, working_title: e.target.value }))} />
                                </div>
                                <div className="col-span-2 space-y-2 rounded-md border p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <Label className="text-xs">Forbind med værk</Label>
                                        {editForm.work_id && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs"
                                                onClick={() => {
                                                    setEditForm(f => f && ({ ...f, work_id: "" }))
                                                    setEditWorkSearch(editForm.working_title)
                                                }}
                                            >
                                                Fjern kobling
                                            </Button>
                                        )}
                                    </div>
                                    {editForm.work_id ? (
                                        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                                            <span className="font-medium">{works.find(w => w.id === editForm.work_id)?.title ?? editContract?.work_title ?? "Valgt værk"}</span>
                                            <span className="text-xs text-muted-foreground">{works.find(w => w.id === editForm.work_id)?.year ?? ""}</span>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    className="h-8 pl-8 text-xs"
                                                    placeholder="Søg efter værk..."
                                                    value={editWorkSearch}
                                                    onChange={e => setEditWorkSearch(e.target.value)}
                                                />
                                            </div>
                                            <div className="max-h-40 space-y-1 overflow-y-auto">
                                                {editWorkResults.map(work => (
                                                    <button
                                                        key={work.id}
                                                        type="button"
                                                        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                                                        onClick={() => {
                                                            setEditForm(f => f && ({ ...f, work_id: work.id }))
                                                            setEditWorkSearch(work.title)
                                                        }}
                                                    >
                                                        <span className="font-medium">{work.title}</span>
                                                        <span className="text-xs text-muted-foreground">{work.year ?? ""}</span>
                                                    </button>
                                                ))}
                                                {editWorkResults.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Ingen værker fundet.</p>}
                                            </div>
                                            {editWorkSearch.trim() && editWorkResults.length === 0 && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full"
                                                    onClick={() => {
                                                        const q = editWorkSearch.trim() || editForm.working_title.trim()
                                                        setEditContract(null)
                                                        setEditForm(null)
                                                        router.push(`/admin/vaerker?add=1&q=${encodeURIComponent(q)}`)
                                                    }}
                                                >
                                                    Tilføj nyt værk
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="rounded-md border p-3">
                                <p className="mb-2 text-sm font-medium">AI-udtrukket data</p>
                                {editContract && (
                                    <ContractAiDataEditor
                                        key={editContract.id}
                                        contractId={editContract.id}
                                        activeHighlight={activeHighlight}
                                        onHighlightClick={(quote) => setActiveHighlight(quote)}
                                    />
                                )}
                            </div>
                            <div className="rounded-md border p-3">
                                <p className="mb-2 text-sm font-medium">Kommentarer</p>
                                <div className="max-h-40 space-y-2 overflow-y-auto">
                                    {editContract?.contract_comments.length ? editContract.contract_comments.map(comment => (
                                        <div key={comment.id} className="rounded bg-muted px-3 py-2 text-sm">
                                            <div className="text-xs text-muted-foreground">{comment.author_role === "admin" ? "Admin · " : ""}{new Date(comment.created_at).toLocaleString("da-DK")}</div>
                                            <div>{comment.message}</div>
                                        </div>
                                    )) : (
                                        <p className="text-sm text-muted-foreground">Ingen kommentarer.</p>
                                    )}
                                </div>
                                <div className="mt-3 space-y-2">
                                    <Textarea value={adminReply} onChange={e => setAdminReply(e.target.value)} placeholder="Svar brugeren..." />
                                    <Button type="button" variant="outline" onClick={handleAdminReply} disabled={replySaving || !adminReply.trim()} className="w-full">
                                        {replySaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Send kommentar
                                    </Button>
                                    <Button type="button" variant="outline" onClick={() => handleSaveEdit()} disabled={editSaving} className="w-full">
                                        {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Gem kontrakt
                                    </Button>
                                </div>
                            </div>
                        </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setEditContract(null); setEditForm(null) }} disabled={editSaving}>
                            Annuller
                        </Button>
                        <Button variant="outline" onClick={() => handleSaveEdit("kladde")} disabled={editSaving}>
                            {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gem som kladde"}
                        </Button>
                        <Button onClick={handleValidateAndNext} disabled={editSaving}>
                            {editSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Gemmer...</> : "Valider (⌘↵)"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen}>
                <DialogContent className="sm:max-w-3xl md:max-w-3xl lg:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Find dubletter</DialogTitle>
                        <DialogDescription>Mulige dubletter baseret på produktion, klipper, producent og kontrakttype.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-3 overflow-auto">
                        {duplicateGroups.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Ingen sandsynlige dubletter fundet.</p>
                        ) : duplicateGroups.map((group, index) => (
                            <div key={index} className="rounded-lg border p-3">
                                <div className="mb-2 text-sm font-medium">Mulig dubletgruppe {index + 1}</div>
                                <div className="space-y-2">
                                    {group.map(contract => (
                                        <label key={contract.id} className="flex items-center gap-3 rounded border px-3 py-2 text-sm">
                                            <input type="checkbox" checked={selectedIds.includes(contract.id)} onChange={() => toggleSelected(contract.id)} className="h-4 w-4" />
                                            <span className="font-medium">{contract.work_title ?? contract.working_title ?? "Kontrakt"}</span>
                                            <span className="text-muted-foreground">
                                                {contract.rights_holder_name ?? "-"} · {contract.employer_name ?? "-"} · {contract.type === "a-løn" ? "A-løn" : "Leverandør"}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDuplicatesOpen(false)}>Luk</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(missingWorkValidation)} onOpenChange={open => !open && setMissingWorkValidation(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Opret værk og valider?</DialogTitle>
                        <DialogDescription>
                            Kontrakten mangler værktilknytning. Hvis du fortsætter, oprettes et nyt værk med arbejdstitlen:
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
                        {missingWorkValidation?.title}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMissingWorkValidation(null)} disabled={editSaving}>
                            Annuller
                        </Button>
                        <Button onClick={confirmMissingWorkValidation} disabled={editSaving}>
                            {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Opret værk og valider
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={archiveEditOpen} onOpenChange={setArchiveEditOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Arkiver kontrakt?</DialogTitle>
                        <DialogDescription>
                            Kontrakten skjules fra den aktive arbejdsliste, men kan stadig findes som arkiveret.
                        </DialogDescription>
                    </DialogHeader>
                    {editContract && (
                        <div className="whitespace-pre-line rounded-md border bg-muted/40 px-3 py-2 text-sm">
                            {adminContractSummary(editContract)}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setArchiveEditOpen(false)} disabled={editSaving}>
                            Annuller
                        </Button>
                        <Button variant="outline" onClick={confirmArchiveEdit} disabled={editSaving}>
                            {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Arkiver
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={deleteEditOpen} onOpenChange={setDeleteEditOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Slet kontrakt permanent?</DialogTitle>
                        <DialogDescription>
                            Kontrakten og PDF-filen slettes permanent. Dette kan ikke fortrydes.
                        </DialogDescription>
                    </DialogHeader>
                    {editContract && (
                        <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                            {adminContractSummary(editContract)}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteEditOpen(false)} disabled={editSaving}>
                            Annuller
                        </Button>
                        <Button variant="destructive" onClick={confirmDeleteEdit} disabled={editSaving}>
                            {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Slet permanent
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Slet valgte kontrakter permanent</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
                            <div className="mb-1 flex items-center gap-2 font-medium">
                                <AlertTriangle className="h-4 w-4" />
                                Permanent sletning
                            </div>
                            <p>
                                Du er ved at slette {selectedContracts.length} kontrakt(er) permanent. Dette kan ikke fortrydes.
                            </p>
                            <ul className="mt-2 max-h-32 overflow-y-auto list-disc pl-5 text-xs text-red-800">
                                {selectedContracts.map(contract => (
                                    <li key={contract.id}>{contract.work_title ?? contract.working_title ?? "Kontrakt"}</li>
                                ))}
                            </ul>
                        </div>
                        <p className="text-muted-foreground">
                            PDF-filer for de valgte kontrakter slettes også fra storage, hvis de findes.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBatchDeleteOpen(false)}>Annuller</Button>
                        <Button variant="destructive" onClick={handleDeleteSelectedPermanently} disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Slet permanent
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Masse-sletning >20: kun superadmin, 3 sekventielle advarsler, sidste med indtastning */}
            <Dialog open={bulkDeleteStep > 0} onOpenChange={open => { if (!open) { setBulkDeleteStep(0); setBulkDeleteConfirmText("") } }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-700">
                            <AlertTriangle className="h-5 w-5" />
                            Advarsel {bulkDeleteStep}/3 — masse-sletning
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                        {bulkDeleteStep === 1 && (
                            <p>
                                Du er ved at slette <strong>{selectedIds.length}</strong> kontrakter permanent (mere end 20 ad gangen).
                                Dette kan <strong>ikke</strong> fortrydes, og PDF-filerne slettes også. Er du sikker?
                            </p>
                        )}
                        {bulkDeleteStep === 2 && (
                            <p>
                                Bekræft igen: alle <strong>{selectedIds.length}</strong> kontrakter og deres bilag/allonger,
                                valideringer og kommentarer slettes for altid. Der er ingen fortrydelse.
                            </p>
                        )}
                        {bulkDeleteStep === 3 && (
                            <div className="space-y-2">
                                <p>
                                    Sidste bekræftelse. Skriv <strong>SLET</strong> nedenfor for at slette
                                    de {selectedIds.length} kontrakter permanent.
                                </p>
                                <Input
                                    value={bulkDeleteConfirmText}
                                    onChange={e => setBulkDeleteConfirmText(e.target.value)}
                                    placeholder="Skriv SLET"
                                    autoFocus
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setBulkDeleteStep(0); setBulkDeleteConfirmText("") }} disabled={saving}>
                            Annuller
                        </Button>
                        {bulkDeleteStep < 3 ? (
                            <Button variant="destructive" onClick={() => setBulkDeleteStep(bulkDeleteStep + 1)}>
                                Fortsæt
                            </Button>
                        ) : (
                            <Button
                                variant="destructive"
                                onClick={handleDeleteSelectedPermanently}
                                disabled={saving || bulkDeleteConfirmText.trim().toUpperCase() !== "SLET"}
                            >
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Slet {selectedIds.length} permanent
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete */}
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Slet kontrakt</DialogTitle>
                        <DialogDescription>Kontrakten og PDF-filen slettes permanent.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>Annuller</Button>
                        <Button variant="destructive" onClick={handleDelete}>Slet</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default function AdminKontrakterPage() {
    return <Suspense><AdminKontrakterContent /></Suspense>
}
