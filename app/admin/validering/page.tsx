"use client"

import { useState, useRef, useMemo, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
    Check, X, FileText, Upload, ArrowLeft, Building2, AlertTriangle,
    Trash2, Clock, CheckCircle2, Eye, Sparkles, Loader2, Lock,
} from "lucide-react"
import { toast } from "sonner"
import { PdfViewer } from "@/components/pdf-viewer"
import { useI18n } from "@/lib/i18n"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { maskPersonalData } from "@/lib/mask-text"
import { getContractValidationData } from "@/app/actions/contract-imports"
import { normaliseSources } from "@/lib/ai-sources"
import { resolveAnker } from "@/lib/resolveAnker"
import { SourceBtn } from "@/components/source-btn"

const ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
const BUCKET = "kontrakter"

// ── Fuzzy matching ────────────────────────────────────────────
const LEGAL_SUFFIXES = /\b(aps|a\/s|as|ivs|i\/s|fmba|smba|productions?|film|media|company|group|entertainment|studios?|international|denmark|dk)\b/g

function nameTokens(name: string): string[] {
    return name.toLowerCase().replace(LEGAL_SUFFIXES, "").replace(/[^a-zæøå0-9\s]/g, " ").trim().split(/\s+/).filter(t => t.length > 1)
}

function tokenOverlapScore(a: string, b: string): number {
    // Eksakt match (case-insensitiv) giver altid 1.0
    if (a.toLowerCase() === b.toLowerCase()) return 1.0
    const ta = new Set(nameTokens(a))
    const tb = new Set(nameTokens(b))
    if (ta.size === 0 || tb.size === 0) return 0
    let overlap = 0
    for (const t of ta) { if (tb.has(t)) overlap++ }
    return overlap / Math.min(ta.size, tb.size)
}

type ValidatingContract = {
    id: string
    org_id: string
    employer_id: string | null
    rights_holder_id: string | null
    work_id: string | null
    type: string
    overenskomst: string | null
    status: string
    pdf_url: string | null
    contract_date: string | null
    start_date: string | null
    end_date: string | null
    created_at: string
    working_title: string | null
    employers: { id: string; name: string; cvr: string | null } | null
    rettighedshavere: { id: string; full_name: string } | null
    works: { id: string; title: string } | null
    contract_attachments: { id: string; type: string; title: string | null; pdf_url: string | null }[]
    validation: {
        id: string
        holiday_pay_rate: number | null
        beta_rate: number | null
        notes: string | null
        extracted_data: Record<string, unknown> | null
        validated_at: string | null
        bruger_redigerede_felter: string[] | null
    } | null
    displayTitle: string
    displayEmployer: string | null
    displayMember: string
    signedPdfUrl: string | null
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    kladde: "outline", valideret: "default", arkiveret: "destructive",
}
const statusLabel: Record<string, string> = {
    kladde: "Afventer", valideret: "Godkendt", arkiveret: "Afvist",
}


