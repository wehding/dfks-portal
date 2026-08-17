"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { errorMessage } from "@/lib/error-message";
import { useCallback, useEffect, useState, useMemo, Suspense, useRef } from "react"
import dynamic from "next/dynamic"
import {
    Search, Trash2, Eye, Upload, FileText, Download,
    CheckCircle2, AlertCircle, Loader2, X, Pencil, MessageSquare,
    AlertTriangle, Clock, Archive,
} from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { addAdminContractComment, deleteAdminContractsPermanently, markContractCommentsRead, checkRightsHolderName, updateAdminContract, validateAdminContracts } from "@/app/actions/member-contracts"
import { createAdminWork, createAndLinkWorkForContract } from "@/app/actions/work-management"
import { searchWorksUnified, resolveUnifiedSearchResultDetails, type UnifiedSearchWorkResult } from "@/app/actions/member-works"
import { useSearchParams } from "next/navigation"
import { useI18n } from "@/lib/i18n"
import { PageHeader } from "@/components/page-header"
import { ValideringskøTab } from "@/components/admin/valideringskoe-tab"
import { AdminListTools } from "@/components/admin/admin-list-tools"
import { ADMIN_CONTRACT_UPLOAD_ACCEPT } from "@/lib/contract-upload-format"
import { CONTRACT_IMPORT_CONCURRENCY, validateContractImportFile } from "@/lib/contract-import"
import { findOwnersForContracts, getContractImportStates } from "@/app/actions/contract-imports"
import { ActiveUserFilter } from "@/components/admin/active-user-filter"
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame, SummaryCard, SummaryGrid } from "@/components/responsive-data-view"
import { MessageThread, type MessageThreadMessage } from "@/components/messages/message-thread"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useActiveRightsHolder } from "@/lib/use-active-rights-holder"
import { ResetFiltersButton } from "@/components/filters/reset-filters-button"
import { clearAdminMessageThread, deleteAdminMessage } from "@/app/actions/admin-messages"
import { WORK_TYPES } from "@/lib/work-types"
import { buildCompleteEpisodeOptions, contractEpisodeTag } from "@/lib/series-episodes"
import { TableSkeleton } from "@/components/ui/data-skeletons"
import { ListResultSummary } from "@/components/list-result-summary"
import { GoogleDriveContractPicker } from "@/components/admin/google-drive-contract-picker"
import { ProductionCompanyPicker } from "@/components/production-company-picker"
import { ManualWorkFormFields } from "@/components/works/manual-work-form"
import type { ProductionCompanySelection } from "@/lib/production-companies"
import { extractedProductionCompanyNames } from "@/lib/production-companies"
import { contractReadiness, contractReadinessDetails, effectiveCopydanStatus, isPendingContractValidation, normalizeTriState } from "@/lib/contract-list-status"
import { contractDataToManualWorkSeed, emptyManualWorkForm, validateManualWork, type ManualWorkFormValue } from "@/lib/manual-work"

const ContractAiDataEditor = dynamic(() => import("./ContractAiDataEditor").then(mod => mod.ContractAiDataEditor), { ssr: false })
const ContractDocViewer = dynamic(() => import("./ContractDocViewer").then(mod => mod.ContractDocViewer), { ssr: false })
const PdfViewer = dynamic(() => import("@/components/pdf-viewer").then(mod => mod.PdfViewer), { ssr: false })
const WORK_TYPE_FILTERS = WORK_TYPES

type ContractRow = {
    id: string
    type: string
    overenskomst: string | null
    status: string
    pdf_url: string | null
    processed_pdf_url: string | null
    document_processing_status: string
    document_processing_error_code: string | null
    superseded_by_contract_id: string | null
    previous_version_count: number
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
    season_number: number | null
    episode_numbers: number[] | null
    contract_comments: ContractComment[]
    contract_attachments?: Array<{ id: string; title: string | null; ai_status: string | null; ai_result: Record<string, unknown> | null }>
    validation_data?: Record<string, unknown> | null
    validation_has_credit_clause?: boolean | null
    validation_has_overenskomst_incorporation?: boolean | null
    ai_job_status?: string | null
    ai_job_error?: string | null
    import_status?: string | null
}

type ContractVersion = {
    id: string
    working_title: string | null
    status: string
    contract_date: string | null
    created_at: string
    pdf_url: string | null
    processed_pdf_url: string | null
    superseded_at: string | null
    superseded_by_contract_id: string | null
}

function documentProcessingErrorMessage(contract: ContractRow) {
    const messages: Record<string, string> = {
        ocr_no_readable_text: "OCR fandt ikke nok læsbar tekst. Kontrollér scanningens kvalitet og at filen indeholder kontrakttekst.",
        invalid_pdf: "Filen er ikke en gyldig PDF.",
        file_too_large: "PDF-filen er større end den tilladte grænse på 25 MB.",
        processed_file_too_large: "Den OCR-behandlede PDF blev for stor og kræver manuel behandling.",
        invalid_download_origin: "Den midlertidige filadresse kom ikke fra den forventede lagerkonto.",
        signed_url_failed: "Systemet kunne ikke oprette sikker, midlertidig adgang til PDF-filen.",
        document_processing_failed: "PDF'en kunne ikke rettes eller OCR-behandles efter de automatiske forsøg.",
    }
    if (contract.document_processing_error_code) {
        return messages[contract.document_processing_error_code] ?? "PDF-behandlingen fejlede og kræver manuel kontrol."
    }
    if (contract.document_processing_status === "failed") return "PDF-behandlingen fejlede og prøves automatisk igen, hvis der er forsøg tilbage."
    return null
}

type ContractComment = {
    id: string
    author_role: "member" | "admin"
    message: string
    created_at: string
    member_read_at?: string | null
    admin_read_at?: string | null
}

function contractMessages(comments: ContractComment[]): MessageThreadMessage[] {
    return comments.map(comment => ({
        id: comment.id,
        authorRole: comment.author_role,
        message: comment.message,
        createdAt: comment.created_at,
        memberReadAt: comment.member_read_at,
        adminReadAt: comment.admin_read_at,
    }))
}

function adminContractNextAction(contract: ContractRow | null) {
    const latest = contract?.contract_comments?.at(-1)
    if (!latest) return null
    if (latest.author_role === "member" && !latest.admin_read_at) return "Kræver svar fra DFKS"
    if (latest.author_role === "admin") return "Afventer bruger"
    return "Samtalen er ajour"
}

function adminContractNextActionTone(contract: ContractRow | null): "neutral" | "attention" | "done" {
    const latest = contract?.contract_comments?.at(-1)
    if (!latest) return "neutral"
    if (latest.author_role === "member" && !latest.admin_read_at) return "attention"
    if (latest.author_role === "admin") return "neutral"
    return "done"
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

function chunkIds(ids: string[], size = 75) {
    const chunks: string[][] = []
    for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size))
    return chunks
}
type SortDir = "asc" | "desc"
type NavneTjekResult = {
    status: "match" | "delvist-match" | "ikke-fundet"
    navnIKontrakt?: string
    navnIRegister?: string
    idIRegister?: string
}

type UploadItem = {
    file: File
    clientToken: string
    status: "pending" | "uploading" | "queued" | "duplicate" | "extracting" | "done" | "error"
    error?: string
    contractId?: string | null
    importItemId?: string | null
    employerId?: string
    rightsHolderId?: string
}

type ImportBatchSummary = {
    id: string
    source: string
    status: string
    discovered_count: number
    uploaded_count: number
    duplicate_count: number
    completed_count: number
    failed_count: number
    created_at: string
    updated_at: string
}

const STATUS_LABELS: Record<string, string> = {
    kladde: "Afventer validering",
    valideret: "Valideret",
    arkiveret: "Arkiveret",
}

const STATUS_CLASS: Record<string, string> = {
    kladde: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    valideret: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    arkiveret: "bg-muted text-muted-foreground",
}

const AI_JOB_LABELS: Record<string, string> = {
    queued: "I kø",
    processing: "Analyserer",
    done: "Indlæst",
    error: "Fejl",
    retry_wait: "Prøver igen",
    blocked: "Afventer opsætning",
    dead: "Kræver handling",
}

