"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Upload, X, FileText, CheckCircle2, Check, Loader2 } from "lucide-react"
import {
    Chip,
    SegmentedControl,
    ProducerCombobox,
    PRODUCTION_TYPES,
    DISTRIBUTION_CHANNELS,
} from "@/components/contract-intake-fields"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/page-header"
import type {
    ContractType,
    ProductionType,
    DistributionChannel,
    FocusArea,
    ProducerSelection,
} from "@/lib/types"

// Delte komponenter importeres fra components/contract-intake-fields.tsx

// ── Formatering ──────────────────────────────────────────────

function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Konstanter ───────────────────────────────────────────────

// PRODUCTION_TYPES og DISTRIBUTION_CHANNELS importeres fra components/contract-intake-fields.tsx

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

    useEffect(() => {
        createClient().auth.getUser().then(({ data: { user } }) => {
            if (user) {
                setMemberName(user.user_metadata?.full_name ?? null)
                setMemberEmail(user.email ?? null)
                setMemberId(user.id)
                setOrgId(user.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5")
            }
        })
    }, [])

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
            const res = await fetch("/api/gennemgang", { method: "POST", body: fd })
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Ukendt fejl" }))
                throw new Error(err.error ?? "Serverfejl")
            }
            // Gem sker server-side i /api/gennemgang med service role
            setSubmitted(true)
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

    // ── Bekræftelsesvisning ──────────────────────────────────

    if (submitted) {
        return (
            <div className="space-y-6">
                <PageHeader title="Kontraktgennemgang" subtitle="Send din kontrakt til juridisk gennemgang" />
                <div className="max-w-xl rounded-xl border bg-card p-8 text-center space-y-4">
                    <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
                    <h2 className="text-xl font-semibold">Din kontrakt er modtaget</h2>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        Vi gennemgår den og vender tilbage til dig snarest.<br />
                        Du får besked på din registrerede e-mail.
                    </p>
                    <Button variant="outline" onClick={reset} className="mt-2">
                        Send en ny kontrakt
                    </Button>
                </div>
            </div>
        )
    }

    // ── Formular ─────────────────────────────────────────────

    return (
        <div className="space-y-6">
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
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyserer kontrakt…</>
                            ) : (
                                "Send til gennemgang"
                            )}
                        </Button>
                    </div>
                )}
            </form>
        </div>
    )
}
