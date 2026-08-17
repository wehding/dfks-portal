"use client"

/**
 * app/admin/kontraktgennemgang/page.tsx
 *
 * To sektioner:
 *   1. Indbakke — indkomne kontrakter fra medlemsportalen (tabs: Min kø / Alle)
 *   2. Manuel gennemgang — eksisterende jurist-værktøj med upload + AI-analyse
 */

import { Suspense, useState, useRef, useCallback, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import {
    Upload, ArrowLeft, Sparkles, Mail, Copy,
    CheckCircle2, AlertTriangle, Info, ChevronRight,
    Archive, Pencil, Eye, BookMarked,
    ThumbsUp, ThumbsDown, Star, Search,
    User, FileText, ChevronDown, RotateCcw,
    Trash2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { resolveAnker, bygFeedbackPayload } from "@/lib/resolveAnker"
import { PageHeader } from "@/components/page-header"
import { ListResultSummary } from "@/components/list-result-summary"
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { type CaseLearningKontrakttype } from "@/lib/ai"
import { getMyOrgRole } from "@/lib/db/organisations"
import { useRouter } from "next/navigation"
import type { DbContractReview } from "@/lib/db/types"
import { isActiveContractReviewAnalysis, normalizeContractReviewAnalysisStatus } from "@/lib/contract-review-job-status"
import type { ContractType, ProductionType, DistributionChannel, ProducerSelection } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import {
    Chip,
    SegmentedControl,
    ProducerCombobox,
    CONTRACT_TYPE_OPTIONS,
    PRODUCTION_TYPES,
    DISTRIBUTION_CHANNELS,
} from "@/components/contract-intake-fields"

// ── Types ─────────────────────────────────────────────────────

interface FeedbackPoint {
    id: string
    rule_code?: string
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

type ReviewClassification = {
    kontrakttype?: string
    produktionstype?: string
    er_overenskomst?: boolean
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "ukendt fejl"
}

// ── Helpers ───────────────────────────────────────────────────

const TYPE_CONFIG = {
    kritisk:  { color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", icon: AlertTriangle, badge: "destructive" as const },
    advarsel: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800", icon: AlertTriangle, badge: "secondary" as const },
    positiv:  { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800", icon: CheckCircle2, badge: "default" as const },
    info:     { color: "text-muted-foreground", bg: "bg-muted/50 border-border", icon: Info, badge: "outline" as const },
}

const VERDICT_CONFIG = {
    godkendt:  { label: "✓ Godkendt", class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800" },
    forbehold: { label: "! Med forbehold", class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
    kritisk:   { label: "✗ Kritisk", class: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" },
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

const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
    afventer:  { label: "Ikke tildelt",     class: "bg-muted text-muted-foreground border-border" },
    behandling:{ label: "Tildelt og under behandling", class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
    afsluttet: { label: "Afsluttet",        class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800" },
}

const ANALYSIS_STATUS_CONFIG = {
    queued: { label: { da: "I kø", en: "Queued" }, class: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:border-slate-800" },
    processing: { label: { da: "Analyserer", en: "Analysing" }, class: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800" },
    retrying: { label: { da: "Prøver igen", en: "Retrying" }, class: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
    failed: { label: { da: "Analyse fejlede – genprøv", en: "Analysis failed – retry" }, class: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" },
    ready: { label: { da: "Analyse klar", en: "Analysis ready" }, class: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800" },
} as const

function reviewAnalysisStatus(review: DbContractReview) {
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
}

function relativeTime(dateStr: string, locale: "da" | "en"): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    const formatter = new Intl.RelativeTimeFormat(locale === "da" ? "da-DK" : "en-GB", { numeric: "auto" })
    if (mins < 1) return formatter.format(0, "minute")
    if (mins < 60) return formatter.format(-mins, "minute")
    const hours = Math.floor(mins / 60)
    if (hours < 24) return formatter.format(-hours, "hour")
    const days = Math.floor(hours / 24)
    if (days < 7) return formatter.format(-days, "day")
    return new Date(dateStr).toLocaleDateString(locale === "da" ? "da-DK" : "en-GB")
}

function highlightText(text: string, quotes: string[], activeQuote: string | null): string {
    if (!text) return ""
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>")
    quotes.forEach((quote, i) => {
        if (!quote || quote.length < 10) return
        const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
        try {
            const regex = new RegExp(`(${escaped})`, "gi")
            const isActive = activeQuote === quote
            html = html.replace(regex, (match) =>
                `<mark class="${isActive
                    ? "bg-yellow-300 dark:bg-yellow-600 ring-2 ring-yellow-400 rounded px-0.5"
                    : "bg-yellow-100 dark:bg-yellow-900/50 rounded px-0.5"
                }" data-quote="${i}">${match}</mark>`
            )
        } catch { /* skip malformed regex */ }
    })
    return html
}

function buildMailText(mail: FeedbackMail): string {
    return mail.tekst ?? ""
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
    return <span dangerouslySetInnerHTML={{ __html: html }} className="whitespace-pre-wrap" />
}

function removeMailSection(text: string, sectionNum: number): string {
    const lines = text.split("\n")
    const headerRe = /^(\d+)[.)]\s+\S/
    const headers: { lineIdx: number; num: number }[] = []
    lines.forEach((line, i) => {
        const m = line.match(headerRe)
        if (m) headers.push({ lineIdx: i, num: parseInt(m[1]) })
    })
    const target = headers.find(h => h.num === sectionNum)
    if (!target) return text
    const tIdx = headers.indexOf(target)
    const endLine = tIdx + 1 < headers.length ? headers[tIdx + 1].lineIdx : lines.length
    return [...lines.slice(0, target.lineIdx), ...lines.slice(endLine)]
        .join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function extractGulText(text: string): string {
    const spanMatches = [...text.matchAll(/<span[^>]*background-color:#fef08a[^>]*>([\s\S]*?)<\/span>/g)].map(m => m[1].trim())
    if (spanMatches.length) return spanMatches.join("\n\n")
    const legacy = [...text.matchAll(/\[GUL\]([\s\S]*?)\[\/GUL\]/g)].map(m => m[1].trim())
    const gul = [...text.matchAll(/===GUL START===([\s\S]*?)===GUL SLUT===/g)].map(m => m[1].trim())
    return [...legacy, ...gul].join("\n\n")
}

// ── Indbakke-komponent ────────────────────────────────────────

function Indbakke() {
    const { t, locale } = useI18n()
    const router = useRouter()
    const searchParams = useSearchParams()
    const [tab, setTab] = useState<"mine" | "alle">(() => searchParams.get("queue") === "mine" ? "mine" : "alle")
    const [reviews, setReviews] = useState<DbContractReview[]>([])
    const [totalCount, setTotalCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState<string[]>(() => searchParams.get("status")?.split(",").filter(Boolean) ?? [])
    const [productionTypeFilter, setProductionTypeFilter] = useState<string[]>([])
    const [search, setSearch] = useState("")
    const [reanalysingIds, setReanalysingIds] = useState<Set<string>>(new Set())
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [bulkUpdating, setBulkUpdating] = useState(false)
    const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false)

    const fetchReviews = useCallback(async (showLoading = true) => {
        if (showLoading) setLoading(true)
        const params = new URLSearchParams()
        params.set("queue", tab === "mine" ? "mine" : "all")
        if (statusFilter.length) params.set("status", statusFilter.join(","))
        if (productionTypeFilter.length) params.set("productionType", productionTypeFilter.join(","))
        if (search) params.set("search", search)
        params.set("limit", "50")

        try {
            const resp = await fetch(`/api/admin/contracts?${params}`)
            const json = await resp.json()
            setReviews(json.data ?? [])
            setTotalCount(json.count ?? 0)
        } catch {
            toast.error("Kunne ikke hente kontrakter")
        }
        if (showLoading) setLoading(false)
    }, [tab, statusFilter, productionTypeFilter, search])

    useEffect(() => {
        let cancelled = false
        queueMicrotask(() => {
            if (!cancelled) void fetchReviews()
        })
        return () => {
            cancelled = true
        }
    }, [fetchReviews])

    useEffect(() => {
        if (!reviews.some(review => isActiveContractReviewAnalysis(reviewAnalysisStatus(review)))) return
        const interval = window.setInterval(() => void fetchReviews(false), 5_000)
        return () => window.clearInterval(interval)
    }, [fetchReviews, reviews])

    // ── Supabase Realtime — lyt på INSERT og UPDATE ───────────
    useEffect(() => {
        const supabase = createClient()
        const channel = supabase
            .channel("contract_reviews_changes")
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "contract_reviews" },
                () => { void fetchReviews(false) }
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "contract_reviews" },
                () => { void fetchReviews(false) }
            )
            .on(
                "postgres_changes",
                { event: "DELETE", schema: "public", table: "contract_reviews" },
                payload => {
                    const deletedId = (payload.old as { id?: string }).id
                    if (!deletedId) return
                    setReviews(previous => {
                        const existed = previous.some(review => review.id === deletedId)
                        if (existed) setTotalCount(count => Math.max(0, count - 1))
                        return previous.filter(review => review.id !== deletedId)
                    })
                    setSelectedIds(previous => {
                        const next = new Set(previous)
                        next.delete(deletedId)
                        return next
                    })
                }
            )
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [fetchReviews])

    const mineCount = reviews.filter(r => r.status !== "afsluttet").length
    const visibleIds = reviews.map(review => review.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
    const toggleSelected = (id: string) => setSelectedIds(current => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })
    const toggleAllVisible = () => setSelectedIds(current => {
        if (allVisibleSelected) return new Set([...current].filter(id => !visibleIds.includes(id)))
        return new Set([...current, ...visibleIds])
    })
    const openReview = (id: string) => router.push(`/admin/kontraktgennemgang/${id}`)
    const reanalyseReview = async (reviewId: string) => {
        setReanalysingIds(previous => new Set([...previous, reviewId]))
        try {
            const response = await fetch(`/api/admin/contracts/${reviewId}/reanalyse`, { method: "POST" })
            const result = await response.json().catch(() => ({})) as { error?: string; missing_file?: boolean }
            if (!response.ok) {
                if (result.missing_file) toast.error("Filen mangler – åbn sagen og upload den igen")
                else toast.error(result.error ?? "Analysen kunne ikke sættes i kø")
                return
            }
            toast.success("Analysen er sat i kø")
            await fetchReviews(false)
        } finally {
            setReanalysingIds(previous => { const next = new Set(previous); next.delete(reviewId); return next })
        }
    }
    const renderAnalysisBadge = (review: DbContractReview) => {
        const state = reviewAnalysisStatus(review)
        const config = ANALYSIS_STATUS_CONFIG[state]
        const label = config.label[locale]
        const busy = reanalysingIds.has(review.id)
        const title = state === "retrying" && review.analysis_job?.next_attempt_at
            ? `Næste automatiske forsøg: ${new Date(review.analysis_job.next_attempt_at).toLocaleString("da-DK")}`
            : label
        if (state === "failed") {
            return <button
                type="button"
                title={title}
                disabled={busy}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80 disabled:cursor-wait ${config.class}`}
                onClick={event => { event.stopPropagation(); void reanalyseReview(review.id) }}
            >
                <RotateCcw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
                {busy ? (locale === "en" ? "Queuing…" : "Sætter i kø…") : label}
            </button>
        }
        return <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${config.class}`}>
            {state === "processing" && <RotateCcw className="h-3 w-3 animate-spin" />}
            {state === "ready" && <CheckCircle2 className="h-3 w-3" />}
            {label}
        </span>
    }
    const runBulkAction = async (action: "claim" | "release" | "complete") => {
        const ids = [...selectedIds]
        if (!ids.length) return
        if (action === "complete" && !window.confirm(`Markér ${ids.length} valgte kontraktgennemgang${ids.length === 1 ? "" : "e"} som afsluttet?`)) return
        setBulkUpdating(true)
        const body = action === "complete" ? { status: "afsluttet" } : { action }
        const results = await Promise.allSettled(ids.map(async id => {
            const response = await fetch(`/api/admin/contracts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Opdatering fejlede")
        }))
        const succeeded = results.filter(result => result.status === "fulfilled").length
        const failed = results.length - succeeded
        if (succeeded) toast.success(`${succeeded} kontraktgennemgang${succeeded === 1 ? "" : "e"} blev opdateret`)
        if (failed) toast.error(`${failed} kunne ikke opdateres`)
        setSelectedIds(new Set())
        await fetchReviews()
        setBulkUpdating(false)
    }
    const deleteSelected = async () => {
        const ids = [...selectedIds]
        if (!ids.length) return
        setBulkUpdating(true)
        try {
            const response = await fetch("/api/admin/contracts", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
            })
            const result = await response.json() as { error?: string; deletedIds?: string[]; failed?: Array<{ id: string; error: string }> }
            if (!response.ok) throw new Error(result.error ?? "Sletning fejlede")
            const deletedIds = result.deletedIds ?? []
            const failedIds = new Set((result.failed ?? []).map(item => item.id))
            setReviews(previous => previous.filter(review => !deletedIds.includes(review.id)))
            setSelectedIds(new Set(ids.filter(id => failedIds.has(id))))
            setTotalCount(previous => Math.max(0, previous - deletedIds.length))
            if (deletedIds.length) toast.success(`${deletedIds.length} kontraktgennemgang${deletedIds.length === 1 ? "" : "e"} blev slettet`)
            if (failedIds.size) toast.error(`${failedIds.size} kunne ikke slettes og er fortsat valgt`)
            setDeleteSelectedOpen(false)
            await fetchReviews()
            window.dispatchEvent(new CustomEvent("contract-reviews-updated"))
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Kontraktgennemgangene kunne ikke slettes")
        } finally {
            setBulkUpdating(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* Tabs */}
            <div className="flex items-center gap-1 border-b">
                <button
                    onClick={() => setTab("alle")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === "alle" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                    {t("admin.reviewQueue.all")} {totalCount > 0 && <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">{totalCount}</span>}
                </button>
                <button
                    onClick={() => setTab("mine")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === "mine" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                    {t("admin.reviewQueue.mine")} {mineCount > 0 && tab !== "mine" && <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 rounded-full px-1.5 py-0.5">{mineCount}</span>}
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t("admin.reviewQueue.search")}
                        className="h-8 w-full pl-8 text-xs sm:w-60"
                    />
                </div>

                <Select
                    value={statusFilter.join(",") || "alle"}
                    onValueChange={v => setStatusFilter(v === "alle" ? [] : v.split(","))}
                >
                    <SelectTrigger className="h-8 w-full text-xs sm:w-44">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="alle">{t("common.status")}</SelectItem>
                        <SelectItem value="afventer">{t("admin.reviewQueue.unassigned")}</SelectItem>
                        <SelectItem value="behandling">{t("admin.reviewQueue.processing")}</SelectItem>
                        <SelectItem value="afsluttet">{t("admin.reviewQueue.completed")}</SelectItem>
                        <SelectItem value="afventer,behandling">{t("admin.reviewQueue.active")}</SelectItem>
                    </SelectContent>
                </Select>

                <Select
                    value={productionTypeFilter.join(",") || "alle"}
                    onValueChange={v => setProductionTypeFilter(v === "alle" ? [] : v.split(","))}
                >
                    <SelectTrigger className="h-8 w-full text-xs sm:w-44">
                        <SelectValue placeholder="Produktionstype" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="alle">{t("admin.reviewQueue.allTypes")}</SelectItem>
                        <SelectItem value="dokumentar">Dokumentarfilm</SelectItem>
                        <SelectItem value="spillefilm">Spillefilm</SelectItem>
                        <SelectItem value="tvserie">TV-serie</SelectItem>
                        <SelectItem value="kortfilm">Kortfilm</SelectItem>
                        <SelectItem value="reklame">Reklame</SelectItem>
                        <SelectItem value="ukendt">Ukendt</SelectItem>
                    </SelectContent>
                </Select>

                <button
                    onClick={() => void fetchReviews()}
                    className="flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground sm:ml-auto sm:border-0 sm:px-0 sm:py-0"
                >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("common.refresh")}
                </button>
            </div>

            <Button type="button" variant="outline" className="w-full md:hidden" onClick={toggleAllVisible} disabled={!reviews.length}>
                {allVisibleSelected ? "Fravælg alle viste" : "Vælg alle viste"}
            </Button>

            <ListResultSummary filteredCount={totalCount} totalCount={totalCount} selectedCount={selectedIds.size} loading={loading} />

            {selectedIds.size > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                <span className="text-sm font-medium">{selectedIds.size} valgt</span>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={bulkUpdating} title={locale === "en" ? "Assigns the cases to you without changing analysis or validation" : "Tildeler sagerne til dig uden at ændre analyse eller validering"} onClick={() => void runBulkAction("claim")}>{locale === "en" ? "Assign selected to me" : "Tildel valgte til mig"}</Button>
                    <Button size="sm" variant="outline" disabled={bulkUpdating} title={locale === "en" ? "Returns the cases to the shared queue" : "Fjerner din tildeling og lægger sagerne tilbage i den fælles kø"} onClick={() => void runBulkAction("release")}>{locale === "en" ? "Release selected to queue" : "Frigiv valgte til køen"}</Button>
                    <Button size="sm" variant="outline" disabled={bulkUpdating} onClick={() => void runBulkAction("complete")}>Markér afsluttet</Button>
                    <Button size="sm" variant="destructive" disabled={bulkUpdating} onClick={() => setDeleteSelectedOpen(true)}><Trash2 className="mr-1.5 h-4 w-4" />Slet valgte</Button>
                    <Button size="sm" variant="outline" disabled={bulkUpdating} onClick={() => setSelectedIds(new Set())}>Ryd valg</Button>
                </div>
            </div>}

            <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {locale === "en" ? "Case status shows who is responsible for the review. AI status only shows whether the contract has been read. Assignment neither starts analysis nor closes the case." : "Sagsstatus viser, hvem der har ansvaret for gennemgangen. AI-status viser kun, om kontrakten er aflæst. Tildeling starter ikke en analyse og afslutter ikke sagen."}
            </p>

            <Dialog open={deleteSelectedOpen} onOpenChange={open => !bulkUpdating && setDeleteSelectedOpen(open)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Slet valgte kontraktgennemgange?</DialogTitle>
                        <DialogDescription>
                            {selectedIds.size} gennemgang{selectedIds.size === 1 ? "" : "e"}, AI-resultater, juristsvar og uploadede reviewfiler slettes permanent. Tilknyttede kontrakter i Kontraktadmin bevares.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={bulkUpdating} onClick={() => setDeleteSelectedOpen(false)}>Annuller</Button>
                        <Button type="button" variant="destructive" disabled={bulkUpdating} onClick={() => void deleteSelected()}>
                            {bulkUpdating ? "Sletter…" : "Slet permanent"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {loading ? (
                <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">{t("admin.reviewQueue.loading")}</div>
            ) : reviews.length === 0 ? (
                <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
                    {tab === "mine" ? t("admin.reviewQueue.emptyMine") : t("admin.reviewQueue.empty")}
                </div>
            ) : <>
                <MobileCardList>
                    {reviews.map(r => {
                        const statusCfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.afventer
                        return <MobileDataCard key={r.id}>
                            <div className="flex items-start gap-3">
                                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} aria-label={`Vælg ${r.file_name ?? r.member_name ?? "kontrakt"}`} />
                                <div className="min-w-0 flex-1 space-y-1.5">
                                    <button type="button" className="flex max-w-full items-center gap-1.5 text-left font-medium hover:underline" onClick={() => openReview(r.id)}>
                                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{r.member_name ?? "Ukendt"}</span>
                                    </button>
                                    <button type="button" className="flex max-w-full items-center gap-1.5 text-left text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => openReview(r.id)}>
                                        <FileText className="h-3.5 w-3.5 shrink-0" />
                                        <span className="truncate">{r.file_name ?? "—"}</span>
                                    </button>
                                </div>
                                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusCfg.class}`}>
                                    {r.status === "afventer" ? t("admin.reviewQueue.unassigned") : r.status === "behandling" ? t("admin.reviewQueue.processing") : t("admin.reviewQueue.completed")}
                                </span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                <MobileMetaRow label={t("admin.reviewQueue.submitted")}>{relativeTime(r.reviewed_at, locale)}</MobileMetaRow>
                                <MobileMetaRow label={t("common.type")}>{r.production_type ? PRODUCTION_TYPE_LABELS[r.production_type] ?? r.production_type : "—"}</MobileMetaRow>
                                <MobileMetaRow label={t("admin.producers.producer")}>{r.producer_name ?? "—"}</MobileMetaRow>
                                <MobileMetaRow label={t("admin.reviewQueue.assigned")}>{r.assigned_to ? `${locale === "en" ? "In progress by" : "Under behandling af"} ${r.assigned_to_name ?? (locale === "en" ? "staff member" : "medarbejder")}` : t("admin.reviewQueue.unassigned")}</MobileMetaRow>
                            </div>
                            <div className="mt-3">{renderAnalysisBadge(r)}</div>
                        </MobileDataCard>
                    })}
                </MobileCardList>
                <ResponsiveTableFrame>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b bg-muted/30">
                                <th className="w-10 px-4 py-2.5"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Vælg alle synlige kontraktgennemgange" /></th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("admin.reviewQueue.submitted")}</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("admin.reviewQueue.member")}</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("admin.reviewQueue.file")}</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("common.type")}</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("admin.producers.producer")}</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("common.status")}</th>
                                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("admin.reviewQueue.assigned")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {reviews.map(r => {
                                const statusCfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.afventer
                                return (
                                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                                        <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} aria-label={`Vælg ${r.file_name ?? r.member_name ?? "kontrakt"}`} /></td>
                                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                            {relativeTime(r.reviewed_at, locale)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button type="button" className="flex items-center gap-1.5 text-left hover:underline" onClick={() => openReview(r.id)}>
                                                <User className="h-3 w-3 text-muted-foreground shrink-0" />
                                                <span>{r.member_name ?? "Ukendt"}</span>
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 max-w-[160px] truncate">
                                            <button type="button" className="flex max-w-full items-center gap-1.5 text-left hover:underline" onClick={() => openReview(r.id)}>
                                                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                                                <span className="truncate" title={r.file_name ?? undefined}>
                                                    {r.file_name ?? "—"}
                                                </span>
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            {r.production_type ? (
                                                <span className="rounded-full bg-muted px-2 py-0.5">
                                                    {PRODUCTION_TYPE_LABELS[r.production_type] ?? r.production_type}
                                                </span>
                                            ) : "—"}
                                        </td>
                                        <td className="px-4 py-3 max-w-[140px]">
                                            <div className="flex items-center gap-1 truncate">
                                                <span className="truncate">{r.producer_name ?? "—"}</span>
                                                {r.producer_overenskomst_bound === true && (
                                                    <span className="text-emerald-600 shrink-0" title="Overenskomstbundet">✓</span>
                                                )}
                                                {r.producer_overenskomst_bound === false && (
                                                    <span className="text-muted-foreground shrink-0" title="Ikke overenskomstbundet">✗</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusCfg.class}`}>
                                                    {r.status === "afventer" ? t("admin.reviewQueue.unassigned") : r.status === "behandling" ? t("admin.reviewQueue.processing") : t("admin.reviewQueue.completed")}
                                                </span>
                                                {renderAnalysisBadge(r)}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {r.assigned_to ? `${locale === "en" ? "In progress by" : "Under behandling af"} ${r.assigned_to_name ?? (locale === "en" ? "staff member" : "medarbejder")}` : t("admin.reviewQueue.unassigned")}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </ResponsiveTableFrame>
            </>}
        </div>
    )
}

// ── Manuel gennemgang ─────────────────────────────────────────

function ManuelGennemgang() {
    const [file, setFile] = useState<File | null>(null)
    const [memberName, setMemberName] = useState("")
    const [memberEmail, setMemberEmail] = useState("")
    const [contractType, setContractType] = useState<ContractType | null>(null)
    const [productionType, setProductionType] = useState<ProductionType | null>(null)
    const [distributionChannels, setDistributionChannels] = useState<DistributionChannel[]>([])
    const [producer, setProducer] = useState<ProducerSelection | null>(null)
    const [notes, setNotes] = useState("")
    const [analyzing, setAnalyzing] = useState(false)
    const [result, setResult] = useState<ReviewResult | null>(null)
    const [contractText, setContractText] = useState("")
    const [activeQuote, setActiveQuote] = useState<string | null>(null)
    const [activeFpId, setActiveFpId] = useState<string | null>(null)
    const [mailText, setMailText] = useState("")
    const [mailSubject, setMailSubject] = useState("")
    const [archived, setArchived] = useState<{ date: string; subject: string; body: string; member: string }[]>([])
    const [showArchive, setShowArchive] = useState(false)
    const [mailEditMode, setMailEditMode] = useState(false)
    const [showSaveLearning, setShowSaveLearning] = useState(false)
    const [learningDraft, setLearningDraft] = useState<{ titel: string; kontrakttype: CaseLearningKontrakttype; regel: string }>({ titel: "", kontrakttype: "alle", regel: "" })
    const [klassifikation, setKlassifikation] = useState<ReviewClassification | null>(null)
    const [showSaveEksempel, setShowSaveEksempel] = useState(false)
    const [eksempelNote, setEksempelNote] = useState("")
    const [gemmerEksempel, setGemmerEksempel] = useState(false)
    const [pdfUrl, setPdfUrl] = useState<string | null>(null)
    const [dismissedPoints, setDismissedPoints] = useState<Set<number>>(new Set())
    const [orgId, setOrgId] = useState<string | null>(null)
    const [analyseId] = useState(() => crypto.randomUUID())
    const [reviewId, setReviewId] = useState<string | null>(null)
    const [fundFeedback, setFundFeedback] = useState<Record<string, "good" | "bad">>({})
    const [fundKorrektioner, setFundKorrektioner] = useState<Record<string, string>>({})
    const [fundGemtFeedback, setFundGemtFeedback] = useState<Record<string, boolean>>({})

    useEffect(() => {
        getMyOrgRole().then(r => setOrgId(r?.org_id ?? null))
    }, [])
    const fileRef = useRef<HTMLInputElement>(null)
    const docRef = useRef<HTMLDivElement>(null)
    const originalMailRef = useRef<string>("")

    useEffect(() => {
        if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
            const url = URL.createObjectURL(file)
            setPdfUrl(url)
            return () => URL.revokeObjectURL(url)
        } else {
            setPdfUrl(null)
        }
    }, [file])

    useEffect(() => {
        if (result?.feedbackmail) {
            const text = buildMailText(result.feedbackmail)
            originalMailRef.current = text
            setMailText(text)
            setMailSubject(result.feedbackmail.emne)
            setDismissedPoints(new Set())
            setMailEditMode(false)
        }
    }, [result])

    useEffect(() => {
        if (!activeQuote || !docRef.current) return
        const mark = docRef.current.querySelector("mark.ring-2")
        if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [activeQuote])

    const handleFile = (f: File) => {
        setFile(f)
        setResult(null)
        setContractText("")
        setActiveQuote(null)
        setActiveFpId(null)
        setContractType(null)
        setProductionType(null)
        setDistributionChannels([])
        setProducer(null)
        setNotes("")
    }

    const handleAnalyze = async () => {
        if (!file) { toast.error("Upload en kontrakt for at starte gennemgang"); return }
        setAnalyzing(true)
        setResult(null)
        try {
            const payload = new FormData()
            payload.append("file", file)
            payload.append("submissionId", analyseId)
            if (memberName) payload.append("memberName", memberName)
            if (contractType) payload.append("contractType", contractType)
            if (productionType) payload.append("productionType", productionType)
            if (distributionChannels.length) payload.append("distributionChannels", JSON.stringify(distributionChannels))
            if (producer?.name) payload.append("producerName", producer.name)
            if (producer?.dfksId) payload.append("producerDfksId", producer.dfksId)
            if (producer?.dfiId) payload.append("producerDfiId", producer.dfiId)
            if (producer?.isOverenskomstBound !== undefined) payload.append("producerOverenskomst", String(producer.isOverenskomstBound))
            if (notes.trim()) payload.append("notes", notes.trim())
            const resp = await fetch("/api/gennemgang", { method: "POST", body: payload })
            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}))
                throw new Error(e.error ?? `Fejl ${resp.status}`)
            }
            const data = await resp.json()
            if (data.error) throw new Error(data.error)
            setResult(data.result)
            setReviewId(typeof data.reviewId === "string" ? data.reviewId : null)
            setContractText(data.contractText || "")
            setKlassifikation(data.klassifikation ?? null)
            toast.success("Gennemgang fuldført")
        } catch (e: unknown) {
            toast.error(`Gennemgang fejlede: ${getErrorMessage(e)}`)
        }
        setAnalyzing(false)
    }

    const handleDismissNegotiationPoint = (i: number) => {
        const newDismissed = new Set(dismissedPoints)
        if (newDismissed.has(i)) newDismissed.delete(i); else newDismissed.add(i)
        setDismissedPoints(newDismissed)
        if (!result?.prioriterede_forhandlingspunkter || !originalMailRef.current) return
        let text = originalMailRef.current
        result.prioriterede_forhandlingspunkter.forEach((point, idx) => {
            if (!newDismissed.has(idx)) return
            const sectionNum = result.prioriterede_mail_sektioner?.[idx]
            if (sectionNum) { text = removeMailSection(text, sectionNum); return }
            const keyword = point.slice(0, 35).toLowerCase().trim()
            const blocks = text.split(/\n\n+/)
            const filtered = blocks.filter(block => {
                const clean = block.replace(/\[GUL\]|\[\/GUL\]|===GUL START===|===GUL SLUT===/gi, "")
                return !(keyword.length > 5 && clean.toLowerCase().includes(keyword))
            })
            if (filtered.length < blocks.length) { text = filtered.join("\n\n"); return }
            const sectionHeaderRe = /^\s*\d+[.)]\s+/
            let inSection = false
            const kept: string[] = []
            for (const line of text.split("\n")) {
                const clean = line.replace(/\[GUL\]|\[\/GUL\]/gi, "")
                const isHeading = sectionHeaderRe.test(clean)
                if (isHeading && keyword.length > 5 && clean.toLowerCase().includes(keyword)) { inSection = true; continue }
                if (inSection && isHeading) inSection = false
                if (!inSection) kept.push(line)
            }
            text = kept.join("\n")
        })
        text = text.replace(/\n{3,}/g, "\n\n").trim()
        setMailText(text)
    }

    const handleFpClick = (fp: FeedbackPoint) => {
        setActiveFpId(fp.id)
        setActiveQuote(fp.citat)
    }

    const handleArchiveMail = () => {
        if (!mailText.trim()) { toast.error("Ingen mail at arkivere"); return }
        setArchived((prev) => [{
            date: new Date().toLocaleString("da-DK"),
            subject: mailSubject,
            body: mailText,
            member: memberName || "Ukendt",
        }, ...prev])
        toast.success("Mail arkiveret under " + (memberName || "Ukendt"))
    }

    const handleCopyMail = async () => {
        const html = mailText.replace(/\n/g, "<br/>")
        const plain = mailText.replace(/<[^>]+>/g, "")
        try {
            await navigator.clipboard.write([new ClipboardItem({
                "text/html": new Blob([`<html><body>${html}</body></html>`], { type: "text/html" }),
                "text/plain": new Blob([plain], { type: "text/plain" }),
            })])
        } catch { await navigator.clipboard.writeText(plain) }
        toast.success("Mail kopieret til udklipsholder")
    }

    const handleCopyGul = async () => {
        const gul = extractGulText(mailText)
        if (!gul) { toast.error("Ingen gul-markeret tekst fundet"); return }
        const plain = gul.replace(/<[^>]+>/g, "")
        try {
            await navigator.clipboard.write([new ClipboardItem({
                "text/html": new Blob([`<html><body>${gul.replace(/\n/g, "<br/>")}</body></html>`], { type: "text/html" }),
                "text/plain": new Blob([plain], { type: "text/plain" }),
            })])
        } catch { await navigator.clipboard.writeText(plain) }
        toast.success("Producent-tekst kopieret (kun gule afsnit)")
    }

    const reset = () => {
        setFile(null); setResult(null); setContractText("")
        setActiveQuote(null); setActiveFpId(null)
        setMailText(""); setMailSubject("")
    }

    if (!result) {
        return (
            <div className="max-w-xl space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Medlemsnavn</Label>
                        <Input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Anna Larsen..." />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">E-mail (til feedback)</Label>
                        <Input type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="anna@film.dk..." />
                    </div>
                </div>

                <div
                    className={`rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                        file ? "border-foreground/30 bg-muted/30" : "border-muted-foreground/20 hover:border-muted-foreground/40"
                    }`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault()
                        const f = e.dataTransfer.files[0]
                        if (f) handleFile(f)
                    }}
                >
                    <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                    {file ? (
                        <div className="space-y-1">
                            <p className="text-sm font-medium">{file.name}</p>
                            <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · Klik for at skifte fil</p>
                        </div>
                    ) : (
                        <>
                            <Upload className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
                            <p className="text-sm">Træk kontrakten hertil eller klik for at vælge</p>
                            <p className="text-xs text-muted-foreground mt-1">PDF · DOCX · DOC · TXT</p>
                        </>
                    )}
                </div>

                {/* Valgfri kontekst — alle felter er frivillige for juristen */}
                <div className="space-y-4 rounded-lg border border-dashed p-4">
                    <p className="text-xs text-muted-foreground font-medium">Kontekst til AI (valgfri — giver bedre analyse)</p>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Ansættelsesform</Label>
                        <SegmentedControl<ContractType>
                            options={CONTRACT_TYPE_OPTIONS}
                            value={contractType}
                            onChange={setContractType}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Produktionstype</Label>
                        <div className="flex flex-wrap gap-2">
                            {PRODUCTION_TYPES.map(opt => (
                                <Chip
                                    key={opt.value}
                                    label={opt.label}
                                    selected={productionType === opt.value}
                                    onClick={() => setProductionType(p => p === opt.value ? null : opt.value)}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Distributionskanaler</Label>
                        <div className="flex flex-wrap gap-2">
                            {DISTRIBUTION_CHANNELS.map(opt => (
                                <Chip
                                    key={opt.value}
                                    label={opt.label}
                                    selected={distributionChannels.includes(opt.value)}
                                    onClick={() => setDistributionChannels(prev =>
                                        prev.includes(opt.value)
                                            ? prev.filter(c => c !== opt.value)
                                            : [...prev, opt.value]
                                    )}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Producent</Label>
                        <ProducerCombobox value={producer} onChange={setProducer} />
                        {producer && (
                            <p className="text-xs text-muted-foreground">
                                {producer.name}
                                {producer.isOverenskomstBound === true && " · ✓ Overenskomstbundet"}
                                {producer.isOverenskomstBound === false && " · ✗ Ikke overenskomstbundet"}
                                {producer.source === "manual" && " · (fritekst)"}
                            </p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Bemærkning til AI</Label>
                        <Textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value.slice(0, 1000))}
                            placeholder="Særlige forhold, hvad juristen allerede ved om sagen..."
                            rows={2}
                            className="text-sm resize-none"
                        />
                        {notes.length > 800 && (
                            <p className="text-xs text-muted-foreground text-right">{notes.length}/1000</p>
                        )}
                    </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg border border-muted bg-muted/30 px-4 py-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="text-xs text-muted-foreground space-y-1">
                        <p><strong className="text-foreground">AI-vurdering:</strong> Kontrakten gennemgås først af AI, og rådgivningen er derfor en foreløbig AI-baseret vurdering. Usædvanlige vilkår eller forhold, der kræver juridisk vurdering, skal sendes videre til foreningens jurist.</p>
                        <p><strong className="text-foreground">Datasikkerhed:</strong> Filen behandles server-side og gemmes ikke efter analyse. Kun udgående mails arkiveres under medlemmets navn.</p>
                        <p><strong className="text-foreground">Ekstern behandling:</strong> Kontraktindholdet analyseres via Anthropic&apos;s API (USA). CPR-numre, bankkontonumre, IBAN og private adressenumre maskeres automatisk inden afsendelse. Anthropic anvender ikke API-data til modeltræning.</p>
                        <p><strong className="text-foreground">Anbefaling:</strong> Undgå at uploade kontrakter med særligt følsomme oplysninger der ikke er nødvendige for analysen.</p>
                    </div>
                </div>

                <Button className="gap-2 w-full sm:w-auto" onClick={handleAnalyze} disabled={analyzing || !file}>
                    <Sparkles className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />
                    {analyzing ? "Analyserer..." : "Start gennemgang"}
                </Button>

                {archived.length > 0 && (
                    <div className="space-y-3 max-w-2xl">
                        <button
                            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setShowArchive(!showArchive)}
                        >
                            <Archive className="h-4 w-4" />
                            Arkiv ({archived.length} mails)
                            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showArchive ? "rotate-90" : ""}`} />
                        </button>
                        {showArchive && (
                            <div className="rounded-lg border divide-y">
                                {archived.map((a, i) => (
                                    <div key={i} className="px-4 py-3 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-medium">{a.subject}</span>
                                            <span className="text-xs text-muted-foreground shrink-0">{a.date}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">Til: {a.member}</p>
                                        <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">{a.body.slice(0, 120)}…</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    // Review screen
    const quotes = result.feedbackpunkter.map((fp) => fp.citat).filter(Boolean)
    const highlightedHtml = highlightText(contractText, quotes, activeQuote)
    const verdictCfg = VERDICT_CONFIG[result.samlet_vurdering]

    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-3 px-1 pb-4 shrink-0 flex-wrap">
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={reset}>
                    <ArrowLeft className="h-4 w-4" />
                    Ny gennemgang
                </Button>
                <Separator orientation="vertical" className="h-5" />
                <span className="text-sm font-medium">{result.overblik.titel || file?.name}</span>
                {memberName && <span className="text-xs text-muted-foreground">— {memberName}</span>}
                <div className={`ml-auto inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${verdictCfg.class}`}>
                    {verdictCfg.label}
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" title="Tilføj en regel AI'en skal lære af denne sag"
                    onClick={() => {
                        const kontrakttype: CaseLearningKontrakttype = result.overblik.erLeverandoerkontrakt ? "leverandoer" : "a-loen"
                        setLearningDraft({ titel: "", kontrakttype, regel: "" })
                        setShowSaveLearning(true)
                    }}
                >
                    <BookMarked className="h-3.5 w-3.5" />
                    Tilføj lært regel
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" title="Gem hele analysen som et godkendt eksempel AI'en kan lære af"
                    disabled={!Object.values(fundFeedback).some(v => v === "good")}
                    onClick={() => { setEksempelNote(""); setShowSaveEksempel(true) }}
                >
                    <Star className="h-3.5 w-3.5" />
                    Gem som eksempel
                </Button>
                <span className="text-[10px] text-muted-foreground border rounded px-2 py-1">
                    Følsomme data maskeret · Fil ikke gemt
                </span>
            </div>

            <div className="grid gap-4 lg:h-[calc(100vh-110px)] lg:grid-cols-3">
                {/* Panel 1: Kontrakt */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <span className="text-xs font-medium">Kontrakt</span>
                        <span className="text-xs text-muted-foreground ml-auto truncate max-w-[140px]">{file?.name}</span>
                    </div>
                    {pdfUrl ? (
                        <iframe src={pdfUrl} className="flex-1 w-full border-0 min-h-0" title={file?.name} />
                    ) : (
                        <div
                            ref={docRef}
                            className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed font-mono text-foreground/80 whitespace-pre-wrap min-h-0"
                            dangerouslySetInnerHTML={{ __html: highlightedHtml || "<span class='text-muted-foreground'>Dokumenttekst ikke tilgængelig for PDF-filer — brug DOCX eller TXT for highlight</span>" }}
                        />
                    )}
                </div>

                {/* Panel 2: Feedback points */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">AI-analyse</span>
                        <Badge variant="secondary" className="ml-auto text-[10px]">
                            {result.feedbackpunkter.length} punkter
                        </Badge>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y">
                        {result.overblik.erLeverandoerkontrakt && result.overblik.honorarUge && result.overblik.honorarUge > 0 && (() => {
                            const w = result.overblik.honorarUge!
                            const grundloen = w / 1.125
                            const feriepenge = w - grundloen
                            const DE4_NORMALLON = 14637
                            const pension = DE4_NORMALLON * 0.095
                            const helligdag = DE4_NORMALLON * 0.01
                            const beta = DE4_NORMALLON * 0.005
                            const netto = grundloen - pension - helligdag - beta
                            const fmt = (n: number) => Math.round(n).toLocaleString("da-DK")
                            return (
                                <div className="px-4 py-3 bg-amber-50/60 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 space-y-2">
                                    <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-300">Reel løn — leverandørkontrakt</p>
                                    <div className="space-y-1 text-xs">
                                        <div className="flex justify-between"><span className="text-muted-foreground">Honorar/uge (alt-inkl.)</span><span className="font-mono tabular-nums">{fmt(w)} kr</span></div>
                                        <div className="flex justify-between text-red-700 dark:text-red-400"><span>− Feriepenge (12,5% inkl.)</span><span className="font-mono tabular-nums">−{fmt(feriepenge)} kr</span></div>
                                        <div className="flex justify-between border-t border-border/50 pt-1"><span className="text-muted-foreground">= Grundløn</span><span className="font-mono tabular-nums">{fmt(grundloen)} kr</span></div>
                                        <div className="flex justify-between text-red-700 dark:text-red-400"><span>− Pension (9,5% af grundlønnen)</span><span className="font-mono tabular-nums">−{fmt(pension)} kr</span></div>
                                        <div className="flex justify-between text-red-700 dark:text-red-400"><span>− Helligdage (1% — betales ikke af prod.)</span><span className="font-mono tabular-nums">−{fmt(helligdag)} kr</span></div>
                                        <div className="flex justify-between text-red-700 dark:text-red-400"><span>− BETA-fond (0,5% — betales ikke af prod.)</span><span className="font-mono tabular-nums">−{fmt(beta)} kr</span></div>
                                        <div className="flex justify-between border-t border-border/50 pt-1 font-semibold"><span>= Reel nettoløn/uge</span><span className="font-mono tabular-nums">{fmt(netto)} kr</span></div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">De4-normalløn 2022: 14.637 kr/uge — producenten betaler pension, helligdage og BETA oveni.</p>
                                </div>
                            )
                        })()}
                        {result.feedbackpunkter.map((fp) => {
                            const cfg = TYPE_CONFIG[fp.type] || TYPE_CONFIG.info
                            const Icon = cfg.icon
                            const isActive = activeFpId === fp.id
                            return (
                                <div key={fp.id} role="button" tabIndex={0}
                                    onClick={() => handleFpClick(fp)}
                                    onKeyDown={e => e.key === "Enter" && handleFpClick(fp)}
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
                                                                    setFundKorrektioner(prev => { const n = { ...prev }; delete n[fp.id]; return n })
                                                                    const supabase = createClient()
                                                                    await supabase.from("analysis_feedback").upsert({
                                                                        analyse_id: reviewId ?? analyseId,
                                                                        fund_id: fp.rule_code ?? fp.id,
                                                                        fund_titel: fp.titel,
                                                                        fund_svaerhedsgrad: fp.type,
                                                                        fund_beskrivelse: fp.beskrivelse,
                                                                        godkendt: true,
                                                                        org_id: orgId,
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
                                                                <p className="text-[10px] text-muted-foreground">Hvad er det korrekte? (valgfrit)</p>
                                                                <textarea
                                                                    className="w-full text-[11px] rounded border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                                                                    rows={2}
                                                                    placeholder="Beskriv hvad AI'en misforstod..."
                                                                    value={fundKorrektioner[fp.id] ?? ""}
                                                                    onChange={e => setFundKorrektioner(prev => ({ ...prev, [fp.id]: e.target.value }))}
                                                                />
                                                                <div className="flex items-center gap-3">
                                                                    {fundGemtFeedback[fp.id] ? (
                                                                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                                                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                                            Feedback gemt
                                                                        </span>
                                                                    ) : (
                                                                        <button
                                                                            className="text-[11px] text-muted-foreground underline underline-offset-2"
                                                                            onClick={async () => {
                                                                                const supabase = createClient()
                                                                                const ankerResultat = fp.citat && contractText ? resolveAnker(fp.citat, contractText) : null
                                                                                const ankerPayload = ankerResultat ? bygFeedbackPayload(ankerResultat, false, fundKorrektioner[fp.id] ?? undefined) : {}
                                                                                await supabase.from("analysis_feedback").upsert({
                                                                                    analyse_id: reviewId ?? analyseId,
                                                                                    fund_id: fp.rule_code ?? fp.id,
                                                                                    fund_titel: fp.titel,
                                                                                    fund_svaerhedsgrad: fp.type,
                                                                                    fund_beskrivelse: fp.beskrivelse,
                                                                                    godkendt: false,
                                                                                    korrektion_beskrivelse: fundKorrektioner[fp.id] ?? null,
                                                                                    org_id: orgId,
                                                                                    ...ankerPayload,
                                                                                }, { onConflict: "analyse_id,fund_id" })
                                                                                setFundGemtFeedback(prev => ({ ...prev, [fp.id]: true }))
                                                                                toast.success("Feedback gemt")
                                                                            }}
                                                                        >
                                                                            Gem feedback
                                                                        </button>
                                                                    )}
                                                                </div>
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
                        })}
                        {result.prioriterede_forhandlingspunkter.length > 0 && (
                            <div className="px-4 py-3 space-y-1.5">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex-1">Prioriterede forhandlingspunkter</p>
                                    <p className="text-[9px] text-muted-foreground">Klik for at fravælge</p>
                                </div>
                                {result.prioriterede_forhandlingspunkter.map((p, i) => {
                                    const dismissed = dismissedPoints.has(i)
                                    return (
                                        <button key={i} onClick={() => handleDismissNegotiationPoint(i)}
                                            className={`w-full text-left flex gap-2 rounded px-1.5 py-1 transition-colors hover:bg-muted/50 ${dismissed ? "opacity-40" : ""}`}
                                            title={dismissed ? "Klik for at genaktivere" : "Klik for at fravælge fra mailen"}
                                        >
                                            <span className={`text-muted-foreground text-[11px] shrink-0 ${dismissed ? "line-through" : ""}`}>{i + 1}.</span>
                                            <p className={`text-[11px] text-left ${dismissed ? "line-through" : ""}`}>{p}</p>
                                        </button>
                                    )
                                })}
                                {dismissedPoints.size > 0 && (
                                    <p className="text-[9px] text-muted-foreground pt-1 border-t">
                                        {dismissedPoints.size} punkt{dismissedPoints.size > 1 ? "er" : ""} fravalgt — klik igen for at gendanne
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Panel 3: Mail composer */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">AI-svarudkast</span>
                        <div className="ml-auto flex items-center gap-1">
                            <button onClick={() => setMailEditMode(m => !m)}
                                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] border transition-colors ${mailEditMode ? "bg-muted border-border" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                                title={mailEditMode ? "Vis preview" : "Rediger"}
                            >
                                {mailEditMode ? <><Eye className="h-3 w-3" /> Vis</> : <><Pencil className="h-3 w-3" /> Rediger</>}
                            </button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Kopiér hele mailen" onClick={handleCopyMail}><Copy className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Arkivér" onClick={handleArchiveMail}><Archive className="h-3 w-3" /></Button>
                        </div>
                    </div>
                    <div className="border-b bg-amber-50 px-4 py-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        AI-forslag — skal kontrolleres af en jurist. Systemet sender ikke mail.
                    </div>
                    <div className="border-b px-4 py-2.5 space-y-2 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-12 shrink-0">Til:</span>
                            <Input value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="modtager@email.dk" className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-12 shrink-0">Emne:</span>
                            <Input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0" />
                        </div>
                    </div>
                    {mailEditMode ? (
                        <Textarea value={mailText} onChange={(e) => setMailText(e.target.value)} className="flex-1 resize-none rounded-none border-0 text-xs font-mono focus-visible:ring-0 min-h-0" placeholder="Feedback-mail udkast..." />
                    ) : (
                        <div className="flex-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap">
                            {mailText ? renderMailWithHighlights(mailText) : <span className="text-muted-foreground">Feedback-mail udkast...</span>}
                        </div>
                    )}
                    <div className="border-t px-4 py-2.5 shrink-0 flex gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-1" onClick={handleCopyGul}>
                            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-300 shrink-0" />
                            Kopiér til producent
                        </Button>
                        <Button size="sm" className="gap-1.5 text-xs flex-1" onClick={handleCopyMail}>
                            <Copy className="h-3.5 w-3.5" />
                            Kopiér svarudkast
                        </Button>
                    </div>
                </div>
            </div>

            {/* Dialogs */}
            <Dialog open={showSaveLearning} onOpenChange={setShowSaveLearning}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Tilføj regel fra denne sag</DialogTitle>
                        <DialogDescription>Skriv den regel AI&apos;en skal lære af denne kontrakt. Den tilføjes til lærte mønstre og bruges i fremtidige analyser.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Hvad gik AI&apos;en galt? (kort titel)</Label>
                            <Input value={learningDraft.titel} onChange={(e) => setLearningDraft(d => ({ ...d, titel: e.target.value }))} placeholder="Fx: AI klassificerede leverandørkontrakt som overenskomstkontrakt" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Gælder for</Label>
                            <Select value={learningDraft.kontrakttype} onValueChange={(v) => setLearningDraft(d => ({ ...d, kontrakttype: v as CaseLearningKontrakttype }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="alle">Alle kontrakttyper</SelectItem>
                                    <SelectItem value="a-loen">Kun A-lønskontrakter</SelectItem>
                                    <SelectItem value="leverandoer">Kun leverandørkontrakter</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Korrekt regel (injiceres direkte i AI-prompten)</Label>
                            <Textarea value={learningDraft.regel} onChange={(e) => setLearningDraft(d => ({ ...d, regel: e.target.value }))} rows={5} className="text-sm font-mono" placeholder="Fx: En kontrakt med CVR-nummer og momsopkrævning er ALTID en leverandørkontrakt..." />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSaveLearning(false)}>Annuller</Button>
                        <Button disabled={!learningDraft.titel.trim() || !learningDraft.regel.trim()}
                            onClick={async () => {
                                const supabase = createClient()
                                const { data: saved, error: saveErr } = await supabase
                                    .from("case_learnings")
                                    .insert({ org_id: orgId, kontrakttype: learningDraft.kontrakttype, titel: learningDraft.titel.trim(), regel: learningDraft.regel.trim(), added_at: new Date().toISOString() })
                                    .select().single()
                                if (!saved || saveErr) { toast.error(`Kunne ikke gemme regel: ${saveErr?.message ?? "ukendt fejl"}`); return }
                                fetch("/api/knowledge/upsert", {
                                    method: "POST", headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ kilde_id: saved.id, kilde_type: "sagserfaring", kilde_titel: saved.titel, tekst: `${saved.titel}: ${saved.regel}`, org_id: orgId, metadata: { kontrakttype: saved.kontrakttype } }),
                                }).catch(() => {})
                                setShowSaveLearning(false)
                                toast.success("Regel tilføjet til lærte mønstre")
                            }}
                        >
                            <BookMarked className="mr-1.5 h-3.5 w-3.5" />
                            Tilføj regel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showSaveEksempel} onOpenChange={setShowSaveEksempel}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Gem analyse som eksempel</DialogTitle>
                        <DialogDescription>Dette gemmer hele analysen som et godkendt eksempel AI&apos;en kan lære af ved fremtidige gennemgange af lignende kontrakter.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Kontrakttype</Label>
                                <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">{klassifikation?.kontrakttype ?? result?.overblik?.erLeverandoerkontrakt ? "leverandoer" : "a-loen"}</div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Produktionstype</Label>
                                <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">{klassifikation?.produktionstype ?? "ukendt"}</div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Note (valgfrit)</Label>
                            <Textarea value={eksempelNote} onChange={e => setEksempelNote(e.target.value)} rows={3} placeholder="Hvorfor er dette et godt eksempel?" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSaveEksempel(false)}>Annuller</Button>
                        <Button disabled={gemmerEksempel}
                            onClick={async () => {
                                if (!result || !orgId) return
                                setGemmerEksempel(true)
                                try {
                                    const supabase = createClient()
                                    const { error } = await supabase.from("case_learnings").insert({
                                        org_id: orgId,
                                        kilde_type: "godkendt_eksempel",
                                        kontrakttype: klassifikation?.kontrakttype ?? (result.overblik.erLeverandoerkontrakt ? "leverandoer" : "a-loen"),
                                        produktionstype: klassifikation?.produktionstype ?? "ukendt",
                                        er_overenskomst: klassifikation?.er_overenskomst ?? false,
                                        kontrakttitel: result.overblik?.titel ?? "Ukendt",
                                        producent_type: klassifikation?.er_overenskomst ? "overenskomstdaekket" : "ikke-overenskomstdaekket",
                                        ai_analyse: result,
                                        feedbackmail: mailText,
                                        noter: eksempelNote.trim() || null,
                                        godkendt_af: orgId,
                                        added_at: new Date().toISOString(),
                                    })
                                    if (error) throw error
                                    setShowSaveEksempel(false)
                                    toast.success("Analyse gemt som eksempel — bruges ved næste gennemgang")
                                } catch (e: unknown) {
                                    toast.error(`Kunne ikke gemme eksempel: ${getErrorMessage(e)}`)
                                } finally {
                                    setGemmerEksempel(false)
                                }
                            }}
                        >
                            <Star className="mr-1.5 h-3.5 w-3.5" />
                            {gemmerEksempel ? "Gemmer..." : "Gem som eksempel"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Hoved-side ────────────────────────────────────────────────

export default function KontraktGennemgangPage() {
    const [showManuel, setShowManuel] = useState(false)

    return (
        <div className="space-y-8">
            <PageHeader
                title="Kontraktgennemgang"
                subtitle="Juridisk gennemgang og feedback på foreløbige kontrakter"
            />

            {/* Indbakke */}
            <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
                <Indbakke />
            </Suspense>

            {/* Manuel gennemgang — collapsible */}
            <div className="space-y-4">
                <Separator />
                <button
                    onClick={() => setShowManuel(v => !v)}
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                    <Upload className="h-4 w-4" />
                    Upload og analyser kontrakt manuelt
                    <ChevronDown className={`h-4 w-4 transition-transform ${showManuel ? "rotate-180" : ""}`} />
                </button>
                {showManuel && <ManuelGennemgang />}
            </div>
        </div>
    )
}