const AI_JOB_CLASS: Record<string, string> = {
    queued: "border-amber-300 bg-amber-50 text-amber-700",
    processing: "border-blue-300 bg-blue-50 text-blue-700",
    done: "border-emerald-300 bg-emerald-50 text-emerald-700",
    error: "border-red-300 bg-red-50 text-red-700",
    retry_wait: "border-amber-300 bg-amber-50 text-amber-700",
    blocked: "border-red-300 bg-red-50 text-red-700",
    dead: "border-red-300 bg-red-50 text-red-700",
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

function isMissingOwner(contract: ContractRow) {
    return !contract.rights_holder_id
}

function isValidationRecommended(contract: ContractRow) {
    return ["recommended", "recommended_with_warnings"].includes(contractReadiness(contract))
}

function hasContractWorkLink(contract: ContractRow) {
    return Boolean(contract.work_id) || contract.status === "valideret"
}

function ContractStatusBadges({ contract, compact = false }: { contract: ContractRow; compact?: boolean }) {
    const badgeClass = compact ? "text-[10px]" : "text-xs"
    const readiness = contractReadinessDetails(contract)
    const hasMaterialWarning = readiness.warnings.some(warning => warning !== "signature_missing")
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
            {["recommended", "recommended_with_warnings"].includes(readiness.status) && (
                <Badge variant="outline" className={`w-fit border-blue-300 bg-blue-50 font-normal text-blue-700 ${badgeClass}`}>
                    {hasMaterialWarning ? "Validering anbefalet · kontrollér advarsler" : "Validering anbefalet"}
                </Badge>
            )}
            {contract.status !== "valideret" && (
                <Badge variant="outline" className={`w-fit font-normal ${badgeClass} ${hasContractWorkLink(contract) ? WORK_LINK_CLASS.linked : WORK_LINK_CLASS.missing}`}>
                    {hasContractWorkLink(contract) ? "Værk tilknyttet" : "Mangler værk"}
                </Badge>
            )}
            {isMissingOwner(contract) && (
                <Badge variant="outline" className={`w-fit border-red-300 bg-red-50 font-normal text-red-700 ${badgeClass}`}>
                    Mangler ejer
                </Badge>
            )}
            {contract.import_status === "awaiting_episode_confirmation" && (
                <Badge variant="outline" className={`w-fit border-amber-300 bg-amber-50 font-normal text-amber-800 ${badgeClass}`}>
                    Afventer bekræftelse af afsnit
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

function YearCountCard({ contracts, availableYears, currentYear }: {
    contracts: ContractRow[]
    availableYears: number[]
    currentYear: number
}) {
    const [selectedYear, setSelectedYear] = useState(currentYear)
    const count = contracts.filter(c => {
        const year = c.contract_date ? new Date(c.contract_date).getFullYear() : new Date(c.created_at).getFullYear()
        return year === selectedYear
    }).length
    return (
        <div className="min-w-0 rounded-lg border bg-card px-3 py-3 text-card-foreground sm:flex sm:min-w-52 sm:items-center sm:gap-3 sm:px-4 sm:py-2.5">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium leading-4 text-muted-foreground sm:text-sm">Kontrakter i</p>
                <select
                    value={selectedYear}
                    onChange={e => setSelectedYear(Number(e.target.value))}
                    className="rounded border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground sm:text-sm focus:outline-none"
                >
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground sm:ml-auto sm:mt-0">{count}</p>
        </div>
    )
}

function AdminKontrakterContent({ view = "archive" }: { view?: "archive" | "upload" }) {
    const { locale, t } = useI18n()
    const [contracts, setContracts] = useState<ContractRow[]>([])
    const [employers, setEmployers] = useState<Employer[]>([])
    const [rightsHolders, setRightsHolders] = useState<RightsHolder[]>([])
    const [works, setWorks] = useState<WorkOption[]>([])
    const [orgId, setOrgId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
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
    const [versionDialogOpen, setVersionDialogOpen] = useState(false)
    const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
    const [versionHistory, setVersionHistory] = useState<ContractVersion[]>([])
    const [versionHistoryLoading, setVersionHistoryLoading] = useState(false)
    const [currentVersionId, setCurrentVersionId] = useState("")
    const [versionSaving, setVersionSaving] = useState(false)
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
    const [editProducerSelections, setEditProducerSelections] = useState<ProductionCompanySelection[]>([])
    const [editWorkSearch, setEditWorkSearch] = useState("")
    const [editWorkTypeFilter, setEditWorkTypeFilter] = useState("all")
    const [editSaving, setEditSaving] = useState(false)

    const [unifiedResults, setUnifiedResults] = useState<UnifiedSearchWorkResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [pickedUnifiedResult, setPickedUnifiedResult] = useState<UnifiedSearchWorkResult | null>(null)
    const [detailsLoading] = useState(false)
    const [manualWorkMode, setManualWorkMode] = useState(false)
    const [manualWork, setManualWork] = useState<ManualWorkFormValue>(() => emptyManualWorkForm())

    // Series fields
    const [addSeason, setAddSeason] = useState("")
    const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([])
    const [episodeOptions, setEpisodeOptions] = useState<any[]>([])
    const [detectedEpisodeCount, setDetectedEpisodeCount] = useState<number | null>(null)
    const [episodesLoading, setEpisodesLoading] = useState(false)
    const [episodesError, setEpisodesError] = useState<string | null>(null)
    const [seriesSectionRequested, setSeriesSectionRequested] = useState(false)

    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            const q = editWorkSearch.trim()
            if (!q) {
                setUnifiedResults([])
                return
            }
            setIsSearching(true)
            try {
                const res = await searchWorksUnified(q)
                if (res.success && res.results) {
                    setUnifiedResults(res.results.slice(0, 8))
                }
            } catch (e) {
                console.error(e)
            } finally {
                setIsSearching(false)
            }
        }, 400)

        return () => clearTimeout(delayDebounceFn)
    }, [editWorkSearch])

    useEffect(() => {
        let cancelled = false
        const updateEpisodesForSeason = async () => {
            if (!seriesSectionRequested) return
            if (pickedUnifiedResult && (pickedUnifiedResult.type === "tv-serie" || pickedUnifiedResult.type === "dokumentar-serie")) {
                setEpisodesLoading(true)
                setEpisodesError(null)
                try {
                    const sNum = parseInt(addSeason) || 1
                    const detailsRes = await resolveUnifiedSearchResultDetails(pickedUnifiedResult, sNum)
                    if (cancelled) return
                    if (detailsRes.success && detailsRes.details?.episode_lookup_status === "found") {
                        const d = detailsRes.details
                        const options = (d.episode_options ?? []).map(option => ({ number: option.number, title: option.title }))
                        const count = Math.max(d.episode_count ?? 0, options.length)
                        if (count > 0) {
                            setDetectedEpisodeCount(count)
                            setEpisodeOptions(buildCompleteEpisodeOptions({
                                episodeCount: count,
                                externalOptions: options,
                                seasonNumber: sNum,
                            }))
                            setSelectedEpisodes(prev => prev.filter(x => x <= count))
                        } else {
                            // Sæsonen findes ikke — vis fejl i stedet for placeholder-afsnit.
                            setDetectedEpisodeCount(null)
                            setEpisodeOptions([])
                            setSelectedEpisodes([])
                            setEpisodesError(`Sæson ${sNum} blev ikke fundet.`)
                        }
                    } else {
                        setDetectedEpisodeCount(null)
                        setEpisodeOptions([])
                        setSelectedEpisodes([])
                        const lookupFailed = detailsRes.success && detailsRes.details?.episode_lookup_status === "error"
                        setEpisodesError(lookupFailed ? `Kunne ikke hente sæson ${sNum}. Prøv igen.` : `Sæson ${sNum} blev ikke fundet.`)
                    }
                } catch (e) {
                    if (cancelled) return
                    console.error(e)
                    setEpisodeOptions([])
                    setSelectedEpisodes([])
                    setEpisodesError(`Kunne ikke hente sæson ${parseInt(addSeason) || 1}. Prøv igen.`)
                } finally {
                    if (!cancelled) setEpisodesLoading(false)
                }
            }
        }
        updateEpisodesForSeason()
        return () => { cancelled = true }
    }, [addSeason, pickedUnifiedResult, seriesSectionRequested])

    const pickUnifiedResult = (result: UnifiedSearchWorkResult) => {
        setManualWorkMode(false)
        setPickedUnifiedResult(result)
        setSelectedEpisodes([])
        setEpisodeOptions([])
        setDetectedEpisodeCount(null)
        setEpisodesError(null)
        setSeriesSectionRequested(false)
        const initialSeason = result.season_hint ? String(result.season_hint) : "1"
        setAddSeason(initialSeason)
    }
    const [editRightsHolderSearch, setEditRightsHolderSearch] = useState("")
    const [activeHighlight, setActiveHighlight] = useState<string | null>(null)
    const [navneTjekResult, setNavneTjekResult] = useState<NavneTjekResult | null>(null)
    const [navneTjekLoading, setNavneTjekLoading] = useState(false)
    const editDialogRef = useRef<HTMLDivElement>(null)
    const editDialogScrollRef = useRef<HTMLDivElement>(null)
    const flushAiEditorRef = useRef<(() => Promise<boolean>) | null>(null)

    useEffect(() => {
        if (!editContract?.id) return

        const frame = window.requestAnimationFrame(() => {
            editDialogRef.current?.scrollTo({ top: 0 })
            editDialogScrollRef.current?.scrollTo({ top: 0 })
        })

        return () => window.cancelAnimationFrame(frame)
    }, [editContract?.id])

    const closeEditDialog = useCallback(() => {
        setEditContract(null)
        setEditForm(null)
        setEditWorkTypeFilter("all")
        setPickedUnifiedResult(null)
        setManualWorkMode(false)
        setManualWork(emptyManualWorkForm())
        setAddSeason("")
        setSelectedEpisodes([])
        setEpisodeOptions([])
        setDetectedEpisodeCount(null)
        setSeriesSectionRequested(false)
    }, [])

    // Upload flow
    const [showUpload, setShowUpload] = useState(false)
    const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
    const [uploadPhase, setUploadPhase] = useState<"select" | "processing">("select")
    const [uploadRightsHolderId, setUploadRightsHolderId] = useState("")
    const [uploadRightsHolderSearch, setUploadRightsHolderSearch] = useState("")
    const [activeUploadBatchId, setActiveUploadBatchId] = useState<string | null>(null)
    const [recentImportBatches, setRecentImportBatches] = useState<ImportBatchSummary[]>([])
    const removeUploadItem = (index: number) => setUploadItems(prev => prev.filter((_, i) => i !== index))
    const [saving, setSaving] = useState(false)
    const prefillWorkIdRef = useRef<string | null>(null)
    const { activeRh, setActiveRh } = useActiveRightsHolder()

    const loadImportBatches = useCallback(async () => {
        try {
            const response = await fetch("/api/admin/contract-imports?limit=5", { cache: "no-store" })
            if (!response.ok) return
            const json = await response.json() as { batches?: ImportBatchSummary[] }
            setRecentImportBatches(json.batches ?? [])
        } catch { /* Kontraktlisten må fortsat fungere ved en statusfejl. */ }
    }, [])

    useEffect(() => {
        void loadImportBatches()
    }, [loadImportBatches])

    const activeImportPollKey = recentImportBatches
        .filter(batch => batch.status === "processing")
        .map(batch => batch.id)
        .join(",")
    useEffect(() => {
        if (!activeImportPollKey) return
        const interval = window.setInterval(() => void loadImportBatches(), 4000)
        return () => window.clearInterval(interval)
    }, [activeImportPollKey, loadImportBatches])

    const retryImportBatch = useCallback(async (batchId: string) => {
        const response = await fetch(`/api/admin/contract-imports/${batchId}/retry`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "resume" }),
        })
        const json = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(json.error ?? t("admin.contracts.import.retryError"))
        toast.success(t("admin.contracts.import.retryQueued", { count: Number(json.queued ?? 0) }))
        await loadImportBatches()
    }, [loadImportBatches, t])

    // Åbn upload-flowet automatisk når man kommer fra "Tilføj kontrakt" (?new=1&work=<id>)
    useEffect(() => {
        if (typeof window === "undefined") return
        const params = new URLSearchParams(window.location.search)
        prefillWorkIdRef.current = params.get("work")
        const status = params.get("status")
        if (status) setFilterStatus(status)
        if (params.get("new") === "1") {
            setShowUpload(true)
            setUploadPhase("select")
            setUploadItems([])
            setActiveUploadBatchId(null)
        }
    }, [])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (duplicatesOpen) {
                    setDuplicatesOpen(false)
                } else if (editContract && !editSaving) {
                    closeEditDialog()
                } else if (viewContract) {
                    setViewContract(null)
                    setViewPdfUrl(null)
                } else if (showUpload && !saving) {
                    setShowUpload(false)
                    setUploadItems([])
                    setUploadPhase("select")
                }
            }
        }
        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [editContract, editSaving, viewContract, showUpload, saving, duplicatesOpen, closeEditDialog])

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

                const contextResponse = await fetch("/api/admin/context", { cache: "no-store" })
                const context = contextResponse.ok
                    ? await contextResponse.json() as { orgId?: string; role?: string }
                    : null
                const resolvedOrgId = context?.orgId ?? null
                if (!resolvedOrgId) {
                    toast.error("Din bruger er ikke knyttet til en organisation.")
                    setLoading(false)
                    return
                }
                setOrgId(resolvedOrgId)
                setIsSuperadmin(context?.role === "superadmin")

                const [contractsRes, employersRes, rhRes, worksRes] = await Promise.all([
                    supabase
                        .from("contracts")
                        .select(`
                            id, type, overenskomst, status, pdf_url, processed_pdf_url,
                            document_processing_status, document_processing_error_code, superseded_by_contract_id,
                            contract_date, start_date, end_date, created_at,
                            employer_id, rights_holder_id, working_title,
                            season_number, episode_numbers,
                            employers (name),
                            rettighedshavere (full_name),
                            works (id, title, type, poster_url),
                            contract_validations (has_credit_clause, has_overenskomst_incorporation)
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
                    const rawContracts = contractsRes.data as unknown as Array<{ id: string; type: string; overenskomst: string | null; status: string; pdf_url: string; processed_pdf_url?: string | null; document_processing_status?: string; document_processing_error_code?: string | null; superseded_by_contract_id?: string | null; contract_date: string | null; start_date: string | null; end_date: string | null; created_at: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; season_number?: number | null; episode_numbers?: number[] | null; works?: { id?: string | null; title?: string | null; type?: string | null; poster_url?: string | null } | null; contract_validations?: { has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null }[] | { has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null } | null }>
                    const commentsByContract: Record<string, ContractComment[]> = {}
                    const latestJobByContract: Record<string, { status: string; error_message: string | null; created_at: string }> = {}
                    if (rawContracts.length > 0) {
                        const idChunks = chunkIds(rawContracts.map(row => row.id))
                        const [commentResults, jobResults] = await Promise.all([
                            Promise.all(idChunks.map(ids => supabase
                                .from("contract_comments")
                                .select("id, contract_id, author_role, message, created_at, member_read_at, admin_read_at")
                                .in("contract_id", ids)
                                .eq("author_role", "member")
                                .is("admin_read_at", null)
                                .order("created_at", { ascending: true }))),
                            Promise.all(idChunks.map(ids => supabase
                                .from("contract_ai_jobs")
                                .select("contract_id, status, error_message, created_at")
                                .in("contract_id", ids)
                                .is("attachment_id", null)
                                .order("created_at", { ascending: false }))),
                        ])
                        for (const commentsRes of commentResults) {
                            if (commentsRes.error) console.error("[admin-contracts] unread comments failed", commentsRes.error.code)
                            for (const comment of (commentsRes.data ?? []) as unknown as Array<ContractComment & { contract_id: string }>) {
                                if (!commentsByContract[comment.contract_id]) commentsByContract[comment.contract_id] = []
                                commentsByContract[comment.contract_id].push(comment)
                            }
                        }
                        for (const jobsRes of jobResults) {
                            if (jobsRes.error) console.error("[admin-contracts] AI job status failed", jobsRes.error.code)
                            for (const job of (jobsRes.data ?? []) as Array<{ contract_id: string; status: string; error_message: string | null; created_at: string }>) {
                                if (!latestJobByContract[job.contract_id]) latestJobByContract[job.contract_id] = job
                            }
                        }
                    }
                    const importStates = await getContractImportStates(rawContracts.map(contract => contract.id))
                    const previousCounts = rawContracts.reduce<Record<string, number>>((counts, row) => {
                        if (row.superseded_by_contract_id) counts[row.superseded_by_contract_id] = (counts[row.superseded_by_contract_id] ?? 0) + 1
                        return counts
                    }, {})
                    setContracts(rawContracts.filter(r => !r.superseded_by_contract_id).map((r) => {
                        const validation = Array.isArray(r.contract_validations) ? r.contract_validations[0] : r.contract_validations
                        return ({
                        id: r.id,
                        type: r.type,
                        overenskomst: r.overenskomst,
                        status: r.status,
                        pdf_url: r.pdf_url,
                        processed_pdf_url: r.processed_pdf_url ?? null,
                        document_processing_status: r.document_processing_status ?? "pending",
                        document_processing_error_code: r.document_processing_error_code ?? null,
                        superseded_by_contract_id: r.superseded_by_contract_id ?? null,
                        previous_version_count: previousCounts[r.id] ?? 0,
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
                        season_number: r.season_number ?? null,
                        episode_numbers: r.episode_numbers ?? null,
                        contract_comments: commentsByContract[r.id] ?? [],
                        contract_attachments: [],
                        validation_data: null, // udskudt til loadContractDetail() ved åbning
                        validation_has_credit_clause: validation?.has_credit_clause ?? null,
                        validation_has_overenskomst_incorporation: validation?.has_overenskomst_incorporation ?? null,
                        ai_job_status: latestJobByContract[r.id]?.status ?? null,
                        ai_job_error: latestJobByContract[r.id]?.error_message ?? null,
                        import_status: importStates.states[r.id] ?? null,
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
        .filter(c => ["queued", "processing", "retry_wait", "error"].includes(c.ai_job_status ?? ""))
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
                        season_number, episode_numbers,
                        employers (name), rettighedshavere (full_name), works (id, title, poster_url),
                        contract_validations (has_credit_clause, has_overenskomst_incorporation)
                    `)
                    .in("id", doneIds)
                for (const r of (rows ?? []) as unknown as Array<{ id: string; type: string; overenskomst: string | null; status: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; season_number?: number | null; episode_numbers?: number[] | null; works?: { id?: string | null; title?: string | null; type?: string | null; poster_url?: string | null } | null; contract_validations?: { has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null }[] | { has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null } | null }>) {
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
                        season_number: r.season_number ?? null,
                        episode_numbers: r.episode_numbers ?? null,
                        validation_data: null, // udskudt til loadContractDetail() ved åbning
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
        const displayPath = contract.processed_pdf_url ?? contract.pdf_url
        if (!displayPath) return
        const supabase = createClient()
        const { data } = await supabase.storage.from("kontrakter").createSignedUrl(displayPath, 3600)
        if (data?.signedUrl) setViewPdfUrl(data.signedUrl)
    }

    // ── Upload: file selection ────────────────────────────────

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        const invalid = files.map(file => ({ file, error: validateContractImportFile(file) })).filter(item => item.error)
        if (invalid.length > 0) {
            toast.error(`${invalid[0].file.name}: ${invalid[0].error}`)
            e.target.value = ""
            return
        }
        setUploadItems(files.map(file => ({ file, clientToken: crypto.randomUUID(), status: "pending" })))
    }

    // ── Upload: gem kontrakter + opret AI-jobs ───────────────────

    const handleExtractAndSave = async () => {
        if (uploadItems.length === 0 || !orgId) return
        setUploadPhase("processing")
        setSaving(true)
        const updated = [...uploadItems]
        try {
            const batchResponse = await fetch("/api/admin/contract-imports", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source: "computer", discoveredCount: updated.length }),
            })
            const batchJson = await batchResponse.json()
            if (!batchResponse.ok || !batchJson.batch?.id) throw new Error(batchJson.error ?? "Importbatch kunne ikke oprettes")
            setActiveUploadBatchId(batchJson.batch.id)
            let nextIndex = 0
            const uploadNext = async (): Promise<void> => {
                const index = nextIndex++
                if (index >= updated.length) return
                updated[index] = { ...updated[index], status: "uploading" }
                setUploadItems([...updated])
                try {
                    const formData = new FormData()
                    formData.set("file", updated[index].file)
                    formData.set("clientToken", updated[index].clientToken)
                    if (updated.length === 1 && uploadRightsHolderId) formData.set("rightsHolderId", uploadRightsHolderId)
                    if (prefillWorkIdRef.current) formData.set("workId", prefillWorkIdRef.current)
                    const response = await fetch(`/api/admin/contract-imports/${batchJson.batch.id}/items`, { method: "POST", body: formData })
                    const json = await response.json()
                    if (!response.ok) throw new Error(json.error ?? "Upload fejlede")
                    updated[index] = {
                        ...updated[index],
                        status: json.duplicate ? "duplicate" : "queued",
                        contractId: json.item?.contract_id ?? null,
                        importItemId: json.item?.id ?? null,
                    }
                } catch (error) {
                    updated[index] = { ...updated[index], status: "error", error: error instanceof Error ? error.message : "Upload fejlede" }
                }
                setUploadItems([...updated])
                await uploadNext()
            }
            await Promise.all(Array.from({ length: Math.min(CONTRACT_IMPORT_CONCURRENCY, updated.length) }, () => uploadNext()))
            const queuedCount = updated.filter(item => item.status === "queued").length
            const duplicateCount = updated.filter(item => item.status === "duplicate").length
            const failedCount = updated.filter(item => item.status === "error").length
            if (queuedCount) toast.success(`${queuedCount} kontrakt${queuedCount === 1 ? "" : "er"} er lagt i analysekø`)
            if (duplicateCount) toast.info(`${duplicateCount} dublet${duplicateCount === 1 ? "" : "ter"} blev afvist`)
            if (failedCount) toast.error(`${failedCount} fil${failedCount === 1 ? "" : "er"} fejlede`)
            window.dispatchEvent(new CustomEvent("contracts-updated"))
            await loadImportBatches()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Importen kunne ikke startes")
        } finally {
            setSaving(false)
        }
    }

    // ── Upload: extract all files ─────────────────────────────


    // ── Update extracted field in review ──────────────────────



    // ── Save all reviewed contracts ───────────────────────────


    // ── Delete ────────────────────────────────────────────────

    const handleDelete = async () => {
        if (!deleteId) return
        setSaving(true)
        try {
            const result = await deleteAdminContractsPermanently([deleteId])
            if (!result.success) throw new Error(result.error)
            setContracts(prev => prev.filter(c => c.id !== deleteId))
            setDeleteId(null)
            toast.success("Kontrakt slettet")
            if (result.warning) toast.warning(result.warning)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke slettes")
        } finally {
            setSaving(false)
        }
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
        const missingWork = contracts.filter(c => selectedIds.includes(c.id) && !hasContractWorkLink(c))
        if (missingWork.length > 0) {
            toast.error(`${missingWork.length} kontrakt(er) kan ikke valideres, fordi de mangler værktilknytning`)
            return
        }
        setSaving(true)
        try {
            const result = await validateAdminContracts(selectedIds)
            if (!result.success) throw new Error(result.error)
            setContracts(prev => prev.map(c => selectedIds.includes(c.id) ? { ...c, status: "valideret" } : c))
            toast.success(`${selectedIds.length} kontrakt(er) er valideret`)
            setSelectedIds([])
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Kunne ikke validere kontrakter")
        } finally {
            setSaving(false)
        }
    }

    const handleFindOwners = async () => {
        if (selectedIds.length === 0) return
        setSaving(true)
        try {
            const result = await findOwnersForContracts(selectedIds)
            if (!result.success) throw new Error(result.error)
            const matchMap = new Map(result.matches.map(match => [match.contractId, match.rightsHolderId]))
            setContracts(previous => previous.map(contract => {
                const rightsHolderId = matchMap.get(contract.id)
                if (!rightsHolderId) return contract
                return {
                    ...contract,
                    rights_holder_id: rightsHolderId,
                    rights_holder_name: rightsHolders.find(holder => holder.id === rightsHolderId)?.full_name ?? contract.rights_holder_name,
                }
            }))
            if (result.matched) toast.success(`${result.matched} kontrakt${result.matched === 1 ? "" : "er"} blev koblet til en rettighedshaver`)
            if (result.unresolved) toast.info(`${result.unresolved} kontrakt${result.unresolved === 1 ? "" : "er"} mangler fortsat ejer`)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Ejersøgningen fejlede")
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
            if (res.warning) toast.warning(res.warning)
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

    const openEdit = (c: ContractRow) => {
        setEditContract(c)
        setAdminReply("")
        void markAdminCommentsRead(c)
        // Auto-hent dokument-URL så kontrakten vises til venstre uden knap-tryk
        setEditDocUrl(null)
        setActiveHighlight(null)
        setNavneTjekResult(null)
        setSeriesSectionRequested(false)

        const displayPath = c.processed_pdf_url ?? c.pdf_url
        if (displayPath) {
            const supabase = createClient()
            supabase.storage.from("kontrakter").createSignedUrl(displayPath, 3600).then(({ data }) => {
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
        setManualWorkMode(false)
        setManualWork(emptyManualWorkForm({
            title: c.working_title ?? c.work_title ?? "",
            contract_id: c.id,
        }))
        setEditProducerSelections(c.employer_id ? [{
            employerId: c.employer_id,
            canonicalName: c.employer_name ?? employers.find(employer => employer.id === c.employer_id)?.name ?? "Producent",
        }] : [])
        void fetch(`/api/admin/contracts/${c.id}/producers`)
            .then(response => response.ok ? response.json() : null)
            .then(json => {
                if (json?.data?.length) setEditProducerSelections(json.data)
            })
            .catch(() => undefined)
        setAddSeason(String(c.season_number ?? 1))
        setSelectedEpisodes(c.episode_numbers ?? [])
        if (c.work_id) {
            setPickedUnifiedResult({
                id: `local:${c.work_id}`,
                local_id: c.work_id,
                title: c.work_title ?? c.working_title ?? "Valgt værk",
                // Værkets type kendes først efter loadContractDetail — c.type er kontraktens type (a-løn/leverandør).
                type: "spillefilm" as UnifiedSearchWorkResult["type"],
                year: null,
                description: null,
                poster_url: null,
                director: null,
                genre: null,
                duration_minutes: null,
                sources: ["local"],
            })
        } else {
            setPickedUnifiedResult(null)
        }
        setEditWorkSearch(c.work_title ?? c.working_title ?? "")
        setEditRightsHolderSearch(c.rights_holder_name ?? "")
        void loadContractDetail(c)
    }

    const loadContractDetail = async (c: ContractRow) => {
        const supabase = createClient()
        const { data } = await supabase
            .from("contracts")
            .select(`
                id, type, overenskomst, status, pdf_url, processed_pdf_url,
                document_processing_status, document_processing_error_code,
                contract_date, start_date, end_date, created_at,
                employer_id, rights_holder_id, working_title,
                season_number, episode_numbers,
                employers (name),
                rettighedshavere (full_name),
                works (id, title, type, poster_url),
                contract_validations (extracted_data, has_credit_clause, has_overenskomst_incorporation)
            `)
            .eq("id", c.id)
            .maybeSingle()
        const { data: comments } = await supabase
            .from("contract_comments")
            .select("id, contract_id, author_role, message, created_at, member_read_at, admin_read_at")
            .eq("contract_id", c.id)
            .order("created_at", { ascending: true })
        const [{ data: jobs }, { data: attachments }] = await Promise.all([
            supabase
                .from("contract_ai_jobs")
                .select("contract_id, status, error_message, created_at")
                .eq("contract_id", c.id)
                .order("created_at", { ascending: false })
                .limit(1),
            supabase
                .from("contract_attachments")
                .select("id,title,ai_status,ai_result")
                .eq("contract_id", c.id)
                .order("created_at", { ascending: false }),
        ])

        if (!data) return
        const row = data as unknown as { id: string; type: string; overenskomst: string | null; status: string; pdf_url: string | null; processed_pdf_url?: string | null; document_processing_status?: string; document_processing_error_code?: string | null; contract_date: string | null; start_date: string | null; end_date: string | null; created_at: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; season_number?: number | null; episode_numbers?: number[] | null; works?: { id?: string | null; title?: string | null; type?: string | null; poster_url?: string | null } | null; contract_validations?: { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null }[] | { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null } | null }
        const validation = Array.isArray(row.contract_validations) ? row.contract_validations[0] : row.contract_validations
        const latestJob = (jobs ?? [])[0] as { status?: string; error_message?: string | null } | undefined
        const detail: ContractRow = {
            ...c,
            id: row.id,
            type: row.type,
            overenskomst: row.overenskomst,
            status: row.status,
            processed_pdf_url: row.processed_pdf_url ?? null,
            document_processing_status: row.document_processing_status ?? "pending",
            document_processing_error_code: row.document_processing_error_code ?? null,
            pdf_url: row.pdf_url,
            contract_date: row.contract_date,
            start_date: row.start_date,
            end_date: row.end_date,
            created_at: row.created_at,
            employer_id: row.employer_id ?? null,
            employer_name: row.employers?.name ?? null,
            rights_holder_id: row.rights_holder_id ?? null,
            rights_holder_name: row.rettighedshavere?.full_name ?? null,
            work_id: row.works?.id ?? null,
            working_title: row.working_title ?? null,
            work_title: row.works?.title ?? null,
            work_poster_url: row.works?.poster_url ?? null,
            season_number: row.season_number ?? null,
            episode_numbers: row.episode_numbers ?? null,
            contract_comments: ((comments ?? []) as unknown as ContractComment[]),
            contract_attachments: (attachments ?? []) as NonNullable<ContractRow["contract_attachments"]>,
            validation_data: validation?.extracted_data ?? null,
            validation_has_credit_clause: validation?.has_credit_clause ?? null,
            validation_has_overenskomst_incorporation: validation?.has_overenskomst_incorporation ?? null,
            ai_job_status: latestJob?.status ?? null,
            ai_job_error: latestJob?.error_message ?? null,
        }
        setEditContract(prev => prev?.id === c.id ? detail : prev)
        setContracts(prev => prev.map(contract => contract.id === c.id ? { ...contract, ...detail } : contract))

        if (row.season_number) setAddSeason(String(row.season_number))
        if (row.episode_numbers) setSelectedEpisodes(row.episode_numbers)
        if (row.works?.id) {
            setPickedUnifiedResult({
                id: `local:${row.works.id}`,
                local_id: row.works.id,
                title: row.works.title ?? row.working_title ?? "Valgt værk",
                type: (row.works.type ?? "spillefilm") as UnifiedSearchWorkResult["type"],
                year: null,
                description: null,
                poster_url: row.works.poster_url ?? null,
                director: null,
                genre: null,
                duration_minutes: null,
                sources: ["local"],
            })
        }

        const rightsHolderName = detail.validation_data?.rightsHolderName as string | undefined
        if (rightsHolderName) {
            if (!row.rights_holder_id) setEditRightsHolderSearch(rightsHolderName)
            setNavneTjekLoading(true)
            checkRightsHolderName(rightsHolderName).then(res => {
                if (res.success && res.result) setNavneTjekResult(res.result)
                setNavneTjekLoading(false)
            }).catch(() => setNavneTjekLoading(false))
        }
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
                season_number, episode_numbers,
                employers (name),
                rettighedshavere (full_name),
                works (id, title, type, poster_url),
                contract_validations (extracted_data, has_credit_clause, has_overenskomst_incorporation)
            `)
            .eq("id", contractId)
            .maybeSingle()
        if (!data) return
        const row = data as unknown as { id: string; type: string; overenskomst: string | null; status: string; pdf_url: string | null; contract_date: string | null; start_date: string | null; end_date: string | null; created_at: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; season_number?: number | null; episode_numbers?: number[] | null; works?: { id?: string | null; title?: string | null; type?: string | null; poster_url?: string | null } | null; contract_validations?: { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null }[] | { extracted_data?: Record<string, unknown> | null; has_credit_clause?: boolean | null; has_overenskomst_incorporation?: boolean | null } | null }
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
        if (contract.pdf_url.toLowerCase().endsWith(".pdf") && contract.document_processing_status !== "ready") {
            const message = documentProcessingErrorMessage(contract)
                ?? (contract.document_processing_status === "processing"
                    ? "PDF'en er ved at blive rettet og OCR-behandlet. Start AI-aflæsningen igen, når PDF-behandlingen er færdig."
                    : "PDF'en skal først rettes og OCR-behandles, før AI-aflæsningen kan startes.")
            if (!automatic) toast.error(message)
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
        options?: { skipMissingWorkConfirm?: boolean; openNextAfterSave?: boolean; saveOnly?: boolean }
    ) => {
        if (!editContract || !editForm) return false
        if (flushAiEditorRef.current && !(await flushAiEditorRef.current())) {
            toast.error("De aflæste kontraktdata kunne ikke gemmes. Prøv igen, før kontrakten lukkes.")
            return false
        }
        const newStatus: "kladde" | "valideret" | "arkiveret" = statusOverride
            ?? (editForm.status === "valideret" || editForm.status === "arkiveret" ? editForm.status : "kladde")
        let resolvedWorkId = editForm.work_id
        let selectedWork = works.find(w => w.id === resolvedWorkId)

        if (manualWorkMode) {
            const validationError = validateManualWork(manualWork, "da")
            if (validationError) {
                toast.error(validationError)
                return false
            }
            setEditSaving(true)
            try {
                const numberOrNull = (value: string) => {
                    const number = Number(value)
                    return value.trim() && Number.isFinite(number) ? number : null
                }
                const created = await createAdminWork({
                    data: {
                        title: manualWork.title.trim(),
                        type: manualWork.type,
                        year: numberOrNull(manualWork.year),
                        duration_minutes: numberOrNull(manualWork.duration_minutes),
                        season_count: null,
                        episode_count: numberOrNull(manualWork.episode_count),
                        parent_work_id: null,
                        season_number: numberOrNull(manualWork.season_number),
                        episode_number: numberOrNull(manualWork.episode_number),
                        genre: null,
                        director: manualWork.director.trim() || null,
                        alternative_titles: [],
                        production_countries: [],
                        production_companies: manualWork.production_companies.map(company => company.canonicalName),
                        description: null,
                        dfi_id: null,
                        tmdb_id: null,
                        poster_url: null,
                    },
                    seasonNumber: numberOrNull(manualWork.season_number),
                    selectedEpisodes: manualWork.selected_episodes,
                    productionCompanies: manualWork.production_companies,
                    status: "godkendt",
                })
                if (!created.workId) throw new Error("Værket kunne ikke oprettes")
                resolvedWorkId = created.workId
                selectedWork = { id: created.workId, title: manualWork.title.trim(), year: numberOrNull(manualWork.year), poster_url: null }
                setWorks(previous => previous.some(work => work.id === created.workId) ? previous : [...previous, selectedWork!].sort((a, b) => a.title.localeCompare(b.title, "da-DK")))
            } catch (error: unknown) {
                toast.error(error instanceof Error ? error.message : "Værket kunne ikke oprettes")
                setEditSaving(false)
                return false
            }
        } else if (pickedUnifiedResult) {
            setEditSaving(true)
            try {
                const activeSeason = parseInt(addSeason) || 1
                const linkRes = await createAndLinkWorkForContract({
                    contractId: editContract.id,
                    result: pickedUnifiedResult,
                    seasonNumber: activeSeason,
                    selectedEpisodes: selectedEpisodes,
                    rightsHolderId: editForm.rights_holder_id,
                    role: "Klipper",
                })
                if (!linkRes.success || !linkRes.workId) {
                    toast.error(linkRes.error || "Fejl under oprettelse/kobling af værk")
                    setEditSaving(false)
                    return false
                }
                resolvedWorkId = linkRes.workId
                selectedWork = {
                    id: linkRes.workId,
                    title: pickedUnifiedResult.title,
                    year: pickedUnifiedResult.year,
                    poster_url: pickedUnifiedResult.poster_url ?? null,
                } as any
                setWorks(prev => prev.some(w => w.id === linkRes.workId) ? prev : [...prev, selectedWork!].sort((a, b) => a.title.localeCompare(b.title, "da-DK")))
            } catch (e: unknown) {
                toast.error(errorMessage(e) || "Kunne ikke tilknytte værk")
                setEditSaving(false)
                return false
            }
        }
	        if (!options?.saveOnly && newStatus === "valideret" && !resolvedWorkId && !options?.skipMissingWorkConfirm) {
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
	            if (!options?.saveOnly && newStatus === "valideret" && !resolvedWorkId) {
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
            const isSeriesSave = manualWorkMode
                ? manualWork.type === "tv-serie" || manualWork.type === "dokumentar-serie"
                : pickedUnifiedResult?.type === "tv-serie" || pickedUnifiedResult?.type === "dokumentar-serie"
            const saveSeasonNumber = isSeriesSave ? (manualWorkMode ? Number(manualWork.season_number) || 1 : Number(addSeason) || 1) : null
            const saveEpisodeNumbers = isSeriesSave ? (manualWorkMode ? manualWork.selected_episodes : selectedEpisodes) : null

            const updateResult = await updateAdminContract(editContract.id, {
                    type: editForm.type,
                    overenskomst: editForm.overenskomst === "ingen" ? null : editForm.overenskomst,
                    status: newStatus,
                    contract_date: editForm.contract_date || null,
                    start_date: editForm.start_date || null,
                    end_date: editForm.end_date || null,
                    employer_id: editForm.employer_id || null,
                    producer_selections: editProducerSelections,
                    rights_holder_id: editForm.rights_holder_id || null,
                    work_id: resolvedWorkId || null,
                    working_title: editForm.working_title || null,
                    season_number: saveSeasonNumber,
                    episode_numbers: saveEpisodeNumbers,
                })
            if (!updateResult.success) throw new Error(updateResult.error)

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
                season_number: saveSeasonNumber,
                episode_numbers: saveEpisodeNumbers,
            } : c))
            closeEditDialog()
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
        setEditSaving(true)
        try {
            const result = await deleteAdminContractsPermanently([contract.id])
            if (!result.success) throw new Error(result.error)
            setContracts(prev => prev.filter(c => c.id !== contract.id))
            setEditContract(null)
            setEditForm(null)
            toast.success("Kontrakt slettet")
            if (result.warning) toast.warning(result.warning)
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
        else if (filterStatus === "missingWork") list = list.filter(c => !hasContractWorkLink(c))
        else if (filterStatus === "validationPending") list = list.filter(isPendingContractValidation)
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
            if (sortKey === "status") {
                const statusPriority = (s: string) => (s === "afventer" ? 0 : s === "mangler_vaerk" ? 1 : s === "kladde" ? 2 : 3)
                const prioA = statusPriority(a.status)
                const prioB = statusPriority(b.status)
                if (prioA !== prioB) return (prioA - prioB) * direction
            }
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
    const editRightsHolderResults = editRightsHolderSearch.trim()
        ? rightsHolders.filter(r => r.full_name.toLowerCase().includes(editRightsHolderSearch.toLowerCase())).slice(0, 8)
        : rightsHolders.slice(0, 8)
    const editPreviewContract = editContract && editForm ? {
        ...editContract,
        status: editForm.status,
        employer_id: editForm.employer_id || null,
        rights_holder_id: editForm.rights_holder_id || null,
        work_id: editForm.work_id || null,
        overenskomst: editForm.overenskomst === "ingen" ? null : editForm.overenskomst,
    } : editContract
    const editValidationData = editPreviewContract?.validation_data ?? {}
    const editCopydanStatus = editPreviewContract ? effectiveCopydanStatus(editPreviewContract) : "unknown"
    const editRightsOverview = editValidationData.rightsOverview && typeof editValidationData.rightsOverview === "object"
        ? editValidationData.rightsOverview as Record<string, unknown>
        : {}
    const editStreamingStatus = normalizeTriState(editValidationData.svod ?? editValidationData.streamingReservation ?? editRightsOverview.streamingforbehold)
    const editDocumentError = editContract ? documentProcessingErrorMessage(editContract) : null
    const activeUploadBatch = activeUploadBatchId ? recentImportBatches.find(batch => batch.id === activeUploadBatchId) ?? null : null
    const toggleSelected = (id: string) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
    }
    const toggleAllFiltered = () => {
        setSelectedIds(allFilteredSelected ? [] : filtered.map(contract => contract.id))
    }
    const markAsPreviousVersion = async () => {
        if (!editContract || !currentVersionId) return
        setVersionSaving(true)
        try {
            const response = await fetch(`/api/admin/contracts/${editContract.id}/versions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentContractId: currentVersionId }),
            })
            const json = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(json.error ?? "Kontrakterne kunne ikke forbindes")
            setContracts(items => items.filter(item => item.id !== editContract.id).map(item => item.id === currentVersionId ? { ...item, previous_version_count: item.previous_version_count + 1 } : item))
            setVersionDialogOpen(false)
            closeEditDialog()
            toast.success("Kontrakten er markeret som tidligere version")
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Kontrakterne kunne ikke forbindes")
        } finally {
            setVersionSaving(false)
        }
    }

    const showVersionHistory = async () => {
        if (!editContract) return
        setVersionHistoryOpen(true)
        setVersionHistoryLoading(true)
        setVersionHistory([])
        try {
            const response = await fetch(`/api/admin/contracts/${editContract.id}/versions`, { cache: "no-store" })
            const json = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(json.error ?? "Versionshistorikken kunne ikke hentes")
            setVersionHistory(Array.isArray(json.versions) ? json.versions : [])
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Versionshistorikken kunne ikke hentes")
            setVersionHistoryOpen(false)
        } finally {
            setVersionHistoryLoading(false)
        }
    }

    const openContractVersion = async (version: ContractVersion) => {
        const path = version.processed_pdf_url ?? version.pdf_url
        if (!path) return toast.error("Denne version har ingen dokumentfil")
        const supabase = createClient()
        const { data, error } = await supabase.storage.from("kontrakter").createSignedUrl(path, 10 * 60)
        if (error || !data?.signedUrl) return toast.error("Dokumentet kunne ikke åbnes sikkert")
        window.open(data.signedUrl, "_blank", "noopener,noreferrer")
    }

    const SortButton = ({ label, sortId }: { label: string; sortId: SortKey }) => (
        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => handleSort(sortId)}>
            {label}{sortMark(sortId) && <span>{sortMark(sortId)}</span>}
        </button>
    )


    if (loading) return <TableSkeleton columns={7} rows={7} />

    const currentYear = new Date().getFullYear()
    const availableYears = Array.from(
        new Set(contracts.map(c => c.contract_date ? new Date(c.contract_date).getFullYear() : new Date(c.created_at).getFullYear()))
    ).sort((a, b) => b - a)
    if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear)

    const stats = {
        total: contracts.length,
        validerede: contracts.filter(c => c.status === "valideret").length,
    }

    return (
        <div className="space-y-6">
            {view === "archive" && <SummaryGrid>
                <SummaryCard label="Kontrakter i alt" value={stats.total} />
                <YearCountCard contracts={contracts} availableYears={availableYears} currentYear={currentYear} />
                <SummaryCard label="Validerede" value={stats.validerede} />
            </SummaryGrid>}

            {view === "upload" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
                <div>
                    <h2 className="font-semibold">Upload fra computer eller telefon</h2>
                    <p className="text-sm text-muted-foreground">Filer gemmes som kladder og behandles sikkert i baggrunden.</p>
                </div>
                <Button size="sm" className="gap-1.5" onClick={() => { setShowUpload(true); setUploadPhase("select"); setUploadItems([]); setActiveUploadBatchId(null); setUploadRightsHolderId(""); setUploadRightsHolderSearch("") }}>
                    <Upload className="h-4 w-4" />
                    Upload kontrakter
                </Button>
            </div>}

            {view === "upload" && <GoogleDriveContractPicker onImported={() => void loadImportBatches()} />}

            {view === "upload" && recentImportBatches.length > 0 && (
                <section className="rounded-lg border bg-card p-3 sm:p-4" aria-labelledby="recent-imports-title">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <h2 id="recent-imports-title" className="text-sm font-semibold">{t("admin.contracts.import.latest")}</h2>
                            <p className="text-xs text-muted-foreground">{t("admin.contracts.import.latestDescription")}</p>
                        </div>
                    </div>
                    <div className="grid gap-2 lg:grid-cols-3">
                        {recentImportBatches.slice(0, 3).map(batch => (
                            <div key={batch.id} className="rounded-md border p-3 text-sm">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="font-medium">{batch.source === "computer" ? t("admin.contracts.import.sourceComputer") : batch.source.replaceAll("_", " ")}</p>
                                        <p className="text-xs text-muted-foreground">{new Date(batch.created_at).toLocaleString(locale === "da" ? "da-DK" : "en-GB")}</p>
                                    </div>
                                    <Badge variant="outline">{batch.status === "processing" ? t("admin.contracts.import.statusProcessing") : batch.status === "completed" ? t("admin.contracts.import.statusCompleted") : batch.status === "partially_failed" ? t("admin.contracts.import.statusActionRequired") : batch.status}</Badge>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {t("admin.contracts.import.summary", {
                                        completed: batch.completed_count,
                                        duplicates: batch.duplicate_count,
                                        failed: batch.failed_count,
                                        queued: Math.max(0, batch.uploaded_count - batch.completed_count - batch.duplicate_count - batch.failed_count),
                                    })}
                                </p>
                                {batch.failed_count > 0 && (
                                    <Button type="button" variant="outline" size="sm" className="mt-2 h-8" onClick={() => void retryImportBatch(batch.id).catch(error => toast.error(error instanceof Error ? error.message : t("admin.contracts.import.retryError")))}>
                                        {t("admin.contracts.import.retryFailed")}
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {view === "archive" && <>
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
                        <SelectItem value="validationPending">Afventer validering</SelectItem>
                        <SelectItem value="validationRecommended">Validering anbefalet</SelectItem>
                        <SelectItem value="missingOwner">Mangler ejer</SelectItem>
                        <SelectItem value="missingWork">Mangler værk</SelectItem>
                        <SelectItem value="valideret">Valideret</SelectItem>
                        <SelectItem value="arkiveret">Arkiveret</SelectItem>
                        <SelectItem value="beskeder">Beskeder</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-full lg:w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Type</SelectItem>
                        <SelectItem value="a-løn">A-løn</SelectItem>
                        <SelectItem value="leverandør">Leverandør</SelectItem>
                    </SelectContent>
                </Select>
                <ActiveUserFilter rightsHolders={rightsHolders} activeRh={activeRh} onChange={setActiveRh} />
                <ResetFiltersButton
                    active={Boolean(search || filterStatus !== "all" || filterType !== "all" || activeRh)}
                    onReset={() => { setSearch(""); setFilterStatus("all"); setFilterType("all"); setActiveRh(null); setSelectedIds([]); setPageSize(20) }}
                />
                <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={() => setDuplicatesOpen(true)}>
                    <Search className="h-4 w-4" />
                    Find dubletter
                </Button>
                <div className="grid w-full grid-cols-[1fr_auto] gap-2 lg:hidden">
                    <Select value={sortKey} onValueChange={value => setSortKey(value as SortKey)}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sorter efter" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="status">Status</SelectItem>
                            <SelectItem value="production">Værk</SelectItem>
                            <SelectItem value="rightsHolder">Rettighedshaver</SelectItem>
                            <SelectItem value="employer">Producent</SelectItem>
                            <SelectItem value="type">Type</SelectItem>
                            <SelectItem value="overenskomst">Overenskomst</SelectItem>
                            <SelectItem value="period">Periode</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} className="h-9 px-3">
                        {sortDir === "asc" ? "A-Z" : "Z-A"}
                    </Button>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground lg:ml-auto">
                    Vis
                    <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                        {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
                    </select>
                </label>
                {filtered.length > 0 && (
                    <Button type="button" variant="outline" className="w-full sm:w-auto lg:hidden" onClick={toggleAllFiltered}>
                        {allFilteredSelected ? "Fravælg alle" : "Vælg alle"}
                        {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
                    </Button>
                )}
            </div>

            <ListResultSummary filteredCount={filtered.length} totalCount={contracts.length} selectedCount={selectedIds.length} />

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
                    <Button size="sm" variant="outline" className="gap-2" onClick={handleFindOwners} disabled={saving}>
                        <Search className="h-4 w-4" />
                        Find ejer
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
                                <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelected(c.id)} className="mt-1 h-4 w-4" aria-label={`Vælg ${c.work_title ?? c.working_title ?? "kontrakt"}`} />
                                <button type="button" onClick={() => openEdit(c)} className="flex min-w-0 flex-1 gap-3 text-left">
                                    {posterUrl(c.work_poster_url) && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={posterUrl(c.work_poster_url) ?? ""} alt="" loading="lazy" className="h-16 w-11 shrink-0 rounded object-cover" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-medium leading-snug">{c.work_title ?? c.working_title ?? "—"}</p>
                                            {contractEpisodeTag(c.season_number, c.episode_numbers) && (
                                                <Badge variant="outline" className="font-mono text-[10px]">{contractEpisodeTag(c.season_number, c.episode_numbers)}</Badge>
                                            )}
                                            {c.previous_version_count > 0 && <Badge variant="outline">Har tidligere version</Badge>}
                                            {c.document_processing_status === "processing" && <Badge variant="outline">PDF behandles</Badge>}
                                            {c.document_processing_status === "needs_review" && <Badge variant="destructive">PDF kræver manuel kontrol</Badge>}
                                            {c.document_processing_status === "failed" && <Badge variant="destructive">PDF-behandling fejlede</Badge>}
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
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
	                            <div className="mt-3 grid grid-cols-2 gap-2 lg:hidden">
	                                <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => openPdf(c)}>
	                                    <Eye className="h-3.5 w-3.5" />
	                                    Se kontrakt
	                                </Button>
	                                <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => openEdit(c)}>
	                                    <Pencil className="h-3.5 w-3.5" />
	                                    Rediger
	                                </Button>
	                            </div>
	                        </MobileDataCard>
                    )
                })}
            </MobileCardList>

            <AdminListTools pageKey="contracts" title="Kontrakter" columns={[{id:"select",label:"Vælg",index:1,required:true},{id:"production",label:"Produktion",index:2,required:true},{id:"holder",label:"Klipper",index:3},{id:"producer",label:"Producent",index:4},{id:"type",label:"Type",index:5},{id:"agreement",label:"Overenskomst",index:6},{id:"period",label:"Periode",index:7},{id:"status",label:"Status",index:8},{id:"document",label:"Dokument",index:9}]} />
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
                            <TableHead className="w-[90px]">Dokument</TableHead>
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
                                                <img src={posterUrl(c.work_poster_url) ?? ""} alt="" loading="lazy" className="h-12 w-8 rounded object-cover" />
                                            )}
                                            <button type="button" onClick={() => openEdit(c)} className="text-left underline-offset-4 hover:underline">
                                                {c.work_title ?? c.working_title ?? <span className="text-muted-foreground">—</span>}
                                            </button>
                                            {contractEpisodeTag(c.season_number, c.episode_numbers) && (
                                                <Badge variant="outline" className="font-mono text-[10px]">{contractEpisodeTag(c.season_number, c.episode_numbers)}</Badge>
                                            )}
                                            {c.previous_version_count > 0 && <Badge variant="outline">Har tidligere version</Badge>}
                                            {c.document_processing_status === "processing" && <Badge variant="outline">PDF behandles</Badge>}
                                            {c.document_processing_status === "needs_review" && <Badge variant="destructive">PDF kræver manuel kontrol</Badge>}
                                            {c.document_processing_status === "failed" && <Badge variant="destructive">PDF-behandling fejlede</Badge>}
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
                                    <TableCell className="flex gap-1">
                                        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => openPdf(c)}><Eye className="h-3.5 w-3.5" />Se</Button>
                                        <Button type="button" variant="ghost" size="sm" className="gap-1" disabled={!c.pdf_url} onClick={async () => {
                                            if (!c.pdf_url) return
                                            const { createClient } = await import("@/lib/supabase/client")
                                            const supabase = createClient()
                                            const { data } = await supabase.storage.from("kontrakter").createSignedUrl(c.pdf_url, 60)
                                            if (!data?.signedUrl) return
                                            const a = document.createElement("a")
                                            a.href = data.signedUrl
                                            a.download = c.pdf_url.split("/").pop() ?? "kontrakt.pdf"
                                            a.click()
                                        }}><Download className="h-3.5 w-3.5" /></Button>
                                    </TableCell>
                                </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </ResponsiveTableFrame>
            </>}

            {/* PDF Viewer */}
            <Dialog open={!!viewContract} onOpenChange={() => { setViewContract(null); setViewPdfUrl(null) }}>
                <DialogContent className="h-[92vh] max-h-[92vh] w-full max-w-[95vw] sm:max-w-4xl lg:max-w-[1180px] flex flex-col p-4 sm:p-6">
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
                    className="flex flex-col w-full max-w-[95vw] sm:max-w-[560px]"
                    onCloseAutoFocus={e => e.preventDefault()}
                >
                    <DialogHeader className="shrink-0">
                        <DialogTitle className="flex items-center gap-2">
                            <Upload className="h-5 w-5" />
                            Upload kontrakter
                        </DialogTitle>
                        <DialogDescription>
                            {uploadPhase === "select"
                                ? t("admin.contracts.import.selectDescription")
                                : t("admin.contracts.import.processingDescription")}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Phase: select files */}
                    {uploadPhase === "select" && (
                        <div className="py-2 space-y-4">
                            <div>
                                <Label className="block mb-2">Vælg filer</Label>
                                <div
                                    className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 p-10 cursor-pointer hover:border-primary/50 transition-colors text-center"
                                    onClick={() => document.getElementById("bulk-file-input")?.click()}
                                >
                                    <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                                    <p className="text-sm font-medium">Klik for at vælge filer</p>
                                    <p className="text-xs text-muted-foreground mt-1">PDF, Word (.doc og .docx) eller TXT — ingen samlet batchgrænse, maks. 25 MB pr. fil</p>
                                    <p className="mt-1 text-[11px] text-muted-foreground">Filerne uploades i små bidder og analyseres automatisk i baggrunden.</p>
                                    <input id="bulk-file-input" type="file" accept={ADMIN_CONTRACT_UPLOAD_ACCEPT} multiple className="hidden" onChange={handleFileSelect} />
                                </div>
                            </div>
                            <GoogleDriveContractPicker onImported={() => void loadImportBatches()} />
                            {uploadItems.length > 0 && (
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground font-medium">Valgte filer ({uploadItems.length})</Label>
                                    <div className="max-h-36 overflow-y-auto space-y-1 rounded-md border p-2">
                                        {uploadItems.map((item, i) => (
                                            <div key={item.clientToken} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted">
                                                <span className="truncate flex-1 font-medium">{item.file.name}</span>
                                                <button type="button" onClick={() => removeUploadItem(i)} className="text-muted-foreground hover:text-destructive ml-2">
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {uploadItems.length === 1 && (
                                <div className="space-y-2 pt-2 border-t">
                                    <Label className="text-xs font-semibold">Tilknyt rettighedshaver (valgfrit)</Label>
                                    <p className="text-[11px] text-muted-foreground">
                                        Valgfrit. Hvis du ikke vælger en bruger, gemmes kontrakten som kladde uden rettighedshaver, og der søges automatisk efter brugeren.
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
                            <div className="max-h-[55vh] space-y-3 overflow-y-auto py-2 pr-1">
                                {activeUploadBatch && (
                                    <div className="rounded-md border bg-muted/40 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-medium">{t("admin.contracts.import.background")}</p>
                                            <Badge variant="outline">{activeUploadBatch.status === "processing" ? t("admin.contracts.import.statusProcessing") : activeUploadBatch.status === "completed" ? t("admin.contracts.import.statusCompleted") : t("admin.contracts.import.statusActionRequired")}</Badge>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {t("admin.contracts.import.summaryShort", {
                                                completed: activeUploadBatch.completed_count,
                                                duplicates: activeUploadBatch.duplicate_count,
                                                failed: activeUploadBatch.failed_count,
                                            })}
                                        </p>
                                    </div>
                                )}
                                {uploadItems.map(item => (
                                    <div key={item.clientToken} className="flex items-center gap-2.5 rounded-md border p-3">
                                        {item.status === "pending"    && <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                                        {item.status === "uploading"  && <Loader2  className="h-4 w-4 animate-spin text-primary shrink-0" />}
                                        {item.status === "queued"     && <Clock    className="h-4 w-4 text-amber-500 shrink-0" />}
                                        {item.status === "duplicate"  && <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />}
                                        {item.status === "extracting" && <Loader2  className="h-4 w-4 animate-spin text-primary shrink-0" />}
                                        {item.status === "done"       && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                                        {item.status === "error"      && <AlertCircle  className="h-4 w-4 text-destructive shrink-0" />}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{item.file.name}</p>
                                            {item.status === "uploading"  && <p className="text-xs text-muted-foreground">Uploader...</p>}
                                            {item.status === "queued"     && <p className="text-xs text-amber-600">I kø</p>}
                                            {item.status === "duplicate"  && <p className="text-xs text-amber-700">Dublet — ikke importeret</p>}
                                            {item.status === "extracting" && <p className="text-xs text-muted-foreground">Analyserer...</p>}
                                            {item.status === "done"       && <p className="text-xs text-emerald-600">Indlæst som kladde</p>}
                                            {item.status === "error"      && <p className="text-xs text-destructive">{item.error}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    })()}

                    <DialogFooter className="pt-2 border-t shrink-0">
                        <Button variant="outline" onClick={() => {
                            const imported = uploadItems.some(item => item.contractId)
                            setShowUpload(false)
                            setUploadItems([])
                            setUploadPhase("select")
                            if (imported) window.location.reload()
                        }} disabled={saving}>
                            {uploadPhase === "processing" && uploadItems.every(item => !["pending", "uploading", "extracting"].includes(item.status)) ? "Luk" : "Annuller"}
                        </Button>
                        {uploadPhase === "select" && (
                            <Button onClick={handleExtractAndSave} disabled={uploadItems.length === 0}>
                                {uploadItems.length > 0 ? `${t("admin.contracts.import.upload")} (${uploadItems.length})` : t("admin.contracts.import.upload")}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit */}
            <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Markér som tidligere version</DialogTitle>
                        <DialogDescription>Vælg den reviderede kontrakt, som fremover skal være den aktuelle version. Den tidligere version bevares i historikken og fjernes fra hovedlisten.</DialogDescription>
                    </DialogHeader>
                    <Select value={currentVersionId} onValueChange={setCurrentVersionId}>
                        <SelectTrigger><SelectValue placeholder="Vælg aktuel kontrakt" /></SelectTrigger>
                        <SelectContent>
                            {contracts.filter(candidate => candidate.id !== editContract?.id && Boolean(editContract?.work_id) && candidate.work_id === editContract?.work_id).map(candidate => (
                                <SelectItem key={candidate.id} value={candidate.id}>{candidate.work_title ?? candidate.working_title ?? "Kontrakt"} · {new Date(candidate.created_at).toLocaleDateString("da-DK")}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {!editContract?.work_id && <p className="text-sm text-amber-700">Tilknyt først kontrakten til et værk. Kun kontrakter på det samme værk kan forbindes som versioner.</p>}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setVersionDialogOpen(false)}>Annuller</Button>
                        <Button onClick={markAsPreviousVersion} disabled={!currentVersionId || versionSaving}>{versionSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Gem version</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Kontraktens versionshistorik</DialogTitle>
                        <DialogDescription>Den aktuelle kontrakt vises øverst. Tidligere versioner er bevaret, men vises ikke som selvstændige opslag i kontraktarkivet.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                        {versionHistoryLoading ? (
                            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                        ) : versionHistory.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">Ingen tidligere versioner fundet.</p>
                        ) : versionHistory.map((version, index) => (
                            <div key={version.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium">{version.working_title ?? editContract?.work_title ?? "Kontrakt"}</p>
                                        <Badge variant={index === 0 ? "default" : "outline"}>{index === 0 ? "Aktuel version" : `Tidligere version ${versionHistory.length - index}`}</Badge>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {version.contract_date ? `Kontraktdato ${new Date(version.contract_date).toLocaleDateString("da-DK")}` : `Oprettet ${new Date(version.created_at).toLocaleDateString("da-DK")}`}
                                        {version.superseded_at ? ` · erstattet ${new Date(version.superseded_at).toLocaleDateString("da-DK")}` : ""}
                                    </p>
                                </div>
                                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void openContractVersion(version)} disabled={!version.pdf_url && !version.processed_pdf_url}>
                                    <Eye className="h-4 w-4" />Åbn dokument
                                </Button>
                            </div>
                        ))}
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setVersionHistoryOpen(false)}>Luk</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editContract} onOpenChange={o => { if (!o && !editSaving) { closeEditDialog() } }}>
                <DialogContent
                    ref={editDialogRef}
                    className="top-2 bottom-2 flex h-auto max-h-none min-h-0 w-full max-w-[95vw] flex-col gap-3 overflow-hidden p-4 sm:top-[50%] sm:bottom-auto sm:h-[92vh] sm:max-h-[92vh] sm:max-w-4xl sm:gap-4 sm:p-6 lg:max-w-[1180px]"
                    style={{ overflow: "hidden" }}
                    onOpenAutoFocus={event => event.preventDefault()}
                >
                    <DialogHeader className="shrink-0 pr-8 text-left">
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
                    <div className="shrink-0 border-b pb-3">
	                    <div className="flex flex-wrap gap-2">
	                        <Button type="button" variant="outline" size="sm" onClick={closeEditDialog} disabled={editSaving}>
	                            {t("common.cancel")}
	                        </Button>
	                        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => handleSaveEdit(undefined, { saveOnly: true })} disabled={editSaving}>
	                            {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
	                            {t("admin.contracts.saveContract")}
	                        </Button>
	                        <Button type="button" size="sm" className="gap-2" onClick={handleValidateAndNext} disabled={editSaving}>
	                            {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
	                            {t("admin.contracts.validate")}
	                        </Button>
                        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleArchiveEdit} disabled={editSaving}>
                            <Archive className="h-4 w-4" />
                            Arkiver
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => { setCurrentVersionId(""); setVersionDialogOpen(true) }} disabled={editSaving}>
                            Markér som tidligere version
                        </Button>
                        {Boolean(editContract?.previous_version_count) && (
                            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void showVersionHistory()} disabled={editSaving}>
                                <FileText className="h-4 w-4" />Versionshistorik
                            </Button>
                        )}
                        {editContract?.pdf_url && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2 md:hidden"
                                onClick={() => {
                                    if (editDocUrl) window.open(editDocUrl, "_blank", "noopener,noreferrer")
                                    else void openPdf(editContract)
                                }}
                                disabled={editSaving}
                            >
                                <Eye className="h-4 w-4" />
                                Åbn PDF
                            </Button>
                        )}
                        <Button type="button" variant="destructive" size="sm" className="gap-2" onClick={handleDeleteEdit} disabled={editSaving}>
                            <Trash2 className="h-4 w-4" />
                            Slet
                        </Button>
	                    </div>
                        {!editForm?.work_id && (
                            <p className="mt-2 text-xs text-amber-600">Hvis du validerer uden et værk tilknyttet, bliver du spurgt om der skal oprettes et nyt værk med arbejdstitlen.</p>
                        )}
                        {(editContract?.ai_job_error || editDocumentError) && (
                            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
                                <p className="font-medium">Kontrakten kræver manuel kontrol</p>
                                <p className="mt-0.5">{editContract?.ai_job_error ?? editDocumentError}</p>
                            </div>
                        )}
                    </div>
                    {editForm && (
                        <div ref={editDialogScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:grid md:grid-cols-[1.05fr_1fr] md:gap-4 md:overflow-hidden">
                            <div className="hidden h-full min-h-0 overflow-hidden rounded-md border md:block">
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
                            <div className="space-y-4 py-2 pr-1 md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs">Rettighedshaver</Label>
                                        {!editForm.rights_holder_id && navneTjekLoading && <span className="text-[10px] text-muted-foreground animate-pulse">Tjekker register...</span>}
                                    </div>
                                    <div className="space-y-2">
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
                                        ) : <>
                                        {navneTjekResult && (
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
                                                        className="mt-1.5 h-6 text-[10px]"
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
                                                }}
                                            />
                                        </div>
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
                                        </>}
                                    </div>
                                </div>
                                <div className="space-y-1 sm:col-span-2">
                                    <ProductionCompanyPicker
                                        value={editProducerSelections}
                                        onChange={selections => {
                                            setEditProducerSelections(selections)
                                            setEditForm(form => form && ({ ...form, employer_id: selections[0]?.employerId ?? "" }))
                                        }}
                                        label="Producent"
                                        canManageRegistry
                                        suggestedNames={extractedProductionCompanyNames(editContract?.validation_data)}
                                    />
                                </div>
                                <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
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
                                                    setPickedUnifiedResult(null)
                                                    setManualWorkMode(false)
                                                    setAddSeason("1")
                                                    setSelectedEpisodes([])
                                                    setEpisodeOptions([])
                                                    setDetectedEpisodeCount(null)
                                                    setEpisodesError(null)
                                                }}
                                            >
                                                Fjern kobling
                                            </Button>
                                        )}
                                        {!editForm.work_id && !pickedUnifiedResult && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7 px-2 text-xs"
                                                onClick={() => {
                                                    setManualWorkMode(current => {
                                                        const next = !current
                                                        if (next) {
                                                            const data = editContract?.validation_data ?? {}
                                                            const seed = contractDataToManualWorkSeed({
                                                                title: typeof data.workTitle === "string" ? data.workTitle : editWorkSearch.trim() || editForm.working_title,
                                                                category: typeof data.productionType === "string" ? data.productionType : null,
                                                                duration: typeof data.duration === "string" || typeof data.duration === "number" ? data.duration : null,
                                                                premiereDate: typeof data.premiereDate === "string" ? data.premiereDate : null,
                                                                premiereYear: typeof data.premiereYear === "string" || typeof data.premiereYear === "number" ? data.premiereYear : null,
                                                                productionCompany: editProducerSelections[0]?.canonicalName ?? extractedProductionCompanyNames(data)[0] ?? null,
                                                                director: typeof data.director === "string" ? data.director : null,
                                                                seasonNumber: typeof data.seasonNumber === "string" || typeof data.seasonNumber === "number" ? data.seasonNumber : null,
                                                                contractId: editContract?.id,
                                                            })
                                                            setManualWork(work => emptyManualWorkForm({
                                                                ...seed,
                                                                title: work.title || seed.title,
                                                                type: work.type !== "spillefilm" || !data.productionType ? work.type : seed.type,
                                                                year: work.year || seed.year,
                                                                duration_minutes: work.duration_minutes || seed.duration_minutes,
                                                                episode_count: work.episode_count || seed.episode_count,
                                                                season_number: work.season_number || seed.season_number,
                                                                episode_number: work.episode_number || seed.episode_number,
                                                                selected_episodes: work.selected_episodes.length ? work.selected_episodes : seed.selected_episodes,
                                                                director: work.director || seed.director,
                                                                production_company: editProducerSelections[0]?.canonicalName ?? seed.production_company,
                                                                production_companies: editProducerSelections.length ? editProducerSelections : work.production_companies,
                                                            }))
                                                        }
                                                        return next
                                                    })
                                                }}
                                            >
                                                {manualWorkMode ? "Tilbage til søgning" : "Indtast manuelt"}
                                            </Button>
                                        )}
                                    </div>
                                    {manualWorkMode ? (
                                        <div className="rounded-lg border bg-muted/20 p-3">
                                            <ManualWorkFormFields value={manualWork} onChange={setManualWork} locale="da" autoSelectProducer canManageProducerRegistry />
                                        </div>
                                    ) : editForm.work_id || pickedUnifiedResult ? (
                                        <div className="rounded-lg border bg-card p-3 text-card-foreground space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <p className="text-xs font-semibold text-foreground">
                                                        {works.find(w => w.id === editForm.work_id)?.title ?? pickedUnifiedResult?.title ?? editContract?.work_title ?? "Valgt værk"}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                                        {works.find(w => w.id === editForm.work_id)?.year ?? pickedUnifiedResult?.year ?? "-"} · {pickedUnifiedResult?.type ?? "værk"}
                                                    </p>
                                                </div>
                                            </div>

                                            {detailsLoading && (
                                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground justify-center py-2">
                                                    <Loader2 className="h-3 w-3 animate-spin" /> Indlæser detaljer...
                                                </div>
                                            )}

                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex flex-col gap-2 sm:flex-row">
                                                <div className="relative flex-1">
                                                    {isSearching ? (
                                                        <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                    ) : (
                                                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                                    )}
                                                    <Input className="h-8 pl-8 text-xs" placeholder="Søg i alle databaser..." value={editWorkSearch} onChange={e => setEditWorkSearch(e.target.value)} />
                                                </div>
                                                <Select value={editWorkTypeFilter} onValueChange={setEditWorkTypeFilter}>
                                                    <SelectTrigger className="h-8 text-xs sm:w-44"><SelectValue placeholder="Type" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">Type</SelectItem>
                                                        {WORK_TYPE_FILTERS.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            {unifiedResults.length > 0 && (
                                                <div className="max-h-40 space-y-1 overflow-y-auto border rounded-md p-1.5 bg-muted/40">
                                                    <p className="px-1 text-[10px] text-muted-foreground">{unifiedResults.filter(item => editWorkTypeFilter === "all" || item.type === editWorkTypeFilter).length} resultater</p>
                                                    {unifiedResults.filter(item => editWorkTypeFilter === "all" || item.type === editWorkTypeFilter).map(item => (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            className="flex w-full flex-col text-left text-xs px-2.5 py-1.5 rounded bg-background hover:bg-muted border transition-colors"
                                                            onClick={() => pickUnifiedResult(item)}
                                                        >
                                                            <div className="flex items-center justify-between gap-1 w-full font-medium">
                                                                <span className="truncate">{item.title}</span>
                                                                <span className="text-[9px] uppercase font-bold text-muted-foreground shrink-0">
                                                                    {item.sources.map(source => source === "local" ? "Findes allerede" : source).join(" · ")}
                                                                </span>
                                                            </div>
                                                            <span className="text-[10px] text-muted-foreground mt-0.5">
                                                                {item.year ?? "-"} · {item.type}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {editWorkSearch.trim() && unifiedResults.length === 0 && !isSearching && (
                                                <p className="px-1 py-2 text-xs text-muted-foreground">Ingen værker fundet.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                                    <div className="min-w-0 space-y-1">
                                        <Label className="text-xs">Kontrakttype</Label>
                                        <Select value={editForm.type} onValueChange={v => setEditForm(f => f && ({ ...f, type: v }))}>
                                            <SelectTrigger className="h-8 w-full min-w-0 text-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="a-løn">A-løn</SelectItem>
                                                <SelectItem value="leverandør">Leverandør</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="min-w-0 space-y-1">
                                        <Label className="text-xs">Overenskomst</Label>
                                        <Select value={editForm.overenskomst} onValueChange={v => setEditForm(f => f && ({ ...f, overenskomst: v }))}>
                                            <SelectTrigger className="h-8 w-full min-w-0 text-xs"><SelectValue /></SelectTrigger>
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
                                </div>
                                {(editCopydanStatus === "yes" || editCopydanStatus === "implicit" || editStreamingStatus === "yes" || editStreamingStatus === "implicit") && (
                                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                                        {(editCopydanStatus === "yes" || editCopydanStatus === "implicit") && <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
                                            {editCopydanStatus === "implicit" ? "Copydan via overenskomst" : "Copydan-forbehold"}
                                        </Badge>}
                                        {(editStreamingStatus === "yes" || editStreamingStatus === "implicit") && <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">Streaming-forbehold</Badge>}
                                    </div>
                                )}
                            </div>
                            {editContract && (
                                <ContractAiDataEditor
                                    key={editContract.id}
                                    contractId={editContract.id}
                                    activeHighlight={activeHighlight}
                                    onHighlightClick={(quote) => setActiveHighlight(quote)}
                                    rereadLoading={editSaving}
                                    onReread={handleRunAiDatamining}
                                    dates={{ contractDate: editForm.contract_date, startDate: editForm.start_date, endDate: editForm.end_date }}
                                    onDatesChange={dates => setEditForm(form => form && ({ ...form, contract_date: dates.contractDate, start_date: dates.startDate, end_date: dates.endDate }))}
                                    isSeries={pickedUnifiedResult?.type === "tv-serie" || pickedUnifiedResult?.type === "dokumentar-serie"}
                                    season={Number(addSeason) || 1}
                                    onSeasonChange={season => { setAddSeason(String(season)); setSelectedEpisodes([]) }}
                                    episodeOptions={buildCompleteEpisodeOptions({ episodeCount: detectedEpisodeCount, externalOptions: episodeOptions, seasonNumber: Number(addSeason) || 1 })}
                                    selectedEpisodes={selectedEpisodes}
                                    onSelectedEpisodesChange={setSelectedEpisodes}
                                    episodesLoading={episodesLoading}
                                    episodesError={episodesError}
                                    onSeriesOpen={() => setSeriesSectionRequested(true)}
                                    onValidationChange={patch => setEditContract(contract => contract ? ({ ...contract, validation_data: { ...(contract.validation_data ?? {}), ...patch } }) : contract)}
                                    workingTitle={editForm.working_title}
                                    onWorkingTitleChange={value => setEditForm(form => form && ({ ...form, working_title: value }))}
                                    registerFlush={handler => { flushAiEditorRef.current = handler }}
                                />
                            )}
                            {(editContract?.contract_attachments?.length ?? 0) > 0 && <div className="rounded-md border p-3"><h3 className="mb-2 text-sm font-semibold">Allonger</h3><div className="space-y-2">{editContract?.contract_attachments?.map(attachment => <div key={attachment.id} className="rounded-md bg-muted p-2 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{attachment.title ?? "Allonge"}</span><Badge variant={attachment.ai_status === "fejl" ? "destructive" : attachment.ai_status === "klar" ? "default" : "secondary"}>{attachment.ai_status === "klar" ? "Indlæst" : attachment.ai_status === "fejl" ? "Fejl" : "Analyserer"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Indlæst, men ikke medregnet i rettighedsbetaling eller statistik.</p></div>)}</div></div>}
                            <MessageThread
                                title="Beskeder"
                                messages={contractMessages(editContract?.contract_comments ?? [])}
                                viewerRole="admin"
                                memberLabel="Medlem"
                                adminLabel="DFKS"
                                emptyText=""
                                nextActionLabel={adminContractNextAction(editContract)}
                                nextActionTone={adminContractNextActionTone(editContract)}
                                composerValue={adminReply}
                                onComposerChange={setAdminReply}
                                onSend={handleAdminReply}
                                composerLoading={replySaving}
                                composerPlaceholder="Skriv besked"
                                sendLabel="Send besked"
                                onDeleteMessage={async messageId => {
                                    if (!editContract) return
                                    await deleteAdminMessage({ kind: "contract", threadId: editContract.id, messageId })
                                    setEditContract(prev => prev ? { ...prev, contract_comments: prev.contract_comments.filter(comment => comment.id !== messageId) } : prev)
                                    setContracts(prev => prev.map(contract => contract.id === editContract.id ? { ...contract, contract_comments: contract.contract_comments.filter(comment => comment.id !== messageId) } : contract))
                                }}
                                onClearThread={async () => {
                                    if (!editContract) return
                                    await clearAdminMessageThread({ kind: "contract", threadId: editContract.id })
                                    setEditContract(prev => prev ? { ...prev, contract_comments: [] } : prev)
                                    setContracts(prev => prev.map(contract => contract.id === editContract.id ? { ...contract, contract_comments: [] } : contract))
                                }}
                            />
                        </div>
                        </div>
                    )}
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

function AdminKontrakterPageInner() {
    const searchParams = useSearchParams()
    const requestedTab = searchParams.get("tab")
    const initialTab = requestedTab === "valideringskoe" ? "valideringskoe" : requestedTab === "upload" ? "upload" : "arkiv"
    const [activeTab, setActiveTab] = useState<"arkiv" | "valideringskoe" | "upload">(initialTab)
    const [køCount, setKøCount] = useState<number>(0)

    useEffect(() => {
        async function fetchKøCount() {
            const contextRes = await fetch("/api/admin/context", { cache: "no-store" })
            const context = contextRes.ok ? await contextRes.json() as { orgId?: string } : null
            if (!context?.orgId) return
            const { createClient } = await import("@/lib/supabase/client")
            const supabase = createClient()
            const { count } = await supabase
                .from("contracts")
                .select("id", { count: "exact", head: true })
                .eq("org_id", context.orgId)
                .eq("status", "kladde")
            setKøCount(count ?? 0)
        }
        void fetchKøCount()
    }, [])

    return (
        <div className="space-y-6">
            <PageHeader
                title="Kontraktarkiv"
                subtitle="Oversigt, upload og validering af kontrakter"
            />
            <div className="flex gap-0 border-b">
                <button
                    type="button"
                    onClick={() => setActiveTab("arkiv")}
                    className={[
                        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                        activeTab === "arkiv"
                            ? "border-foreground text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                >
                    Arkiv
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("valideringskoe")}
                    className={[
                        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                        activeTab === "valideringskoe"
                            ? "border-foreground text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                >
                    Valideringskø
                    {køCount > 0 && (
                        <span className="ml-2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 px-2 py-0.5 text-xs font-semibold">
                            {køCount}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("upload")}
                    className={[
                        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                        activeTab === "upload"
                            ? "border-foreground text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                >
                    Kontraktupload
                </button>
            </div>
            {activeTab === "arkiv"
                ? <Suspense><AdminKontrakterContent view="archive" /></Suspense>
                : activeTab === "upload"
                    ? <Suspense><AdminKontrakterContent view="upload" /></Suspense>
                    : <ValideringskøTab onAfventerCount={setKøCount} />
            }
        </div>
    )
}

export default function AdminKontrakterPage() {
    return <Suspense><AdminKontrakterPageInner /></Suspense>
}
