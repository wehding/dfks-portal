"use client"

import { useEffect, useState, useMemo, Suspense, useRef } from "react"
import Link from "next/link"
import {
    Search, Trash2, Eye, Upload, MoreHorizontal, FileText,
    CheckCircle2, AlertCircle, Loader2, X, Pencil, MessageSquare,
    AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { addAdminContractComment, deleteAdminContractsPermanently, markContractCommentsRead } from "@/app/actions/member-contracts"
import { ContractAiDataEditor } from "./ContractAiDataEditor"
import { ContractDocViewer } from "./ContractDocViewer"
import { maskPersonalData } from "@/lib/mask-text"
import { useI18n } from "@/lib/i18n"
import { PdfViewer } from "@/components/pdf-viewer"
import { normaliseSources } from "@/lib/ai-sources"
import { PageHeader } from "@/components/page-header"
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
    working_title: string | null
    work_title: string | null
    contract_comments: ContractComment[]
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
    working_title: string
}

type DfiCompany = { id: number; name: string }
type Employer = { id: string; name: string; parent_id: string | null; dfi_company_id: number | null }
type RightsHolder = { id: string; full_name: string }
type SortKey = "production" | "rightsHolder" | "employer" | "type" | "overenskomst" | "period" | "status"
type SortDir = "asc" | "desc"

// ── Fuzzy name matching ───────────────────────────────────────

const LEGAL_SUFFIXES = /\b(aps|a\/s|as|ivs|i\/s|fmba|smba|productions?|film|media|company|group|entertainment|studios?|international|denmark|dk)\b/g

