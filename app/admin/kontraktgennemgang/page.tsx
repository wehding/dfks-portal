"use client"

/**
 * app/admin/kontraktgennemgang/page.tsx
 *
 * Legal contract review tool for DFKS jurists.
 * Three-panel layout:
 *   Left  — Document viewer with highlighted passages
 *   Middle — AI feedback points (click to highlight)
 *   Right  — Editable feedback mail composer
 *
 * Files are never stored — only the dialogue/mail thread is archived.
 */

import { useState, useRef, useCallback, useEffect } from "react"
import {
    Upload, ArrowLeft, Sparkles, Mail, Copy,
    CheckCircle2, AlertTriangle, Info, ChevronRight,
    MessageSquare, Archive, X, Send,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

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
    hilsen: string
    indledning: string
    punkter: string[]
    afslutning: string
    underskrift: string
}

interface ReviewResult {
    overblik: {
        titel: string
        parter: string[]
        periode: string
        kontrakttype: string
        overenskomst: string | null
    }
    feedbackpunkter: FeedbackPoint[]
    feedbackmail: FeedbackMail
    samlet_vurdering: "godkendt" | "forbehold" | "kritisk"
    prioriterede_forhandlingspunkter: string[]
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

function highlightText(text: string, quotes: string[], activeQuote: string | null): string {
    if (!text) return ""

    // Escape HTML first
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>")

    // Highlight all quotes
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
    return [
        mail.hilsen,
        "",
        mail.indledning,
        "",
        ...mail.punkter.flatMap((p) => [p, ""]),
        mail.afslutning,
        "",
        mail.underskrift,
    ].join("\n")
}

// ── Main Page ─────────────────────────────────────────────────

export default function KontraktGennemgangPage() {
    const [file, setFile] = useState<File | null>(null)
    const [memberName, setMemberName] = useState("")
    const [memberEmail, setMemberEmail] = useState("")
    const [analyzing, setAnalyzing] = useState(false)
    const [result, setResult] = useState<ReviewResult | null>(null)
    const [contractText, setContractText] = useState("")
    const [activeQuote, setActiveQuote] = useState<string | null>(null)
    const [activeFpId, setActiveFpId] = useState<string | null>(null)
    const [mailText, setMailText] = useState("")
    const [mailSubject, setMailSubject] = useState("")
    const [archived, setArchived] = useState<{ date: string; subject: string; body: string; member: string }[]>([])
    const [showArchive, setShowArchive] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)
    const docRef = useRef<HTMLDivElement>(null)

    // Sync mail text when result arrives
    useEffect(() => {
        if (result?.feedbackmail) {
            setMailText(buildMailText(result.feedbackmail))
            setMailSubject(result.feedbackmail.emne)
        }
    }, [result])

