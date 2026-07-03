"use client"

import { useEffect, useState, useMemo, Suspense, useRef } from "react"
import Link from "next/link"
import {
    Search, Trash2, Eye, Upload, MoreHorizontal, FileText,
    CheckCircle2, AlertCircle, Loader2, X, Pencil, Paperclip,
} from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { useI18n } from "@/lib/i18n"
import { PdfViewer } from "@/components/pdf-viewer"
import { SourceBtn } from "@/components/source-btn"
import { normaliseSources } from "@/lib/ai-sources"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
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
    contract_attachments: { id: string; type: string; title: string | null; pdf_url: string | null; created_at: string }[]
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
    [key: string]: any
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

    // View dialog
    const [viewContract, setViewContract] = useState<ContractRow | null>(null)
    const [viewPdfUrl, setViewPdfUrl] = useState<string | null>(null)
    const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null)

    // Edit dialog
    const [editContract, setEditContract] = useState<ContractRow | null>(null)
    const [editForm, setEditForm] = useState<EditForm | null>(null)
    const [editSaving, setEditSaving] = useState(false)

    // Upload flow
    const [showUpload, setShowUpload] = useState(false)
    const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
    const [uploadPhase, setUploadPhase] = useState<"select" | "processing">("select")
    const [saving, setSaving] = useState(false)

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
                    .select("org_id")
                    .eq("user_id", user.id)
                    .limit(1)
                if (roleRows?.[0]?.org_id) resolvedOrgId = roleRows[0].org_id
                setOrgId(resolvedOrgId)

                const [contractsRes, employersRes, rhRes] = await Promise.all([
                    supabase
                        .from("contracts")
                        .select(`
                            id, type, overenskomst, status, pdf_url,
                            contract_date, start_date, end_date, created_at,
                            employer_id, rights_holder_id, working_title,
                            employers (name),
                            rettighedshavere (full_name),
                            works (title),
                            contract_attachments (id, type, title, pdf_url, created_at)
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
                    setContracts(contractsRes.data.map((r: any) => ({
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
                        contract_attachments: r.contract_attachments ?? [],
                    })))
                }
                if (employersRes.data) setEmployers(employersRes.data)
                if (rhRes.data) setRightsHolders(rhRes.data.map((r: any) => ({ id: r.id, full_name: r.full_name })))
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

    const openAttachment = async (attachment: { id: string; pdf_url: string | null }) => {
        if (!attachment.pdf_url) return
        setOpeningAttachmentId(attachment.id)
        const supabase = createClient()
        const { data, error } = await supabase.storage.from("kontrakter").createSignedUrl(attachment.pdf_url, 3600)
        setOpeningAttachmentId(null)
        if (error || !data?.signedUrl) { toast.error("Kunne ikke åbne allongen"); return }
        window.open(data.signedUrl, "_blank")
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
                        contract_attachments: [],
                    })
                }

                updated[i] = { ...updated[i], status: "done" }
            } catch (err: any) {
                updated[i] = { ...updated[i], status: "error", error: err.message }
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

    const updateForm = (idx: number, key: keyof ValidationForm, value: any) => {
        setUploadItems(prev => prev.map((item, i) =>
            i === idx ? { ...item, form: { ...item.form!, [key]: value } } : item
        ))
    }

    // ── Masking helpers ───────────────────────────────────────

    const awaitMaskConfirm = (idx: number, rawText: string): Promise<string | null> => {
        return new Promise((resolve) => {
            const { maskPersonalData } = require("@/lib/mask-text")
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

    const handleExtract = async () => {
        if (uploadItems.length === 0) return
        setUploadPhase("processing")

        const updated = [...uploadItems]

        for (let i = 0; i < updated.length; i++) {
            updated[i] = { ...updated[i], status: "extracting" }
            setUploadItems([...updated])

            try {
                // Udtræk tekst klient-side og vis maskeringsdialog
                const { extractTextFromFile } = await import("@/lib/ai")
                const rawText = await extractTextFromFile(updated[i].file)
                const maskedText = await awaitMaskConfirm(i, rawText)

                // Gem råteksten til preview (kun DOCX/TXT)
                if (rawText && !updated[i].file.name.toLowerCase().endsWith(".pdf")) {
                    updated[i] = { ...updated[i], previewText: rawText }
                    setUploadItems([...updated])
                }

                if (maskedText === null) {
                    // Bruger annullerede
                    updated[i] = { ...updated[i], status: "error", error: "Maskering afbrudt" }
                    setUploadItems([...updated])
                    continue
                }

                // Send maskeret tekst til API
                const fd = new FormData()
                fd.append("maskedText", maskedText)
                const res = await fetch("/api/contracts/extract", { method: "POST", body: fd })
                const json = await res.json()

                if (!res.ok || !json.ok) {
                    updated[i] = { ...updated[i], status: "error", error: json.error ?? "Fejl" }
                } else {
                    const ext = json.data

                    // Employer: exact → fuzzy fallback
                    const exactEmployer = ext.employerName
                        ? employers.find(e => e.name.toLowerCase() === ext.employerName.toLowerCase())
                        : undefined
                    const fuzzyEmployer = !exactEmployer && ext.employerName
                        ? employers
                            .map(e => ({ e, score: tokenOverlapScore(e.name, ext.employerName!) }))
                            .filter(x => x.score >= 0.5)
                            .sort((a, b) => b.score - a.score)[0]?.e
                        : undefined
                    const matchedEmployer = exactEmployer ?? fuzzyEmployer
                    const confidence: UploadItem["employerMatchConfidence"] =
                        exactEmployer ? "exact" : fuzzyEmployer ? "fuzzy" : "none"

                    // Parent suggestion fra lokal DB
                    const parentSuggestion = ext.employerName
                        ? employers
                            .filter(e => e.id !== matchedEmployer?.id)
                            .map(e => ({ e, score: tokenOverlapScore(e.name, ext.employerName!) }))
                            .filter(x => x.score >= 0.3)
                            .sort((a, b) => b.score - a.score)[0]?.e
                        : undefined

                    // DFI-søgning: brug moderselskabsnavn fra header/footer først, ellers employer-navn
                    let dfiMatches: DfiCompany[] = []
                    const dfiSearchName = ext.parentCompanyName ?? ext.employerName
                    if (dfiSearchName) {
                        const tokens = nameTokens(dfiSearchName)
                        const searchTerm = tokens[0] ?? dfiSearchName.split(" ")[0]
                        try {
                            const dfiRes = await fetch(`/api/dfi/company?name=${encodeURIComponent(searchTerm)}`)
                            const dfiJson = await dfiRes.json()
                            if (dfiRes.ok) {
                                dfiMatches = dfiJson.companies ?? []
                            } else {
                                console.warn("DFI fejl:", dfiJson.error)
                            }
                        } catch (e) {
                            console.warn("DFI kald fejlede:", e)
                        }
                    }

                    // Auto-forslag til DFI-moderselskab: tag altid bedste DFI-match når resultater findes
                    const dfiParentSuggestion: DfiCompany | undefined = dfiSearchName && dfiMatches.length > 0
                        ? (dfiMatches
                            .map(c => ({ c, score: tokenOverlapScore(c.name, dfiSearchName) }))
                            .sort((a, b) => b.score - a.score)[0]?.c ?? dfiMatches[0])
                        : undefined

                    // Rights holder: exact match, then fuzzy
                    const exactRH = rightsHolders.find(r =>
                        ext.rightsHolderName && r.full_name.toLowerCase() === ext.rightsHolderName.toLowerCase()
                    )
                    const rhFuzzyMatches: RhMatch[] = !exactRH && ext.rightsHolderName
                        ? rightsHolders
                            .map(r => ({ id: r.id, full_name: r.full_name, score: tokenOverlapScore(r.full_name, ext.rightsHolderName!) }))
                            .filter(x => x.score >= 0.4)
                            .sort((a, b) => b.score - a.score)
                        : []
                    const rhConfidence: UploadItem["rhMatchConfidence"] =
                        exactRH ? "exact" : rhFuzzyMatches.length > 0 ? "fuzzy" : "none"

                    updated[i] = {
                        ...updated[i],
                        status: "done",
                        extracted: ext,
                        form: initForm(ext),
                        sources: ext._sources ? normaliseSources(ext._sources) : undefined,
                        ...(matchedEmployer && { employerId: matchedEmployer.id }),
                        employerMatchConfidence: confidence,
                        // DB-parent bruges kun når AI ikke fandt et eksplicit moderselskabsnavn
                        ...(parentSuggestion && !ext.parentCompanyName && { parentEmployerId: parentSuggestion.id }),
                        dfiMatches,
                        // DFI-forslag vises altid når der er resultater
                        ...(dfiParentSuggestion && { selectedDfiParent: dfiParentSuggestion }),
                        // Kun auto-vælg ved eksakt match — fuzzy kræver manuel bekræftelse
                        ...(exactRH && { rightsHolderId: exactRH.id }),
                        rhFuzzyMatches,
                        rhMatchConfidence: rhConfidence,
                    }
                }
            } catch (err: any) {
                updated[i] = { ...updated[i], status: "error", error: err.message }
            }

            setUploadItems([...updated])
        }
    }

    // ── Update extracted field in review ──────────────────────

    const updateExtracted = (idx: number, key: string, value: any) => {
        setUploadItems(prev => prev.map((item, i) =>
            i === idx ? { ...item, extracted: { ...item.extracted!, [key]: value } } : item
        ))
    }

    const updateItem = (idx: number, patch: Partial<UploadItem>) => {
        setUploadItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
    }

    // ── Save all reviewed contracts ───────────────────────────

    const handleSaveAll = async (saveAsValidated: boolean = false) => {
        if (!orgId) { toast.error("Organisation ikke indlæst — prøv at genindlæse siden"); return }
        setSaving(true)
        const supabase = createClient()
        const saved: ContractRow[] = []

        try {
            for (const item of uploadItems) {
                if (item.status !== "done" || !item.extracted) continue

                const ext = item.extracted

                // Opret/find employer
                let employerId = item.employerId ?? null
                if (!employerId && ext.employerName) {
                    const existing = employers.find(e =>
                        e.name.toLowerCase() === ext.employerName!.toLowerCase()
                    )
                    if (existing) {
                        employerId = existing.id
                    } else {
                        const { data: newEmp, error: empErr } = await supabase
                            .from("employers")
                            .insert({ name: ext.employerName })
                            .select()
                            .single()
                        if (empErr) throw new Error(`Arbejdsgiver fejl: ${empErr.message}`)
                        if (newEmp) {
                            employerId = newEmp.id
                            setEmployers(prev => [...prev, { id: newEmp.id, name: newEmp.name, parent_id: null, dfi_company_id: null }]
                                .sort((a, b) => a.name.localeCompare(b.name, "da")))
                        }
                    }
                }

                // Resolve moderselskab-ID — enten fra DB eller opret fra DFI
                let resolvedParentId = item.parentEmployerId ?? null
                if (!resolvedParentId && item.selectedDfiParent) {
                    // Tjek om et employer med dette DFI-ID allerede findes
                    const existingByDfi = employers.find(e => e.dfi_company_id === item.selectedDfiParent!.id)
                    if (existingByDfi) {
                        resolvedParentId = existingByDfi.id
                    } else {
                        // Opret moderselskab fra DFI-data
                        const { data: newParent, error: parentErr } = await supabase
                            .from("employers")
                            .insert({ name: item.selectedDfiParent.name, dfi_company_id: item.selectedDfiParent.id })
                            .select()
                            .single()
                        if (parentErr) throw new Error(`Moderselskab fejl: ${parentErr.message}`)
                        if (newParent) {
                            resolvedParentId = newParent.id
                            setEmployers(prev => [...prev, { id: newParent.id, name: newParent.name, parent_id: null, dfi_company_id: newParent.dfi_company_id ?? null }]
                                .sort((a, b) => a.name.localeCompare(b.name, "da")))
                        }
                    }
                }

                // Sæt/opdater parent_id på employer hvis angivet
                if (employerId && resolvedParentId) {
                    const emp = employers.find(e => e.id === employerId)
                    if (!emp || !emp.parent_id) {
                        await supabase.from("employers")
                            .update({ parent_id: resolvedParentId })
                            .eq("id", employerId)
                    }
                }

                // Opret/find rettighedshaver
                let rhId: string | null = null
                if (item.rightsHolderId && item.rightsHolderId !== "__new__" && item.rightsHolderId !== "__unselected__") {
                    // Eksisterende person valgt
                    rhId = item.rightsHolderId
                } else if (item.rightsHolderId === "__new__" && ext.rightsHolderName) {
                    // Bruger har eksplicit valgt at oprette ny
                    const { data: newRh, error: rhErr } = await supabase
                        .from("rettighedshavere")
                        .insert({ full_name: ext.rightsHolderName })
                        .select()
                        .single()
                    if (rhErr) throw new Error(`Rettighedshaver fejl: ${rhErr.message}`)
                    if (newRh) {
                        rhId = newRh.id
                        await supabase.from("org_affiliations").insert({
                            org_id: orgId,
                            rights_holder_id: newRh.id,
                            is_member: false,
                        })
                        setRightsHolders(prev => [...prev, { id: newRh.id, full_name: newRh.full_name }]
                            .sort((a, b) => a.full_name.localeCompare(b.full_name, "da")))
                    }
                }
                // undefined / "__unselected__" → gem uden rettighedshaver (kan kobles senere)

                // Upload PDF til Storage
                const filePath = `${orgId}/${Date.now()}_${item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
                const { error: storageErr } = await supabase.storage
                    .from("kontrakter")
                    .upload(filePath, item.file, { contentType: item.file.type })
                if (storageErr) throw new Error(`Upload fejl: ${storageErr.message}`)

                const f = item.form
                const contractStatus = saveAsValidated ? "valideret" : "kladde"

                // Gem kontrakt
                const { data: newContract, error: contractErr } = await supabase
                    .from("contracts")
                    .insert({
                        org_id: orgId,
                        employer_id: employerId,
                        rights_holder_id: rhId,
                        type: ext.contractType ?? "a-løn",
                        overenskomst: ext.overenskomst ?? null,
                        status: contractStatus,
                        pdf_url: filePath,
                        working_title: ext.workTitle ?? null,
                        contract_date: ext.contractDate ?? null,
                        start_date: f?.startDate || ext.startDate || null,
                        end_date: f?.endDate || ext.endDate || null,
                    })
                    .select()
                    .single()
                if (contractErr) throw new Error(`Kontrakt fejl: ${contractErr.message}`)

                if (newContract) {
                    const { data: { user } } = await supabase.auth.getUser()
                    const extractedData = f ? {
                        producerName: f.producerName || undefined,
                        productionType: f.productionType || undefined,
                        salary: f.salary ? Number(f.salary) : undefined,
                        salaryUnit: f.salaryUnit || "monthly",
                        startDate: f.startDate || undefined,
                        endDate: f.endDate || undefined,
                        pensionPercent: f.pensionPercent ? Number(f.pensionPercent) : undefined,
                        pensionSupplement: f.pensionSupplement ? Number(f.pensionSupplement) : undefined,
                        personalSupplement: f.personalSupplement ? Number(f.personalSupplement) : undefined,
                        otherSupplements: f.otherSupplements || undefined,
                        workingWeeks: f.workingWeeks ? Number(f.workingWeeks) : undefined,
                        svod: f.svod, copydan: f.copydan, royalty: f.royalty,
                        royaltyPercent: f.royaltyPercent ? Number(f.royaltyPercent) : undefined,
                        aiDataMiningClause: f.aiDataMiningClause,
                        distribution: f.distribution ? f.distribution.split(",").map(s => s.trim()).filter(Boolean) : undefined,
                        collectiveAgreement: f.collectiveAgreement,
                        collectiveAgreementName: f.collectiveAgreementName || undefined,
                        collectiveAgreementByReference: f.collectiveAgreementByReference,
                        isFreelanceContract: f.isFreelanceContract,
                        gender: f.gender || undefined,
                        holidayPayRate: f.holidayPayRate ? Number(f.holidayPayRate) : undefined,
                        betaRate: f.betaRate ? Number(f.betaRate) : undefined,
                        specialNotes: f.specialNotes || undefined,
                    } : ext

                    const { error: valErr } = await supabase.from("contract_validations").insert({
                        contract_id: newContract.id,
                        org_id: orgId,
                        holiday_pay_rate: f ? (f.holidayPayRate ? Number(f.holidayPayRate) : null) : (ext.holidayPayRate ?? null),
                        beta_rate: f ? (f.betaRate ? Number(f.betaRate) : null) : (ext.betaRate ?? null),
                        has_credit_clause: ext.hasCreditClause ?? false,
                        has_termination_clause: ext.hasTerminationClause ?? false,
                        termination_days_editor: ext.terminationDaysEditor ?? null,
                        termination_days_producer: ext.terminationDaysProducer ?? null,
                        has_indemnification: ext.hasIndemnification ?? false,
                        has_overenskomst_incorporation: ext.hasOverenskomstIncorporation ?? false,
                        extracted_data: extractedData,
                        ...(saveAsValidated && { validated_by: user?.id ?? null, validated_at: new Date().toISOString() }),
                    })
                    if (valErr) throw new Error(`Validering fejl: ${valErr.message}`)

                    saved.push({
                        id: newContract.id,
                        type: newContract.type,
                        overenskomst: newContract.overenskomst,
                        status: newContract.status,
                        pdf_url: newContract.pdf_url,
                        contract_date: newContract.contract_date,
                        start_date: newContract.start_date,
                        end_date: newContract.end_date,
                        created_at: newContract.created_at,
                        employer_id: newContract.employer_id,
                        rights_holder_id: newContract.rights_holder_id,
                        working_title: newContract.working_title,
                        employer_name: ext.employerName ?? null,
                        rights_holder_name: ext.rightsHolderName ?? null,
                        work_title: null,
                        contract_attachments: [],
                    })
                }
            }

            setContracts(prev => [...saved, ...prev])
            setShowUpload(false)
            setUploadItems([])
            setUploadPhase("select")
            toast.success(`${saved.length} kontrakt${saved.length !== 1 ? "er" : ""} gemt`)
        } catch (err: any) {
            toast.error(err.message ?? "Gem fejlede")
        } finally {
            setSaving(false)
        }
    }

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

    // ── Edit ──────────────────────────────────────────────────

    const openEdit = (c: ContractRow) => {
        setEditContract(c)
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
        } catch (err: any) {
            toast.error(err.message ?? "Opdatering fejlede")
        } finally {
            setEditSaving(false)
        }
    }

    // ── Filter ────────────────────────────────────────────────

    const filtered = useMemo(() => {
        let list = contracts
        if (filterStatus !== "all") list = list.filter(c => c.status === filterStatus)
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
        return list
    }, [contracts, filterStatus, filterType, search])

    const doneCount = uploadItems.filter(i => i.status === "done").length
    const totalCount = uploadItems.length

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
            <div className="flex flex-wrap gap-3">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Søg titel, klipper, producent..." className="w-[280px] pl-8" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle status</SelectItem>
                        <SelectItem value="kladde">Kladde</SelectItem>
                        <SelectItem value="valideret">Valideret</SelectItem>
                        <SelectItem value="arkiveret">Arkiveret</SelectItem>
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
            </div>

            {/* Table */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Produktion</TableHead>
                            <TableHead>Klipper</TableHead>
                            <TableHead>Producent</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Overenskomst</TableHead>
                            <TableHead>Periode</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[60px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                                    {contracts.length === 0 ? "Ingen kontrakter endnu — upload den første" : t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map(c => (
                                <TableRow key={c.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-1.5">
                                            {c.work_title ?? c.working_title ?? <span className="text-muted-foreground">—</span>}
                                            {c.contract_attachments.length > 0 && (
                                                <span title={`${c.contract_attachments.length} allonge(r)`} className="flex items-center gap-0.5 text-xs text-muted-foreground">
                                                    <Paperclip className="h-3 w-3" />{c.contract_attachments.length}
                                                </span>
                                            )}
                                        </div>
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
                            ))
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
                    {viewContract && viewContract.contract_attachments.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <span className="text-xs font-medium text-muted-foreground">Allonger:</span>
                            {viewContract.contract_attachments.map(a => (
                                <button
                                    key={a.id}
                                    onClick={() => openAttachment(a)}
                                    disabled={openingAttachmentId === a.id}
                                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted transition-colors"
                                >
                                    <FileText className="h-3 w-3" />
                                    {a.title ?? "Allonge"}
                                    {openingAttachmentId === a.id && <Loader2 className="h-3 w-3 animate-spin" />}
                                </button>
                            ))}
                        </div>
                    )}
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
                <DialogContent className="sm:max-w-[600px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="h-4 w-4" />Rediger kontrakt
                        </DialogTitle>
                        <DialogDescription>{editContract?.work_title ?? editContract?.working_title ?? editContract?.employer_name ?? "Kontrakt"}</DialogDescription>
                    </DialogHeader>
                    {editForm && (
                        <div className="grid grid-cols-2 gap-4 py-2">
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
                        Automatisk maskering er ikke 100% pålidelig. Brug "Rediger" for at kontrollere teksten inden afsendelse.
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

function DocxTextViewer({ text, highlights, activeHighlight }: {
    text: string
    highlights: string[]
    activeHighlight: string | null
}) {
    const containerRef = useRef<HTMLDivElement>(null)

    const html = useMemo(() => {
        if (!text) return ""

        // Normaliser highlights — split || og flatten
        const expandHighlight = (hl: string): string[] =>
            hl.split("||").map(s => s.trim()).filter(s => s.length >= 4)

        const allHighlights = [...new Set([...highlights, activeHighlight].filter(Boolean) as string[])]
        if (allHighlights.length === 0) return escapeHtml(text)

        type Range = { start: number; end: number; active: boolean }
        const ranges: Range[] = []

        for (const hl of allHighlights) {
            if (!hl) continue
            const isActive = hl === activeHighlight
            const terms = expandHighlight(hl)

            let found = false
            for (const term of terms) {
                // Prøv progressive kortere versioner af hvert term
                for (const needle of [term.slice(0, 80), term.slice(0, 50), term.slice(0, 30)]) {
                    if (needle.length < 4) continue
                    const idx = text.toLowerCase().indexOf(needle.toLowerCase())
                    if (idx === -1) continue
                    ranges.push({ start: idx, end: idx + needle.length, active: isActive })
                    found = true
                    break
                }
                if (found) break
            }
        }

        if (ranges.length === 0) return escapeHtml(text)

        ranges.sort((a, b) => a.start - b.start)

        let result = ""
        let cursor = 0
        for (const { start, end, active } of ranges) {
            if (start < cursor) continue
            result += escapeHtml(text.slice(cursor, start))
            const cls = active
                ? "bg-green-200 dark:bg-green-800 outline outline-2 outline-green-500 rounded"
                : "bg-yellow-200 dark:bg-yellow-800 rounded"
            result += `<mark class="${cls}" data-active="${active}">${escapeHtml(text.slice(start, end))}</mark>`
            cursor = end
        }
        result += escapeHtml(text.slice(cursor))
        return result
    }, [text, highlights, activeHighlight])

    useEffect(() => {
        if (!containerRef.current || !activeHighlight) return
        const el = containerRef.current.querySelector("mark[data-active='true']")
        el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [activeHighlight, html])

    return (
        <div
            ref={containerRef}
            className="h-full overflow-y-auto p-4 text-xs leading-relaxed font-mono text-foreground/80 whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    )
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
