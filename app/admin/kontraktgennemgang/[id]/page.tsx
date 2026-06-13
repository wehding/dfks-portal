"use client"

/**
 * app/admin/kontraktgennemgang/[id]/page.tsx
 *
 * Detaljeside for en indsendt kontrakt fra medlemsportalen.
 * Tre-panel layout: PDF-viewer | AI-analyse | Svarkompositor
 * Kontekstkort øverst med status og tildeling.
 */

import { useState, useRef, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft, Sparkles, Mail, Copy, CheckCircle2, AlertTriangle, Info,
    ChevronRight, Archive, Send, Pencil, Eye, BookMarked, ThumbsUp,
    ThumbsDown, Star, FileText, RotateCcw, X,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { resolveAnker, bygFeedbackPayload } from "@/lib/resolveAnker"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { getMyOrgRole } from "@/lib/db/organisations"
import type { DbContractReview } from "@/lib/db/types"

// ── Types ─────────────────────────────────────────────────────

interface FeedbackPoint {
    id: string
    type: "kritisk" | "advarsel" | "positiv" | "info"
    titel: string
    beskrivelse: string
    anbefaling: string
    citat: string
    paragraf?: string
}

interface FeedbackMail {
    emne: string
    tekst: string
}

interface ReviewResult {
    overblik: {
        titel: string
        parter: string[]
        periode: string
        kontrakttype: string
        overenskomst: string | null
        erLeverandoerkontrakt?: boolean
        honorarUge?: number | null
    }
    feedbackpunkter: FeedbackPoint[]
    feedbackmail: FeedbackMail
    samlet_vurdering: "godkendt" | "forbehold" | "kritisk"
    prioriterede_forhandlingspunkter: string[]
    prioriterede_mail_sektioner?: (number | null)[]
}

// ── Helpers ───────────────────────────────────────────────────

const TYPE_CONFIG = {
    kritisk:  { color: "text-destructive", icon: AlertTriangle },
    advarsel: { color: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
    positiv:  { color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
    info:     { color: "text-muted-foreground", icon: Info },
}

const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
    afventer:   { label: "Afventer",         class: "bg-muted text-muted-foreground border-border" },
    behandling: { label: "Under behandling", class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
    afsluttet:  { label: "Afsluttet",        class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800" },
}

const VERDICT_CONFIG = {
    godkendt:  { label: "✓ Godkendt",       class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800" },
    forbehold: { label: "! Med forbehold",  class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
    kritisk:   { label: "✗ Kritisk",        class: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" },
}

function renderMailWithHighlights(text: string): React.ReactNode[] {
    const GUL_RE = /(\[GUL\][\s\S]*?\[\/GUL\]|===GUL START===[\s\S]*?===GUL SLUT===)/g
    const parts = text.split(GUL_RE)
    return parts.map((part, i) => {
        const isLegacy = part.startsWith("[GUL]") && part.endsWith("[/GUL]")
        const isNew = part.startsWith("===GUL START===") && part.endsWith("===GUL SLUT===")
        if (isLegacy || isNew) {
            const inner = isLegacy ? part.slice(5, -6) : part.slice(15, -14)
            return <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/50 text-foreground rounded-sm px-0.5">{inner}</mark>
        }
        return <span key={i}>{part}</span>
    })
}

function extractGulText(text: string): string {
    const legacyMatches = [...text.matchAll(/\[GUL\]([\s\S]*?)\[\/GUL\]/g)].map(m => m[1].trim())
    const newMatches = [...text.matchAll(/===GUL START===([\s\S]*?)===GUL SLUT===/g)].map(m => m[1].trim())
    return [...legacyMatches, ...newMatches].join("\n\n")
}

function highlightText(text: string, quotes: string[], activeQuote: string | null): string {
    if (!text) return ""
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")
    quotes.forEach((quote, i) => {
        if (!quote || quote.length < 10) return
        const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
        try {
            const regex = new RegExp(`(${escaped})`, "gi")
            const isActive = activeQuote === quote
            html = html.replace(regex, (match) =>
                `<mark class="${isActive ? "bg-yellow-300 dark:bg-yellow-600 ring-2 ring-yellow-400 rounded px-0.5" : "bg-yellow-100 dark:bg-yellow-900/50 rounded px-0.5"}" data-quote="${i}">${match}</mark>`
            )
        } catch { /* skip */ }
    })
    return html
}

// ── Hoved-komponent ───────────────────────────────────────────

export default function KontraktGennemgangDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params)
    const router = useRouter()

    const [review, setReview] = useState<DbContractReview | null>(null)
    const [loading, setLoading] = useState(true)
    const [result, setResult] = useState<ReviewResult | null>(null)
    const [riskLevel, setRiskLevel] = useState<"LAV" | "MELLEM" | "HØJ" | null>(null)
    const [shouldEscalate, setShouldEscalate] = useState<boolean | null>(null)
    const [contractText, setContractText] = useState("")
    const [mailText, setMailText] = useState("")
    const [mailSubject, setMailSubject] = useState("")
    const [mailEditMode, setMailEditMode] = useState(false)
    const [activeQuote, setActiveQuote] = useState<string | null>(null)
    const [activeFpId, setActiveFpId] = useState<string | null>(null)
    const [reanalysing, setReanalysing] = useState(false)
    const [orgId, setOrgId] = useState<string | null>(null)
    const [analyseId] = useState(() => crypto.randomUUID())
    const [fundFeedback, setFundFeedback] = useState<Record<string, "good" | "bad">>({})
    const [fundKorrektioner, setFundKorrektioner] = useState<Record<string, string>>({})
    const [fundGemtFeedback, setFundGemtFeedback] = useState<Record<string, boolean>>({})
    const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null)
    const docRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        getMyOrgRole().then(r => setOrgId(r?.org_id ?? null))
    }, [])

    // Hent review fra API
    useEffect(() => {
        setLoading(true)
        fetch(`/api/admin/contracts/${id}`)
            .then(r => r.json())
            .then(json => {
                const r = json.data as DbContractReview
                setReview(r)
                if (r?.risk_level) setRiskLevel(r.risk_level)
                if (r?.should_escalate != null) setShouldEscalate(r.should_escalate)
                if (r?.ai_result && Object.keys(r.ai_result).length > 0) {
                    const res = r.ai_result as unknown as ReviewResult
                    setResult(res)
                    setMailText(res.feedbackmail?.tekst ?? "")
                    setMailSubject(res.feedbackmail?.emne ?? "")
                }
            })
            .catch(() => toast.error("Kunne ikke hente kontrakt"))
            .finally(() => setLoading(false))
    }, [id])

    // Hent PDF fra storage hvis storage_path findes
    useEffect(() => {
        if (!review?.storage_path) return
        const supabase = createClient()
        supabase.storage
            .from("contract-reviews")
            .createSignedUrl(review.storage_path, 3600)
            .then(({ data }) => {
                if (data?.signedUrl) setPdfObjectUrl(data.signedUrl)
            })
    }, [review?.storage_path])

    useEffect(() => {
        if (!activeQuote || !docRef.current) return
        const mark = docRef.current.querySelector("mark.ring-2")
        if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [activeQuote])

    const updateReview = async (updates: { status?: string; assignedTo?: string; jurist_response?: string }) => {
        const resp = await fetch(`/api/admin/contracts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        })
        if (!resp.ok) { toast.error("Opdatering fejlede"); return }
        const json = await resp.json()
        setReview(json.data)
        toast.success("Opdateret")
    }

    // Rens mailtekst for eventuelle risikovurderingslinjer inden afsendelse
    function cleanMailText(text: string): string {
        return text
            .replace(/Overordnet vurdering\s*:.*?(JA|NEJ|LAV|MELLEM|HØJ)[^\n]*/gi, "")
            .replace(/Risikoniveau\s*:?\s*(LAV|MELLEM|HØJ)[^\n]*/gi, "")
            .replace(/Skal eskaleres\s*:?\s*(JA|NEJ)[^\n]*/gi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    }

    const reanalyseFileRef = useRef<HTMLInputElement>(null)

    const handleReanalyse = async (uploadedFile?: File) => {
        setReanalysing(true)
        try {
            let resp: Response
            if (uploadedFile) {
                // Tilstand B: send uploadet fil direkte
                const fd = new FormData()
                fd.append("file", uploadedFile)
                resp = await fetch(`/api/admin/contracts/${id}/reanalyse`, { method: "POST", body: fd })
            } else {
                // Tilstand A: hent fra storage
                resp = await fetch(`/api/admin/contracts/${id}/reanalyse`, { method: "POST" })
            }
            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}))
                // Filen mangler i storage — bed admin om at uploade den
                if (e.missing_file) {
                    reanalyseFileRef.current?.click()
                    setReanalysing(false)
                    return
                }
                throw new Error(e.error ?? "Analyse fejlede")
            }
            const json = await resp.json()
            const res = json.data.ai_result as unknown as ReviewResult
            setResult(res)
            setMailText(res.feedbackmail?.tekst ?? "")
            setMailSubject(res.feedbackmail?.emne ?? "")
            if (json.data.risk_level) setRiskLevel(json.data.risk_level)
            if (json.data.should_escalate != null) setShouldEscalate(json.data.should_escalate)
            setReview(json.data)
            setContractText(json.contractText ?? "")
            toast.success("Ny analyse fuldført")
        } catch (e: any) {
            toast.error(`Analyse fejlede: ${e.message}`)
        }
        setReanalysing(false)
    }

    const handleCopyGul = () => {
        const gul = extractGulText(mailText)
        if (!gul) { toast.error("Ingen gul-markeret tekst fundet"); return }
        navigator.clipboard.writeText(gul)
        toast.success("Producent-tekst kopieret")
    }

    const handleOpenMail = () => {
        const cleanedText = cleanMailText(mailText)
        const to = review?.member_email ? encodeURIComponent(review.member_email) : ""
        window.location.href = `mailto:${to}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(cleanedText)}`
    }

    // ── Afslut og sæt status ──────────────────────────────────

    const handleAfslut = async () => {
        await updateReview({ status: "afsluttet" })
    }

    if (loading) {
        return (
            <div className="space-y-6">
                <PageHeader title="Kontraktgennemgang" />
                <div className="text-sm text-muted-foreground">Henter kontrakt...</div>
            </div>
        )
    }

    if (!review) {
        return (
            <div className="space-y-6">
                <PageHeader title="Kontraktgennemgang" />
                <div className="text-sm text-muted-foreground">Kontrakt ikke fundet.</div>
            </div>
        )
    }

    const statusCfg = STATUS_CONFIG[review.status] ?? STATUS_CONFIG.afventer
    const verdictCfg = result ? VERDICT_CONFIG[result.samlet_vurdering] : null
    const quotes = result?.feedbackpunkter.map(fp => fp.citat).filter(Boolean) ?? []
    const highlightedHtml = highlightText(contractText, quotes, activeQuote)

    return (
        <div className="flex flex-col gap-4">
            {/* Topbar */}
            <div className="flex items-center gap-3 flex-wrap shrink-0">
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/admin/kontraktgennemgang")}>
                    <ArrowLeft className="h-4 w-4" />
                    Tilbage til indbakke
                </Button>
                <Separator orientation="vertical" className="h-5" />
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium truncate max-w-xs">{review.file_name ?? "Kontrakt"}</span>
                {review.member_name && <span className="text-xs text-muted-foreground">— {review.member_name}</span>}
                {verdictCfg && (
                    <div className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${verdictCfg.class}`}>
                        {verdictCfg.label}
                    </div>
                )}
                {review.ai_run_at && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                        Analyse: {new Date(review.ai_run_at).toLocaleString("da-DK")}
                    </span>
                )}
            </div>

            {/* Kontekstkort */}
            <div className="rounded-lg border bg-muted/20 px-5 py-4 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                        <p className="text-muted-foreground mb-0.5">Ansættelsesform</p>
                        <p className="font-medium capitalize">{review.contract_type?.replace("ansaettelse", "Ansættelse").replace("freelance", "Freelance / leverandør") ?? "—"}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground mb-0.5">Produktionstype</p>
                        <p className="font-medium capitalize">{review.production_type ?? "—"}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground mb-0.5">Distribution</p>
                        <p className="font-medium">{review.distribution_channels?.join(" · ") || "—"}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground mb-0.5">Producer</p>
                        <p className="font-medium flex items-center gap-1">
                            {review.producer_name ?? "—"}
                            {review.producer_overenskomst_bound === true && <span className="text-emerald-600 text-xs" title="Overenskomstbundet">✓</span>}
                            {review.producer_overenskomst_bound === false && <span className="text-muted-foreground text-xs" title="Ikke overenskomstbundet">✗</span>}
                        </p>
                    </div>
                    {review.focus_areas && review.focus_areas.length > 0 && (
                        <div className="col-span-2">
                            <p className="text-muted-foreground mb-0.5">Fokusområder</p>
                            <p className="font-medium">{review.focus_areas.join(" · ")}</p>
                        </div>
                    )}
                    {review.notes && (
                        <div className="col-span-2 sm:col-span-4">
                            <p className="text-muted-foreground mb-0.5">Bemærkning fra medlem</p>
                            <p className="italic text-foreground/80">"{review.notes}"</p>
                        </div>
                    )}
                </div>

                {/* Status og tildeling */}
                <div className="flex flex-wrap gap-3 items-center pt-2 border-t">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Status:</span>
                        <Select
                            value={review.status}
                            onValueChange={v => updateReview({ status: v })}
                        >
                            <SelectTrigger className="h-7 text-xs w-44">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="afventer">Afventer</SelectItem>
                                <SelectItem value="behandling">Under behandling</SelectItem>
                                <SelectItem value="afsluttet">Afsluttet</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-7"
                            disabled={reanalysing}
                            title="Kør ny AI-analyse"
                            onClick={() => handleReanalyse()}
                        >
                            <RotateCcw className={`h-3.5 w-3.5 ${reanalysing ? "animate-spin" : ""}`} />
                            {reanalysing ? "Analyserer..." : "Kør ny analyse"}
                        </Button>
                        {/* Skjult fil-input — trigges automatisk hvis storage_path mangler */}
                        <input
                            ref={reanalyseFileRef}
                            type="file"
                            accept=".pdf,.docx,.doc,.txt"
                            className="hidden"
                            onChange={e => {
                                const f = e.target.files?.[0]
                                if (f) handleReanalyse(f)
                                e.target.value = ""
                            }}
                        />
                        {review.status !== "afsluttet" && (
                            <Button size="sm" className="gap-1.5 text-xs h-7" onClick={handleAfslut}>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Afslut sag
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Tre-panel layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-350px)] min-h-[500px]">

                {/* Panel 1: Dokument */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <span className="text-xs font-medium">Kontrakt</span>
                        <span className="text-xs text-muted-foreground ml-auto truncate max-w-[140px]">{review.file_name}</span>
                    </div>
                    {pdfObjectUrl ? (
                        <iframe src={pdfObjectUrl} className="flex-1 w-full border-0 min-h-0" title={review.file_name ?? "Kontrakt"} />
                    ) : contractText ? (
                        <div
                            ref={docRef}
                            className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed font-mono text-foreground/80 whitespace-pre-wrap min-h-0"
                            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
                            {review.storage_path ? "Indlæser dokument..." : "Filen er slettet efter afslutning af sagen."}
                        </div>
                    )}
                </div>

                {/* Panel 2: AI-analyse */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">AI-analyse</span>
                        {result && (
                            <Badge variant="secondary" className="ml-auto text-[10px]">
                                {result.feedbackpunkter.length} punkter
                            </Badge>
                        )}
                    </div>
                    {/* Risikovurderingsbanner — vises kun når risk_level er sat */}
                    {riskLevel && (
                        <div className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b shrink-0 ${
                            riskLevel === "HØJ"
                                ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
                                : riskLevel === "MELLEM"
                                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                        }`}>
                            <span>{riskLevel === "HØJ" ? "🔴" : riskLevel === "MELLEM" ? "🟡" : "🟢"}</span>
                            <span>Risikoniveau: {riskLevel}</span>
                            {shouldEscalate && (
                                <span className="ml-1 font-semibold">— Skal eskaleres: JA</span>
                            )}
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto divide-y">
                        {!result ? (
                            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
                                <p>Ingen analyse endnu.</p>
                                <p className="mt-1">Klik "Kør ny analyse" for at analysere kontrakten.</p>
                            </div>
                        ) : (
                            result.feedbackpunkter.map((fp) => {
                                const cfg = TYPE_CONFIG[fp.type] ?? TYPE_CONFIG.info
                                const Icon = cfg.icon
                                const isActive = activeFpId === fp.id
                                return (
                                    <div key={fp.id} role="button" tabIndex={0}
                                        onClick={() => { setActiveFpId(fp.id); setActiveQuote(fp.citat) }}
                                        onKeyDown={e => e.key === "Enter" && (setActiveFpId(fp.id), setActiveQuote(fp.citat))}
                                        className={`w-full text-left px-4 py-3 space-y-1.5 transition-colors hover:bg-muted/50 cursor-pointer ${isActive ? "bg-muted/50" : ""}`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-xs font-medium">{fp.titel}</span>
                                                    {fp.paragraf && <span className="text-[10px] text-muted-foreground">§ {fp.paragraf}</span>}
                                                </div>
                                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{fp.beskrivelse}</p>
                                                {isActive && (
                                                    <div className="mt-2 space-y-2">
                                                        <p className="text-[11px] text-foreground/80 leading-relaxed">{fp.beskrivelse}</p>
                                                        {fp.anbefaling && (
                                                            <div className="rounded-md bg-muted px-2.5 py-2">
                                                                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Anbefaling</p>
                                                                <p className="text-[11px]">{fp.anbefaling}</p>
                                                            </div>
                                                        )}
                                                        {fp.citat && (
                                                            <p className="text-[10px] italic text-muted-foreground border-l-2 pl-2 border-muted-foreground/30 line-clamp-3">"{fp.citat}"</p>
                                                        )}
                                                        <div className="pt-1 border-t border-border/50" onClick={e => e.stopPropagation()}>
                                                            <p className="text-[10px] text-muted-foreground mb-1.5">Var dette fund korrekt?</p>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    onClick={async () => {
                                                                        setFundFeedback(prev => ({ ...prev, [fp.id]: "good" }))
                                                                        const supabase = createClient()
                                                                        await supabase.from("analysis_feedback").upsert({
                                                                            analyse_id: analyseId, fund_id: fp.id, fund_titel: fp.titel,
                                                                            fund_svaerhedsgrad: fp.type, fund_beskrivelse: fp.beskrivelse,
                                                                            godkendt: true, org_id: orgId,
                                                                        }, { onConflict: "analyse_id,fund_id" })
                                                                        toast.success("Tak for feedback")
                                                                    }}
                                                                    className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${fundFeedback[fp.id] === "good" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40" : "hover:bg-muted text-muted-foreground"}`}
                                                                >
                                                                    <ThumbsUp className="h-3 w-3" /> Korrekt
                                                                </button>
                                                                <button
                                                                    onClick={() => setFundFeedback(prev => ({ ...prev, [fp.id]: "bad" }))}
                                                                    className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${fundFeedback[fp.id] === "bad" ? "bg-red-100 text-red-700 dark:bg-red-900/40" : "hover:bg-muted text-muted-foreground"}`}
                                                                >
                                                                    <ThumbsDown className="h-3 w-3" /> Forkert
                                                                </button>
                                                            </div>
                                                            {fundFeedback[fp.id] === "bad" && (
                                                                <div className="mt-2 space-y-1.5">
                                                                    <textarea
                                                                        className="w-full text-[11px] rounded border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                                                                        rows={2}
                                                                        placeholder="Beskriv hvad AI'en misforstod..."
                                                                        value={fundKorrektioner[fp.id] ?? ""}
                                                                        onChange={e => setFundKorrektioner(prev => ({ ...prev, [fp.id]: e.target.value }))}
                                                                    />
                                                                    {fundGemtFeedback[fp.id] ? (
                                                                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                                                            <CheckCircle2 className="h-3 w-3" /> Feedback gemt
                                                                        </span>
                                                                    ) : (
                                                                        <button
                                                                            className="text-[11px] text-muted-foreground underline underline-offset-2"
                                                                            onClick={async () => {
                                                                                const supabase = createClient()
                                                                                const ankerResultat = fp.citat && contractText ? resolveAnker(fp.citat, contractText) : null
                                                                                const ankerPayload = ankerResultat ? bygFeedbackPayload(ankerResultat, false, fundKorrektioner[fp.id] ?? undefined) : {}
                                                                                await supabase.from("analysis_feedback").upsert({
                                                                                    analyse_id: analyseId, fund_id: fp.id, fund_titel: fp.titel,
                                                                                    fund_svaerhedsgrad: fp.type, fund_beskrivelse: fp.beskrivelse,
                                                                                    godkendt: false, korrektion_beskrivelse: fundKorrektioner[fp.id] ?? null,
                                                                                    org_id: orgId, ...ankerPayload,
                                                                                }, { onConflict: "analyse_id,fund_id" })
                                                                                setFundGemtFeedback(prev => ({ ...prev, [fp.id]: true }))
                                                                                toast.success("Feedback gemt")
                                                                            }}
                                                                        >
                                                                            Gem feedback
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <ChevronRight className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${isActive ? "rotate-90" : ""}`} />
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* Panel 3: Svarkompositor */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">Feedback-mail</span>
                        <div className="ml-auto flex items-center gap-1">
                            <button
                                onClick={() => setMailEditMode(m => !m)}
                                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] border transition-colors ${mailEditMode ? "bg-muted border-border" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                            >
                                {mailEditMode ? <><Eye className="h-3 w-3" /> Vis</> : <><Pencil className="h-3 w-3" /> Rediger</>}
                            </button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Kopiér hele mailen" onClick={() => { navigator.clipboard.writeText(mailText); toast.success("Mail kopieret") }}>
                                <Copy className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Åbn i mailprogram" onClick={handleOpenMail}>
                                <Send className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>
                    <div className="border-b px-4 py-2.5 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-12 shrink-0">Emne:</span>
                            <Input value={mailSubject} onChange={e => setMailSubject(e.target.value)} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" />
                        </div>
                    </div>
                    {mailEditMode ? (
                        <Textarea value={mailText} onChange={e => setMailText(e.target.value)} className="flex-1 resize-none rounded-none border-0 text-xs font-mono focus-visible:ring-0 min-h-0" placeholder="Feedback-mail udkast..." />
                    ) : (
                        <div className="flex-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap">
                            {mailText ? renderMailWithHighlights(mailText) : <span className="text-muted-foreground">Ingen feedback-mail endnu. Kør analyse for at generere.</span>}
                        </div>
                    )}
                    <div className="border-t px-4 py-2.5 shrink-0 flex gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-1" onClick={handleCopyGul}>
                            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-300 shrink-0" />
                            Kopiér til producent
                        </Button>
                        <Button size="sm" className="gap-1.5 text-xs flex-1" onClick={() => {
                            handleOpenMail()
                            // Gem jurist_response (renset tekst uden risikovurdering) + sæt status
                            const cleanedText = cleanMailText(mailText)
                            updateReview({ status: "afsluttet", jurist_response: cleanedText })
                        }}>
                            <Send className="h-3.5 w-3.5" />
                            Send og afslut
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
