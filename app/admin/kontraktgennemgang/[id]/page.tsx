"use client"

import { errorMessage } from "@/lib/error-message";
/**
 * app/admin/kontraktgennemgang/[id]/page.tsx
 *
 * Detaljeside for en indsendt kontrakt fra medlemsportalen.
 * Tre-panel layout: PDF-viewer | AI-analyse | Svarkompositor
 * Kontekstkort øverst med status og tildeling.
 */

import { useState, useRef, useEffect, useMemo, use } from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft, Sparkles, Mail, Copy, CheckCircle2, AlertTriangle, Info,
    ChevronRight, Pencil, Eye, ThumbsUp,
    ThumbsDown, FileText, RotateCcw, RefreshCw, ExternalLink, Loader2,
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
import { isActiveContractReviewAnalysis, normalizeContractReviewAnalysisStatus } from "@/lib/contract-review-job-status"
import { useI18n } from "@/lib/i18n"

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

interface ReviewAssignee {
    id: string
    label: string
}

interface EmailSource {
    subject: string | null
    from_address: string | null
    to_addresses: string[]
    cc_addresses: string[]
    received_at: string | null
    body_text: string | null
}

interface EmailThreadMessage {
    id: string
    gmailMessageId: string
    subject: string | null
    from: string | null
    to: string[]
    cc: string[]
    receivedAt: string | null
    body: string | null
    direction: "incoming" | "outgoing"
}

// ── Helpers ───────────────────────────────────────────────────

