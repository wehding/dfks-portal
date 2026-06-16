"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Upload, X, FileText, CheckCircle2, Loader2, ChevronDown, Check, Clock, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { formatDistanceToNow, format } from "date-fns"
import { da } from "date-fns/locale"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/page-header"
import { Separator } from "@/components/ui/separator"
import type {
    ContractType,
    ProductionType,
    DistributionChannel,
    FocusArea,
    ProducerSelection,
} from "@/lib/types"

// ── Typer til sagslisten ─────────────────────────────────────

type ActiveReview = {
    id: string
    file_name: string | null
    producer_name: string | null
    production_type: string | null
    status: string
    updated_at: string | null
}

type ArchivedReview = {
    id: string
    file_name: string | null
    producer_name: string | null
    production_type: string | null
    updated_at: string | null
}

// ── Hjælpefunktioner ─────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    afventer:   { label: "Modtaget — afventer behandling", className: "bg-muted text-muted-foreground" },
    behandling: { label: "Under behandling",               className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
}

const PRODUCTION_LABELS: Record<string, string> = {
    dokumentar: "Dokumentar", fiktion: "Fiktion / drama", reklame: "Reklame",
    streaming: "Streaming-original", shortform: "Short-form", ukendt: "Ukendt",
}

function relativDato(iso: string | null) {
    if (!iso) return "—"
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: da })
}

function formatDato(iso: string | null) {
    if (!iso) return "—"
    return format(new Date(iso), "d. MMMM yyyy", { locale: da })
}

// ── Hjælpekomponent: Chip ────────────────────────────────────