    // Scroll to highlighted text when active quote changes
    useEffect(() => {
        if (!activeQuote || !docRef.current) return
        const mark = docRef.current.querySelector("mark.ring-2")
        if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [activeQuote])

    // ── Handlers ──────────────────────────────────────────────

    const handleFile = (f: File) => {
        setFile(f)
        setResult(null)
        setContractText("")
        setActiveQuote(null)
        setActiveFpId(null)
    }

    const handleAnalyze = async () => {
        if (!file) { toast.error("Upload en kontrakt for at starte gennemgang"); return }
        setAnalyzing(true)
        setResult(null)

        try {
            const payload = new FormData()
            payload.append("file", file)
            if (memberName) payload.append("memberName", memberName)

            const resp = await fetch("/api/gennemgang", { method: "POST", body: payload })
            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}))
                throw new Error(e.error ?? `Fejl ${resp.status}`)
            }
            const data = await resp.json()
            if (data.error) throw new Error(data.error)

            setResult(data.result)
            setContractText(data.contractText || "")
            toast.success("Gennemgang fuldført")
        } catch (e: any) {
            toast.error(`Gennemgang fejlede: ${e.message}`)
        }
        setAnalyzing(false)
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

    const handleOpenMail = () => {
        const to = memberEmail ? encodeURIComponent(memberEmail) : ""
        const subject = encodeURIComponent(mailSubject)
        const body = encodeURIComponent(mailText)
        window.location.href = `mailto:${to}?subject=${subject}&body=${body}`
    }

    const handleCopyMail = () => {
        navigator.clipboard.writeText(mailText)
        toast.success("Mail kopieret til udklipsholder")
    }

    const reset = () => {
        setFile(null); setResult(null); setContractText("")
        setActiveQuote(null); setActiveFpId(null)
        setMailText(""); setMailSubject("")
    }

    // ── Upload screen ──────────────────────────────────────────

    if (!result) {
        return (
            <div className="space-y-8">
                <PageHeader
                    title="Kontraktgennemgang"
                    subtitle="Juridisk gennemgang og feedback på foreløbige kontrakter — filer gemmes ikke"
                />

                <div className="max-w-xl space-y-6">
                    {/* Member info */}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Medlemsnavn</Label>
                            <Input
                                value={memberName}
                                onChange={(e) => setMemberName(e.target.value)}
                                placeholder="Anna Larsen..."
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">E-mail (til feedback)</Label>
                            <Input
                                type="email"
                                value={memberEmail}
                                onChange={(e) => setMemberEmail(e.target.value)}
                                placeholder="anna@film.dk..."
                            />
                        </div>
                    </div>

                    {/* File upload */}
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
                        <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt"
                            className="hidden"
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

                    <div className="flex items-start gap-2 rounded-lg border border-muted bg-muted/30 px-4 py-3">
                        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="text-xs text-muted-foreground space-y-1">
                            <p><strong className="text-foreground">Datasikkerhed:</strong> Filen behandles server-side og gemmes ikke efter analyse. Kun udgående mails arkiveres under medlemmets navn.</p>
                            <p><strong className="text-foreground">Ekstern behandling:</strong> Kontraktindholdet analyseres via Anthropic's API (USA). CPR-numre, bankkontonumre, IBAN og private adressenumre maskeres automatisk inden afsendelse. Anthropic anvender ikke API-data til modeltræning.</p>
                            <p><strong className="text-foreground">Anbefaling:</strong> Undgå at uploade kontrakter med særligt følsomme oplysninger der ikke er nødvendige for analysen.</p>
                        </div>
                    </div>

                    <Button
                        className="gap-2 w-full sm:w-auto"
                        onClick={handleAnalyze}
                        disabled={analyzing || !file}
                    >
                        <Sparkles className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />
                        {analyzing ? "Analyserer..." : "Start gennemgang"}
                    </Button>
                </div>

                {/* Archive */}
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

    // ── Review screen ──────────────────────────────────────────

    const quotes = result.feedbackpunkter.map((fp) => fp.citat).filter(Boolean)
    const highlightedHtml = highlightText(contractText, quotes, activeQuote)
    const verdictCfg = VERDICT_CONFIG[result.samlet_vurdering]

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            {/* Top bar */}
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
                <span className="text-[10px] text-muted-foreground border rounded px-2 py-1">
                    Følsomme data maskeret · Fil ikke gemt
                </span>
            </div>

            {/* Three-panel layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">

                {/* Panel 1: Document with highlights */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <span className="text-xs font-medium">Kontrakt</span>
                        <span className="text-xs text-muted-foreground ml-auto">{file?.name}</span>
                    </div>
                    <div
                        ref={docRef}
                        className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed font-mono text-foreground/80 whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ __html: highlightedHtml || "<span class='text-muted-foreground'>Dokumenttekst ikke tilgængelig</span>" }}
                    />
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
                        {result.feedbackpunkter.map((fp) => {
                            const cfg = TYPE_CONFIG[fp.type] || TYPE_CONFIG.info
                            const Icon = cfg.icon
                            const isActive = activeFpId === fp.id
                            return (
                                <button
                                    key={fp.id}
                                    onClick={() => handleFpClick(fp)}
                                    className={`w-full text-left px-4 py-3 space-y-1.5 transition-colors hover:bg-muted/50 ${isActive ? "bg-muted/50" : ""}`}
                                >
                                    <div className="flex items-start gap-2">
                                        <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-xs font-medium">{fp.titel}</span>
                                                {fp.paragraf && (
                                                    <span className="text-[10px] text-muted-foreground">§ {fp.paragraf}</span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                                {fp.beskrivelse}
                                            </p>
                                            {isActive && (
                                                <div className="mt-2 space-y-2">
                                                    <p className="text-[11px] text-foreground/80 leading-relaxed">
                                                        {fp.beskrivelse}
                                                    </p>
                                                    {fp.anbefaling && (
                                                        <div className="rounded-md bg-muted px-2.5 py-2">
                                                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Anbefaling</p>
                                                            <p className="text-[11px]">{fp.anbefaling}</p>
                                                        </div>
                                                    )}
                                                    {fp.citat && (
                                                        <p className="text-[10px] italic text-muted-foreground border-l-2 pl-2 border-muted-foreground/30 line-clamp-3">
                                                            "{fp.citat}"
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <ChevronRight className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${isActive ? "rotate-90" : ""}`} />
                                    </div>
                                </button>
                            )
                        })}

                        {result.prioriterede_forhandlingspunkter.length > 0 && (
                            <div className="px-4 py-3 space-y-2">
                                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                    Prioriterede forhandlingspunkter
                                </p>
                                {result.prioriterede_forhandlingspunkter.map((p, i) => (
                                    <div key={i} className="flex gap-2">
                                        <span className="text-muted-foreground text-[11px] shrink-0">{i + 1}.</span>
                                        <p className="text-[11px]">{p}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Panel 3: Mail composer */}
                <div className="rounded-lg border flex flex-col min-h-0">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">Feedback-mail</span>
                        <div className="ml-auto flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Kopiér" onClick={handleCopyMail}>
                                <Copy className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Arkivér" onClick={handleArchiveMail}>
                                <Archive className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Åbn i mailprogram" onClick={handleOpenMail}>
                                <Send className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>

                    {/* Subject + recipient */}
                    <div className="border-b px-4 py-2.5 space-y-2 shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-12 shrink-0">Til:</span>
                            <Input
                                value={memberEmail}
                                onChange={(e) => setMemberEmail(e.target.value)}
                                placeholder="modtager@email.dk"
                                className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-12 shrink-0">Emne:</span>
                            <Input
                                value={mailSubject}
                                onChange={(e) => setMailSubject(e.target.value)}
                                className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0"
                            />
                        </div>
                    </div>

                    {/* Editable mail body */}
                    <Textarea
                        value={mailText}
                        onChange={(e) => setMailText(e.target.value)}
                        className="flex-1 resize-none rounded-none border-0 text-xs font-mono focus-visible:ring-0 min-h-0"
                        placeholder="Feedback-mail udkast..."
                    />

                    <div className="border-t px-4 py-2.5 shrink-0">
                        <Button size="sm" className="w-full gap-2 text-xs" onClick={handleOpenMail}>
                            <Send className="h-3.5 w-3.5" />
                            Åbn i mailprogram
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