function nameTokens(name: string): string[] {
    return name
        .toLowerCase()
        .replace(LEGAL_SUFFIXES, "")
        .replace(/[^a-zæøå0-9\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(t => t.length > 1)
}

function tokenOverlapScore(a: string, b: string): number {
    const ta = new Set(nameTokens(a))
    const tb = new Set(nameTokens(b))
    if (ta.size === 0 || tb.size === 0) return 0
    let overlap = 0
    for (const t of ta) { if (tb.has(t)) overlap++ }
    return overlap / Math.min(ta.size, tb.size)
}

type ExtractedData = {
    employerName: string | null
    parentCompanyName: string | null
    rightsHolderName: string | null
    workTitle: string | null
    contractType: string | null
    overenskomst: string | null
    contractDate: string | null
    startDate: string | null
    endDate: string | null
    [key: string]: string | null
}

type RhMatch = { id: string; full_name: string; score: number }

type ValidationForm = {
    producerName: string; productionType: string
    salary: string; salaryUnit: string
    startDate: string; endDate: string
    pensionPercent: string; pensionSupplement: string
    personalSupplement: string; otherSupplements: string
    workingWeeks: string
    svod: boolean; copydan: boolean; royalty: boolean; royaltyPercent: string
    aiDataMiningClause: boolean; distribution: string
    collectiveAgreement: boolean; collectiveAgreementName: string
    collectiveAgreementByReference: boolean; isFreelanceContract: boolean
    gender: string; holidayPayRate: string; betaRate: string; specialNotes: string
}

type UploadItem = {
    file: File
    status: "pending" | "uploading" | "extracting" | "done" | "error"
    error?: string
    extracted?: ExtractedData
    form?: ValidationForm
    sources?: Record<string, string | null>
    // resolved IDs after review
    employerId?: string
    employerMatchConfidence?: "exact" | "fuzzy" | "none"
    parentEmployerId?: string
    dfiMatches?: DfiCompany[]
    selectedDfiParent?: DfiCompany
    // "__new__" = opret ny, undefined = ikke valgt, string = eksisterende ID
    rightsHolderId?: string
    rhFuzzyMatches?: RhMatch[]
    rhMatchConfidence?: "exact" | "fuzzy" | "none"
    saveAsValidated?: boolean
    previewText?: string      // Udtrukket tekst til visning (DOCX/TXT)
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

const OVERENSKOMST_LABELS: Record<string, string> = {
    "de4-fiktion": "De4 (fiktion)",
    "faf": "FAF (fiktion)",
    "faf-dokumentar": "FAF (dokumentar)",
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

function AdminKontrakterContent() {
    const { t } = useI18n()
    const [contracts, setContracts] = useState<ContractRow[]>([])
    const [employers, setEmployers] = useState<Employer[]>([])
    const [rightsHolders, setRightsHolders] = useState<RightsHolder[]>([])
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
    const [adminReply, setAdminReply] = useState("")
    const [replySaving, setReplySaving] = useState(false)

    // View dialog
    const [viewContract, setViewContract] = useState<ContractRow | null>(null)
    const [viewPdfUrl, setViewPdfUrl] = useState<string | null>(null)
    const [editDocUrl, setEditDocUrl] = useState<string | null>(null)

    // Edit dialog
    const [editContract, setEditContract] = useState<ContractRow | null>(null)
    const [editForm, setEditForm] = useState<EditForm | null>(null)
    const [editSaving, setEditSaving] = useState(false)

    // Upload flow
    const [showUpload, setShowUpload] = useState(false)
    const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
    const [uploadPhase, setUploadPhase] = useState<"select" | "processing">("select")
    const [saving, setSaving] = useState(false)
    const prefillWorkIdRef = useRef<string | null>(null)

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


    // Masking dialog
    const [maskDialog, setMaskDialog] = useState<{ idx: number; preview: { count: number; types: string[] }; maskedText: string } | null>(null)
    const [maskEditorText, setMaskEditorText] = useState("")
    const [showMaskEditor, setShowMaskEditor] = useState(false)
    const maskResolveRef = useRef<((text: string | null) => void) | null>(null)

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

                const [contractsRes, employersRes, rhRes] = await Promise.all([
                    supabase
                        .from("contracts")
                        .select(`
                            id, type, overenskomst, status, pdf_url,
                            contract_date, start_date, end_date, created_at,
                            employer_id, rights_holder_id, working_title,
                            employers (name),
                            rettighedshavere (full_name),
                            works (title)
                        `)
                        .eq("org_id", resolvedOrgId)
                        .order("created_at", { ascending: false }),
                    supabase.from("employers").select("id, name, parent_id, dfi_company_id").order("name"),
                    supabase
                        .from("rettighedshavere")
                        .select("id, full_name, org_affiliations!inner(org_id)")
                        .eq("org_affiliations.org_id", resolvedOrgId)
                        .order("full_name"),
                ])

                if (contractsRes.error) console.error("Kontrakter query fejl:", contractsRes.error.message)
                if (contractsRes.data) {
                    const rawContracts = contractsRes.data as unknown as Array<{ id: string; type: string; overenskomst: string | null; status: string; pdf_url: string; contract_date: string | null; start_date: string | null; end_date: string | null; created_at: string; employer_id?: string | null; employers?: { name?: string | null } | null; rights_holder_id?: string | null; rettighedshavere?: { full_name?: string | null } | null; working_title?: string | null; works?: { title?: string | null } | null }>
                    const commentsByContract: Record<string, ContractComment[]> = {}
                    if (rawContracts.length > 0) {
                        const commentsRes = await supabase
                            .from("contract_comments")
                            .select("id, contract_id, author_role, message, created_at, member_read_at, admin_read_at")
                            .in("contract_id", rawContracts.map(r => r.id))
                            .order("created_at", { ascending: true })
                        if (commentsRes.data) {
                            for (const comment of commentsRes.data as unknown as Array<ContractComment & { contract_id: string }>) {
                                if (!commentsByContract[comment.contract_id]) commentsByContract[comment.contract_id] = []
                                commentsByContract[comment.contract_id].push(comment)
                            }
                        }
                    }
                    setContracts(rawContracts.map((r) => ({
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
                        working_title: r.working_title ?? null,
                        work_title: r.works?.title ?? null,
                        contract_comments: commentsByContract[r.id] ?? [],
                    })))
                }
                if (employersRes.data) setEmployers(employersRes.data)
                if (rhRes.data) setRightsHolders(rhRes.data.map((r: { id: string; full_name: string }) => ({ id: r.id, full_name: r.full_name })))
            } catch (e) {
                console.error("Load fejl:", e)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

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
        setUploadItems(files.map(f => ({ file: f, status: "pending" })))
    }

    // ── Upload: extract + gem automatisk (ingen review-trin) ──────

    const handleExtractAndSave = async () => {
        if (uploadItems.length === 0 || !orgId) return
        setUploadPhase("processing")
        setSaving(true)
        const supabase = createClient()
        const saved: ContractRow[] = []
        const updated = [...uploadItems]

        for (let i = 0; i < updated.length; i++) {
            updated[i] = { ...updated[i], status: "extracting" }
            setUploadItems([...updated])

            try {
                // 1. Udtræk tekst + maskeringsdialog
                const { extractTextFromFile } = await import("@/lib/ai")
                const rawText = await extractTextFromFile(updated[i].file)
                const maskedText = await awaitMaskConfirm(i, rawText)
                if (maskedText === null) {
                    updated[i] = { ...updated[i], status: "error", error: "Maskering afbrudt" }
                    setUploadItems([...updated])
                    continue
                }

                updated[i] = { ...updated[i], status: "extracting" }
                setUploadItems([...updated])

                // 2. AI-udtræk
                const fd = new FormData()
                fd.append("maskedText", maskedText)
                const res = await fetch("/api/contracts/extract", { method: "POST", body: fd })
                const json = await res.json()
                if (!res.ok || !json.ok) throw new Error(json.error ?? "AI-udtræk fejlede")
                const ext = json.data

                // 3. Auto-match employer — KUN eksakt match, ingen auto-oprettelse
                // Fuzzy og ny producent kobles manuelt i Validering
                let employerId: string | null = null
                if (ext.employerName) {
                    const exact = employers.find(e => e.name.toLowerCase() === ext.employerName.toLowerCase())
                    if (exact) employerId = exact.id
                    // Ingen eksakt match → employer_id forbliver null, kobles i validering
                }

                // 4. Auto-match rettighedshaver (kun eksakt)
                let rhId: string | null = null
                if (ext.rightsHolderName) {
                    const exactRH = rightsHolders.find(r => r.full_name.toLowerCase() === ext.rightsHolderName.toLowerCase())
                    if (exactRH) rhId = exactRH.id
                    // Ingen eksakt match → link manuelt i validering
                }

                // 5. Upload PDF
                const filePath = `${orgId}/${Date.now()}_${updated[i].file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
                const { error: storageErr } = await supabase.storage.from("kontrakter").upload(filePath, updated[i].file, { contentType: updated[i].file.type })
                if (storageErr) throw new Error(`Upload fejl: ${storageErr.message}`)

                // 6. Gem kontrakt — fallback uden employer_id hvis FK fejler (stale cache)
                let { data: newContract, error: contractErr } = await supabase.from("contracts").insert({
                    org_id: orgId,
                    employer_id: employerId,
                    rights_holder_id: rhId,
                    type: ext.contractType ?? "a-løn",
                    overenskomst: ext.overenskomst ?? null,
                    status: "kladde",
                    pdf_url: filePath,
                    working_title: ext.workTitle ?? null,
                    work_id: prefillWorkIdRef.current,
                    contract_date: ext.contractDate ?? null,
                    start_date: ext.startDate ?? null,
                    end_date: ext.endDate ?? null,
                }).select().single()

                // FK-fejl på employer_id (slettet fra DB siden siden sidst): prøv uden
                if (contractErr?.code === "23503" && employerId) {
                    const retry = await supabase.from("contracts").insert({
                        org_id: orgId,
                        employer_id: null,
                        rights_holder_id: rhId,
                        type: ext.contractType ?? "a-løn",
                        overenskomst: ext.overenskomst ?? null,
                        status: "kladde",
                        pdf_url: filePath,
                        working_title: ext.workTitle ?? null,
                        work_id: prefillWorkIdRef.current,
                        contract_date: ext.contractDate ?? null,
                        start_date: ext.startDate ?? null,
                        end_date: ext.endDate ?? null,
                    }).select().single()
                    newContract = retry.data
                    contractErr = retry.error
                    // Ryd stale employer fra lokal state
                    setEmployers(prev => prev.filter(e => e.id !== employerId))
                }

                if (contractErr) throw new Error(`Kontrakt fejl: ${contractErr.message}`)

                if (newContract) {
                    // 7. Gem extracted data til validering
                    await supabase.from("contract_validations").insert({
                        contract_id: newContract.id,
                        org_id: orgId,
                        holiday_pay_rate: ext.holidayPayRate ?? null,
                        beta_rate: ext.betaRate ?? null,
                        has_credit_clause: ext.hasCreditClause ?? false,
                        has_termination_clause: ext.hasTerminationClause ?? false,
                        termination_days_editor: ext.terminationDaysEditor ?? null,
                        termination_days_producer: ext.terminationDaysProducer ?? null,
                        has_indemnification: ext.hasIndemnification ?? false,
                        has_overenskomst_incorporation: ext.hasOverenskomstIncorporation ?? false,
                        extracted_data: ext,
                    })
                    saved.push({
                        id: newContract.id, type: newContract.type, overenskomst: newContract.overenskomst,
                        status: newContract.status, pdf_url: newContract.pdf_url,
                        contract_date: newContract.contract_date, start_date: newContract.start_date,
                        end_date: newContract.end_date, created_at: newContract.created_at,
                        employer_id: employerId, rights_holder_id: rhId,
                        working_title: newContract.working_title,
                        employer_name: ext.employerName ?? null, rights_holder_name: ext.rightsHolderName ?? null, work_title: null,
                        contract_comments: [],
                    })
                }

                updated[i] = { ...updated[i], status: "done" }
            } catch (err: unknown) {
                updated[i] = { ...updated[i], status: "error", error: err instanceof Error ? err.message : String(err) }
            }
            setUploadItems([...updated])
        }

        setContracts(prev => [...saved, ...prev])
        setSaving(false)
        const doneCount = updated.filter(i => i.status === "done").length
        const errCount  = updated.filter(i => i.status === "error").length
        if (doneCount > 0) {
            toast.success(`${doneCount} kontrakt${doneCount !== 1 ? "er" : ""} gemt som kladde — gennemgå i Validering`)
            window.dispatchEvent(new CustomEvent("contracts-updated"))
        }
        if (errCount  > 0) toast.error(`${errCount} kontrakt${errCount !== 1 ? "er" : ""} fejlede`)
        if (errCount === 0) {
            setShowUpload(false)
            setUploadItems([])
            setUploadPhase("select")
        }
    }

    const initForm = (ext: ExtractedData): ValidationForm => ({
        producerName: ext.producerName ?? "",
        productionType: ext.productionType ?? "",
        salary: ext.salary != null ? String(ext.salary) : "",
        salaryUnit: ext.salaryUnit ?? "monthly",
        startDate: ext.startDate ?? "",
        endDate: ext.endDate ?? "",
        pensionPercent: ext.pensionPercent != null ? String(ext.pensionPercent) : "",
        pensionSupplement: ext.pensionSupplement != null ? String(ext.pensionSupplement) : "",
        personalSupplement: ext.personalSupplement != null ? String(ext.personalSupplement) : "",
        otherSupplements: ext.otherSupplements ?? "",
        workingWeeks: ext.workingWeeks != null ? String(ext.workingWeeks) : "",
        svod: !!ext.svod, copydan: !!ext.copydan, royalty: !!ext.royalty,
        royaltyPercent: ext.royaltyPercent != null ? String(ext.royaltyPercent) : "",
        aiDataMiningClause: !!ext.aiDataMiningClause,
        distribution: Array.isArray(ext.distribution) ? ext.distribution.join(", ") : (ext.distribution ?? ""),
        collectiveAgreement: !!ext.collectiveAgreement,
        collectiveAgreementName: ext.collectiveAgreementName ?? "",
        collectiveAgreementByReference: !!ext.collectiveAgreementByReference,
        isFreelanceContract: !!ext.isFreelanceContract,
        gender: ext.gender ?? "",
        holidayPayRate: ext.holidayPayRate != null ? String(ext.holidayPayRate) : "",
        betaRate: ext.betaRate != null ? String(ext.betaRate) : "",
        specialNotes: ext.specialNotes ?? "",
    })


    // ── Masking helpers ───────────────────────────────────────

    const awaitMaskConfirm = (idx: number, rawText: string): Promise<string | null> => {
        return new Promise((resolve) => {
            const masked: string = maskPersonalData(rawText)
            const types: string[] = []
            if (masked.includes("[CPR-NUMMER]")) types.push("CPR-numre")
            if (masked.includes("[KONTONUMMER]") || masked.includes("[IBAN]")) types.push("kontonumre")
            if (masked.includes("[TELEFON]")) types.push("telefonnumre")
            if (masked.includes("[EMAIL]")) types.push("email-adresser")
            if (masked.includes("[ADRESSE]")) types.push("adresser")
            if (masked.includes("[POSTNR-BY]")) types.push("postnumre")
            if (masked.includes("[CVR-NUMMER]")) types.push("CVR-numre")
            const count = (masked.match(/\[(?:CPR-NUMMER|KONTONUMMER|IBAN|TELEFON|EMAIL|ADRESSE|POSTNR-BY|CVR-NUMMER)\]/g) || []).length
            maskResolveRef.current = resolve
            setMaskEditorText(masked)
            setMaskDialog({ idx, preview: { count, types }, maskedText: masked })
        })
    }

    const handleMaskConfirm = () => {
        if (maskResolveRef.current) { maskResolveRef.current(maskEditorText); maskResolveRef.current = null }
        setMaskDialog(null)
    }

    const handleMaskCancel = () => {
        if (maskResolveRef.current) { maskResolveRef.current(null); maskResolveRef.current = null }
        setMaskDialog(null)
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
        setSaving(true)
        const supabase = createClient()
        try {
            const { error } = await supabase
                .from("contracts")
                .update({ status: "valideret" })
                .in("id", selectedIds)
            if (error) throw new Error(error.message)
            setContracts(prev => prev.map(c => selectedIds.includes(c.id) ? { ...c, status: "valideret" } : c))
            toast.success(`${selectedIds.length} kontrakt(er) er godkendt`)
            setSelectedIds([])
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Kunne ikke godkende kontrakter")
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

    const openEdit = (c: ContractRow) => {
        setEditContract(c)
        setAdminReply("")
        void markAdminCommentsRead(c)
        // Auto-hent dokument-URL så kontrakten vises til venstre uden knap-tryk
        setEditDocUrl(null)
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
            working_title: c.working_title ?? "",
        })
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

    const handleSaveEdit = async (statusOverride?: "kladde" | "valideret" | "arkiveret") => {
        if (!editContract || !editForm) return
        setEditSaving(true)
        const supabase = createClient()
        try {
            const newStatus = statusOverride ?? editForm.status
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
                working_title: editForm.working_title || null,
            } : c))
            setEditContract(null)
            setEditForm(null)
            toast.success(newStatus === "valideret" ? "Kontrakt valideret" : "Kontrakt gemt")
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Opdatering fejlede")
        } finally {
            setEditSaving(false)
        }
    }

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
    }

    // ── Filter ────────────────────────────────────────────────

    const filtered = useMemo(() => {
        let list = [...contracts]
        if (filterStatus === "beskeder") list = list.filter(c => c.contract_comments.some(comment => comment.author_role === "member" && !comment.admin_read_at))
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
    }, [contracts, filterStatus, filterType, search, sortDir, sortKey])
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
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5" asChild>
                            <Link href="/admin/validering">
                                <CheckCircle2 className="h-4 w-4" />
                                Valideringskø
                            </Link>
                        </Button>
                        <Button size="sm" className="gap-1.5" onClick={() => { setShowUpload(true); setUploadPhase("select"); setUploadItems([]) }}>
                            <Upload className="h-4 w-4" />
                            Upload kontrakter
                        </Button>
                    </div>
                }
            />

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Søg titel, klipper, producent..." className="w-[280px] pl-8 pr-8" value={search} onChange={e => setSearch(e.target.value)} />
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
                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle status</SelectItem>
                        <SelectItem value="kladde">Kladde</SelectItem>
                        <SelectItem value="valideret">Valideret</SelectItem>
                        <SelectItem value="arkiveret">Arkiveret</SelectItem>
                        <SelectItem value="beskeder">Beskeder</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle typer</SelectItem>
                        <SelectItem value="a-løn">A-løn</SelectItem>
                        <SelectItem value="leverandør">Leverandør</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" className="gap-2" onClick={() => setDuplicatesOpen(true)}>
                    <Search className="h-4 w-4" />
                    Find dubletter
                </Button>
                <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
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
                        Godkend valgte
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
            <div className="rounded-lg border">
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
                                            <button type="button" onClick={() => openEdit(c)} className="text-left underline-offset-4 hover:underline">
                                                {c.work_title ?? c.working_title ?? <span className="text-muted-foreground">—</span>}
                                            </button>
                                            {unreadMemberComments > 0 && (
                                                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
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
                                        <Badge className={`font-normal ${STATUS_CLASS[c.status] ?? ""}`}>
                                            {STATUS_LABELS[c.status] ?? c.status}
                                        </Badge>
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
            </div>

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
                                ? "Vælg filer — AI trækker data ud og gemmer som kladde. Gennemgå og godkend i Validering."
                                : "Analyserer og gemmer..."}
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
                                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX eller TXT — flere filer ad gangen</p>
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
                        </div>
                    )}

                    {/* Phase: processing */}
                    {uploadPhase === "processing" && (() => {
                        return (
                            <div className="py-2 space-y-2">
                                {uploadItems.map((item, i) => (
                                    <div key={i} className="flex items-center gap-2.5 rounded-md border p-3">
                                        {item.status === "pending"    && <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                                        {item.status === "extracting" && <Loader2  className="h-4 w-4 animate-spin text-primary shrink-0" />}
                                        {item.status === "extracting"     && <Loader2  className="h-4 w-4 animate-spin text-primary shrink-0" />}
                                        {item.status === "done"       && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                                        {item.status === "error"      && <AlertCircle  className="h-4 w-4 text-destructive shrink-0" />}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{item.file.name}</p>
                                            {item.status === "extracting" && <p className="text-xs text-muted-foreground">Analyserer...</p>}
                                            {item.status === "done"       && <p className="text-xs text-emerald-600">Gemt som kladde</p>}
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
                            <Button onClick={handleExtractAndSave} disabled={uploadItems.length === 0}>
                                {uploadItems.length > 0 ? `Analyser og gem (${uploadItems.length})` : "Analyser og gem"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit */}
            <Dialog open={!!editContract} onOpenChange={o => { if (!o && !editSaving) { setEditContract(null); setEditForm(null) } }}>
                <DialogContent className="w-[min(1180px,calc(100vw-2rem))] !max-w-none sm:!max-w-none">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="h-4 w-4" />Rediger kontrakt
                        </DialogTitle>
                        <DialogDescription>{editContract?.work_title ?? editContract?.working_title ?? editContract?.employer_name ?? "Kontrakt"}</DialogDescription>
                    </DialogHeader>
                    {editForm && (
                        <div className="grid gap-4 md:grid-cols-[1.05fr_1fr]">
                            <div className="hidden h-[72vh] overflow-hidden rounded-md border md:block">
                                {editContract?.pdf_url
                                    ? <ContractDocViewer url={editDocUrl} filename={editContract.pdf_url} />
                                    : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ingen fil på kontrakten</div>}
                            </div>
                            <div className="max-h-[72vh] space-y-4 overflow-y-auto py-2 pr-1">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label className="text-xs">Klipper / rettighedshaver</Label>
                                    <Select value={editForm.rights_holder_id || "__none__"} onValueChange={v => setEditForm(f => f && ({ ...f, rights_holder_id: v === "__none__" ? "" : v }))}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vælg..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">—</SelectItem>
                                            {rightsHolders.map(r => <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Producent (juridisk)</Label>
                                    <Select value={editForm.employer_id || "__none__"} onValueChange={v => setEditForm(f => f && ({ ...f, employer_id: v === "__none__" ? "" : v }))}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vælg..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">—</SelectItem>
                                            {employers.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
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
                            </div>
                            <div className="rounded-md border p-3">
                                <p className="mb-2 text-sm font-medium">AI-udtrukket data</p>
                                {editContract && <ContractAiDataEditor key={editContract.id} contractId={editContract.id} />}
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
                                    <Button type="button" variant="outline" onClick={handleAdminReply} disabled={replySaving || !adminReply.trim()}>
                                        {replySaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Send svar
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
                        <Button onClick={() => handleSaveEdit("valideret")} disabled={editSaving}>
                            {editSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Gemmer...</> : "Valider"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Masking confirm dialog */}
            <Dialog open={!!maskDialog} onOpenChange={() => handleMaskCancel()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Persondata maskeres inden AI-udtræk</DialogTitle>
                        <DialogDescription>
                            {maskDialog?.preview.count === 0
                                ? "Ingen personoplysninger fundet med automatisk detektion."
                                : `${maskDialog?.preview.count} forekomster maskeres: ${maskDialog?.preview.types.join(", ")}.`}
                        </DialogDescription>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground">
                        Automatisk maskering er ikke 100% pålidelig. Brug &quot;Rediger&quot; for at kontrollere teksten inden afsendelse.
                    </p>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button variant="outline" onClick={() => { setShowMaskEditor(true); setMaskDialog(null) }}>
                            Rediger maskeret tekst
                        </Button>
                        <Button onClick={handleMaskConfirm}>
                            Fortsæt med AI-udtræk
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Masking text editor */}
            <Dialog open={showMaskEditor} onOpenChange={() => setShowMaskEditor(false)}>
                <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Rediger maskeret tekst</DialogTitle>
                        <DialogDescription>
                            Erstat eventuelt resterende følsomme oplysninger manuelt med f.eks. [NAVN] eller [ADRESSE].
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        className="flex-1 font-mono text-xs resize-none rounded-md border p-3 focus:outline-none focus:ring-1 focus:ring-ring"
                        value={maskEditorText}
                        onChange={e => setMaskEditorText(e.target.value)}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowMaskEditor(false); handleMaskCancel() }}>Annuller</Button>
                        <Button onClick={() => { setShowMaskEditor(false); handleMaskConfirm() }}>Send til AI-udtræk</Button>
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

// ── DOCX tekst-viewer med highlight-support ───────────────────


function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
