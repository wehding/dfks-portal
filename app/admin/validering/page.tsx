"use client"

import { useState, useRef, useMemo, useEffect, useCallback } from "react"
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
import { normaliseSources } from "@/lib/ai-sources"
import { SourceBtn } from "@/components/source-btn"

const ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
const BUCKET = "kontrakter"

// ── Fuzzy matching ────────────────────────────────────────────
const LEGAL_SUFFIXES = /\b(aps|a\/s|as|ivs|i\/s|fmba|smba|productions?|film|media|company|group|entertainment|studios?|international|denmark|dk)\b/g

function nameTokens(name: string): string[] {
    return name.toLowerCase().replace(LEGAL_SUFFIXES, "").replace(/[^a-zæøå0-9\s]/g, " ").trim().split(/\s+/).filter(t => t.length > 1)
}

function tokenOverlapScore(a: string, b: string): number {
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


export default function AdminValideringPage() {
    const { t } = useI18n()
    const [contracts, setContracts] = useState<ValidatingContract[]>([])
    const [pageLoading, setPageLoading] = useState(true)
    const [reviewingId, setReviewingId] = useState<string | null>(null)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)
    const [localPdfFile, setLocalPdfFile] = useState<File | null>(null)
    const [screening, setScreening] = useState(false)
    const [textLoading, setTextLoading] = useState(false)
    const [formData, setFormData] = useState<Record<string, any>>({})
    const [brugerRedigerede, setBrugerRedigerede] = useState<Set<string>>(new Set())
    const [contractText, setContractText] = useState("")
    const [sources, setSources] = useState<Record<string, string | null>>({})
    const [activeSource, setActiveSource] = useState<string | null>(null)   // quote til PDF-highlight
    const [activeField, setActiveField] = useState<string | null>(null)     // felt-ID til knap-highlight
    const [storedDocxText, setStoredDocxText] = useState<string | null>(null)
    const [storedDocxLoading, setStoredDocxLoading] = useState(false)
    const [showMaskingConfirm, setShowMaskingConfirm] = useState(false)
    const [maskingPreview, setMaskingPreview] = useState<{ count: number; types: string[] }>({ count: 0, types: [] })
    const [maskedText, setMaskedText] = useState("")

    // Producer matching
    const [employers, setEmployers] = useState<{ id: string; name: string; dfi_company_id: number | null }[]>([])
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
    const [overenskomster, setOverenskomster] = useState<{ value: string; label: string }[]>([
        { value: "de4-fiktion",   label: "De4 (fiktion)"    },
        { value: "faf",           label: "FAF (fiktion)"    },
        { value: "faf-dokumentar",label: "FAF (dokumentar)" },
    ])

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

    // Moderselskab: søg DFI + vis eksisterende parent når employer vælges
    useEffect(() => {
        const name = formData.producerName?.trim()
        if (!name || name.length < 3) { setParentSuggestions([]); return }

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
        const c = contracts.find(x => x.id === reviewingId)
        if (!c) return
        // Indlæs hvilke felter admin tidligere har redigeret manuelt
        const redigerede = c.validation?.bruger_redigerede_felter ?? []
        setBrugerRedigerede(new Set(redigerede))
        const ed = c.validation?.extracted_data as any
        if (ed) {
            // Post-process: De4-fiktion inkluderer SVOD/Copydan/Royalty implicit via overenskomsten
            const impliedBySvod    = ed.overenskomst === "de4-fiktion" || !!ed.svod
            const impliedByCopydan = ed.overenskomst === "de4-fiktion" || !!ed.copydan
            // Royalty: spillefilm + dokumentar har royalty — tv-serier ALDRIG automatisk
            const isTvSeries = ["tvSeries", "docSeries"].includes(ed.productionType ?? "")
            const isFilmOrDoc = ["feature", "documentary", "short"].includes(ed.productionType ?? "")
            const impliedByRoyalty = isTvSeries
                ? false  // TV-serier: aldrig royalty automatisk
                : isFilmOrDoc || !!ed.royalty

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
        }
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
                holiday_pay_rate: extractedData.holidayPayRate ?? null,
                beta_rate: extractedData.betaRate ?? null,
                notes: extractedData.specialNotes ?? null,
                extracted_data: extractedData,
                validated_by: user?.id ?? null,
                validated_at: new Date().toISOString(),
                bruger_redigerede_felter: Array.from(brugerRedigerede),
            }, { onConflict: "contract_id" })

            if (valError) throw new Error(valError.message)

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
            if (selectedEmployerId && resolvedParentId) {
                await createClient().from("employers").update({ parent_id: resolvedParentId }).eq("id", selectedEmployerId)
            }

            const contractType = formData.contractType === "leverandør-ref" ? "leverandør" : (formData.contractType ?? undefined)
            const overenskomstVal = formData.overenskomst === "ingen" ? null : (formData.overenskomst ?? undefined)

            await supabase.from("contracts").update({
                status: "valideret",
                ...(selectedEmployerId && { employer_id: selectedEmployerId }),
                ...(contractType && { type: contractType }),
                ...(overenskomstVal !== undefined && { overenskomst: overenskomstVal }),
            }).eq("id", id)

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
            producerName:                  ed.employerName ?? "",
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
            // SVOD og Copydan er inkluderet i De4-overenskomsten
            svod:                          impliedDe4 ? true : !!ed.svod,
            copydan:                       impliedDe4 ? true : !!ed.copydan,
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

        // Storage-PDF: hent filen i browseren (signed URL virker), udtræk tekst og send som maskedText
        if (hasStoragePdf && !localPdfFile) {
            if (!reviewingContract!.signedPdfUrl) {
                toast.error("Ingen adgang til PDF — åbn kontrakten og prøv igen")
                return
            }
            setTextLoading(true)
            try {
                const pdfResp = await fetch(reviewingContract!.signedPdfUrl)
                if (!pdfResp.ok) throw new Error(`Kunne ikke hente PDF: HTTP ${pdfResp.status}`)
                const blob = await pdfResp.blob()
                const file = new File([blob], reviewingContract!.pdf_url?.split("/").pop() ?? "kontrakt.pdf", { type: blob.type })
                const { extractTextFromFile } = await import("@/lib/ai")
                const raw = await extractTextFromFile(file)
                const masked = maskPersonalData(raw)
                const types: string[] = []
                if (masked.includes("[CPR-NUMMER]")) types.push("CPR-numre")
                if (masked.includes("[KONTONUMMER]") || masked.includes("[IBAN]")) types.push("kontonumre")
                if (masked.includes("[TELEFON]")) types.push("telefonnumre")
                if (masked.includes("[EMAIL]")) types.push("email-adresser")
                const count = (masked.match(/\[(?:CPR-NUMMER|KONTONUMMER|IBAN|TELEFON|EMAIL|ADRESSE|POSTNR-BY|CVR-NUMMER)\]/g) || []).length
                setMaskingPreview({ count, types })
                setMaskedText(masked)
                setShowMaskingConfirm(true)
            } catch (e: any) {
                toast.error(`Kunne ikke forberede udtræk: ${e.message}`)
            } finally {
                setTextLoading(false)
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
        if (!localPdfFile) return
        setScreening(true)
        try {
            const { extractTextFromFile, buildSystemPrompt } = await import("@/lib/ai")
            let textToSend = maskedText
            let originalText = contractText
            if (!textToSend) {
                const raw = await extractTextFromFile(localPdfFile)
                if (!raw.trim()) throw new Error("Ingen tekst fundet i filen")
                originalText = raw
                textToSend = maskPersonalData(raw)
            }
            if (!textToSend.trim()) throw new Error("Ingen tekst fundet i filen")
            const resp = await fetch("/api/screen", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    system: buildSystemPrompt(),
                    userMessage: "Analyser denne kontrakt og returner JSON:\n\n" + textToSend.slice(0, 40000),
                }),
            })
            if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error ?? `Fejl ${resp.status}`) }
            const data = await resp.json()
            if (data.error) throw new Error(data.error)
            const ed = data.result?.extractedData
            if (!ed) throw new Error("AI returnerede ingen data")
            try { setContractText(originalText) } catch { /* ok */ }
            if (ed._sources) setSources(normaliseSources(ed._sources))
            overwriteWithAi(ed)
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

        const salaryHl = sources.salary ?? (formData.salary ? String(formData.salary) : undefined)
        const datesHl = sources.dates ?? undefined  // Kun eksakt kildecitat — ikke ISO-dato
        const weeksHl = sources.workingWeeks ?? undefined  // Kun eksakt kildecitat
        const supplementsHl = sources.supplements ?? (formData.personalSupplement ? String(formData.personalSupplement) : undefined)
        const svodSrc = sources.svod ?? null
        const copydanSrc = sources.copydan ?? null
        const royaltySrc = sources.royalty ?? null
        const ca = sources.collectiveAgreement ?? null
        // Each value is a ||‑separated list of candidates tried in order by findPageForQuote.
        // Source quote first (most specific), then generic fallbacks so navigation always finds something.
        // Specific clause terms go FIRST — svodSrc/copydanSrc may be an overenskomst
        // reference from page 1, so we must find the actual clause text before falling back to it.
        const rightsPageSource: Record<string, string> = {
            __svod__:    ["SVOD", "Create Denmark", "streaming", svodSrc].filter(Boolean).join("||"),
            __copydan__: ["Copydan", "privatkopiering", "Copy-dan", copydanSrc].filter(Boolean).join("||"),
            __royalty__: ["royalt", royaltySrc].filter(Boolean).join("||"),
            __collectiveAgreement__: [ca, "STANDARDKONTRAKT", "Standardkontrakt", "overenskomst"].filter(Boolean).join("||"),
        }
        const rightsHighlightSource: Record<string, string> = {
            __svod__:    ["SVOD", "Create Denmark", "streaming", svodSrc].filter(Boolean).join("||"),
            __copydan__: ["Copydan", "privatkopiering", copydanSrc].filter(Boolean).join("||"),
            __royalty__: ["royalt", royaltySrc ? royaltySrc.toLowerCase().slice(0, 30) : null].filter(Boolean).join("||"),
            __collectiveAgreement__: [ca ? ca.toLowerCase().slice(0, 40) : null, "STANDARDKONTRAKT", "Standardkontrakt", "overenskomst"].filter(Boolean).join("||"),
        }
        const resolvedActiveHighlight = activeSource
            ? (rightsHighlightSource[activeSource] || rightsPageSource[activeSource] || activeSource)
            : null
        const resolvedPageSource = activeSource
            ? (rightsPageSource[activeSource] || activeSource)
            : null
        // Only show section highlights for the currently active rights button —
        // always-on generic terms like "§§" match too many wrong spans.
        const activeSectionHighlights: string[] = activeSource && rightsHighlightSource[activeSource]
            ? rightsHighlightSource[activeSource].split("||").map(s => s.trim()).filter(Boolean)
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
                                highlights={[salaryHl, sources.pension ?? null, supplementsHl ?? null, datesHl, weeksHl].filter(Boolean) as string[]}
                                sectionHighlights={activeSectionHighlights}
                                activeHighlight={resolvedActiveHighlight} />

                        ) : storedDocxText !== null || storedDocxLoading ? (
                            /* DOCX fra Storage — vis som tekst */
                            <TextViewer
                                text={storedDocxText ?? ""}
                                loading={storedDocxLoading}
                                highlights={[salaryHl, sources.pension ?? null, supplementsHl ?? null, datesHl, weeksHl].filter(Boolean) as string[]}
                                sectionHighlights={activeSectionHighlights}
                                activeHighlight={resolvedActiveHighlight} />

                        ) : pdfUrl ? (
                            /* PDF */
                            <PdfViewer
                                url={pdfUrl}
                                highlights={[salaryHl, sources.pension ?? null, supplementsHl ?? null, datesHl, weeksHl].filter(Boolean) as string[]}
                                sectionHighlights={activeSectionHighlights}
                                activeHighlight={resolvedActiveHighlight}
                                pageNavigationHint={resolvedPageSource ?? undefined}
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

                    {/* Data extraction form */}
                    <div className="rounded-lg border overflow-y-auto" style={{ maxHeight: "80vh" }}>
                        <div className="flex items-center gap-2 border-b px-4 py-3 sticky top-0 bg-background z-10">
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

                        <div className="space-y-5 p-4">
                            {/* Portal-data: vis kun hvis kontrakten er indsendt af klipperen via portal */}
                            {(formData.workTitle || formData.creditedRoles) && (reviewingContract?.validation?.extracted_data as any)?.submittedByMember && (
                                <>
                                    <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                                        Felter markeret med <span className="font-semibold">★</span> er udfyldt af klipperen ved upload
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {formData.workTitle && (
                                            <F label="★ Arbejdstitel (fra klipper)">
                                                <Input value={String(formData.workTitle ?? "")} onChange={(e) => setField("workTitle", e.target.value)} />
                                            </F>
                                        )}
                                        {formData.creditedRoles && (
                                            <F label="★ Krediteret rolle (fra klipper)">
                                                <Input value={String(formData.creditedRoles ?? "")} onChange={(e) => setField("creditedRoles", e.target.value)} placeholder="Klipper, Film Editor..." />
                                            </F>
                                        )}
                                    </div>
                                    <Separator />
                                </>
                            )}
                            <F
                                label={t("admin.validation.producer")}
                                action={
                                    <button
                                        type="button"
                                        className="text-[11px] text-primary underline underline-offset-2"
                                        onClick={() => {
                                            setNewEmpName(formData.producerName?.trim() ?? "")
                                            setNewEmpCvr("")
                                            setNewEmpDfiId(null)
                                            setNewEmpRelation(null)
                                            setNewEmpDfiResults([])
                                            setNewEmpDbMatches([])
                                            setShowNewEmployer(true)
                                        }}
                                    >
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

                                {/* Koblet OK */}
                                {selectedEmployerId && (
                                    <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
                                        <Check className="h-3 w-3 shrink-0" />Koblet til eksisterende producent i DB
                                    </p>
                                )}

                                {/* Ingen match */}
                                {!selectedEmployerId && (formData.producerName?.trim()?.length ?? 0) > 2 && (
                                    <div className="mt-1.5 space-y-1.5">
                                        <p className="text-[11px] text-amber-700 flex items-center gap-1.5">
                                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                            <span>Ingen match i databasen — <button type="button" className="underline underline-offset-2 font-medium" onClick={() => { setNewEmpName(formData.producerName?.trim() ?? ""); setNewEmpCvr(""); setNewEmpDfiId(null); setNewEmpRelation(null); setNewEmpDfiResults([]); setNewEmpDbMatches([]); setShowNewEmployer(true) }}>opret producent i databasen</button></span>
                                        </p>

                                        {/* Evt. forslag */}
                                        {(searchingDfi || employerSuggestions.length > 0) && (
                                            <div className="rounded-md border bg-muted/20">
                                                <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                                    Evt. forslag fra DB og DFI
                                                    {searchingDfi && <Loader2 className="h-3 w-3 animate-spin" />}
                                                </p>
                                                <div className="divide-y">
                                                    {employerSuggestions.map((s, i) => (
                                                        <button key={i} type="button"
                                                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center justify-between gap-2"
                                                            onClick={() => { setField("producerName", s.name); setSelectedEmployerId(s.id); setEmployerSuggestions([]) }}>
                                                            <span className="font-medium">{s.name}</span>
                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.source === "db" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                                                                    {s.source === "db" ? "DB" : "DFI"}
                                                                </span>
                                                                <span className="text-muted-foreground text-[10px]">{Math.round(s.score * 100)}%</span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </F>

                            {/* Moderselskab */}
                            <F label="Moderselskab (valgfrit)">
                                <div className="relative">
                                    <Input
                                        value={selectedDfiParent?.name ?? (selectedParentId ? (employers.find(e => e.id === selectedParentId)?.name ?? "") : "")}
                                        onChange={() => { setSelectedParentId(null); setSelectedDfiParent(null) }}
                                        placeholder="Søges automatisk fra DB..."
                                        className="text-xs"
                                    />
                                    {(selectedParentId || selectedDfiParent) && (
                                        <button
                                            className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                                            onClick={() => { setSelectedParentId(null); setSelectedDfiParent(null) }}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                                {parentSuggestions.length > 0 && !selectedParentId && !selectedDfiParent && (
                                    <div className="mt-1 rounded-md border bg-background shadow-sm divide-y">
                                        {parentSuggestions.map((s, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 flex items-center justify-between gap-2"
                                                onClick={() => {
                                                    if (s.id) { setSelectedParentId(s.id); setSelectedDfiParent(null) }
                                                    else if (s.dfi_id) { setSelectedDfiParent({ id: s.dfi_id, name: s.name }); setSelectedParentId(null) }
                                                    setParentSuggestions([])
                                                }}
                                            >
                                                <span className="font-medium">{s.name}</span>
                                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.source === "db" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                                                    {s.source === "db" ? "DB" : "DFI"}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </F>
                            {formData.rightsHolderName && (
                                <F label="Medarbejder / Klipper (fra AI-udtræk)" locked={isLocked("rightsHolderName")}>
                                    <Input
                                        value={String(formData.rightsHolderName ?? "")}
                                        onChange={(e) => setField("rightsHolderName", e.target.value)}
                                        placeholder="Klipperens fulde navn..."
                                    />
                                </F>
                            )}
                            <Separator />
                            <F label="Produktionstype" locked={isLocked("productionType")}>
                                <Select value={formData.productionType ?? ""} onValueChange={(v) => setField("productionType", v)}>
                                    <SelectTrigger><SelectValue placeholder="Vælg type..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="feature">Spillefilm</SelectItem>
                                        <SelectItem value="tvSeries">TV-serie</SelectItem>
                                        <SelectItem value="documentary">Dokumentarfilm</SelectItem>
                                        <SelectItem value="docSeries">Dokumentarserie</SelectItem>
                                        <SelectItem value="short">Kortfilm</SelectItem>
                                        <SelectItem value="tvEntertainment">TV-underholdning</SelectItem>
                                        <SelectItem value="reality">Reality</SelectItem>
                                        <SelectItem value="other">Andet</SelectItem>
                                    </SelectContent>
                                </Select>
                            </F>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label="Kontrakttype" locked={isLocked("contractType")}>
                                    <Select
                                        value={formData.contractType ?? "a-løn"}
                                        onValueChange={(v) => {
                                            setField("contractType", v)
                                            setField("collectiveAgreement", v === "a-løn" || v === "leverandør-ref")
                                            setField("collectiveAgreementByReference", v === "leverandør-ref")
                                            setField("isFreelanceContract", v !== "a-løn")
                                        }}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="a-løn">A-løn</SelectItem>
                                            <SelectItem value="leverandør">Leverandør</SelectItem>
                                            <SelectItem value="leverandør-ref">Leverandør (OK ved reference)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </F>
                                <F label={<>{t("admin.validation.agreement")}<SourceBtn quote={ca ?? undefined} active={activeField === "agreement"} onClick={() => activateSource("agreement", ca)} /></>}>
                                    <Select
                                        value={formData.overenskomst ?? "ingen"}
                                        onValueChange={(v) => setField("overenskomst", v)}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {overenskomster.map(o => (
                                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                            ))}
                                            <SelectItem value="ingen">Ingen overenskomst</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </F>
                            </div>
                            <Separator />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.salary")}<SourceBtn quote={salaryHl} active={activeField === "salary"} onClick={() => activateSource("salary", salaryHl)} /></>} locked={isLocked("salary")}>
                                    <Input type="number" value={String(formData.salary ?? "")} onChange={(e) => setField("salary", e.target.value)} placeholder="0" />
                                </F>
                                <F label={t("admin.validation.salaryUnit")} locked={isLocked("salaryUnit")}>
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
                            <Separator />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.startDate")}<SourceBtn quote={datesHl} active={activeField === "dates"} onClick={() => activateSource("dates", datesHl)} /></>} locked={isLocked("startDate")}>
                                    <Input type="date" value={String(formData.startDate ?? "")} onChange={(e) => setField("startDate", e.target.value)} />
                                </F>
                                <F label={t("admin.validation.endDate")} locked={isLocked("endDate")}>
                                    <Input type="date" value={String(formData.endDate ?? "")} onChange={(e) => setField("endDate", e.target.value)} />
                                </F>
                            </div>
                            <Separator />
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.pensionPercent")}<SourceBtn quote={sources.pension ?? undefined} active={activeField === "pension"} onClick={() => activateSource("pension", sources.pension)} /></>}>
                                    <div className="flex items-center gap-2">
                                        <Input type="number" step="0.1" value={String(formData.pensionPercent ?? "")} onChange={(e) => setField("pensionPercent", e.target.value)} placeholder="0" />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </F>
                                <F label={<>{t("admin.validation.pension")} (kr.)<SourceBtn quote={sources.pension ?? undefined} active={activeField === "pension"} onClick={() => activateSource("pension", sources.pension)} /></>}>
                                    <Input type="number" value={String(formData.pensionSupplement ?? "")} onChange={(e) => setField("pensionSupplement", e.target.value)} placeholder="0" />
                                </F>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={<>{t("admin.validation.personalSupplement")}<SourceBtn quote={supplementsHl} active={activeField === "supplements"} onClick={() => activateSource("supplements", supplementsHl)} /></>}>
                                    <Input type="number" value={String(formData.personalSupplement ?? "")} onChange={(e) => setField("personalSupplement", e.target.value)} placeholder="0" />
                                </F>
                                <F label={<>{t("admin.validation.other")}{sources.otherSupplements && <SourceBtn quote={sources.otherSupplements} active={activeField === "otherSupplements"} onClick={() => activateSource("otherSupplements", sources.otherSupplements)} />}</>}>
                                    <Input value={String(formData.otherSupplements ?? "")} onChange={(e) => setField("otherSupplements", e.target.value)} placeholder="—" />
                                </F>
                            </div>
                            <Separator />
                            <F label={<>{t("admin.validation.workingWeeks")}<SourceBtn quote={weeksHl} active={activeField === "workingWeeks"} onClick={() => activateSource("workingWeeks", weeksHl)} /></>}>
                                <Input type="number" value={String(formData.workingWeeks ?? "")} onChange={(e) => setField("workingWeeks", e.target.value)} placeholder="0" className="max-w-[120px]" />
                            </F>
                            <Separator />
                            <div>
                                <Label className="text-xs mb-3 block">{t("admin.validation.producerContributions")}</Label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <F label={<>{t("admin.validation.holidayPay")}<SourceBtn quote={ca ?? undefined} active={activeField === "agreement"} onClick={() => activateSource("agreement", ca)} /></>}>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.1" value={String(formData.holidayPayRate ?? "")} onChange={(e) => setField("holidayPayRate", e.target.value)} placeholder="Ikke nævnt" className="max-w-[120px]" />
                                            {formData.holidayPayRate && <span className="text-sm text-muted-foreground">%</span>}
                                        </div>
                                    </F>
                                    <F label={<>{t("admin.validation.beta")}<SourceBtn quote={ca ?? undefined} active={activeField === "agreement"} onClick={() => activateSource("agreement", ca)} /></>}>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" step="0.01" value={String(formData.betaRate ?? "")} onChange={(e) => setField("betaRate", e.target.value)} placeholder="Ikke nævnt" className="max-w-[120px]" />
                                            {formData.betaRate && <span className="text-sm text-muted-foreground">%</span>}
                                        </div>
                                    </F>
                                </div>
                            </div>
                            <Separator />
                            <div>
                                <Label className="text-xs mb-3 block">{t("admin.validation.rights")}</Label>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm">SVOD<SourceBtn quote={sources.svod ?? sources.copydan ?? sources.collectiveAgreement ?? undefined} active={activeField === "svod"} onClick={() => activateSource("svod", sources.svod ?? sources.copydan ?? sources.collectiveAgreement ?? null)} /></span>
                                            <p className="text-[10px] text-muted-foreground">Streaming on-demand rettighed</p>
                                        </div>
                                        <Switch checked={formData.svod ?? false} onCheckedChange={(v) => setField("svod", v)} />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm">Copydan<SourceBtn quote={sources.copydan ?? sources.collectiveAgreement ?? undefined} active={activeField === "copydan"} onClick={() => activateSource("copydan", sources.copydan ?? sources.collectiveAgreement ?? null)} /></span>
                                            <p className="text-[10px] text-muted-foreground">Copydan-vederlag inkluderet</p>
                                        </div>
                                        <Switch checked={formData.copydan ?? false} onCheckedChange={(v) => setField("copydan", v)} />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1">
                                            <span className="text-sm">Royalty<SourceBtn quote={sources.royalty ?? sources.copydan ?? sources.collectiveAgreement ?? undefined} active={activeField === "royalty"} onClick={() => activateSource("royalty", sources.royalty ?? sources.copydan ?? sources.collectiveAgreement ?? null)} /></span>
                                            <p className="text-[10px] text-muted-foreground">Løbende royaltybetaling</p>
                                        </div>
                                        <Input type="number" step="0.1" value={String(formData.royaltyPercent ?? "")} onChange={(e) => setField("royaltyPercent", e.target.value)} placeholder="%" className="w-20" />
                                        <Switch checked={formData.royalty ?? false} onCheckedChange={(v) => setField("royalty", v)} />
                                    </div>
                                    <Separator className="my-1" />
                                    <RightRow label={t("admin.validation.aiClause")} desc={t("admin.validation.aiClauseDesc")} checked={formData.aiDataMiningClause ?? false} onChange={(v) => setField("aiDataMiningClause", v)} />
                                </div>
                            </div>
                            <Separator />
                            <F label={t("admin.validation.distribution")}>
                                <Input value={formData.distribution ?? ""} onChange={(e) => setField("distribution", e.target.value)} placeholder="Netflix, DR, TV2..." />
                            </F>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <F label={t("admin.validation.gender")}>
                                    <Select value={formData.gender ?? ""} onValueChange={(v) => setField("gender", v)}>
                                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="male">{t("admin.stats.male")}</SelectItem>
                                            <SelectItem value="female">{t("admin.stats.female")}</SelectItem>
                                            <SelectItem value="other">Andet</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </F>
                            </div>
                            <F label={t("admin.validation.specialNotes")}>
                                <Textarea value={formData.specialNotes ?? ""} onChange={(e) => setField("specialNotes", e.target.value)} placeholder="Fritekst..." rows={3} />
                            </F>
                            <Separator />
                            <div className="flex items-center gap-2 pt-1">
                                <Button className="gap-1.5" disabled={saving} onClick={() => handleApprove(reviewingContract.id)}>
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                    {t("admin.validation.approve")}
                                </Button>
                                <Button variant="destructive" className="gap-1.5" disabled={saving} onClick={() => handleReject(reviewingContract.id)}>
                                    <X className="h-4 w-4" />{t("admin.validation.reject")}
                                </Button>
                            </div>
                        </div>
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

function F({ label, action, locked, children }: { label: React.ReactNode; action?: React.ReactNode; locked?: boolean; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
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
        const allHighlights = [...highlights, ...sectionHighlights]

        allHighlights.forEach((quote) => {
            if (!quote || quote.length < 3) return
            const isActive = activeHighlight !== null && normQ(quote) === normQ(activeHighlight)
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