function Chip({
    label,
    selected,
    onClick,
    color = "default",
}: {
    label: string
    selected: boolean
    onClick: () => void
    color?: "default" | "amber"
}) {
    const base = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium cursor-pointer transition-all select-none"
    const active =
        color === "amber"
            ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            : "border-primary bg-primary text-primary-foreground"
    const inactive = "border-muted-foreground/25 bg-transparent text-muted-foreground hover:border-foreground/50 hover:text-foreground"
    return (
        <button type="button" onClick={onClick} className={`${base} ${selected ? active : inactive}`}>
            {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
            {label}
        </button>
    )
}

// ── Hjælpekomponent: Segmented control ──────────────────────

function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[]
    value: T | null
    onChange: (v: T) => void
}) {
    return (
        <div className="flex rounded-lg border overflow-hidden">
            {options.map((opt, i) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={[
                        "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                        i > 0 && "border-l",
                        value === opt.value
                            ? "bg-primary text-primary-foreground"
                            : "bg-transparent text-muted-foreground hover:bg-muted",
                    ].filter(Boolean).join(" ")}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

// ── Producentfelt: combobox med DFKS + DFI søgning ──────────

interface ProducerHit { id: string; name: string; isOverenskomstBound?: boolean; source: "dfks" | "dfi" }

function ProducerCombobox({
    value,
    onChange,
}: {
    value: ProducerSelection | null
    onChange: (v: ProducerSelection) => void
}) {
    const [query, setQuery] = useState(value?.name ?? "")
    const [open, setOpen] = useState(false)
    const [dfksHits, setDfksHits] = useState<ProducerHit[]>([])
    const [dfiHits, setDfiHits] = useState<ProducerHit[]>([])
    const [loading, setLoading] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // Luk dropdown ved klik udenfor
    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [])

    function search(q: string) {
        if (timerRef.current) clearTimeout(timerRef.current)
        if (q.length < 2) { setDfksHits([]); setDfiHits([]); setOpen(false); return }
        timerRef.current = setTimeout(async () => {
            setLoading(true)
            try {
                const [dfksRes, dfiRes] = await Promise.allSettled([
                    fetch(`/api/producers/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
                    fetch(`/api/dfi/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
                ])
                setDfksHits(
                    dfksRes.status === "fulfilled"
                        ? (dfksRes.value.results ?? []).map((r: any) => ({ ...r, source: "dfks" as const }))
                        : []
                )
                setDfiHits(
                    dfiRes.status === "fulfilled"
                        ? (dfiRes.value.results ?? []).map((r: any) => ({ ...r, source: "dfi" as const }))
                        : []
                )
                setOpen(true)
            } finally {
                setLoading(false)
            }
        }, 300)
    }

    function select(hit: ProducerHit) {
        setQuery(hit.name)
        setOpen(false)
        onChange({
            name: hit.name,
            dfksId: hit.source === "dfks" ? hit.id : undefined,
            dfiId: hit.source === "dfi" ? hit.id : undefined,
            isOverenskomstBound: hit.isOverenskomstBound,
            source: hit.source,
        })
    }

    function confirmManual() {
        if (!query.trim()) return
        setOpen(false)
        onChange({ name: query.trim(), source: "manual" })
    }

    const hasResults = dfksHits.length > 0 || dfiHits.length > 0

    return (
        <div ref={containerRef} className="relative">
            <div className="relative">
                <input
                    type="text"
                    value={query}
                    onChange={e => { setQuery(e.target.value); search(e.target.value) }}
                    onFocus={() => query.length >= 2 && setOpen(true)}
                    placeholder="Søg produktionsselskab..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-8"
                />
                {loading
                    ? <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    : <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />}
            </div>

            {open && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-72 overflow-y-auto">
                    {!hasResults ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                            Ingen match — fortsæt med det du har skrevet
                        </div>
                    ) : (
                        <>
                            {dfksHits.length > 0 && (
                                <>
                                    <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fra DFKS</div>
                                    {dfksHits.map(h => (
                                        <button
                                            key={h.id}
                                            type="button"
                                            onClick={() => select(h)}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                                        >
                                            <span className="flex-1">{h.name}</span>
                                            {h.isOverenskomstBound && (
                                                <span className="shrink-0 rounded-full bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 font-medium dark:bg-emerald-950 dark:text-emerald-300">
                                                    Overenskomst
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </>
                            )}
                            {dfiHits.length > 0 && (
                                <>
                                    <div className={`px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${dfksHits.length > 0 ? "border-t" : ""}`}>Fra DFI</div>
                                    {dfiHits.map(h => (
                                        <button
                                            key={h.id}
                                            type="button"
                                            onClick={() => select(h)}
                                            className="flex w-full items-center px-3 py-2 text-sm hover:bg-muted text-left"
                                        >
                                            {h.name}
                                        </button>
                                    ))}
                                </>
                            )}
                        </>
                    )}
                    {query.trim().length >= 2 && (
                        <div className="border-t px-3 py-2">
                            <button
                                type="button"
                                onClick={confirmManual}
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Brug &quot;{query.trim()}&quot; som fritekst
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Formatering ──────────────────────────────────────────────

function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Konstanter ───────────────────────────────────────────────

const PRODUCTION_TYPES: { value: ProductionType; label: string }[] = [
    { value: "dokumentar",  label: "Dokumentar" },
    { value: "fiktion",     label: "Fiktion / drama" },
    { value: "tv_program",  label: "TV-program" },
    { value: "reklame",     label: "Reklame / branded content" },
    { value: "streaming",   label: "Streaming-original" },
    { value: "shortform",   label: "Short-form / online" },
    { value: "ukendt",      label: "Ved ikke" },
]

const DISTRIBUTION_CHANNELS: { value: DistributionChannel; label: string }[] = [
    { value: "biograf",              label: "Biograf" },
    { value: "tv_lineaer",           label: "TV (lineær)" },
    { value: "streaming_svod",       label: "Streaming (SVOD)" },
    { value: "streaming_avod",       label: "Streaming (AVOD/gratis)" },
    { value: "festival",             label: "Festival" },
    { value: "internationalt_salg",  label: "Internationale salg" },
    { value: "ukendt",               label: "Ved ikke" },
]

const FOCUS_AREAS: { value: FocusArea; label: string }[] = [
    { value: "vederlag",    label: "Vederlag / royalties" },
    { value: "streaming",   label: "Streaming & genvisninger" },
    { value: "arbejdstid",  label: "Arbejdstid & overarbejde" },
    { value: "rettigheder", label: "Rettigheder & IP" },
    { value: "opsigelse",   label: "Opsigelse & varsel" },
    { value: "konkurrence", label: "Konkurrenceklausul" },
]

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

// ── Hoved-komponent ──────────────────────────────────────────

export default function PortalKontraktgennemgangPage() {
    const router = useRouter()

    const [file, setFile] = useState<File | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Formfelter
    const [contractType, setContractType] = useState<ContractType | null>(null)
    const [productionType, setProductionType] = useState<ProductionType | null>(null)
    const [distributionChannels, setDistributionChannels] = useState<DistributionChannel[]>([])
    const [producer, setProducer] = useState<ProducerSelection | null>(null)
    const [focusAreas, setFocusAreas] = useState<FocusArea[]>([])
    const [notes, setNotes] = useState("")

    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [memberName, setMemberName] = useState<string | null>(null)
    const [memberEmail, setMemberEmail] = useState<string | null>(null)
    const [memberId, setMemberId] = useState<string | null>(null)
    const [orgId, setOrgId] = useState<string>("3dfcad23-03ce-4de0-82f2-6566dfcd88a5")

    // Sagslister
    const [activeReviews, setActiveReviews] = useState<ActiveReview[]>([])
    const [archivedReviews, setArchivedReviews] = useState<ArchivedReview[]>([])
    const [reviewsLoading, setReviewsLoading] = useState(true)

    useEffect(() => {
        createClient().auth.getUser().then(({ data: { user } }) => {
            if (user) {
                setMemberName(user.user_metadata?.full_name ?? null)
                setMemberEmail(user.email ?? null)
                setMemberId(user.id)
                setOrgId(user.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5")
                loadReviews(user.id)
            }
        })
    }, [])

    async function loadReviews(uid: string) {
        setReviewsLoading(true)
        const supabase = createClient()
        const [activeRes, archiveRes] = await Promise.all([
            supabase
                .from("contract_reviews")
                .select("id, file_name, producer_name, production_type, status, updated_at")
                .eq("member_id", uid)
                .in("status", ["afventer", "behandling"])
                .order("updated_at", { ascending: false }),
            supabase
                .from("contract_reviews")
                .select("id, file_name, producer_name, production_type, updated_at")
                .eq("member_id", uid)
                .eq("status", "afsluttet")
                .order("updated_at", { ascending: false }),
        ])
        setActiveReviews((activeRes.data ?? []) as ActiveReview[])
        setArchivedReviews((archiveRes.data ?? []) as ArchivedReview[])
        setReviewsLoading(false)
    }

    // ── Fil-håndtering ───────────────────────────────────────

    function validateAndSetFile(f: File) {
        const name = f.name.toLowerCase()
        if (!name.endsWith(".pdf") && !name.endsWith(".docx") && !name.endsWith(".doc")) {
            toast.error("Kun PDF og Word-filer (.pdf, .docx, .doc) er understøttet")
            return
        }
        if (f.size > MAX_FILE_SIZE) {
            toast.error(`Filen er for stor (${formatBytes(f.size)}). Maksimalt 20 MB.`)
            return
        }
        setFile(f)
    }

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) validateAndSetFile(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Distribution channels — "ukendt" er eksklusiv ────────

    function toggleDistribution(ch: DistributionChannel) {
        if (ch === "ukendt") {
            setDistributionChannels(prev => prev.includes("ukendt") ? [] : ["ukendt"])
        } else {
            setDistributionChannels(prev => {
                const without = prev.filter(c => c !== "ukendt")
                return without.includes(ch)
                    ? without.filter(c => c !== ch)
                    : [...without, ch]
            })
        }
    }

    function toggleFocus(area: FocusArea) {
        setFocusAreas(prev =>
            prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
        )
    }

    // ── Validering ───────────────────────────────────────────

    const isValid =
        file !== null &&
        contractType !== null &&
        productionType !== null &&
        distributionChannels.length > 0 &&
        producer !== null && producer.name.trim().length >= 2

    // ── Submit ───────────────────────────────────────────────

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!isValid) return
        setSubmitting(true)

        const fd = new FormData()
        fd.append("file", file!)
        if (memberName)  fd.append("memberName",  memberName)
        if (memberEmail) fd.append("memberEmail", memberEmail)
        if (memberId)    fd.append("memberId",    memberId)
        fd.append("orgId", orgId)
        fd.append("contractType", contractType!)
        fd.append("productionType", productionType!)
        fd.append("distributionChannels", JSON.stringify(distributionChannels))
        fd.append("producerName", producer!.name)
        if (producer!.dfksId) fd.append("producerDfksId", producer!.dfksId)
        if (producer!.dfiId)  fd.append("producerDfiId",  producer!.dfiId)
        if (producer!.isOverenskomstBound !== undefined) {
            fd.append("producerOverenskomst", String(producer!.isOverenskomstBound))
        }
        if (focusAreas.length) fd.append("focusAreas", JSON.stringify(focusAreas))
        if (notes.trim()) fd.append("notes", notes.trim())

        try {
            // Brug /api/portal/submit — gemmer straks og kører AI asynkront
            // Brugeren venter IKKE på analysen
            const res = await fetch("/api/portal/submit", { method: "POST", body: fd })
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Ukendt fejl" }))
                throw new Error(err.error ?? "Serverfejl")
            }
            setSubmitted(true)
            // Opdater sagsliste i baggrunden
            if (memberId) loadReviews(memberId)
        } catch (err: any) {
            toast.error(err.message ?? "Kunne ikke sende kontrakten — prøv igen")
        } finally {
            setSubmitting(false)
        }
    }

    function reset() {
        setFile(null)
        setContractType(null)
        setProductionType(null)
        setDistributionChannels([])
        setProducer(null)
        setFocusAreas([])
        setNotes("")
        setSubmitted(false)
    }

    // ── Render ───────────────────────────────────────────────

    return (
        <div className="space-y-8">
            <PageHeader
                title="Kontraktgennemgang"
                subtitle="Upload din kontrakt og angiv kontekst, så vi kan give dig den bedste vurdering"
            />

            <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">

                {/* ── Uploadzone ── */}
                <div>
                    {!file ? (
                        <div
                            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={onDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={[
                                "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 cursor-pointer transition-colors",
                                dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30",
                            ].join(" ")}
                        >
                            <Upload className="h-8 w-8 text-muted-foreground" />
                            <div className="text-center">
                                <p className="text-sm font-medium">Træk filen hertil, eller klik for at vælge</p>
                                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX eller DOC — maks. 20 MB</p>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.docx,.doc"
                                className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f) }}
                            />
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
                            <FileText className="h-8 w-8 shrink-0 text-primary" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setFile(null)}
                                className="shrink-0 rounded-full p-1 hover:bg-muted transition-colors"
                            >
                                <X className="h-4 w-4 text-muted-foreground" />
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Kontekstformular (vises når fil er valgt) ── */}
                {file && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">

                        {/* 1. Ansættelsesform */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">
                                Hvad slags aftale er det? <span className="text-destructive">*</span>
                            </Label>
                            <p className="text-xs text-muted-foreground">Påvirker hvilke vilkår og forpligtelser der gælder</p>
                            <SegmentedControl<ContractType>
                                options={[
                                    { value: "ansaettelse", label: "Ansættelse (A-løn)" },
                                    { value: "freelance",   label: "Freelance / leverandør" },
                                    { value: "ukendt",      label: "Ved ikke" },
                                ]}
                                value={contractType}
                                onChange={setContractType}
                            />
                        </div>

                        {/* 2. Produktionstype */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">
                                Hvad produceres der? <span className="text-destructive">*</span>
                            </Label>
                            <p className="text-xs text-muted-foreground">Afgørende for hvilke rettigheder og vilkår der gælder for din type produktion</p>
                            <div className="flex flex-wrap gap-2">
                                {PRODUCTION_TYPES.map(opt => (
                                    <Chip
                                        key={opt.value}
                                        label={opt.label}
                                        selected={productionType === opt.value}
                                        onClick={() => setProductionType(opt.value)}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* 3. Distributionskanal */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">
                                Hvor skal produktionen vises? <span className="text-destructive">*</span>
                            </Label>
                            <p className="text-xs text-muted-foreground">Afgørende for vurdering af streaming- og genvisningsrettigheder</p>
                            <div className="flex flex-wrap gap-2">
                                {DISTRIBUTION_CHANNELS.map(opt => (
                                    <Chip
                                        key={opt.value}
                                        label={opt.label}
                                        selected={distributionChannels.includes(opt.value)}
                                        onClick={() => toggleDistribution(opt.value)}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* 4. Producer */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">
                                Hvem er producer eller opdragsgiver? <span className="text-destructive">*</span>
                            </Label>
                            <p className="text-xs text-muted-foreground">Hjælper AI&apos;en med at vurdere kontraktens kontekst</p>
                            <ProducerCombobox value={producer} onChange={setProducer} />
                            {producer?.isOverenskomstBound === true && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <Check className="h-3.5 w-3.5" /> Registreret som overenskomstbundet i DFKS
                                </p>
                            )}
                            {producer?.isOverenskomstBound === false && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    Ikke registreret som overenskomstbundet i DFKS
                                </p>
                            )}
                        </div>

                        {/* 5. Fokusområder (valgfrit) */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">
                                Er der noget særligt du vil have kigget på?{" "}
                                <span className="text-muted-foreground font-normal">(valgfrit)</span>
                            </Label>
                            <div className="flex flex-wrap gap-2">
                                {FOCUS_AREAS.map(opt => (
                                    <Chip
                                        key={opt.value}
                                        label={opt.label}
                                        selected={focusAreas.includes(opt.value)}
                                        onClick={() => toggleFocus(opt.value)}
                                        color="amber"
                                    />
                                ))}
                            </div>
                        </div>

                        {/* 6. Fritekst-bemærkning (valgfrit) */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">
                                Er der særlige omstændigheder AI&apos;en bør kende til?{" "}
                                <span className="text-muted-foreground font-normal">(valgfrit)</span>
                            </Label>
                            <Textarea
                                value={notes}
                                onChange={e => setNotes(e.target.value.slice(0, 1000))}
                                placeholder="f.eks. 'der er allerede forhandlet om § 12', 'produceren hævder dette er standard', 'jeg er usikker på afsnit om streaming-rettigheder'…"
                                rows={3}
                                className="resize-none"
                            />
                            <p className="text-xs text-muted-foreground text-right">{notes.length}/1000</p>
                        </div>

                        {/* GDPR-note */}
                        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                            Kontrakten sendes ikke til eksterne parter. CPR-numre og kontonumre maskeres automatisk inden analyse. Filen gemmes ikke efter analysen er færdig.
                        </div>

                        {/* Submit */}
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={!isValid || submitting}
                            size="lg"
                        >
                            {submitting ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sender…</>
                            ) : (
                                "Send til gennemgang"
                            )}
                        </Button>
                    </div>
                )}
            </form>

            {/* ── Bekræftelse (inline efter submit) ── */}
            {submitted && (
                <div className="max-w-2xl rounded-xl border bg-emerald-50 dark:bg-emerald-950/20 p-6 flex items-start gap-4">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                        <p className="font-semibold text-emerald-800 dark:text-emerald-300">Din kontrakt er modtaget</p>
                        <p className="text-sm text-emerald-700 dark:text-emerald-400">
                            Vi gennemgår den og vender tilbage til dig snarest. Du får besked på din registrerede e-mail.
                        </p>
                        <button
                            type="button"
                            onClick={reset}
                            className="text-xs text-emerald-600 dark:text-emerald-400 underline underline-offset-2 mt-1"
                        >
                            Send en ny kontrakt
                        </button>
                    </div>
                </div>
            )}

            {/* ── Mine aktive sager ── */}
            <div className="max-w-2xl space-y-3">
                <div className="flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        Mine aktive sager
                    </span>
                    <Separator className="flex-1" />
                </div>

                {reviewsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                        <Loader2 className="h-4 w-4 animate-spin" />Henter sager…
                    </div>
                ) : activeReviews.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                        Du har ingen igangværende sager.
                    </p>
                ) : (
                    <div className="rounded-lg border divide-y">
                        {activeReviews.map(r => {
                            const sc = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.afventer
                            return (
                                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{r.file_name ?? "Ukendt fil"}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {r.producer_name ?? "—"}
                                            {r.production_type && ` · ${PRODUCTION_LABELS[r.production_type] ?? r.production_type}`}
                                        </p>
                                    </div>
                                    <div className="shrink-0 text-right space-y-1">
                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sc.className}`}>
                                            {sc.label}
                                        </span>
                                        <p className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                                            <Clock className="h-3 w-3" />{relativDato(r.updated_at)}
                                        </p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* ── Arkiv (kun hvis der er afsluttede sager) ── */}
            {!reviewsLoading && archivedReviews.length > 0 && (
                <div className="max-w-2xl space-y-3">
                    <div className="flex items-center gap-3">
                        <Separator className="flex-1" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                            Arkiv
                        </span>
                        <Separator className="flex-1" />
                    </div>
                    <div className="rounded-lg border divide-y">
                        {archivedReviews.map(r => (
                            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{r.file_name ?? "Ukendt fil"}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {r.producer_name ?? "—"}
                                        {r.production_type && ` · ${PRODUCTION_LABELS[r.production_type] ?? r.production_type}`}
                                        {r.updated_at && ` · Afsluttet ${formatDato(r.updated_at)}`}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 h-7 text-xs px-2.5"
                                    onClick={() => router.push(`/portal/kontraktgennemgang/${r.id}`)}
                                >
                                    Se svar <ChevronRight className="h-3 w-3 ml-0.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