function AdminValideringPageInner() {
    const { t } = useI18n()
    const router = useRouter()
    const searchParams = useSearchParams()
    const cameFromQueue = searchParams.get("id") !== null
    const [contracts, setContracts] = useState<ValidatingContract[]>([])
    const [pageLoading, setPageLoading] = useState(true)
    const [reviewingId, setReviewingId] = useState<string | null>(searchParams.get("id"))
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)
    const [localPdfFile, setLocalPdfFile] = useState<File | null>(null)
    const [screening, setScreening] = useState(false)
    const [textLoading, setTextLoading] = useState(false)
    const [formData, setFormData] = useState<Record<string, any>>({})
    const [brugerRedigerede, setBrugerRedigerede] = useState<Set<string>>(new Set())
    const [contractText, setContractText] = useState("")
    const [sources, setSources] = useState<Record<string, string | null>>({})
    const [contractLayout, setContractLayout] = useState<import("@/lib/contract-layout").ContractLayout | null>(null)
    const [activeSource, setActiveSource] = useState<string | null>(null)   // quote til PDF-highlight
    const [activeField, setActiveField] = useState<string | null>(null)     // felt-ID til knap-highlight
    const [storedDocxText, setStoredDocxText] = useState<string | null>(null)
    const [storedDocxLoading, setStoredDocxLoading] = useState(false)
    const [showMaskingConfirm, setShowMaskingConfirm] = useState(false)
    const [maskingPreview, setMaskingPreview] = useState<{ count: number; types: string[] }>({ count: 0, types: [] })
    const [maskedText, setMaskedText] = useState("")

    // Producer matching
    const [employers, setEmployers] = useState<{ id: string; name: string; dfi_company_id: number | null }[]>([])
    const [rettighedshavere, setRettighedshavere] = useState<{ id: string; full_name: string; gender?: string | null }[]>([])
    const [rhSuggestions, setRhSuggestions] = useState<{ id: string; name: string; score: number }[]>([])
    const [selectedRhId, setSelectedRhId] = useState<string | null>(null)
    const [employerSuggestions, setEmployerSuggestions] = useState<{
        id: string | null; name: string; source: "db" | "dfi"; score: number; dfi_id?: number
    }[]>([])
    const [selectedEmployerId, setSelectedEmployerId] = useState<string | null>(null)
    const [searchingDfi, setSearchingDfi] = useState(false)
    const [parentSuggestions, setParentSuggestions] = useState<{
        id: string | null; name: string; source: "db" | "dfi"; dfi_id?: number
    }[]>([])
    const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
    const [selectedDfiParent, setSelectedDfiParent] = useState<{ id: number; name: string } | null>(null)
    const [parentExplicitNone, setParentExplicitNone] = useState(false)
    const [overenskomster, setOverenskomster] = useState<{ value: string; label: string }[]>([
        { value: "de4-fiktion",   label: "De4 (fiktion)"    },
        { value: "faf",           label: "FAF (fiktion)"    },
        { value: "faf-dokumentar",label: "FAF (dokumentar)" },
    ])
    // Fortolkningsnote pr. label_key for den aktive kontrakts matchede overenskomst
    const [pctRuleNotes, setPctRuleNotes] = useState<Record<string, string>>({})

    // Opret ny producent dialog
    const [showNewEmployer, setShowNewEmployer] = useState(false)
    const [newEmpName, setNewEmpName] = useState("")
    const [newEmpCvr, setNewEmpCvr] = useState("")
    const [newEmpDfiId, setNewEmpDfiId] = useState<number | null>(null)
    const [newEmpSaving, setNewEmpSaving] = useState(false)
    const [newEmpDfiResults, setNewEmpDfiResults] = useState<{ id: number; name: string; cvr?: string }[]>([])
    const [newEmpDfiLoading, setNewEmpDfiLoading] = useState(false)
    const [newEmpDbMatches, setNewEmpDbMatches] = useState<{ id: string; name: string; score: number }[]>([])
    // Relation til DB-match: null=ingen, {role:"child",id} = ny er underselskab, {role:"parent",id} = ny er moderselskab
    const [newEmpRelation, setNewEmpRelation] = useState<{ role: "child" | "parent"; id: string; name: string } | null>(null)

    // Søg automatisk når brugeren skriver i ny-producent-dialogen
    useEffect(() => {
        if (!showNewEmployer) return
        const name = newEmpName.trim()
        if (name.length < 3) { setNewEmpDbMatches([]); setNewEmpDfiResults([]); return }

        // DB fuzzy
        const dbMatches = employers
            .map(e => ({ id: e.id, name: e.name, score: tokenOverlapScore(e.name, name) }))
            .filter(x => x.score >= 0.3)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4)
        setNewEmpDbMatches(dbMatches)

        // DFI
        setNewEmpDfiLoading(true)
        const token = nameTokens(name)[0] ?? name.split(" ")[0]
        fetch(`/api/dfi/company?name=${encodeURIComponent(token)}`)
            .then(r => r.json())
            .then(json => setNewEmpDfiResults(json.companies?.slice(0, 5) ?? []))
            .catch(() => {})
            .finally(() => setNewEmpDfiLoading(false))
    }, [newEmpName, showNewEmployer, employers])
    const [showMaskedEditor, setShowMaskedEditor] = useState(false)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        const supabase = createClient()
        supabase.from("employers").select("id, name, dfi_company_id").order("name")
            .then(({ data }) => { if (data) setEmployers(data) })
        supabase.from("rettighedshavere").select("id, full_name, gender").order("full_name")
            .then(({ data }) => { if (data) setRettighedshavere(data) })

        // Hent overenskomster fra reference_docs katalog
        supabase.from("reference_docs")
            .select("title, doc_subtype")
            .eq("archived", false)
            .not("doc_subtype", "is", null)
            .then(({ data }) => {
                if (data?.length) {
                    const seen = new Set<string>()
                    const fromDb = data
                        .filter(d => d.doc_subtype)
                        .map(d => ({ value: d.doc_subtype!, label: d.title }))
                        .filter(o => seen.has(o.value) ? false : (seen.add(o.value), true))
                    // Merge med defaults — DB-versioner overskriver
                    setOverenskomster(prev => {
                        const dbValues = new Set(fromDb.map(o => o.value))
                        const merged = [...fromDb, ...prev.filter(p => !dbValues.has(p.value))]
                        const deduped = merged.filter((o, i, arr) => arr.findIndex(x => x.value === o.value) === i)
                        return deduped
                    })
                }
            })
    }, [])

    // Kør producer-søgning når producerName ændres
    useEffect(() => {
        const name = formData.producerName?.trim()
        if (!name || name.length < 3) { setEmployerSuggestions([]); return }

        // Lokal DB-søgning (fuzzy)
        const dbMatches = employers
            .map(e => ({ id: e.id, name: e.name, source: "db" as const, score: tokenOverlapScore(e.name, name), dfi_id: e.dfi_company_id ?? undefined }))
            .filter(x => x.score >= 0.4)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4)

        setEmployerSuggestions(dbMatches)

        // DFI-søgning (kun hvis ingen gode lokale matches)
        if (dbMatches.length === 0 || dbMatches[0].score < 0.8) {
            setSearchingDfi(true)
            const token = nameTokens(name)[0] ?? name.split(" ")[0]
            fetch(`/api/dfi/company?name=${encodeURIComponent(token)}`)
                .then(r => r.json())
                .then(json => {
                    const dfiResults: typeof dbMatches = (json.companies ?? [])
                        .map((c: { id: number; name: string }) => ({
                            id: null,
                            name: c.name,
                            source: "dfi" as const,
                            score: tokenOverlapScore(c.name, name),
                            dfi_id: c.id,
                        }))
                        .filter((x: { score: number }) => x.score >= 0.3)
                        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
                        .slice(0, 3)

                    setEmployerSuggestions(prev => {
                        const combined = [...prev]
                        for (const d of dfiResults) {
                            if (!combined.some(p => tokenOverlapScore(p.name, d.name) > 0.8)) {
                                combined.push(d)
                            }
                        }
                        return combined.sort((a, b) => b.score - a.score).slice(0, 5)
                    })
                })
                .catch(() => {})
                .finally(() => setSearchingDfi(false))
        }
    }, [formData.producerName, employers])

    // Rettighedshaver-matching når rightsHolderName ændres
    useEffect(() => {
        const name = formData.rightsHolderName?.trim()
        if (!name || name.length < 3) { setRhSuggestions([]); return }
        const matches = rettighedshavere
            .map(rh => ({ id: rh.id, name: rh.full_name, score: tokenOverlapScore(rh.full_name, name) }))
            .filter(x => x.score >= 0.4)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4)
        setRhSuggestions(matches)
        if (matches.length === 1 && matches[0].score >= 0.8) {
            setSelectedRhId(matches[0].id)
        }
    }, [formData.rightsHolderName, rettighedshavere])

    // Auto-udfyld gender fra rettighedshaverprofil når kobling sættes
    useEffect(() => {
        if (!selectedRhId) return
        const rh = rettighedshavere.find(r => r.id === selectedRhId)
        if (!rh?.gender) return
        // Kun auto-udfyld hvis feltet ikke er manuelt redigeret
        if (!brugerRedigerede.has("gender")) {
            setField("gender", rh.gender)
        }
    }, [selectedRhId, rettighedshavere])

    // Moderselskab: søg DFI + vis eksisterende parent når employer vælges
    useEffect(() => {
        const name = formData.producerName?.trim()
        if (!name || name.length < 3) { setParentSuggestions([]); setParentExplicitNone(false); return }

        // Eksisterende DB-forældre (ikke samme som employer)
        const dbParents = employers
            .filter(e => e.id !== selectedEmployerId)
            .map(e => ({ id: e.id, name: e.name, source: "db" as const, score: tokenOverlapScore(e.name, name) }))
            .filter(x => x.score >= 0.25)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)

        setParentSuggestions(dbParents)

        // DFI-søgning for moderselskab
        const token = nameTokens(name)[0] ?? name.split(" ")[0]
        if (token) {
            fetch(`/api/dfi/company?name=${encodeURIComponent(token)}`)
                .then(r => r.json())
                .then(json => {
                    const dfiResults = (json.companies ?? [])
                        .filter((c: { id: number; name: string }) => tokenOverlapScore(c.name, name) >= 0.25)
                        .slice(0, 3)
                        .map((c: { id: number; name: string }) => ({
                            id: null, name: c.name, source: "dfi" as const, dfi_id: c.id,
                        }))
                    setParentSuggestions(prev => {
                        const combined = [...prev]
                        for (const d of dfiResults) {
                            if (!combined.some(p => tokenOverlapScore(p.name, d.name) > 0.7)) combined.push(d)
                        }
                        return combined.slice(0, 5)
                    })
                })
                .catch(() => {})
        }
    }, [formData.producerName, employers, selectedEmployerId])

    const loadContracts = useCallback(async () => {
        setPageLoading(true)
        const supabase = createClient()

        const { data, error } = await supabase
            .from("contracts")
            .select(`*, employers(id, name, cvr), rettighedshavere(id, full_name), works(id, title), contract_attachments(*)`)
            .eq("org_id", ORG_ID)
            .order("created_at", { ascending: false })

        if (error || !data) { setPageLoading(false); return }

        const ids = data.map((c: any) => c.id)
        const { data: validations } = ids.length > 0
            ? await supabase.from("contract_validations").select("*").in("contract_id", ids)
            : { data: [] }

        const validationMap = new Map<string, any>()
        validations?.forEach((v: any) => validationMap.set(v.contract_id, v))

        const mapped: ValidatingContract[] = await Promise.all(data.map(async (c: any) => {
            let signedPdfUrl: string | null = null
            if (c.pdf_url) {
                const { data: sd, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(c.pdf_url, 3600)
                if (signErr) console.error("[validering] createSignedUrl fejl:", signErr.message, "path:", c.pdf_url)
                signedPdfUrl = sd?.signedUrl ?? null
            }
            return {
                ...c,
                validation: validationMap.get(c.id) ?? null,
                displayTitle: c.works?.title ?? c.working_title ?? c.employers?.name ?? "—",
                displayEmployer: (c.works?.title || c.working_title) ? (c.employers?.name ?? null) : null,
                displayMember: c.rettighedshavere?.full_name ?? "—",
                signedPdfUrl,
            }
        }))

        setContracts(mapped)
        setPageLoading(false)
    }, [])

    useEffect(() => { loadContracts() }, [loadContracts])

    // Pre-fill form when opening a contract that has existing validation data
    useEffect(() => {
        if (!reviewingId) return

        void getContractValidationData(reviewingId).then(res => {
            const validation = res.success ? res.data : null
            const redigerede = (validation?.bruger_redigerede_felter as string[] | null) ?? []
            setBrugerRedigerede(new Set(redigerede))
            const ed = validation?.extracted_data as any
            if (!ed) return
            // SVOD: kun true hvis AI eksplicit fandt — aldrig automatisk
            const impliedBySvod    = !!ed.svod
            // Copydan og royalty: kun fra AI-udtræk — ingen hardcoded overenskomst-lister
            const impliedByCopydan = !!ed.copydan
            const impliedByRoyalty = !!ed.royalty

            setFormData({
                producerName: ed.producerName ?? ed.employerName ?? "",
                rightsHolderName: ed.rightsHolderName ?? "",
                workTitle: ed.workTitle ?? "",
                creditedRoles: Array.isArray(ed.creditedRoles) ? ed.creditedRoles.join(", ") : (ed.creditedRoles ?? ""),
                productionType: ed.productionType ?? "",
                contractType: ed.collectiveAgreementByReference
                    ? "leverandør-ref"
                    : (ed.contractType === "leverandør" || ed.isFreelanceContract)
                        ? "leverandør"
                        : "a-løn",
                overenskomst: ed.overenskomst ?? "ingen",
                salary: ed.salary ?? "",
                salaryUnit: ed.salaryUnit ?? "monthly",
                startDate: ed.startDate ?? "",
                endDate: ed.endDate ?? "",
                pensionPercent: ed.pensionPercent ?? "",
                pensionSupplement: ed.pensionSupplement ?? "",
                personalSupplement: ed.personalSupplement ?? "",
                otherSupplements: ed.otherSupplements ?? "",
                workingWeeks: ed.workingWeeks ?? "",
                prolongationWeeks: ed.prolongationWeeks ?? "",
                prolongationNote: ed.prolongationNote ?? "",
                svod: impliedBySvod,
                copydan: impliedByCopydan,
                royalty: impliedByRoyalty,
                royaltyPercent: ed.royaltyPercent ?? "",
                aiDataMiningClause: ed.aiDataMiningClause ?? false,
                distribution: Array.isArray(ed.distribution) ? ed.distribution.join(", ") : (ed.distribution ?? ""),
                collectiveAgreementName: ed.collectiveAgreementName ?? "",
                gender: ed.gender ?? "",
                holidayPayRate: ed.holidayPayRate ?? "",
                betaRate: ed.betaRate ?? "",
                specialNotes: ed.specialNotes ?? "",
                collectiveAgreement: ed.collectiveAgreement ?? false,
                isFreelanceContract: ed.isFreelanceContract ?? false,
                collectiveAgreementByReference: ed.collectiveAgreementByReference ?? false,
            })
            if (ed._sources) setSources(normaliseSources(ed._sources))
            if (validation?.masked_text) setContractText(validation.masked_text as string)

            // Hent fortolkningsnote via server-rute (undgår RLS-begrænsning på agreements)
            const agreementCode = ed._resolvedAgreementCode ?? null
            setPctRuleNotes({})
            if (agreementCode) {
                fetch(`/api/admin/agreements?percentageNotes=${encodeURIComponent(agreementCode)}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(json => { if (json?.notes) setPctRuleNotes(json.notes) })
            }
        })
    }, [reviewingId]) // eslint-disable-line react-hooks/exhaustive-deps

    const unreviewedContracts = contracts.filter(c => c.status === "kladde")
    const reviewedContracts = contracts.filter(c => c.status === "valideret" || c.status === "arkiveret")
    const reviewingContract = contracts.find(c => c.id === reviewingId) ?? null

    // Hent DOCX-tekst fra Storage når kontrakten åbnes
    useEffect(() => {
        setStoredDocxText(null)
        if (!reviewingContract?.signedPdfUrl) return
        const url = reviewingContract.pdf_url ?? ""
        const isDocx = url.toLowerCase().endsWith(".docx") || url.toLowerCase().endsWith(".doc")
        if (!isDocx) return

        setStoredDocxLoading(true)
        fetch(reviewingContract.signedPdfUrl)
            .then(r => r.arrayBuffer())
            .then(async buf => {
                const mammoth = await import("mammoth")
                const result = await mammoth.extractRawText({ arrayBuffer: buf })
                setStoredDocxText(result.value)
            })
            .catch(e => console.error("[validering] DOCX hentning fejlede:", e))
            .finally(() => setStoredDocxLoading(false))
    }, [reviewingContract?.id])

    const leaveReview = () => {
        if (cameFromQueue) {
            router.push("/admin/kontrakter?tab=valideringskoe")
            return
        }
        setReviewingId(null); setLocalPdfUrl(null); setLocalPdfFile(null)
        setStoredDocxText(null)
        setFormData({}); setContractText(""); setSources({}); setActiveSource(null); setActiveField(null)
        setTextLoading(false); setMaskedText(""); setScreening(false)
        setBrugerRedigerede(new Set())
    }

    const handleApprove = async (id: string) => {
        const c = contracts.find(x => x.id === id)
        setSaving(true)
        try {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

            const extractedData = {
                producerName: formData.producerName || undefined,
                rightsHolderName: formData.rightsHolderName || undefined,
                workTitle: formData.workTitle || undefined,
                creditedRoles: formData.creditedRoles || undefined,
                productionType: formData.productionType || undefined,
                salary: formData.salary ? Number(formData.salary) : undefined,
                salaryUnit: formData.salaryUnit || "monthly",
                startDate: formData.startDate || undefined,
                endDate: formData.endDate || undefined,
                pensionPercent: formData.pensionPercent ? Number(formData.pensionPercent) : undefined,
                pensionSupplement: formData.pensionSupplement ? Number(formData.pensionSupplement) : undefined,
                personalSupplement: formData.personalSupplement ? Number(formData.personalSupplement) : undefined,
                otherSupplements: formData.otherSupplements || undefined,
                workingWeeks: formData.workingWeeks ? Number(formData.workingWeeks) : undefined,
                prolongationWeeks: formData.prolongationWeeks ? Number(formData.prolongationWeeks) : undefined,
                prolongationNote: formData.prolongationNote || undefined,
                svod: !!formData.svod,
                copydan: !!formData.copydan,
                royalty: !!formData.royalty,
                royaltyPercent: formData.royaltyPercent ? Number(formData.royaltyPercent) : undefined,
                aiDataMiningClause: !!formData.aiDataMiningClause,
                distribution: formData.distribution
                    ? formData.distribution.split(",").map((s: string) => s.trim()).filter(Boolean)
                    : undefined,
                collectiveAgreement: !!formData.collectiveAgreement,
                collectiveAgreementName: formData.collectiveAgreementName || undefined,
                collectiveAgreementByReference: !!formData.collectiveAgreementByReference,
                isFreelanceContract: !!formData.isFreelanceContract,
                gender: formData.gender || undefined,
                holidayPayRate: formData.holidayPayRate ? Number(formData.holidayPayRate) : undefined,
                betaRate: formData.betaRate ? Number(formData.betaRate) : undefined,
                specialNotes: formData.specialNotes || undefined,
            }

            const { error: valError } = await supabase.from("contract_validations").upsert({
                contract_id: id,
                org_id: ORG_ID,
                // Eksisterende kolonner
                holiday_pay_rate:               extractedData.holidayPayRate ?? null,
                beta_rate:                      extractedData.betaRate ?? null,
                has_overenskomst_incorporation: !!extractedData.collectiveAgreement,
                has_credit_clause:              !!(extractedData.creditedRoles),
                notes:                          extractedData.specialNotes ?? null,
                // Udvidede kolonner (migration 20260612)
                extracted_data:                 extractedData,
                bruger_redigerede_felter:       Array.from(brugerRedigerede),
                validated_by:                   user?.id ?? null,
                validated_at:                   new Date().toISOString(),
            }, { onConflict: "contract_id" })

            if (valError) throw new Error(valError.message)

            // Auto-kobl employer fra extracted employerName hvis admin ikke har valgt manuelt
            let resolvedEmployerId = selectedEmployerId
            if (!resolvedEmployerId && extractedData.producerName) {
                try {
                    const supabaseAdmin = createClient()
                    const employerName = extractedData.producerName as string
                    let { data: existingEmployer } = await supabaseAdmin
                        .from("employers")
                        .select("id")
                        .ilike("name", employerName)
                        .single()

                    if (!existingEmployer) {
                        const { data: nyEmployer } = await supabaseAdmin
                            .from("employers")
                            .insert({ name: employerName })
                            .select("id")
                            .single()
                        existingEmployer = nyEmployer
                    }

                    if (existingEmployer) {
                        resolvedEmployerId = existingEmployer.id
                    }
                } catch (employerErr) {
                    console.warn("[validering] Kunne ikke auto-oprette employer:", employerErr)
                }
            }

            // Opret moderselskab fra DFI hvis valgt
            let resolvedParentId = selectedParentId
            if (!resolvedParentId && selectedDfiParent) {
                const existing = employers.find(e => e.dfi_company_id === selectedDfiParent.id)
                if (existing) {
                    resolvedParentId = existing.id
                } else {
                    const supabaseAdmin = createClient()
                    const { data: newParent } = await supabaseAdmin.from("employers")
                        .insert({ name: selectedDfiParent.name, dfi_company_id: selectedDfiParent.id })
                        .select().single()
                    if (newParent) resolvedParentId = newParent.id
                }
            }

            // Opdater employer med parent hvis valgt
            if (resolvedEmployerId && resolvedParentId) {
                await createClient().from("employers").update({ parent_id: resolvedParentId }).eq("id", resolvedEmployerId)
            }

            const contractType = formData.contractType === "leverandør-ref" ? "leverandør" : (formData.contractType ?? undefined)
            const overenskomstVal = formData.overenskomst === "ingen" ? null : (formData.overenskomst ?? undefined)

            const { error: contractError } = await supabase.rpc("admin_validate_contract", {
                p_contract_id:      id,
                p_status:           "valideret",
                p_employer_id:      resolvedEmployerId ?? null,
                p_type:             contractType ?? null,
                p_overenskomst:     overenskomstVal ?? null,
                p_rights_holder_id: (selectedRhId && selectedRhId !== reviewingContract?.rights_holder_id) ? selectedRhId : null,
            })

            if (contractError) throw new Error(`Kontraktstatus kunne ikke opdateres: ${contractError.message}`)

            leaveReview()
            window.dispatchEvent(new CustomEvent("contracts-updated"))
            if (c) toast.success(`"${c.displayTitle}" er godkendt`)
            await loadContracts()
        } catch (err: any) {
            toast.error(`Fejl ved godkendelse: ${err.message}`)
        } finally {
            setSaving(false)
        }
    }

    const handleReject = async (id: string) => {
        const c = contracts.find(x => x.id === id)
        const supabase = createClient()
        await supabase.from("contracts").update({ status: "arkiveret" }).eq("id", id)
        leaveReview()
        window.dispatchEvent(new CustomEvent("contracts-updated"))
        if (c) toast.error(`"${c.displayTitle}" er afvist`)
        await loadContracts()
    }

    // Smart merge: AI-værdier må kun fylde tomme felter — bevar brugerens input
    const buildFormFromAi = (ed: Record<string, any>) => {
        const overenskomst = ed.overenskomst ?? "ingen"
        const isLeverandoer = ed.contractType === "leverandør" || ed.isFreelanceContract
        const isALoen = !isLeverandoer

        // Afledte værdier baseret på overenskomst — ikke AI-udtrækt, men deterministisk
        // De4-fiktionsoverenskomst: helligdagsbetaling 1%, BETA 0,5%, SVOD og Copydan inkluderet
        const impliedDe4 = isALoen && overenskomst === "de4-fiktion"
        // Ingen overenskomst (kun funktionærloven): ingen helligdag/BETA
        const ingenOverenskomst = !overenskomst || overenskomst === "ingen"

        return {
            producerName: (() => {
                const raw = ed.employerName ?? ed.producerName ?? ed.parentCompanyName ?? ""
                // Normaliser ALL CAPS til title case (bevarer blandinget case som er)
                return raw === raw.toUpperCase() && raw.length > 3
                    ? raw.replace(/\b\w+/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                    : raw
            })(),
            rightsHolderName:              ed.rightsHolderName ?? "",
            workTitle:                     ed.workTitle ?? "",
            creditedRoles:                 Array.isArray(ed.creditedRoles) ? ed.creditedRoles.join(", ") : (ed.creditedRoles ?? ""),
            productionType:                ed.productionType ?? "",
            contractType:                  ed.collectiveAgreementByReference
                                               ? "leverandør-ref"
                                               : isLeverandoer ? "leverandør" : "a-løn",
            overenskomst,
            salary:                        ed.salary ?? "",
            salaryUnit:                    ed.salaryUnit ?? "monthly",
            startDate:                     ed.startDate ?? "",
            endDate:                       ed.endDate ?? "",
            pensionPercent:                ed.pensionPercent ?? (impliedDe4 ? 9.5 : ""),
            pensionSupplement:             ed.pensionSupplement ?? "",
            personalSupplement:            ed.personalSupplement ?? "",
            otherSupplements:              ed.otherSupplements ?? "",
            workingWeeks:                  ed.workingWeeks ?? "",
            prolongationWeeks:             ed.prolongationWeeks ?? "",
            prolongationNote:              ed.prolongationNote ?? "",
            // SVOD og Copydan: kun fra AI-udtræk — ingen hardcoded overenskomst-lister
            svod:                          !!ed.svod,
            copydan:                       !!ed.copydan,
            royalty:                       !!ed.royalty,
            royaltyPercent:                ed.royaltyPercent ?? "",
            aiDataMiningClause:            !!ed.aiDataMiningClause,
            distribution:                  Array.isArray(ed.distribution) ? ed.distribution.join(", ") : (ed.distribution ?? ""),
            collectiveAgreementName:       ed.collectiveAgreementName ?? "",
            gender:                        ed.gender ?? "",
            // Helligdagsbetaling og BETA: kun ved De4, null ved ingen overenskomst
            holidayPayRate:                impliedDe4 ? 1 : ingenOverenskomst ? "" : (ed.holidayPayRate ?? ""),
            betaRate:                      impliedDe4 ? 0.5 : ingenOverenskomst ? "" : (ed.betaRate ?? ""),
            specialNotes:                  ed.specialNotes ?? "",
            collectiveAgreement:           !!ed.collectiveAgreement,
            isFreelanceContract:           !!ed.isFreelanceContract,
            collectiveAgreementByReference:!!ed.collectiveAgreementByReference,
        }
    }

    // Udfyld kun felter brugeren ikke selv har redigeret
    const mergeWithAi = (ed: Record<string, any>) => {
        const ai = buildFormFromAi(ed)
        setFormData(prev => {
            const next: typeof prev = { ...prev }
            for (const key of Object.keys(ai) as (keyof typeof ai)[]) {
                if (!brugerRedigerede.has(key)) {
                    (next as any)[key] = ai[key]
                }
            }
            return next
        })
    }

    // Overskriv AI-felter — respektér stadig manuelt redigerede felter
    const overwriteWithAi = (ed: Record<string, any>) => {
        const ai = buildFormFromAi(ed)
        setFormData(prev => {
            const next: typeof prev = { ...prev }
            for (const key of Object.keys(ai) as (keyof typeof ai)[]) {
                if (!brugerRedigerede.has(key)) {
                    (next as any)[key] = ai[key]
                }
            }
            return next
        })
    }

    const handleExtractClick = async () => {
        // Kan bruge lokal fil ELLER kontrakt fra Storage
        const hasStoragePdf = !!reviewingContract?.pdf_url && !localPdfFile
        if (!localPdfFile && !hasStoragePdf) {
            toast.error("Ingen PDF tilknyttet kontrakten")
            return
        }

        // Storage-PDF: udtræk direkte server-side via validate/extract
        if (hasStoragePdf && !localPdfFile) {
            setScreening(true)
            try {
                const resp = await fetch("/api/validate/extract", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contractId: reviewingContract!.id, pdfPath: reviewingContract!.pdf_url }),
                })
                const json = await resp.json()
                if (!resp.ok) throw new Error(json.error)
                if (json.data?._sources) setSources(normaliseSources(json.data._sources))
                if (json.layout) setContractLayout(json.layout)
                // [LAG5-DEBUG-A] Trin 1: er layout modtaget og indeholder det clauses?
                console.log("[LAG5-A] layout i svar:", json.layout ? `${json.layout.clauses?.length} klausuler, type=${json.layout.type}` : "MANGLER")
                console.log("[LAG5-A] salary_clause_id fra sources:", json.data?._sources?.salary_clause_id ?? "null/undefined")
                if (json.maskedText) setContractText(json.maskedText)
                overwriteWithAi(json.data)
                toast.success("Felter opdateret fra AI-udtræk")
            } catch (e: any) {
                toast.error(`Udtræk fejlede: ${e.message}`)
            } finally {
                setScreening(false)
            }
            return
        }

        // Lokal fil: vis maskeringsvisning først
        setTextLoading(true)
        try {
            const { extractTextFromFile } = await import("@/lib/ai")
            const raw = contractText || await extractTextFromFile(localPdfFile!)
            const masked = maskPersonalData(raw)
            const types: string[] = []
            if (masked.includes("[CPR-NUMMER]")) types.push("CPR-numre")
            if (masked.includes("[KONTONUMMER]") || masked.includes("[IBAN]")) types.push("kontonumre")
            if (masked.includes("[TELEFON]")) types.push("telefonnumre")
            if (masked.includes("[EMAIL]")) types.push("email-adresser")
            if (masked.includes("[ADRESSE]")) types.push("adresser")
            if (masked.includes("[POSTNR-BY]")) types.push("postnumre")
            if (masked.includes("[CVR-NUMMER]")) types.push("CVR-numre")
            const count = (masked.match(/\[(?:CPR-NUMMER|KONTONUMMER|IBAN|TELEFON|EMAIL|ADRESSE|POSTNR-BY|CVR-NUMMER)\]/g) || []).length
            setMaskingPreview({ count, types })
            setMaskedText(masked)
            setShowMaskingConfirm(true)
        } catch (e: any) {
            toast.error(`Kunne ikke forberede udtræk: ${e.message}`)
        } finally {
            setTextLoading(false)
        }
    }

    const handleExtract = async () => {
        if (!localPdfFile && !maskedText) return
        setScreening(true)
        try {
            let textToSend = maskedText
            let originalText = contractText
            if (!textToSend && localPdfFile) {
                const { extractTextFromFile } = await import("@/lib/ai")
                const raw = await extractTextFromFile(localPdfFile)
                if (!raw.trim()) throw new Error("Ingen tekst fundet i filen")
                originalText = raw
                textToSend = maskPersonalData(raw)
            }
            if (!textToSend?.trim()) throw new Error("Ingen tekst fundet i filen")

            // Brug contracts/extract (fuld admin-prompt med kilder og highlights)
            const fd = new FormData()
            fd.append("maskedText", textToSend)
            const resp = await fetch("/api/contracts/extract", { method: "POST", body: fd })
            if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error ?? `Fejl ${resp.status}`) }
            const data = await resp.json()
            if (!data.ok) throw new Error(data.error ?? "AI returnerede ingen data")
            const ed = data.data
            if (!ed) throw new Error("AI returnerede ingen data")
            if (originalText) { try { setContractText(originalText) } catch { /* ok */ } }
            if (ed._sources) setSources(normaliseSources(ed._sources))
            overwriteWithAi(ed)

            // Navnetjek — vis toast og tilføj til specialNotes ved afvigelse
            if (data.navneTjek && data.navneTjek.status !== "match") {
                const tjek = data.navneTjek
                const besked = tjek.feedbackpunkt?.beskrivelse ?? `Navnetjek: ${tjek.status}`
                if (tjek.status === "ikke-fundet") {
                    toast.warning(`⚠ ${besked}`)
                } else {
                    toast.info(`ℹ ${besked}`)
                }
                setField("specialNotes", [formData.specialNotes, `Navnetjek: ${besked}`].filter(Boolean).join("\n"))
            }

            toast.success("Felter opdateret fra AI-udtræk")
        } catch (e: any) { toast.error(`Udtræk fejlede: ${e.message}`) }
        setScreening(false)
    }

    const handleDelete = async (id: string) => {
        const c = contracts.find(x => x.id === id)
        const supabase = createClient()
        await supabase.from("contracts").delete().eq("id", id)
        setDeleteId(null)
        if (reviewingId === id) leaveReview()
        if (c) toast.success(`"${c.displayTitle}" er slettet`)
        await loadContracts()
    }

    const isLocked = (key: string) => brugerRedigerede.has(key)

    // Aktiver source-link: fieldId identificerer knappen, quote navigerer i PDF
    const activateSource = (fieldId: string, quote: string | null | undefined) => {
setActiveField(fieldId)
        setActiveSource(quote ?? null)
    }

    const setField = (key: string, value: unknown, fromAi = false) => {
        setFormData(prev => ({ ...prev, [key]: value }))
        if (!fromAi) {
            setBrugerRedigerede(prev => { const next = new Set(prev); next.add(key); return next })
        }
    }

    const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setLocalPdfUrl(URL.createObjectURL(file))
        setLocalPdfFile(file)
        if (!file.name.endsWith(".pdf") && file.type !== "application/pdf") {
            setTextLoading(true)
            try {
                const { extractTextFromFile } = await import("@/lib/ai")
                const text = await extractTextFromFile(file)
                setContractText(text)
            } catch (err) {
                console.error("Tekstudtræk fejlede:", err)
            } finally {
                setTextLoading(false)
            }
        }
    }

    // ── Review view ───────────────────────────────────────────
    if (reviewingContract) {
        const pdfUrl = localPdfUrl ?? reviewingContract.signedPdfUrl

        // Pre-processér sources med resolveAnker() + gem metadata til UI-indikatorer
        const resolveWithMeta = (s: string | null | undefined) => {
            if (!s) return { anker: undefined, erBeløb: false, forGenerisk: false }
            const tekstGrundlag = contractText || storedDocxText || ""
            if (!tekstGrundlag) return { anker: s, erBeløb: false, forGenerisk: false }
            const r = resolveAnker(s, tekstGrundlag)
            return {
                anker: r.fundet ? r.anker : s,
                erBeløb: r.erBeløb,
                forGenerisk: r.fejltype === "for_generisk",
            }
        }
        const resolve = (s: string | null | undefined) => resolveWithMeta(s).anker

        // Bestem datakilde per felt
        const submittedByMember = !!(reviewingContract?.validation?.extracted_data as any)?.submittedByMember
        const fieldSrc = (key: string, impliedByOverenskomst = false): DataSource => {
            if (isLocked(key)) return "manuel"
            if (impliedByOverenskomst) return "overenskomst"
            if (submittedByMember && (key === "workTitle" || key === "creditedRoles")) return "klipper"
            if (formData[key] !== undefined && formData[key] !== "" && formData[key] !== null) return "ai"
            return undefined
        }

        const salaryMeta = resolveWithMeta(sources.salary)
        const svodMeta = resolveWithMeta(sources.svod)
        const copydanMeta = resolveWithMeta(sources.copydan)
        const royaltyMeta = resolveWithMeta(sources.royalty)
        const caMeta = resolveWithMeta(sources.collectiveAgreement)

        // Bare tal (uden AI-fundet kildesætning) er farlige som highlight-mål —
        // uden omkringliggende kontekst kan resolveAnker() ikke skelne det
        // tiltænkte beløb fra et vilkårligt andet forekommende tal i dokumentet
        // (fx et postnummer). Brug kun det bare tal, hvis det rent faktisk er
        // entydigt i dokumentet — ellers vis intet highlight frem for et forkert.
        const safeNumberFallback = (value: unknown) => {
            if (value === undefined || value === null || value === "") return undefined
            const meta = resolveWithMeta(String(value))
            return meta.forGenerisk ? undefined : meta.anker
        }

        const prolongHl = resolve((sources as any).prolongation)
        const creditHl = resolve(sources.creditedRoles)
        const salaryHl = salaryMeta.anker ?? safeNumberFallback(formData.salary)
        const workTitleHl = resolve(sources.workTitle)
        const datesHl = resolve(sources.dates)
        const weeksHl = resolve(sources.workingWeeks)
        const supplementsHl = resolve(sources.supplements) ?? safeNumberFallback(formData.personalSupplement)
        const svodSrc = svodMeta.anker ?? null
        const ca = caMeta.anker ?? null
        // Copydan/royalty: brug specifik kilde hvis AI fandt én, ellers fald tilbage til overenskomst-referencen
        const copydanSrc = copydanMeta.anker ?? ca
        const royaltySrc = royaltyMeta.anker ?? ca
        // Each value is a ||‑separated list of candidates tried in order by findPageForQuote.
        // Source quote first (most specific), then generic fallbacks so navigation always finds something.
        // Specific clause terms go FIRST — svodSrc/copydanSrc may be an overenskomst
        // reference from page 1, so we must find the actual clause text before falling back to it.
        const rightsPageSource: Record<string, string> = {
            svod:    ["SVOD", "Create Denmark", "streaming", "SVOD platforme", svodSrc].filter(Boolean).join("||"),
            copydan: ["Copydan", "privatkopiering", "Copy-dan", "vederlagsret", "§§ 13", "§§ 35", "Ophavsretslovens §", copydanSrc].filter(Boolean).join("||"),
            // Royalty: brug specifik kilde FØRST — "royalt"-keyword matcher for bredt som første kandidat
            royalty: [royaltySrc, "afregner royalties", "royalties til", "royaltybetaling"].filter(Boolean).join("||"),
            agreement: [ca, "STANDARDKONTRAKT", "Standardkontrakt", "overenskomst", "ikke omfattet af kollektive"].filter(Boolean).join("||"),
        }
        const rightsHighlightSource: Record<string, string> = {
            svod:    ["SVOD", "Create Denmark", "streaming", "SVOD platforme", svodSrc].filter(Boolean).join("||"),
            copydan: ["Copydan", "privatkopiering", "Copy-dan", "vederlagsret", "§§ 13", "§§ 35", "Ophavsretslovens §", copydanSrc].filter(Boolean).join("||"),
            royalty: [royaltySrc ? royaltySrc.slice(0, 40) : null, royaltySrc ? royaltySrc.slice(0, 20) : null, "afregner royalties", "royalties til"].filter(Boolean).join("||"),
            agreement: [ca ? ca.slice(0, 40) : null, "STANDARDKONTRAKT", "Standardkontrakt", "overenskomst", "ikke omfattet af kollektive"].filter(Boolean).join("||"),
        }
        // Lag 5: map aktivt felt til klausul-ID fra sources (primær) — fallback til teksthighlight
        const FIELD_TO_CLAUSE_ID: Record<string, string | null | undefined> = {
            workTitle: sources.workTitle_clause_id,
            salary: sources.salary_clause_id,
            pension: sources.pension_clause_id,
            supplements: sources.supplements_clause_id,
            otherSupplements: sources.otherSupplements_clause_id,
            dates: sources.dates_clause_id,
            workingWeeks: sources.workingWeeks_clause_id,
            agreement: sources.collectiveAgreement_clause_id,
            copydan: sources.copydan_clause_id,
            svod: sources.svod_clause_id,
            // Royalty er ofte deterministisk udledt fra overenskomsten, ikke fundet i selve
            // kontraktteksten — falder da tilbage til overenskomst-henvisningens klausul-ID,
            // i stedet for at falde helt tilbage til den gamle, upræcise tekst-søgning.
            royalty: sources.royalty_clause_id ?? sources.collectiveAgreement_clause_id,
            prolongation: sources.prolongation_clause_id,
            creditedRoles: sources.creditedRoles_clause_id,
        }
        const activeClauseId = activeField ? (FIELD_TO_CLAUSE_ID[activeField] ?? null) : null
        if (activeField) console.log(`[LAG5-B] activeField=${activeField} → activeClauseId=${activeClauseId ?? "null"}, layout=${contractLayout ? contractLayout.clauses.length + " klausuler" : "NULL"}`)

        // Alle gyldige klausul-ID'er på tværs af felter — bruges til koordinat-bokse og filtrering af tekst-highlights
        const allClauseIds = Object.values(FIELD_TO_CLAUSE_ID).filter((id): id is string => !!id)
        const inactiveClauseIds = allClauseIds.filter(id => id !== activeClauseId)

        // Hjælper: har feltet en koordinat-boks tilgængelig i det aktuelle layout?
        const hasCoord = (clauseId: string | null | undefined): boolean =>
            !!clauseId && !!contractLayout?.clauses.find(c => c.id === clauseId)?.pdfBbox

        // PDF-highlights: tekst-søgning kun for felter UDEN koordinat-dækning.
        // Felter med et gyldigt clause_id + pdfBbox vises som koordinat-boks — ingen dobbelt-markering.
        const pdfHighlights = [
            hasCoord(sources.workTitle_clause_id)       ? null : workTitleHl,
            hasCoord(sources.creditedRoles_clause_id)   ? null : creditHl,
            hasCoord(sources.salary_clause_id)          ? null : salaryHl,
            hasCoord(sources.pension_clause_id)         ? null : sources.pension,
            hasCoord(sources.supplements_clause_id)     ? null : supplementsHl,
            hasCoord(sources.otherSupplements_clause_id)? null : sources.otherSupplements,
            hasCoord(sources.dates_clause_id)           ? null : datesHl,
            hasCoord(sources.workingWeeks_clause_id)    ? null : weeksHl,
            hasCoord(sources.prolongation_clause_id)    ? null : prolongHl,
        ].filter(Boolean) as string[]


        const resolvedActiveHighlight = activeField
            ? (rightsHighlightSource[activeField] || rightsPageSource[activeField] || activeSource)
            : null
        const resolvedPageSource = activeField
            ? (rightsPageSource[activeField] || activeSource)
            : null
        // Only show section highlights for the currently active rights button —
        // always-on generic terms like "§§" match too many wrong spans.
        const activeSectionHighlights: string[] = activeField && rightsHighlightSource[activeField]
            ? rightsHighlightSource[activeField].split("||").map(s => s.trim()).filter(Boolean)
            : []

        return (
            <>
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={leaveReview}>
                        <ArrowLeft className="h-4 w-4" />{t("admin.validation.backToList")}
                    </Button>
                    <Separator orientation="vertical" className="h-5" />
                    <span className="text-sm font-medium">{reviewingContract.displayTitle}</span>
                    {reviewingContract.displayEmployer && (
                        <span className="text-xs text-muted-foreground">({reviewingContract.displayEmployer})</span>
                    )}
                    <span className="text-xs text-muted-foreground">— {reviewingContract.displayMember}</span>
                    <Badge variant={statusVariant[reviewingContract.status] ?? "outline"} className="ml-2 text-xs font-normal">
                        {statusLabel[reviewingContract.status] ?? reviewingContract.status}
                    </Badge>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* PDF viewer */}
                    <div className="rounded-lg border overflow-hidden" style={{ height: "80vh" }}>
                        <div className="flex items-center justify-between border-b px-4 py-3">
                            <span className="text-sm font-medium">{t("admin.validation.document")}</span>
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                <Upload className="h-3.5 w-3.5" />
                                {t("admin.validation.uploadLocal")}
                                <input type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={handleFileInput} />
                            </label>
                        </div>
                        {/* Lokal DOCX-fil */}
                        {localPdfFile && (localPdfFile.name.endsWith(".docx") || localPdfFile.name.endsWith(".doc")) ? (
                            <TextViewer text={contractText} loading={textLoading}
                                highlights={[workTitleHl, creditHl ?? null, salaryHl, sources.pension ?? null, supplementsHl ?? null, sources.otherSupplements ?? null, datesHl, weeksHl, prolongHl ?? null].filter(Boolean) as string[]}
                                sectionHighlights={activeSectionHighlights}
                                activeHighlight={resolvedActiveHighlight} />

                        ) : storedDocxText !== null || storedDocxLoading ? (
                            /* DOCX fra Storage — vis som tekst */
                            <TextViewer
                                text={storedDocxText ?? ""}
                                loading={storedDocxLoading}
                                highlights={[workTitleHl, creditHl ?? null, salaryHl, sources.pension ?? null, supplementsHl ?? null, sources.otherSupplements ?? null, datesHl, weeksHl, prolongHl ?? null].filter(Boolean) as string[]}
                                sectionHighlights={activeSectionHighlights}
                                activeHighlight={resolvedActiveHighlight} />

                        ) : pdfUrl ? (
                            /* PDF */
                            <PdfViewer
                                url={pdfUrl}
                                highlights={pdfHighlights}
                                sectionHighlights={activeSectionHighlights}
                                activeHighlight={resolvedActiveHighlight}
                                pageNavigationHint={resolvedPageSource ?? undefined}
                                layout={contractLayout}
                                activeClauseId={activeClauseId}
                                inactiveClauseIds={inactiveClauseIds}
                            />
                        ) : (
                            <div className="flex flex-1 h-full items-center justify-center text-sm text-muted-foreground">
                                <div className="text-center space-y-2">
                                    <FileText className="mx-auto h-8 w-8 opacity-30" />
                                    <p>{t("admin.validation.uploadPrompt")}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Data extraction form — 4-tab layout */}
                    <div className="rounded-lg border flex flex-col" style={{ maxHeight: "80vh" }}>
                        {/* Sticky header med AI-udtræk og tab-nav */}
                        <div className="border-b px-4 py-3 sticky top-0 bg-background z-10 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{t("admin.validation.extracted")}</span>
                                <div className="ml-auto flex items-center gap-2">
                                    {Object.keys(sources).length > 0 && (
                                        <span className="text-[10px] text-muted-foreground">
                                            {Object.entries(sources).filter(([, v]) => v).length} kilder fundet
                                        </span>
                                    )}
                                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                                        onClick={handleExtractClick} disabled={screening || textLoading || (!localPdfFile && !reviewingContract?.pdf_url)}
                                        title={(!localPdfFile && !reviewingContract?.pdf_url) ? "Ingen PDF tilknyttet kontrakten" : reviewingContract?.pdf_url && !localPdfFile ? "Kører udtræk fra gemt PDF" : ""}>
                                        <Sparkles className={`h-3.5 w-3.5 ${(screening || textLoading) ? "animate-pulse" : ""}`} />
                                        {screening ? "Udtrækker..." : textLoading ? "Forbereder..." : "AI-udtræk"}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Legende */}
                        <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/20 text-[10px] text-muted-foreground flex-wrap">
                            <span className="font-medium text-foreground">Datakilde:</span>
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-100 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 shrink-0" />AI-udtræk</span>
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-100 dark:bg-amber-900 border border-amber-200 dark:border-amber-700 shrink-0" />Overenskomst</span>
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-100 dark:bg-emerald-900 border border-emerald-200 dark:border-emerald-700 shrink-0" />Fra klipper</span>
                            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted border border-border shrink-0" /><Lock className="h-2.5 w-2.5" />Manuelt sat</span>
                        </div>

                        <Tabs defaultValue="parter" className="flex flex-col flex-1 min-h-0">
                            <TabsList className="flex w-full rounded-none border-b bg-muted/30 px-2 pt-2 gap-1 justify-start h-auto shrink-0">
                                <TabsTrigger value="parter" className="text-xs rounded-t-md data-[state=active]:bg-background data-[state=active]:shadow-none border-b-2 data-[state=active]:border-foreground border-transparent pb-2">
                                    Parter
                                </TabsTrigger>
                                <TabsTrigger value="oekonomi" className="text-xs rounded-t-md data-[state=active]:bg-background data-[state=active]:shadow-none border-b-2 data-[state=active]:border-foreground border-transparent pb-2">
                                    Økonomi
                                </TabsTrigger>
                                <TabsTrigger value="rettigheder" className="text-xs rounded-t-md data-[state=active]:bg-background data-[state=active]:shadow-none border-b-2 data-[state=active]:border-foreground border-transparent pb-2">
                                    Rettigheder
                                </TabsTrigger>
                                <TabsTrigger value="godkend" className="text-xs rounded-t-md data-[state=active]:bg-background data-[state=active]:shadow-none border-b-2 data-[state=active]:border-foreground border-transparent pb-2">
                                    Godkend
                                </TabsTrigger>
                            </TabsList>

                            {/* ── TAB 1: PARTER ── */}
                            <TabsContent value="parter" className="flex-1 overflow-y-auto p-4 space-y-4 mt-0">
                                {/* Kontekst: work fra portal */}
                                {reviewingContract.work_id ? (
                                    <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
                                        <FileText className="h-3.5 w-3.5 shrink-0" />
                                        <span>Tilknyttet: <strong>{reviewingContract.displayTitle}</strong></span>
                                    </div>
                                ) : (
                                    <F src={fieldSrc("workTitle")} label={<>Arbejdstitel{workTitleHl && <SourceBtn quote={workTitleHl} active={activeField === "workTitle"} onClick={() => activateSource("workTitle", workTitleHl)} />}</>}>
                                        <Input value={String(formData.workTitle ?? "")} onChange={(e) => setField("workTitle", e.target.value)} placeholder="Produktionens arbejdstitel..." />
                                    </F>
                                )}

                                <Separator />

                                <F
                                    src={fieldSrc("producerName")}
                                    label={t("admin.validation.producer")}
                                    action={
                                        <button type="button" className="text-[11px] text-primary underline underline-offset-2"
                                            onClick={() => { setNewEmpName(formData.producerName?.trim() ?? ""); setNewEmpCvr(""); setNewEmpDfiId(null); setNewEmpRelation(null); setNewEmpDfiResults([]); setNewEmpDbMatches([]); setShowNewEmployer(true) }}>
                                            + Opret ny
                                        </button>
                                    }
                                >
                                    <Input
                                        value={String(formData.producerName ?? "")}
                                        onChange={(e) => { setField("producerName", e.target.value); setSelectedEmployerId(null) }}
                                        placeholder="Producentens navn..."
                                        className={!selectedEmployerId && (formData.producerName?.trim()?.length ?? 0) > 2
                                            ? "border-amber-400 focus-visible:ring-amber-400"
                                            : selectedEmployerId ? "border-emerald-400" : ""}
                                    />
                                    {selectedEmployerId && (
                                        <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
                                            <Check className="h-3 w-3 shrink-0" />Koblet til eksisterende producent i DB
                                        </p>
                                    )}
                                    {!selectedEmployerId && (formData.producerName?.trim()?.length ?? 0) > 2 && (
                                        <div className="mt-1.5 space-y-1.5">
                                            <p className="text-[11px] text-amber-700 flex items-center gap-1.5">
                                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                                <span>Ingen match — <button type="button" className="underline underline-offset-2 font-medium" onClick={() => { setNewEmpName(formData.producerName?.trim() ?? ""); setNewEmpCvr(""); setNewEmpDfiId(null); setNewEmpRelation(null); setNewEmpDfiResults([]); setNewEmpDbMatches([]); setShowNewEmployer(true) }}>opret i databasen</button></span>
                                            </p>
                                            {(searchingDfi || employerSuggestions.length > 0) && (
                                                <div className="rounded-md border bg-muted/20">
                                                    <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                                        Forslag fra DB og DFI {searchingDfi && <Loader2 className="h-3 w-3 animate-spin" />}
                                                    </p>
                                                    <div className="divide-y">
                                                        {employerSuggestions.map((s, i) => (
                                                            <button key={i} type="button"
                                                                className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center justify-between gap-2"
                                                                onClick={() => { setField("producerName", s.name); setSelectedEmployerId(s.id); setEmployerSuggestions([]) }}>
                                                                <span className="font-medium">{s.name}</span>
                                                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.source === "db" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                                                                    {s.source === "db" ? "DB" : "DFI"}
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </F>

                                <F label="Moderselskab (valgfrit)">
                                    {parentExplicitNone ? (
                                        <div className="flex items-center gap-2 rounded border px-3 py-1.5 text-xs text-muted-foreground bg-muted/30">
                                            <span className="flex-1">Ingen moderselskab</span>
                                            <button type="button" className="hover:text-foreground" onClick={() => setParentExplicitNone(false)}>
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <Input
                                                value={selectedDfiParent?.name ?? (selectedParentId ? (employers.find(e => e.id === selectedParentId)?.name ?? "") : "")}
                                                onChange={() => { setSelectedParentId(null); setSelectedDfiParent(null); setParentExplicitNone(false) }}
                                                placeholder="Søges automatisk fra DB..."
                                                className="text-xs"
                                            />
                                            {(selectedParentId || selectedDfiParent) && (
                                                <button className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" onClick={() => { setSelectedParentId(null); setSelectedDfiParent(null) }}>
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {!parentExplicitNone && parentSuggestions.length > 0 && !selectedParentId && !selectedDfiParent && (
                                        <div className="mt-1 rounded-md border bg-background shadow-sm divide-y">
                                            {parentSuggestions.map((s, i) => (
                                                <button key={i} type="button" className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center justify-between gap-2"
                                                    onClick={() => { if (s.id) { setSelectedParentId(s.id); setSelectedDfiParent(null) } else if (s.dfi_id) { setSelectedDfiParent({ id: s.dfi_id, name: s.name }); setSelectedParentId(null) } setParentSuggestions([]) }}>
                                                    <span className="font-medium">{s.name}</span>
                                                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.source === "db" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{s.source === "db" ? "DB" : "DFI"}</span>
                                                </button>
                                            ))}
                                            <button type="button" className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 text-muted-foreground italic"
                                                onClick={() => { setParentExplicitNone(true); setParentSuggestions([]) }}>
                                                Ingen moderselskab
                                            </button>
                                        </div>
                                    )}
                                    {!parentExplicitNone && !selectedParentId && !selectedDfiParent && parentSuggestions.length === 0 && (
                                        <button type="button" className="mt-1 text-[10px] text-muted-foreground underline hover:text-foreground"
                                            onClick={() => { setParentExplicitNone(true); setParentSuggestions([]) }}>
                                            Sæt til ingen moderselskab
                                        </button>
                                    )}
                                </F>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    {formData.rightsHolderName !== undefined && (
                                        <F src={fieldSrc("rightsHolderName")} label="Medarbejder / Klipper" locked={isLocked("rightsHolderName")}>
                                            <Input
                                                value={String(formData.rightsHolderName ?? "")}
                                                onChange={(e) => { setField("rightsHolderName", e.target.value); setSelectedRhId(null) }}
                                                placeholder="Klipperens fulde navn..."
                                            />
                                            {selectedRhId && (
                                                <div className="mt-1.5 flex items-center gap-2 text-xs text-green-700 font-medium">
                                                    <span>✓ Koblet til rettighedshaver</span>
                                                    <button type="button" className="underline text-muted-foreground" onClick={() => setSelectedRhId(null)}>Fjern</button>
                                                </div>
                                            )}
                                            {!selectedRhId && rhSuggestions.length > 0 && (
                                                <div className="mt-1.5 space-y-1">
                                                    {rhSuggestions.map(s => (
                                                        <button key={s.id} type="button" className="w-full text-left px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                                                            onClick={() => setSelectedRhId(s.id)}>
                                                            {s.name} <span className="text-muted-foreground">({Math.round(s.score * 100)}% match)</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {!selectedRhId && formData.rightsHolderName && rhSuggestions.length === 0 && (formData.rightsHolderName as string).length > 2 && (
                                                <p className="mt-1 text-xs text-amber-600">Ikke fundet i rettighedshavere</p>
                                            )}
                                        </F>
                                    )}
                                    <F src={fieldSrc("creditedRoles")} label={<>Kreditering{creditHl && <SourceBtn quote={creditHl} active={activeField === "creditedRoles"} onClick={() => activateSource("creditedRoles", creditHl)} />}</>}>
                                        <Input value={String(formData.creditedRoles ?? "")} onChange={(e) => setField("creditedRoles", e.target.value)} placeholder="Klipper, Film Editor..." />
                                    </F>
                                </div>

                                <Separator />

                                <F src={fieldSrc("productionType")} label="Produktionstype" locked={isLocked("productionType")}>
                                    <Select value={formData.productionType ?? ""} onValueChange={(v) => setField("productionType", v)}>
                                        <SelectTrigger><SelectValue placeholder="Vælg type..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="documentary" className="font-medium text-muted-foreground text-[10px]" disabled>── Dokumentar ──</SelectItem>
                                            <SelectItem value="documentary">Dokumentarfilm</SelectItem>
                                            <SelectItem value="docSeries">Dokumentarserie</SelectItem>
                                            <SelectItem value="udvikling_dokumentar">Udvikling (dokumentar)</SelectItem>
                                            <SelectItem value="feature" className="font-medium text-muted-foreground text-[10px]" disabled>── Fiktion ──</SelectItem>
                                            <SelectItem value="feature">Spillefilm</SelectItem>
                                            <SelectItem value="tvSeries">TV-serie</SelectItem>
                                            <SelectItem value="short">Kortfilm</SelectItem>
                                            <SelectItem value="udvikling_fiktion">Udvikling (fiktion)</SelectItem>
                                            <SelectItem value="tvEntertainment" className="font-medium text-muted-foreground text-[10px]" disabled>── Underholdning ──</SelectItem>
                                            <SelectItem value="tvEntertainment">TV-underholdning</SelectItem>
                                            <SelectItem value="reality">Reality</SelectItem>
                                            <SelectItem value="udvikling_underholdning">Udvikling (underholdning)</SelectItem>
                                            <SelectItem value="other" className="font-medium text-muted-foreground text-[10px]" disabled>── Andet ──</SelectItem>
                                            <SelectItem value="other">Andet</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </F>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F src={fieldSrc("contractType")} label="Kontrakttype" locked={isLocked("contractType")}>
                                        <Select value={formData.contractType ?? "a-løn"}
                                            onValueChange={(v) => { setField("contractType", v); setField("collectiveAgreement", v === "a-løn" || v === "leverandør-ref"); setField("collectiveAgreementByReference", v === "leverandør-ref"); setField("isFreelanceContract", v !== "a-løn") }}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="a-løn">A-løn</SelectItem>
                                                <SelectItem value="leverandør">Leverandør</SelectItem>
                                                <SelectItem value="leverandør-ref">Leverandør (OK ved reference)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </F>
                                    <F src={fieldSrc("overenskomst")} label={<>{t("admin.validation.agreement")}<SourceBtn quote={ca ?? undefined} active={activeField === "agreement"} onClick={() => activateSource("agreement", ca)} /></>}>
                                        <Select value={formData.overenskomst ?? "ingen"} onValueChange={(v) => setField("overenskomst", v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {overenskomster.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                                <SelectItem value="ingen">Ingen overenskomst</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </F>
                                </div>

                                <F src={fieldSrc("gender")} label={t("admin.validation.gender")}>
                                    <Select value={formData.gender ?? ""} onValueChange={(v) => setField("gender", v)}>
                                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="male">{t("admin.stats.male")}</SelectItem>
                                            <SelectItem value="female">{t("admin.stats.female")}</SelectItem>
                                            <SelectItem value="other">Andet</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </F>
                            </TabsContent>

                            {/* ── TAB 2: ØKONOMI ── */}
                            <TabsContent value="oekonomi" className="flex-1 overflow-y-auto p-4 space-y-4 mt-0">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F src={fieldSrc("salary")} label={<>{t("admin.validation.salary")}{salaryMeta.erBeløb && <span title="Forankret i beløb" className="ml-1 text-amber-500">💰</span>}{salaryMeta.forGenerisk && <span title="Fandt flere steder" className="ml-1 text-orange-500 text-[10px] font-semibold">⚠</span>}<SourceBtn quote={salaryHl} active={activeField === "salary"} onClick={() => activateSource("salary", salaryHl)} /></>} locked={isLocked("salary")}>
                                        <Input type="number" value={String(formData.salary ?? "")} onChange={(e) => setField("salary", e.target.value)} placeholder="0" />
                                    </F>
                                    <F src={fieldSrc("salaryUnit")} label={t("admin.validation.salaryUnit")} locked={isLocked("salaryUnit")}>
                                        <Select value={formData.salaryUnit ?? "monthly"} onValueChange={(v) => setField("salaryUnit", v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="monthly">{t("admin.validation.monthly")}</SelectItem>
                                                <SelectItem value="weekly">{t("admin.validation.weekly")}</SelectItem>
                                                <SelectItem value="daily">{t("admin.validation.daily")}</SelectItem>
                                                <SelectItem value="total">{t("admin.validation.total")}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </F>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F src={fieldSrc("startDate")} label={<>{t("admin.validation.startDate")}<SourceBtn quote={datesHl} active={activeField === "dates"} onClick={() => activateSource("dates", datesHl)} /></>} locked={isLocked("startDate")}>
                                        <Input type="date" value={String(formData.startDate ?? "")} onChange={(e) => setField("startDate", e.target.value)} />
                                    </F>
                                    <F src={fieldSrc("endDate")} label={t("admin.validation.endDate")} locked={isLocked("endDate")}>
                                        <Input type="date" value={String(formData.endDate ?? "")} onChange={(e) => setField("endDate", e.target.value)} />
                                    </F>
                                </div>
                                <F src={fieldSrc("workingWeeks")} label={<>{t("admin.validation.workingWeeks")}<SourceBtn quote={weeksHl} active={activeField === "workingWeeks"} onClick={() => activateSource("workingWeeks", weeksHl)} /></>}>
                                    <Input type="number" value={String(formData.workingWeeks ?? "")} onChange={(e) => setField("workingWeeks", e.target.value)} placeholder="0" className="max-w-[120px]" />
                                </F>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F src={fieldSrc("prolongationWeeks")} label={<>Prolongationsuger{prolongHl && <SourceBtn quote={prolongHl} active={activeField === "prolongation"} onClick={() => activateSource("prolongation", prolongHl)} />}</>}>
                                        <Input type="number" value={String(formData.prolongationWeeks ?? "")} onChange={(e) => setField("prolongationWeeks", e.target.value)} placeholder="0" className="max-w-[120px]" />
                                    </F>
                                    <F src={fieldSrc("prolongationNote")} label={<>Prolongation — vilkår{prolongHl && <SourceBtn quote={prolongHl} active={activeField === "prolongation"} onClick={() => activateSource("prolongation", prolongHl)} />}</>}>
                                        <Input value={String(formData.prolongationNote ?? "")} onChange={(e) => setField("prolongationNote", e.target.value)} placeholder="fx juleferie 21.12–07.01" />
                                    </F>
                                </div>
                                <Separator />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F src={fieldSrc("pensionPercent")} label={<>{t("admin.validation.pensionPercent")}<SourceBtn quote={sources.pension ?? undefined} active={activeField === "pension"} onClick={() => activateSource("pension", sources.pension)} /></>}>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.1" value={String(formData.pensionPercent ?? "")} onChange={(e) => setField("pensionPercent", e.target.value)} placeholder="0" />
                                            <span className="text-sm text-muted-foreground">%</span>
                                        </div>
                                    </F>
                                    <F src={fieldSrc("pensionSupplement")} label={<>{t("admin.validation.pension")} (kr.)<SourceBtn quote={sources.pension ?? undefined} active={activeField === "pension"} onClick={() => activateSource("pension", sources.pension)} /></>}>
                                        <Input type="number" value={String(formData.pensionSupplement ?? "")} onChange={(e) => setField("pensionSupplement", e.target.value)} placeholder="0" />
                                    </F>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F src={fieldSrc("personalSupplement")} label={<>{t("admin.validation.personalSupplement")}<SourceBtn quote={supplementsHl} active={activeField === "supplements"} onClick={() => activateSource("supplements", supplementsHl)} /></>}>
                                        <Input type="number" value={String(formData.personalSupplement ?? "")} onChange={(e) => setField("personalSupplement", e.target.value)} placeholder="0" />
                                    </F>
                                    <F src={fieldSrc("otherSupplements")} label={<>{t("admin.validation.other")}{sources.otherSupplements && <SourceBtn quote={sources.otherSupplements} active={activeField === "otherSupplements"} onClick={() => activateSource("otherSupplements", sources.otherSupplements)} />}</>}>
                                        <Input value={String(formData.otherSupplements ?? "")} onChange={(e) => setField("otherSupplements", e.target.value)} placeholder="—" />
                                    </F>
                                </div>
                                <Separator />
                                <Label className="text-xs block">Producentbidrag</Label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F src={fieldSrc("holidayPayRate", true)} label={<>{t("admin.validation.holidayPay")}<SourceBtn quote={ca ?? undefined} active={activeField === "agreement"} onClick={() => activateSource("agreement", ca)} /></>}>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.1" value={String(formData.holidayPayRate ?? "")} onChange={(e) => setField("holidayPayRate", e.target.value)} placeholder="Ikke nævnt" className="max-w-[120px]" />
                                            {formData.holidayPayRate && <span className="text-sm text-muted-foreground">%</span>}
                                        </div>
                                    </F>
                                    <F src={fieldSrc("betaRate", true)} label={<>{t("admin.validation.beta")}<SourceBtn quote={ca ?? undefined} active={activeField === "agreement"} onClick={() => activateSource("agreement", ca)} /></>}>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.01" value={String(formData.betaRate ?? "")} onChange={(e) => setField("betaRate", e.target.value)} placeholder="Ikke nævnt" className="max-w-[120px]" />
                                            {formData.betaRate && <span className="text-sm text-muted-foreground">%</span>}
                                        </div>
                                    </F>
                                </div>
                                <F src={fieldSrc("distribution")} label={t("admin.validation.distribution")}>
                                    <Input value={formData.distribution ?? ""} onChange={(e) => setField("distribution", e.target.value)} placeholder="Netflix, DR, TV2..." />
                                </F>
                            </TabsContent>

                            {/* ── TAB 3: RETTIGHEDER ── */}
                            <TabsContent value="rettigheder" className="flex-1 overflow-y-auto p-4 space-y-4 mt-0">
                                <div>
                                    <Label className="text-xs mb-3 block font-semibold uppercase tracking-wide text-muted-foreground">Rettighedsforbehold</Label>
                                    <div className="space-y-3">
                                        <div className={`flex items-center justify-between rounded-md px-2.5 py-2 -mx-2.5 ${isLocked("svod") ? "bg-muted/40" : formData.overenskomst === "de4-fiktion" ? "bg-amber-50 dark:bg-amber-950/25" : formData.svod ? "bg-blue-50 dark:bg-blue-950/25" : ""}`}>
                                            <div>
                                                <span className="text-sm flex items-center gap-1">SVOD{svodMeta.forGenerisk && <span title="Fandt flere steder" className="text-orange-500 text-[10px] font-semibold">⚠</span>}<SourceBtn quote={svodSrc ?? undefined} active={activeField === "svod"} onClick={() => activateSource("svod", svodSrc)} /></span>
                                                <p className="text-[10px] text-muted-foreground">Streaming on-demand</p>
                                            </div>
                                            <Switch checked={formData.svod ?? false} onCheckedChange={(v) => setField("svod", v)} />
                                        </div>
                                        {pctRuleNotes["svod"] && (
                                            <div className="flex gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 -mt-1">
                                                <span className="shrink-0">⚠</span>
                                                <span>{pctRuleNotes["svod"]}</span>
                                            </div>
                                        )}
                                        <div className={`flex items-center justify-between rounded-md px-2.5 py-2 -mx-2.5 ${isLocked("copydan") ? "bg-muted/40" : formData.overenskomst === "de4-fiktion" ? "bg-amber-50 dark:bg-amber-950/25" : formData.copydan ? "bg-blue-50 dark:bg-blue-950/25" : ""}`}>
                                            <div>
                                                <span className="text-sm flex items-center gap-1">Copydan{copydanMeta.forGenerisk && <span title="Fandt flere steder" className="text-orange-500 text-[10px] font-semibold">⚠</span>}<SourceBtn quote={copydanSrc ?? undefined} active={activeField === "copydan"} onClick={() => activateSource("copydan", copydanSrc)} /></span>
                                                <p className="text-[10px] text-muted-foreground">Kollektivt vederlag</p>
                                            </div>
                                            <Switch checked={formData.copydan ?? false} onCheckedChange={(v) => setField("copydan", v)} />
                                        </div>
                                        {pctRuleNotes["copydan"] && (
                                            <div className="flex gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 -mt-1">
                                                <span className="shrink-0">⚠</span>
                                                <span>{pctRuleNotes["copydan"]}</span>
                                            </div>
                                        )}
                                        <div className={`flex items-center justify-between rounded-md px-2.5 py-2 -mx-2.5 ${isLocked("royalty") ? "bg-muted/40" : ["feature","documentary","short"].includes(formData.productionType ?? "") ? "bg-amber-50 dark:bg-amber-950/25" : formData.royalty ? "bg-blue-50 dark:bg-blue-950/25" : ""}`}>
                                            <div>
                                                <span className="text-sm flex items-center gap-1">Royalty{royaltyMeta.forGenerisk && <span title="Fandt flere steder" className="text-orange-500 text-[10px] font-semibold">⚠</span>}<SourceBtn quote={royaltySrc ?? undefined} active={activeField === "royalty"} onClick={() => activateSource("royalty", royaltySrc)} /></span>
                                                <p className="text-[10px] text-muted-foreground">Løbende royaltybetaling</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {formData.royalty && (
                                                    <div className="flex items-center gap-1">
                                                        <Input type="number" step="0.1" value={String(formData.royaltyPercent ?? "")} onChange={(e) => setField("royaltyPercent", e.target.value)} placeholder="%" className="w-16 h-7 text-xs" />
                                                        <span className="text-xs text-muted-foreground">%</span>
                                                    </div>
                                                )}
                                                <Switch checked={formData.royalty ?? false} onCheckedChange={(v) => setField("royalty", v)} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <Separator />
                                <div>
                                    <Label className="text-xs mb-3 block font-semibold uppercase tracking-wide text-muted-foreground">Kontraktbeskyttelse</Label>
                                    <RightRow label={t("admin.validation.aiClause")} desc={t("admin.validation.aiClauseDesc")} checked={formData.aiDataMiningClause ?? false} onChange={(v) => setField("aiDataMiningClause", v)} />
                                </div>
                                <Separator />
                                <F src={fieldSrc("collectiveAgreementName", true)} label="Overenskomst-navn">
                                    <Input value={String(formData.collectiveAgreementName ?? "")} onChange={(e) => setField("collectiveAgreementName", e.target.value)} placeholder="fx De4 2022-2024" />
                                </F>
                            </TabsContent>

                            {/* ── TAB 4: GODKEND ── */}
                            <TabsContent value="godkend" className="flex-1 overflow-y-auto p-4 space-y-4 mt-0">
                                {(() => {
                                    const advarsler: string[] = []
                                    if (!formData.productionType) advarsler.push("Produktionstype mangler")
                                    if (!formData.contractType) advarsler.push("Kontrakttype mangler")
                                    if (!selectedEmployerId && (formData.producerName?.trim()?.length ?? 0) > 0) advarsler.push("Producent er ikke koblet til databasen")
                                    if (!formData.salary && formData.salary !== 0) advarsler.push("Løn er ikke angivet")
                                    return (
                                        <>
                                            {advarsler.length > 0 && (
                                                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
                                                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                                        <AlertTriangle className="h-3.5 w-3.5" />Mangler inden godkendelse
                                                    </p>
                                                    {advarsler.map(a => <p key={a} className="text-xs text-amber-700 dark:text-amber-400 pl-5">· {a}</p>)}
                                                </div>
                                            )}

                                            {/* Opsummering */}
                                            <div className="rounded-md border divide-y text-xs">
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">Producent</span><span className="font-medium">{formData.producerName || "—"}{selectedEmployerId && " ✓"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">Klipper</span><span className="font-medium">{formData.rightsHolderName || "—"}{selectedRhId && " ✓"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">Produktionstype</span><span className="font-medium">{formData.productionType || "—"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">Kontrakttype</span><span className="font-medium">{formData.contractType || "—"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">Overenskomst</span><span className="font-medium">{formData.overenskomst || "—"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">Løn</span><span className="font-medium">{formData.salary ? `${formData.salary} (${formData.salaryUnit || "—"})` : "—"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">Periode</span><span className="font-medium">{formData.startDate && formData.endDate ? `${formData.startDate} – ${formData.endDate}` : "—"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">SVOD / Copydan / Royalty</span><span className="font-medium">{[formData.svod && "SVOD", formData.copydan && "Copydan", formData.royalty && `Royalty ${formData.royaltyPercent || ""}%`].filter(Boolean).join(" · ") || "Ingen"}</span></div>
                                                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">AI/TDM-klausul</span><span className="font-medium">{formData.aiDataMiningClause ? "Ja" : "Nej"}</span></div>
                                            </div>

                                            <F label="Noter">
                                                <Textarea value={formData.specialNotes ?? ""} onChange={(e) => setField("specialNotes", e.target.value)} placeholder="Fritekst til arkivet..." rows={3} />
                                            </F>

                                            <div className="flex items-center gap-2 pt-2">
                                                <Button className="gap-1.5 flex-1" disabled={saving} onClick={() => handleApprove(reviewingContract.id)}>
                                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                    {t("admin.validation.approve")}
                                                </Button>
                                                <Button variant="destructive" className="gap-1.5" disabled={saving} onClick={() => handleReject(reviewingContract.id)}>
                                                    <X className="h-4 w-4" />{t("admin.validation.reject")}
                                                </Button>
                                            </div>
                                        </>
                                    )
                                })()}
                            </TabsContent>
                        </Tabs>
                    </div>

                </div>
            </div>

            <Dialog open={showMaskingConfirm} onOpenChange={() => setShowMaskingConfirm(false)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Persondata maskeres inden AI-udtræk</DialogTitle>
                        <DialogDescription>
                            Følgende personoplysninger erstattes med placeholders inden kontrakten sendes til AI:
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        {maskingPreview.count > 0 ? (
                            <>
                                <p className="text-sm">
                                    Der er fundet <span className="font-medium">{maskingPreview.count} forekomster</span> af følsomme data som maskeres:
                                </p>
                                <ul className="text-sm space-y-1 pl-4">
                                    {maskingPreview.types.map(tp => (
                                        <li key={tp} className="flex items-center gap-2">
                                            <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 shrink-0" />
                                            {tp}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">Ingen personoplysninger fundet med automatisk detektion.</p>
                        )}
                        <p className="text-xs text-muted-foreground border-t pt-3">
                            Automatisk maskering er ikke 100% pålidelig. Brug "Rediger maskeret tekst" for at tjekke og tilføje yderligere maskeringer inden afsendelse.
                        </p>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button variant="outline" onClick={() => { setShowMaskingConfirm(false); setShowMaskedEditor(true) }}>
                            Rediger maskeret tekst
                        </Button>
                        <Button onClick={() => { setShowMaskingConfirm(false); handleExtract() }}>
                            Fortsæt med AI-udtræk
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Opret ny producent */}
            <Dialog open={showNewEmployer} onOpenChange={o => { if (!o) setShowNewEmployer(false) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />Opret ny producent
                        </DialogTitle>
                        <DialogDescription>
                            Henter data fra kontrakt og DFI. Tjek om producenten allerede findes i databasen.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Eksisterende DB-matches */}
                        {newEmpDbMatches.length > 0 && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
                                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                    Lignende producenter i databasen:
                                </p>
                                <div className="space-y-2">
                                    {newEmpDbMatches.map(m => (
                                        <div key={m.id} className="rounded border bg-white dark:bg-background p-3 space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-semibold">{m.name}</span>
                                                <span className="text-[10px] text-muted-foreground shrink-0">{Math.round(m.score * 100)}% lighed</span>
                                            </div>
                                            <div className="grid gap-1.5">
                                                <button type="button" onClick={() => {
                                                    setSelectedEmployerId(m.id)
                                                    setField("producerName", m.name)
                                                    setEmployerSuggestions([])
                                                    setShowNewEmployer(false)
                                                    toast.success(`Koblet til "${m.name}"`)
                                                }} className="w-full text-left text-[11px] rounded px-2.5 py-1.5 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 transition-colors">
                                                    Samme selskab — brug eksisterende
                                                </button>
                                                <button type="button"
                                                    onClick={() => setNewEmpRelation(r => r?.id === m.id && r.role === "child" ? null : { role: "child", id: m.id, name: m.name })}
                                                    className={`w-full text-left text-[11px] rounded px-2.5 py-1.5 border transition-colors ${newEmpRelation?.id === m.id && newEmpRelation.role === "child" ? "bg-blue-100 text-blue-900 border-blue-400 font-medium" : "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100"}`}>
                                                    {newEmpRelation?.id === m.id && newEmpRelation.role === "child" ? "✓ Valgt — " : ""}
                                                    "{newEmpName || "Ny"}" er underselskab af "{m.name}"
                                                </button>
                                                <button type="button"
                                                    onClick={() => setNewEmpRelation(r => r?.id === m.id && r.role === "parent" ? null : { role: "parent", id: m.id, name: m.name })}
                                                    className={`w-full text-left text-[11px] rounded px-2.5 py-1.5 border transition-colors ${newEmpRelation?.id === m.id && newEmpRelation.role === "parent" ? "bg-purple-100 text-purple-900 border-purple-400 font-medium" : "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100"}`}>
                                                    {newEmpRelation?.id === m.id && newEmpRelation.role === "parent" ? "✓ Valgt — " : ""}
                                                    "{m.name}" er underselskab af "{newEmpName || "Ny"}"
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {newEmpRelation && (
                                    <p className="text-[10px] text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/20 rounded px-2 py-1">
                                        {newEmpRelation.role === "child"
                                            ? `"${newEmpName || "Ny"}" oprettes som underselskab af "${newEmpRelation.name}"`
                                            : `"${newEmpRelation.name}" sættes som underselskab af "${newEmpName || "Ny"}"`}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* DFI-resultater */}
                        {(newEmpDfiLoading || newEmpDfiResults.length > 0) && (
                            <div className="space-y-1.5">
                                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                    Fra DFI
                                    {newEmpDfiLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                                </p>
                                <div className="space-y-1">
                                    {newEmpDfiResults.map(c => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => {
                                                setNewEmpName(c.name)
                                                setNewEmpDfiId(c.id)
                                            }}
                                            className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded text-xs border transition-colors ${newEmpDfiId === c.id ? "border-primary bg-primary/5" : "hover:border-muted-foreground/50"}`}
                                        >
                                            <span className="font-medium">{c.name}</span>
                                            <div className="flex items-center gap-2 text-muted-foreground text-[10px]">
                                                {c.cvr && <span>CVR {c.cvr}</span>}
                                                <span className="bg-orange-100 text-orange-700 rounded px-1">DFI #{c.id}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Separator />

                        {/* Manuel oprettelse */}
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Navn *</Label>
                                <Input
                                    value={newEmpName}
                                    onChange={e => { setNewEmpName(e.target.value); setNewEmpDfiId(null); setNewEmpRelation(null) }}
                                    placeholder="Produktionsselskabets navn"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">CVR-nummer (valgfrit)</Label>
                                <Input
                                    value={newEmpCvr}
                                    onChange={e => setNewEmpCvr(e.target.value)}
                                    placeholder="12345678"
                                />
                            </div>
                            {newEmpDfiId && (
                                <p className="text-[10px] text-emerald-600 flex items-center gap-1">
                                    <Check className="h-3 w-3" />Koblet til DFI #{newEmpDfiId}
                                </p>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewEmployer(false)}>Annuller</Button>
                        <Button
                            disabled={!newEmpName.trim() || newEmpSaving}
                            onClick={async () => {
                                setNewEmpSaving(true)
                                const supabase = createClient()

                                // Sæt parent_id baseret på relation
                                const parentId = newEmpRelation?.role === "child" ? newEmpRelation.id : null

                                const { data, error } = await supabase
                                    .from("employers")
                                    .insert({
                                        name: newEmpName.trim(),
                                        ...(newEmpDfiId && { dfi_company_id: newEmpDfiId }),
                                        ...(parentId && { parent_id: parentId }),
                                    })
                                    .select().single()
                                if (error) { toast.error(error.message); setNewEmpSaving(false); return }

                                // Hvis ny er moderselskab: opdater det eksisterende selskab
                                if (newEmpRelation?.role === "parent") {
                                    await supabase.from("employers").update({ parent_id: data.id }).eq("id", newEmpRelation.id)
                                }

                                setEmployers(prev => [...prev, { id: data.id, name: data.name, dfi_company_id: data.dfi_company_id ?? null }].sort((a, b) => a.name.localeCompare(b.name, "da")))
                                setSelectedEmployerId(data.id)
                                setField("producerName", data.name)
                                setEmployerSuggestions([])
                                setNewEmpRelation(null)
                                setShowNewEmployer(false)
                                setNewEmpSaving(false)
                                toast.success(`"${data.name}" oprettet${newEmpRelation ? " med selskabsrelation" : ""} og koblet`)
                            }}
                        >
                            {newEmpSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Opret og kobl
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showMaskedEditor} onOpenChange={() => setShowMaskedEditor(false)}>
                <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Rediger maskeret tekst</DialogTitle>
                        <DialogDescription>
                            Dette er teksten der sendes til AI. Erstat eventuelt resterende følsomme oplysninger manuelt med f.eks. [NAVN] eller [ADRESSE].
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea className="flex-1 font-mono text-xs resize-none" value={maskedText} onChange={(e) => setMaskedText(e.target.value)} />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowMaskedEditor(false)}>Annuller</Button>
                        <Button onClick={() => { setShowMaskedEditor(false); handleExtract() }}>Send til AI-udtræk</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            </>
        )
    }

    // ── List view ─────────────────────────────────────────────
    if (pageLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-8">
            <PageHeader title={t("admin.validation.title")} subtitle={t("admin.validation.subtitle")} />
            <Tabs defaultValue="unreviewed">
                <TabsList>
                    <TabsTrigger value="unreviewed" className="gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        {t("admin.validation.pending")}
                        {unreviewedContracts.length > 0 && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">{unreviewedContracts.length}</Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="reviewed" className="gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5" />{t("admin.validation.reviewed")}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="unreviewed" className="mt-4">
                    {unreviewedContracts.length === 0 ? (
                        <EmptyState icon={<CheckCircle2 className="h-10 w-10 text-muted-foreground/30 mb-3" />}
                            title={t("admin.validation.allReviewed")} desc={t("admin.validation.allReviewedDesc")} />
                    ) : (
                        <ContractTable contracts={unreviewedContracts} onReview={setReviewingId} onDelete={setDeleteId} />
                    )}
                </TabsContent>
                <TabsContent value="reviewed" className="mt-4">
                    {reviewedContracts.length === 0 ? (
                        <EmptyState icon={<FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />}
                            title="Ingen validerede kontrakter endnu" />
                    ) : (
                        <ContractTable contracts={reviewedContracts} onReview={setReviewingId} onDelete={setDeleteId} showStatus />
                    )}
                </TabsContent>
            </Tabs>
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("admin.validation.deleteTitle")}</DialogTitle>
                        <DialogDescription>{t("admin.validation.deleteDesc")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>{t("common.cancel")}</Button>
                        <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)}>{t("common.delete")}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Small helpers ─────────────────────────────────────────────

type DataSource = "ai" | "overenskomst" | "klipper" | "manuel" | undefined

const SOURCE_STYLES: Record<NonNullable<DataSource>, string> = {
    ai:           "rounded-md bg-blue-50 dark:bg-blue-950/25 px-2.5 py-2 -mx-2.5",
    overenskomst: "rounded-md bg-amber-50 dark:bg-amber-950/25 px-2.5 py-2 -mx-2.5",
    klipper:      "rounded-md bg-emerald-50 dark:bg-emerald-950/25 px-2.5 py-2 -mx-2.5",
    manuel:       "rounded-md bg-muted/40 px-2.5 py-2 -mx-2.5",
}

function F({ label, action, locked, src, children }: {
    label: React.ReactNode
    action?: React.ReactNode
    locked?: boolean
    src?: DataSource
    children: React.ReactNode
}) {
    const wrapperClass = src ? SOURCE_STYLES[src] : "space-y-1.5"
    return (
        <div className={src ? `${SOURCE_STYLES[src]} space-y-1.5` : "space-y-1.5"}>
            <div className="flex items-center gap-2">
                <Label className="text-xs">{label}</Label>
                {locked && (
                    <span title="Manuelt redigeret — beskyttes mod AI-overskrivning" className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                        <Lock className="h-2.5 w-2.5" />
                    </span>
                )}
                {action}
            </div>
            {children}
        </div>
    )
}

function RightRow({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <span className="text-sm">{label}</span>
                {desc && <p className="text-[10px] text-muted-foreground">{desc}</p>}
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    )
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            {icon}
            <p className="text-sm font-medium">{title}</p>
            {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        </div>
    )
}

function RightsBadges({ extracted }: { extracted: Record<string, unknown> | null | undefined }) {
    if (!extracted) return <span className="text-xs text-muted-foreground">—</span>
    const ed = extracted as any
    const items: { label: string; active: boolean }[] = [
        { label: "SVOD", active: !!ed.svod },
        { label: "Copydan", active: !!ed.copydan },
        { label: "Royalty", active: !!ed.royalty },
        { label: "AI-klausul", active: !!ed.aiDataMiningClause },
    ]
    const active = items.filter(i => i.active)
    if (active.length === 0) return <span className="text-xs text-muted-foreground">Ingen</span>
    return (
        <div className="flex flex-wrap gap-1">
            {active.map(i => (
                <Badge key={i.label} variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">{i.label}</Badge>
            ))}
        </div>
    )
}

function ContractTable({ contracts, onReview, onDelete, showStatus = false }: {
    contracts: ValidatingContract[]
    onReview: (id: string) => void
    onDelete: (id: string) => void
    showStatus?: boolean
}) {
    return (
        <div className="rounded-lg border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Titel</TableHead>
                        <TableHead className="hidden sm:table-cell">Produktionsselskab</TableHead>
                        <TableHead>Rettighedshaver</TableHead>
                        <TableHead className="hidden lg:table-cell">Rettighedsforbehold</TableHead>
                        <TableHead className="hidden md:table-cell">Dato</TableHead>
                        {showStatus && <TableHead>Status</TableHead>}
                        <TableHead className="w-[100px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {contracts.map((c) => (
                        <TableRow key={c.id}>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="text-sm font-medium">{c.displayTitle}</span>
                                </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{c.displayEmployer ?? "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{c.displayMember}</TableCell>
                            <TableCell className="hidden lg:table-cell">
                                <RightsBadges extracted={c.validation?.extracted_data} />
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground tabular-nums">
                                {c.contract_date
                                    ? new Date(c.contract_date).toLocaleDateString("da-DK")
                                    : new Date(c.created_at).toLocaleDateString("da-DK")}
                            </TableCell>
                            {showStatus && (
                                <TableCell>
                                    <Badge variant={statusVariant[c.status] ?? "outline"} className="text-xs font-normal">
                                        {statusLabel[c.status] ?? c.status}
                                    </Badge>
                                </TableCell>
                            )}
                            <TableCell>
                                <div className="flex gap-1 justify-end">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onReview(c.id)}>
                                        <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(c.id)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}

// ── Text viewer for non-PDF files ─────────────────────────────

function normChar(s: string): string {
    return s
        .toLowerCase()
        .replace(/[\u00a0\u2009\u202f]/g, " ")
        .replace(/[\r\n\t]/g, " ")
        .replace(/[\u2013\u2014\u2212]/g, "-")
        .replace(/[\u201c\u201d\u2018\u2019\u0027\u2032]/g, "'")
        .replace(/_/g, " ")
}

function preNorm(s: string): string {
    return s.replace(/copy\s*-\s*dan/gi, "copydan")
}

function buildCharMap(text: string): { normText: string; normToOrig: number[] } {
    const preProcessed = preNorm(text)
    let normText = ""
    const normToOrig: number[] = []
    let i = 0
    while (i < preProcessed.length) {
        const ch = normChar(preProcessed[i])
        for (let j = 0; j < ch.length; j++) {
            normToOrig.push(i)
            normText += ch[j]
        }
        i++
    }
    let collapsed = ""
    const collapsedToOrig: number[] = []
    let prevSpace = false
    for (let k = 0; k < normText.length; k++) {
        if (normText[k] === " ") {
            if (!prevSpace) { collapsed += " "; collapsedToOrig.push(normToOrig[k]) }
            prevSpace = true
        } else {
            collapsed += normText[k]
            collapsedToOrig.push(normToOrig[k])
            prevSpace = false
        }
    }
    return { normText: collapsed.trim(), normToOrig: collapsedToOrig }
}

function TextViewer({ text, loading = false, highlights, sectionHighlights = [], sectionEndMarkers = [], activeHighlight }: {
    text: string
    loading?: boolean
    highlights: string[]
    sectionHighlights?: string[]
    sectionEndMarkers?: string[]
    activeHighlight: string | null
}) {
    const containerRef = useRef<HTMLDivElement>(null)

    const html = useMemo(() => {
        if (!text) return ""

        const { normText, normToOrig } = buildCharMap(text)

        type Range = { origStart: number; origEnd: number; active: boolean }
        const ranges: Range[] = []

        const normQ = (s: string) => buildCharMap(s).normText
        const activeCandidates = activeHighlight
            ? activeHighlight.split("||").map(s => s.trim()).filter(Boolean)
            : []
        // Inkluder active-kandidater så de altid kan markeres — ellers matcher isActive aldrig
        const allHighlights = [...new Set([...highlights, ...sectionHighlights, ...activeCandidates])]

        allHighlights.forEach((quote) => {
            if (!quote || quote.length < 3) return
            const isActive = activeCandidates.length > 0 && activeCandidates.some(c => normQ(quote) === normQ(c))
            const isSection = sectionHighlights.includes(quote)
            const q = normQ(quote)
            const candidates = [q.slice(0, 60), q.slice(0, 40), q.slice(0, 25)].filter(c => c.length >= 4)

            for (const needle of candidates) {
                const idx = normText.indexOf(needle)
                if (idx === -1) continue
                const origStart = normToOrig[idx]

                let sectionStart = origStart
                let origEnd = (normToOrig[idx + needle.length - 1] ?? normToOrig[normToOrig.length - 1]) + 1

                if (isSection) {
                    const lookback = 500
                    const textBefore = text.slice(Math.max(0, origStart - lookback), origStart)
                    const doubleBreakMatch = textBefore.match(/\n\n[^\n].*$/)
                    if (doubleBreakMatch) {
                        sectionStart = origStart - (textBefore.length - textBefore.lastIndexOf(doubleBreakMatch[0])) + 2
                    }
                    const boundaries = sectionEndMarkers.length > 0 ? sectionEndMarkers : []
                    let endFromMarker = text.length
                    for (const marker of boundaries) {
                        if (!marker) continue
                        const mq = normQ(marker)
                        const mIdx = normText.indexOf(mq.slice(0, 40), normText.indexOf(normQ(quote).slice(0, 20)) + 10)
                        if (mIdx !== -1) {
                            const mOrig = normToOrig[mIdx]
                            if (mOrig < endFromMarker) endFromMarker = mOrig
                        }
                    }
                    const nextDoubleBreak = text.indexOf("\n\n", sectionStart + 1)
                    origEnd = Math.min(
                        endFromMarker,
                        nextDoubleBreak !== -1 ? nextDoubleBreak : text.length
                    )
                }

                ranges.push({ origStart: sectionStart, origEnd, active: isActive })
                break
            }
        })

        if (!ranges.length) return escapeHtml(text)

        ranges.sort((a, b) => a.origStart - b.origStart)

        const activeRange = ranges.find(r => r.active)
        const inactiveRanges = ranges.filter(r => !r.active)

        const finalRanges: typeof ranges = []
        let cursor = 0
        for (const r of inactiveRanges) {
            if (r.origStart >= cursor) {
                finalRanges.push(r)
                cursor = r.origEnd
            }
        }
        if (activeRange) {
            const filtered = finalRanges.filter(r => r.origEnd <= activeRange.origStart || r.origStart >= activeRange.origEnd)
            filtered.push(activeRange)
            filtered.sort((a, b) => a.origStart - b.origStart)
            finalRanges.length = 0
            finalRanges.push(...filtered)
        }

        let result = ""
        cursor = 0
        for (const { origStart, origEnd, active } of finalRanges) {
            result += escapeHtml(text.slice(cursor, origStart))
            const cls = active
                ? "bg-green-200 dark:bg-green-800 outline outline-2 outline-green-500 rounded"
                : "bg-yellow-200 dark:bg-yellow-800 rounded"
            result += `<mark class="${cls}" data-hl="${active ? "active" : "true"}">${escapeHtml(text.slice(origStart, origEnd))}</mark>`
            cursor = origEnd
        }
        result += escapeHtml(text.slice(cursor))
        return result
    }, [text, highlights, activeHighlight])

    useEffect(() => {
        if (!containerRef.current || !activeHighlight) return
        const el = containerRef.current.querySelector("mark[data-hl='active']")
        el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [activeHighlight, html])

    if (loading) {
        return (
            <div className="flex flex-1 h-full items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            </div>
        )
    }

    if (!text) {
        return (
            <div className="flex flex-1 h-full items-center justify-center text-sm text-muted-foreground">
                <div className="text-center space-y-2">
                    <FileText className="mx-auto h-8 w-8 opacity-30" />
                    <p>Indlæser dokument...</p>
                </div>
            </div>
        )
    }

    return (
        <div ref={containerRef} className="flex-1 overflow-auto p-6 text-sm leading-relaxed whitespace-pre-wrap font-mono bg-background h-full"
            dangerouslySetInnerHTML={{ __html: html }} />
    )
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

export default function AdminValideringPage() {
    return <Suspense><AdminValideringPageInner /></Suspense>
}