const TYPE_CONFIG = {
    kritisk:  { color: "text-destructive", icon: AlertTriangle },
    advarsel: { color: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
    positiv:  { color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
    info:     { color: "text-muted-foreground", icon: Info },
}

const PRODUCTION_TYPE_LABELS: Record<string, string> = {
    dokumentar:              "Dokumentarfilm",
    fiktion:                 "Fiktion / drama",
    tv_program:              "TV-program",
    reklame:                 "Reklame",
    streaming:               "Streaming",
    shortform:               "Short-form",
    ukendt:                  "Ukendt",
    udvikling_dokumentar:    "Udvikling (Dokumentar)",
    udvikling_fiktion:       "Udvikling (Fiktion)",
    udvikling_underholdning: "Udvikling (Underholdning)",
}

const DISTRIBUTION_LABELS: Record<string, string> = {
    biograf:             "Biograf",
    tv_lineaer:          "TV (lineær)",
    streaming_svod:      "Streaming (SVOD)",
    streaming_avod:      "Streaming (AVOD)",
    festival:            "Festival",
    internationalt_salg: "Internationalt salg",
    ukendt:              "Ukendt",
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

function renderMailWithHighlights(text: string): React.ReactNode {
    const normalizeMarkers = text
        .replace(/\[GUL\]([\s\S]*?)\[\/GUL\]/g, '<span style="background-color:#fef08a">$1</span>')
        .replace(/===GUL START===([\s\S]*?)===GUL SLUT===/g, '<span style="background-color:#fef08a">$1</span>')
        .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/g, '<span style="background-color:#fef08a">$1</span>')
        .replace(/<span[^>]*background-color:#fef08a[^>]*>([\s\S]*?)<\/span>/g, "[GUL]$1[/GUL]")
    const html = normalizeMarkers
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/\[GUL\]([\s\S]*?)\[\/GUL\]/g, '<span style="background-color:#fef08a">$1</span>')
        .replace(/\n/g, "<br/>")
    return (
        <span
            dangerouslySetInnerHTML={{ __html: html }}
            className="whitespace-pre-wrap"
        />
    )
}

function extractGulText(text: string): string {
    // Span-format (nyt)
    const spanMatches = [...text.matchAll(/<span[^>]*background-color:#fef08a[^>]*>([\s\S]*?)<\/span>/g)].map(m => m[1].trim())
    if (spanMatches.length) return spanMatches.join("\n\n")
    // Mark-format
    const markMatches = [...text.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/g)].map(m => m[1].trim())
    if (markMatches.length) return markMatches.join("\n\n")
    // Legacy tokens
    const legacy = [...text.matchAll(/\[GUL\]([\s\S]*?)\[\/GUL\]/g)].map(m => m[1].trim())
    const gul = [...text.matchAll(/===GUL START===([\s\S]*?)===GUL SLUT===/g)].map(m => m[1].trim())
    return [...legacy, ...gul].join("\n\n")
}

async function copyAsRichText(rawHtml: string): Promise<void> {
    // Normaliser <mark> til <span> så spans bevares ved paste i Gmail compose
    const html = rawHtml
        .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/g, '<span style="background-color:#fef08a">$1</span>')
        .replace(/\n/g, "<br/>")
    const plain = rawHtml.replace(/<[^>]+>/g, "")
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([`<html><body>${html}</body></html>`], { type: "text/html" }),
                "text/plain": new Blob([plain], { type: "text/plain" }),
            })
        ])
    } catch {
        await navigator.clipboard.writeText(plain)
    }
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
    const { t } = useI18n()
    const { id } = use(params)
    const router = useRouter()

    const [review, setReview] = useState<DbContractReview | null>(null)
    const [assignees, setAssignees] = useState<ReviewAssignee[]>([])
    const [canAssign, setCanAssign] = useState(false)
    const [loading, setLoading] = useState(true)
    const [result, setResult] = useState<ReviewResult | null>(null)
    const [riskLevel, setRiskLevel] = useState<"LAV" | "MELLEM" | "HØJ" | null>(null)
    const [shouldEscalate, setShouldEscalate] = useState<boolean | null>(null)
    const [contractText] = useState("")
    const [mailText, setMailText] = useState("")
    const [mailSubject, setMailSubject] = useState("")
    const [mailTo, setMailTo] = useState("")
    const [mailCc, setMailCc] = useState("")
    const [mailEditMode, setMailEditMode] = useState(false)
    const [emailSource, setEmailSource] = useState<EmailSource | null>(null)
    const [emailThread, setEmailThread] = useState<EmailThreadMessage[]>([])
    const [mailAction, setMailAction] = useState<"sync" | "suggestion" | "gmail" | null>(null)
    const [gmailDraftUrl, setGmailDraftUrl] = useState<string | null>(null)
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

    // Afledt analysestatus — driver "AI tænker"-feedback i UI'et så længe et
    // job er i kø / under behandling (ikke kun mens POST-kaldet kører).
    const analysisStatus = useMemo(() => {
        if (!review) return null
        return review.analysis_status ?? normalizeContractReviewAnalysisStatus({
            aiStatus: review.ai_status,
            intakeStatus: review.intake_status,
            job: review.analysis_job ? {
                status: review.analysis_job.status,
                attempts: review.analysis_job.attempts,
                next_attempt_at: review.analysis_job.next_attempt_at,
                error_message: review.analysis_job.error,
            } : null,
        })
    }, [review])
    const isAnalysing = analysisStatus != null && isActiveContractReviewAnalysis(analysisStatus)

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
                setAssignees(Array.isArray(json.assignees) ? json.assignees : [])
                setCanAssign(Boolean(json.canAssign))
                setEmailSource(json.emailSource ?? null)
                setEmailThread(Array.isArray(json.emailThread) ? json.emailThread : [])
                setMailTo(r?.response_draft_to ?? "")
                setMailCc((r?.response_draft_cc ?? []).join(", "))
                setGmailDraftUrl(r?.gmail_response_draft_id ? "https://mail.google.com/mail/u/0/#drafts" : null)
                if (r?.risk_level) setRiskLevel(r.risk_level)
                if (r?.should_escalate != null) setShouldEscalate(r.should_escalate)
                if (r?.ai_result && Object.keys(r.ai_result).length > 0) {
                    const res = r.ai_result as unknown as ReviewResult
                    setResult(res)
                    setMailText(r.response_draft ?? res.feedbackmail?.tekst ?? "")
                    setMailSubject(r.response_draft_subject ?? res.feedbackmail?.emne ?? "")
                } else {
                    setMailText(r.response_draft ?? "")
                    setMailSubject(r.response_draft_subject ?? "")
                }
            })
            .catch(() => toast.error("Kunne ikke hente kontrakt"))
            .finally(() => setLoading(false))
    }, [id])

    useEffect(() => {
        if (!isAnalysing) return
        const interval = window.setInterval(async () => {
            const response = await fetch(`/api/admin/contracts/${id}`).catch(() => null)
            if (!response?.ok) return
            const json = await response.json()
            const updated = json.data as DbContractReview
            setReview(updated)
            if (updated.ai_result && updated.analysis_status === "ready") {
                const nextResult = updated.ai_result as unknown as ReviewResult
                setResult(nextResult)
                setMailText(updated.response_draft ?? nextResult.feedbackmail?.tekst ?? "")
                setMailSubject(updated.response_draft_subject ?? nextResult.feedbackmail?.emne ?? "")
                if (updated.risk_level) setRiskLevel(updated.risk_level)
                if (updated.should_escalate != null) setShouldEscalate(updated.should_escalate)
            }
        }, 5_000)
        return () => window.clearInterval(interval)
    }, [id, isAnalysing])

    // Hent PDF-URL via server-side route (omgår storage RLS)
    useEffect(() => {
        if (!review?.storage_path || !id) return
        fetch(`/api/admin/contracts/${id}/pdf`)
            .then(r => r.ok ? r.json() : null)
            .then(json => { if (json?.url) setPdfObjectUrl(json.url) })
            .catch(() => { /* PDF ikke tilgængelig */ })
    }, [review?.storage_path, id])

    useEffect(() => {
        if (!activeQuote || !docRef.current) return
        const mark = docRef.current.querySelector("mark.ring-2")
        if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [activeQuote])

    const updateReview = async (updates: { status?: string; assignedTo?: string; jurist_response?: string; responseDraft?: string; responseDraftSubject?: string; responseDraftTo?: string; responseDraftCc?: string[]; responseDraftVersion?: number; action?: "claim" | "release" | "assign" }) => {
        const resp = await fetch(`/api/admin/contracts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        })
        const json = await resp.json()
        if (!resp.ok) { toast.error(json.error ?? "Opdatering fejlede"); return null }
        setReview(json.data)
        toast.success("Opdateret")
        return json.data as DbContractReview
    }

    const savePortalDraft = async () => {
        if (!review) return null
        const updated = await updateReview({
            responseDraft: cleanMailText(mailText), responseDraftSubject: mailSubject,
            responseDraftTo: mailTo, responseDraftCc: mailCc.split(/[;,]/).map(value => value.trim()).filter(Boolean),
            responseDraftVersion: review.response_draft_version ?? 0,
        })
        if (updated) {
            setMailTo(updated.response_draft_to ?? mailTo)
            setMailCc((updated.response_draft_cc ?? []).join(", "))
        }
        return updated
    }

    const syncMailThread = async () => {
        setMailAction("sync")
        try {
            const response = await fetch(`/api/admin/contracts/${id}/gmail-thread`, { method: "POST" })
            const json = await response.json()
            if (!response.ok) throw new Error(json.error)
            setEmailThread(json.messages ?? [])
            toast.success("Mailtråden er opdateret")
        } catch (error) { toast.error(errorMessage(error)) }
        finally { setMailAction(null) }
    }

    const refreshMailSuggestion = async () => {
        if (!review) return
        setMailAction("suggestion")
        try {
            const response = await fetch(`/api/admin/contracts/${id}/mail-suggestion`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expectedVersion: review.response_draft_version ?? 0 }),
            })
            const json = await response.json()
            if (!response.ok) {
                if (json.data) setReview(json.data)
                throw new Error(json.error)
            }
            setReview(json.data)
            setMailText(json.data.response_draft ?? "")
            setMailSubject(json.data.response_draft_subject ?? "")
            toast.success("Mailforslaget er opdateret med hele tråden")
        } catch (error) { toast.error(errorMessage(error)) }
        finally { setMailAction(null) }
    }

    const createGmailDraft = async () => {
        if (!review) return
        setMailAction("gmail")
        try {
            const response = await fetch(`/api/admin/contracts/${id}/gmail-draft`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: mailTo, cc: mailCc.split(/[;,]/).map(value => value.trim()).filter(Boolean), subject: mailSubject, text: cleanMailText(mailText), expectedVersion: review.response_draft_version ?? 0 }),
            })
            const json = await response.json()
            if (!response.ok) {
                if (json.data) setReview(json.data)
                throw new Error(json.error)
            }
            setReview(json.data)
            setGmailDraftUrl(json.gmail?.url ?? "https://mail.google.com/mail/u/0/#drafts")
            toast.success("Kladden er gemt i Gmail")
        } catch (error) { toast.error(errorMessage(error)) }
        finally { setMailAction(null) }
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
            setReview(current => current ? {
                ...current,
                ai_status: "analyserer",
                intake_status: "queued",
                analysis_status: "queued",
            } : current)
            toast.success("Analysen er sat i kø")
        } catch (e: unknown) {
            toast.error(`Analyse fejlede: ${errorMessage(e)}`)
        }
        setReanalysing(false)
    }

    const handleCopyGul = async () => {
        const gul = extractGulText(mailText)
        if (!gul) { toast.error("Ingen gul-markeret tekst fundet"); return }
        // Wrap i mark-tags så Gmail bevarer den gule farve
        const gulHtml = gul.split("\n\n").map(p =>
            `<mark style="background-color:#fef08a">${p.replace(/\n/g, "<br/>")}</mark>`
        ).join("<br/><br/>")
        await copyAsRichText(gulHtml)
        toast.success("Producent-tekst kopieret")
    }

    // ── Afslut og sæt status ──────────────────────────────────

    const handleAfslut = async () => {
        await updateReview({ status: "afsluttet" })
    }

    if (loading) {
        return (
            <div className="space-y-6">
                <PageHeader title={t("nav.contractReview")} />
                <div className="text-sm text-muted-foreground">{t("admin.reviewDetail.loading")}</div>
            </div>
        )
    }

    if (!review) {
        return (
            <div className="space-y-6">
                <PageHeader title={t("nav.contractReview")} />
                <div className="text-sm text-muted-foreground">{t("admin.reviewDetail.notFound")}</div>
            </div>
        )
    }

    const statusCfg = STATUS_CONFIG[review.status] ?? STATUS_CONFIG.afventer
    const verdictCfg = result ? VERDICT_CONFIG[result.samlet_vurdering] : null
    const quotes = result?.feedbackpunkter.map(fp => fp.citat).filter(Boolean) ?? []
    const highlightedHtml = highlightText(contractText, quotes, activeQuote)
    const latestThreadMessageId = emailThread.at(-1)?.gmailMessageId ?? null
    const hasNewThreadMessages = Boolean(latestThreadMessageId && latestThreadMessageId !== review.response_draft_thread_message_id)

    return (
        <div className="flex flex-col gap-4">
            {/* Topbar */}
            <div className="flex items-center gap-3 flex-wrap shrink-0">
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/admin/kontraktgennemgang")}>
                    <ArrowLeft className="h-4 w-4" />
                    {t("admin.reviewDetail.back")}
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
                <div className="grid gap-4 text-xs sm:grid-cols-4">
                    <div>
                        <p className="text-muted-foreground mb-0.5">Ansættelsesform</p>
                        <p className="font-medium capitalize">{review.contract_type?.replace("ansaettelse", "Ansættelse").replace("freelance", "Freelance / leverandør") ?? "—"}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground mb-0.5">Produktionstype</p>
                        <p className="font-medium">{review.production_type ? (PRODUCTION_TYPE_LABELS[review.production_type] ?? review.production_type) : "—"}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground mb-0.5">Distribution</p>
                        <p className="font-medium">{review.distribution_channels?.map(c => DISTRIBUTION_LABELS[c] ?? c).join(" · ") || "—"}</p>
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
                        <div className="sm:col-span-2">
                            <p className="text-muted-foreground mb-0.5">Fokusområder</p>
                            <p className="font-medium">{review.focus_areas.join(" · ")}</p>
                        </div>
                    )}
                    {review.notes && (
                        <div className="sm:col-span-4">
                            <p className="text-muted-foreground mb-0.5">Bemærkning fra medlem</p>
                            <p className="italic text-foreground/80">&quot;{review.notes}&quot;</p>
                        </div>
                    )}
                </div>

                {/* Status og tildeling */}
                <div className="flex flex-wrap gap-3 items-center pt-2 border-t">
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <span className="text-xs text-muted-foreground">{t("common.status")}:</span>
                        <Badge variant="outline" className={statusCfg.class}>{review.status === "afventer" ? t("admin.reviewQueue.unassigned") : review.status === "behandling" ? t("admin.reviewQueue.processing") : t("admin.reviewQueue.completed")}</Badge>
                        {!review.assigned_to && review.status !== "afsluttet" && <Button size="sm" className="h-7 text-xs" onClick={() => updateReview({ action: "claim" })}>{t("admin.reviewDetail.claim")}</Button>}
                        {review.assigned_to && review.status !== "afsluttet" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateReview({ action: "release" })}>{t("admin.reviewDetail.release")}</Button>}
                        {canAssign && review.status !== "afsluttet" && assignees.length > 0 && (
                            <Select
                                value={review.assigned_to ?? undefined}
                                onValueChange={assignedTo => updateReview({ action: "assign", assignedTo })}
                            >
                                <SelectTrigger className="h-7 w-full text-xs sm:w-48" aria-label={t("admin.reviewDetail.assignTo")}>
                                    <SelectValue placeholder={t("admin.reviewDetail.assignTo")} />
                                </SelectTrigger>
                                <SelectContent>
                                    {assignees.map(assignee => (
                                        <SelectItem key={assignee.id} value={assignee.id}>{assignee.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-7"
                            disabled={reanalysing || isAnalysing}
                            title="Kør ny AI-analyse"
                            onClick={() => handleReanalyse()}
                        >
                            <RotateCcw className={`h-3.5 w-3.5 ${reanalysing || isAnalysing ? "animate-spin" : ""}`} />
                            {reanalysing || isAnalysing ? t("admin.reviewDetail.analysing") : t("admin.reviewDetail.reanalyse")}
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
                                {t("admin.reviewDetail.complete")}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Tre-panel layout */}
            <div className="grid min-h-[500px] gap-4 lg:h-[calc(100vh-350px)] lg:grid-cols-3">

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
                        {isAnalysing ? (
                            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {analysisStatus === "retrying" ? "Prøver igen…" : t("admin.reviewDetail.analysing")}
                            </span>
                        ) : result && (
                            <Badge variant="secondary" className="ml-auto text-[10px]">
                                {result.feedbackpunkter.length} punkter
                            </Badge>
                        )}
                    </div>
                    {/* "AI tænker"-stribe — synlig så længe et analysejob er i kø / under behandling */}
                    {isAnalysing && (
                        <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground shrink-0">
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                            <span>{t("admin.reviewDetail.analysisRunning")}</span>
                        </div>
                    )}
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
                        {!result && isAnalysing ? (
                            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin opacity-40" />
                                <p>{t("admin.reviewDetail.analysisRunning")}</p>
                                <p className="mt-1">Resultatet vises automatisk her, når analysen er færdig.</p>
                            </div>
                        ) : !result && analysisStatus === "failed" ? (
                            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-amber-500 opacity-70" />
                                <p>Analysen kunne ikke gennemføres.</p>
                                <p className="mt-1">Klik &quot;Kør ny analyse&quot; for at prøve igen.</p>
                            </div>
                        ) : !result ? (
                            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
                                <p>Ingen analyse endnu.</p>
                                <p className="mt-1">Klik &quot;Kør ny analyse&quot; for at analysere kontrakten.</p>
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
                                                            <p className="text-[10px] italic text-muted-foreground border-l-2 pl-2 border-muted-foreground/30 line-clamp-3">&quot;{fp.citat}&quot;</p>
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
                        <span className="text-xs font-medium">AI-svarudkast</span>
                        <div className="ml-auto flex items-center gap-1">
                            <button
                                onClick={() => setMailEditMode(m => !m)}
                                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] border transition-colors ${mailEditMode ? "bg-muted border-border" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                            >
                                {mailEditMode ? <><Eye className="h-3 w-3" /> Vis</> : <><Pencil className="h-3 w-3" /> Rediger</>}
                            </button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Kopiér svarudkast" onClick={async () => { await copyAsRichText(mailText); toast.success("Svarudkast kopieret") }}>
                                <Copy className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>
                    <div className="border-b bg-amber-50 px-4 py-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        AI-forslag — skal kontrolleres af en jurist. Systemet sender ikke mail.
                    </div>
                    {(emailSource || emailThread.length > 0) && (
                        <details className="border-b px-4 py-2 text-xs">
                            <summary className="cursor-pointer font-medium">
                                Mail og spørgsmål fra medlemmet
                                {hasNewThreadMessages && <Badge className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">Nye beskeder</Badge>}
                            </summary>
                            <div className="mt-2 flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">{emailThread.length || 1} besked(er) i tråden</span>
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={mailAction === "sync"} onClick={syncMailThread}>
                                    <RefreshCw className={`h-3 w-3 ${mailAction === "sync" ? "animate-spin" : ""}`} /> Opdatér mailtråd
                                </Button>
                            </div>
                            <div className="mt-2 space-y-2 text-muted-foreground">
                                {(emailThread.length ? emailThread : emailSource ? [{
                                    id: "source", gmailMessageId: "source", subject: emailSource.subject, from: emailSource.from_address,
                                    to: emailSource.to_addresses, cc: emailSource.cc_addresses, receivedAt: emailSource.received_at,
                                    body: emailSource.body_text, direction: "incoming" as const,
                                }] : []).map(message => (
                                    <article key={message.id} className={`rounded border p-2 ${message.direction === "outgoing" ? "bg-blue-50/60 dark:bg-blue-950/20" : "bg-muted/30"}`}>
                                        <p><span className="text-foreground">Fra:</span> {message.from ?? "Ukendt"}</p>
                                        <p><span className="text-foreground">Til:</span> {message.to.join(", ") || "Ukendt"}</p>
                                        {message.cc.length > 0 && <p><span className="text-foreground">Cc:</span> {message.cc.join(", ")}</p>}
                                        <p><span className="text-foreground">Emne:</span> {message.subject ?? "Uden emne"}</p>
                                        {message.receivedAt && <p><span className="text-foreground">Tidspunkt:</span> {new Date(message.receivedAt).toLocaleString("da-DK")}</p>}
                                        <div className="mt-2 whitespace-pre-wrap text-foreground">{message.body || "Mailen indeholdt ingen læsbar tekst."}</div>
                                    </article>
                                ))}
                            </div>
                        </details>
                    )}
                    {hasNewThreadMessages && (
                        <div className="flex items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            <span>Nye beskeder siden mailforslaget</span>
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={mailAction === "suggestion"} onClick={refreshMailSuggestion}>
                                {mailAction === "suggestion" ? "Opdaterer…" : "Opdatér mailforslag"}
                            </Button>
                        </div>
                    )}
                    <div className="border-b px-4 py-2.5 shrink-0 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-12 shrink-0">Til:</span>
                            <Input value={mailTo} onChange={e => setMailTo(e.target.value)} className="h-7 text-xs" placeholder="medlem@example.dk" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-12 shrink-0">Cc:</span>
                            <Input value={mailCc} onChange={e => setMailCc(e.target.value)} className="h-7 text-xs" placeholder="Flere adresser adskilles med komma" />
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
                    <div className="border-t px-4 py-2.5 shrink-0 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-1" onClick={handleCopyGul}>
                            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-300 shrink-0" />
                            Kopiér til producent
                        </Button>
                        <Button size="sm" className="gap-1.5 text-xs flex-1" onClick={savePortalDraft}>
                            Gem kladde
                        </Button>
                        <Button size="sm" variant="secondary" className="basis-full gap-1.5 text-xs" disabled={mailAction === "gmail" || !mailTo || !mailText} onClick={createGmailDraft}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            {mailAction === "gmail" ? "Gemmer i Gmail…" : review.gmail_response_draft_id ? "Opdatér kladde i Gmail" : "Opret kladde i Gmail"}
                        </Button>
                        {gmailDraftUrl && (
                            <a href={gmailDraftUrl} target="_blank" rel="noreferrer" className="basis-full text-center text-xs text-primary underline underline-offset-2">
                                Åbn kladder i Gmail
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
