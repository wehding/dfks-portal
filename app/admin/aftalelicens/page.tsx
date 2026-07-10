"use client"

import { useState, useEffect } from "react"
import { Plus, Upload, FileSpreadsheet, Clock, CheckCircle2, Layers, ChevronRight, X, AlertTriangle, Loader2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import Link from "next/link"
import { toast } from "sonner"
import type { AftalelicensBatch, AftalelicensKilde, AftalelicensVaerk, FilterRule, SortStatus } from "@/lib/streaming-types"

// ── Constants ─────────────────────────────────────────────────

const MAX_STORE_ROWS = 20000

// ── Mock data (fallback when no localStorage) ─────────────────

const MOCK_BATCHES: AftalelicensBatch[] = [
    {
        id: "batch1",
        kilde: "copydan_verdenstv",
        year: 2023,
        uploadedAt: "2024-03-15T10:30:00",
        uploadedBy: "Admin",
        totalRows: 312450,
        filteredRows: 8340,
        status: "sorting",
        notes: "Kvartal 1-4 2023",
    },
    {
        id: "batch2",
        kilde: "tv2play",
        year: 2023,
        uploadedAt: "2024-03-10T14:00:00",
        uploadedBy: "Admin",
        totalRows: 2890,
        filteredRows: 1240,
        status: "weighted",
    },
    {
        id: "batch3",
        kilde: "copydan_arkiv",
        year: 2022,
        uploadedAt: "2023-09-01T09:00:00",
        uploadedBy: "Admin",
        totalRows: 45000,
        filteredRows: 3100,
        status: "completed",
    },
]

const PENDING_CLAIMS: Record<string, number> = {
    batch1: 2,
    batch3: 1,
}

// ── Helpers ───────────────────────────────────────────────────

const KILDE_LABELS: Record<AftalelicensKilde, string> = {
    copydan_verdenstv: "Copydan Verdens TV",
    copydan_arkiv: "Copydan Arkiv",
    tv2play: "TV2 Play",
}

const STATUS_CONFIG = {
    imported:  { label: "Importeret",         variant: "outline"   as const, icon: FileSpreadsheet },
    sorting:   { label: "Sorteres",           variant: "secondary" as const, icon: Clock },
    weighted:  { label: "Klar til beregning", variant: "default"   as const, icon: CheckCircle2 },
    completed: { label: "Afsluttet",          variant: "outline"   as const, icon: CheckCircle2 },
}

function loadFilterRules(): FilterRule[] {
    if (typeof window === "undefined") return []
    try {
        const stored = localStorage.getItem("dfks_filter_rules")
        return stored ? JSON.parse(stored) : []
    } catch { return [] }
}

function saveBatches(batches: AftalelicensBatch[]) {
    try { localStorage.setItem("dfks_batches", JSON.stringify(batches)) } catch { /* quota */ }
}

function loadBatches(): AftalelicensBatch[] | null {
    if (typeof window === "undefined") return null
    try {
        const s = localStorage.getItem("dfks_batches")
        return s ? JSON.parse(s) : null
    } catch { return null }
}

// ── Column detection ──────────────────────────────────────────

interface ColMap {
    titleCol: number | null
    channelCol: number | null
    dateCol: number | null
    durationCol: number | null
    viewsCol: number | null
    seasonCol: number | null
    episodeCol: number | null
    productionYearCol: number | null
}

function detectColumns(headers: string[]): ColMap {
    const h = headers.map(s => String(s ?? "").toLowerCase().trim())
    const find = (...candidates: string[]) => {
        for (const c of candidates) {
            const i = h.findIndex(hh => hh === c || hh.includes(c))
            if (i >= 0) return i
        }
        return null
    }
    return {
        titleCol:    find("titel", "title", "programtitel", "programnavn", "program", "produktionstitel", "navn"),
        channelCol:  find("kanal", "channel", "sendekanal", "station", "tv-kanal"),
        dateCol:     find("dato", "date", "sendestart", "sendedato", "broadcastdate", "dato/tid", "startdato"),
        durationCol: find("varighed", "duration", "minutter", "spilletid", "tid", "længde", "length"),
        viewsCol:    find("visninger", "views", "visningstal", "antal visninger", "antal_visninger"),
        seasonCol:          find("sæson", "season", "sæsonnummer", "sæson nr", "serie sæson"),
        episodeCol:         find("afsnit", "episode", "afsnitsnummer", "afsnit nr", "episode nr", "episodenummer"),
        productionYearCol:  find("produktionsår", "produktions år", "production year", "produktionsår", "år", "year", "årstal"),
    }
}

// ── Filter helper ─────────────────────────────────────────────

function matchesRule(title: string, channel: string | undefined, rule: FilterRule): boolean {
    const t = title.toLowerCase()
    const ch = (channel ?? "").toLowerCase()
    if (rule.type === "title_keyword") return t.includes(rule.value.toLowerCase())
    if (rule.type === "title_regex") { try { return new RegExp(rule.value, "i").test(title) } catch { return false } }
    if (rule.type === "channel") return ch === rule.value.toLowerCase()
    return false
}

// ── Import dialog ─────────────────────────────────────────────

type ImportStep = "setup" | "parsing" | "preview" | "confirm"

interface ParsedRow {
    rawTitle: string
    channel?: string
    broadcastDate?: string
    duration?: number
    viewCount?: number
    season?: number
    episode?: number
    productionYear?: number
}

interface FilterResult {
    removed: number
    byRule: { ruleName: string; count: number }[]
    remaining: number
    totalRows: number
}

function ImportDialog({ open, onOpenChange, onImport }: {
    open: boolean
    onOpenChange: (o: boolean) => void
    onImport: (batch: AftalelicensBatch) => void
}) {
    const [step, setStep] = useState<ImportStep>("setup")
    const [kilde, setKilde] = useState<AftalelicensKilde>("copydan_verdenstv")
    const [year, setYear] = useState(String(new Date().getFullYear() - 1))
    const [file, setFile] = useState<File | null>(null)
    const [colMap, setColMap] = useState<ColMap | null>(null)
    const [headers, setHeaders] = useState<string[]>([])
    const [allRows, setAllRows] = useState<ParsedRow[]>([])
    const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([])
    const [filterPreview, setFilterPreview] = useState<FilterResult | null>(null)
    const [parseError, setParseError] = useState<string | null>(null)

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFile(e.target.files?.[0] ?? null)
    }

    const handleParse = async () => {
        if (!file) return
        setStep("parsing")
        setParseError(null)
        try {
            const XLSX = await import("xlsx")
            const buffer = await file.arrayBuffer()
            const wb = XLSX.read(buffer, { type: "array", cellDates: true })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][]

            if (raw.length < 2) {
                setParseError("Filen ser tom ud eller mangler data")
                setStep("setup")
                return
            }

            const hdrs = (raw[0] as unknown[]).map(c => String(c ?? ""))
            const cm = detectColumns(hdrs)
            setHeaders(hdrs)
            setColMap(cm)

            const dataRows = raw.slice(1).filter(r => (r as unknown[]).some(c => c !== ""))
            const parsed: ParsedRow[] = dataRows.map(r => {
                const row = r as unknown[]
                const rawTitle = cm.titleCol !== null ? String(row[cm.titleCol] ?? "").trim() : ""
                if (!rawTitle) return null
                const channel = cm.channelCol !== null ? String(row[cm.channelCol] ?? "").trim() || undefined : undefined
                let broadcastDate: string | undefined
                if (cm.dateCol !== null) {
                    const d = row[cm.dateCol]
                    if (d instanceof Date) broadcastDate = d.toISOString().slice(0, 10)
                    else if (typeof d === "string" && d) broadcastDate = d.slice(0, 10)
                    else if (typeof d === "number") {
                        // Excel serial date
                        const jsDate = new Date(Math.round((d - 25569) * 86400 * 1000))
                        broadcastDate = jsDate.toISOString().slice(0, 10)
                    }
                }
                const durRaw = cm.durationCol !== null ? row[cm.durationCol] : undefined
                const duration = durRaw !== undefined && durRaw !== "" ? Math.round(Number(durRaw)) || undefined : undefined
                const viewRaw = cm.viewsCol !== null ? row[cm.viewsCol] : undefined
                const viewCount = viewRaw !== undefined && viewRaw !== "" ? Math.round(Number(viewRaw)) || undefined : undefined
                const seasonRaw = cm.seasonCol !== null ? row[cm.seasonCol] : undefined
                const season = seasonRaw !== undefined && seasonRaw !== "" ? Math.round(Number(seasonRaw)) || undefined : undefined
                const episodeRaw = cm.episodeCol !== null ? row[cm.episodeCol] : undefined
                const episode = episodeRaw !== undefined && episodeRaw !== "" ? Math.round(Number(episodeRaw)) || undefined : undefined
                const pyRaw = cm.productionYearCol !== null ? row[cm.productionYearCol] : undefined
                const productionYear = pyRaw !== undefined && pyRaw !== "" ? Math.round(Number(pyRaw)) || undefined : undefined
                return { rawTitle, channel, broadcastDate, duration, viewCount, season, episode, productionYear } satisfies ParsedRow
            }).filter(Boolean) as ParsedRow[]

            setAllRows(parsed)

            // Build preview (first 5 rows as col→value map)
            const prev = parsed.slice(0, 5).map(r => {
                const obj: Record<string, string> = { Titel: r.rawTitle }
                if (r.channel) obj["Kanal"] = r.channel
                if (r.broadcastDate) obj["Dato"] = r.broadcastDate
                if (r.duration != null) obj["Varighed"] = `${r.duration} min`
                if (r.viewCount != null) obj["Visninger"] = r.viewCount.toLocaleString("da-DK")
                return obj
            })
            setPreviewRows(prev)

            // Beregn filter-preview (kun informativt — intet fjernes ved import)
            const rules = loadFilterRules().filter(r => r.active)
            const ruleCounts = new Map<string, number>(rules.map(r => [r.id, 0]))
            let removedCount = 0
            for (const row of parsed) {
                for (const rule of rules) {
                    if (matchesRule(row.rawTitle, row.channel, rule)) {
                        ruleCounts.set(rule.id, (ruleCounts.get(rule.id) ?? 0) + 1)
                        removedCount++
                        break
                    }
                }
            }
            setFilterPreview({
                totalRows: parsed.length,
                removed: removedCount,
                remaining: parsed.length - removedCount,
                byRule: rules.map(r => ({ ruleName: r.name, count: ruleCounts.get(r.id) ?? 0 })).filter(r => r.count > 0),
            })
            setStep("preview")
        } catch (err) {
            setParseError(err instanceof Error ? err.message : "Ukendt fejl ved parsing")
            setStep("setup")
        }
    }

    const handleConfirm = () => {
        const batchId = `batch_${Date.now()}`
        const toStore = allRows.slice(0, MAX_STORE_ROWS).map((r, i): AftalelicensVaerk => ({
            id: `${batchId}_${i}`,
            batchId,
            rawTitle: r.rawTitle,
            channel: r.channel,
            broadcastDate: r.broadcastDate,
            duration: r.duration,
            viewCount: r.viewCount,
            season: r.season,
            episode: r.episode,
            productionYear: r.productionYear,
            isGenudsendelse: false,
            sortStatus: "pending" as SortStatus,
        }))

        try {
            localStorage.setItem(`dfks_batch_vaerker_${batchId}`, JSON.stringify(toStore))
        } catch {
            toast.error("Kunne ikke gemme i localStorage — filen er for stor. Prøv med færre rækker.")
            return
        }

        if (allRows.length > MAX_STORE_ROWS) {
            toast.warning(`Kun de første ${MAX_STORE_ROWS.toLocaleString("da-DK")} rækker er gemt (filen har ${allRows.length.toLocaleString("da-DK")} rækker)`)
        }

        const batch: AftalelicensBatch = {
            id: batchId,
            kilde,
            year: Number(year),
            uploadedAt: new Date().toISOString(),
            uploadedBy: "Admin",
            totalRows: allRows.length,
            filteredRows: Math.min(allRows.length, MAX_STORE_ROWS),
            status: "imported",
            notes: file?.name || undefined,
        }

        onImport(batch)
        onOpenChange(false)
        reset()
    }

    const reset = () => {
        setStep("setup")
        setKilde("copydan_verdenstv")
        setYear(String(new Date().getFullYear() - 1))
        setFile(null)
        setColMap(null)
        setHeaders([])
        setAllRows([])
        setPreviewRows([])
        setFilterPreview(null)
        setParseError(null)
    }

    const handleClose = () => {
        onOpenChange(false)
        reset()
    }

    const previewCols = previewRows.length > 0 ? Object.keys(previewRows[0]) : []

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Ny import</DialogTitle>
                    <DialogDescription>
                        Importer Excel-data fra Copydan eller TV2 Play
                    </DialogDescription>
                </DialogHeader>

                {step === "setup" && (
                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Kilde</Label>
                                <Select value={kilde} onValueChange={v => setKilde(v as AftalelicensKilde)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="copydan_verdenstv">Copydan Verdens TV</SelectItem>
                                        <SelectItem value="copydan_arkiv">Copydan Arkiv</SelectItem>
                                        <SelectItem value="tv2play">TV2 Play</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>År</Label>
                                <Input
                                    type="number"
                                    value={year}
                                    onChange={e => setYear(e.target.value)}
                                    min="2000"
                                    max={new Date().getFullYear()}
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Excel-fil</Label>
                            <label className="flex-1 cursor-pointer block">
                                <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                                    <Upload className="h-4 w-4" />
                                    {file?.name || "Klik for at vælge fil (.xlsx)"}
                                </div>
                                <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFileChange} />
                            </label>
                        </div>
                        {parseError && (
                            <p className="text-sm text-destructive">{parseError}</p>
                        )}
                        <DialogFooter>
                            <Button variant="outline" onClick={handleClose}>Annuller</Button>
                            <Button onClick={handleParse} disabled={!file}>
                                Indlæs fil
                                <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {step === "parsing" && (
                    <div className="flex flex-col items-center gap-4 py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Indlæser og parser Excel-fil…</p>
                    </div>
                )}

                {step === "preview" && colMap && (
                    <div className="space-y-4">
                        <div>
                            <p className="text-sm font-medium mb-2">
                                {allRows.length.toLocaleString("da-DK")} rækker fundet — de første 5:
                            </p>
                            <div className="rounded-lg border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            {previewCols.map(col => (
                                                <TableHead key={col}>{col}</TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {previewRows.map((row, i) => (
                                            <TableRow key={i}>
                                                {previewCols.map(col => (
                                                    <TableCell key={col} className="text-xs">
                                                        {row[col] ?? "—"}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>

                        <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 text-sm">
                            <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Kolonner fundet</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                                <span className={colMap.titleCol !== null ? "text-foreground" : "text-destructive"}>
                                    Titel → {colMap.titleCol !== null ? `"${headers[colMap.titleCol]}"` : "ikke fundet"}
                                </span>
                                {colMap.channelCol !== null && (
                                    <span>Kanal → &quot;{headers[colMap.channelCol]}&quot;</span>
                                )}
                                {colMap.dateCol !== null && (
                                    <span>Dato → &quot;{headers[colMap.dateCol]}&quot;</span>
                                )}
                                {colMap.durationCol !== null && (
                                    <span>Varighed → &quot;{headers[colMap.durationCol]}&quot;</span>
                                )}
                                {colMap.viewsCol !== null && (
                                    <span>Visninger → &quot;{headers[colMap.viewsCol]}&quot;</span>
                                )}
                                {colMap.seasonCol !== null && (
                                    <span>Sæson → &quot;{headers[colMap.seasonCol]}&quot;</span>
                                )}
                                {colMap.episodeCol !== null && (
                                    <span>Afsnit → &quot;{headers[colMap.episodeCol]}&quot;</span>
                                )}
                                {colMap.productionYearCol !== null && (
                                    <span>Produktionsår → &quot;{headers[colMap.productionYearCol]}&quot;</span>
                                )}
                            </div>
                        </div>

                        {colMap.titleCol === null && (
                            <p className="text-sm text-destructive">Ingen titelkolonne fundet — tjek at filen har en kolonne med &quot;titel&quot; eller &quot;program&quot;</p>
                        )}

                        {filterPreview && filterPreview.removed > 0 && (
                            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1.5">
                                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                    Filterregler vil auto-afvise ca. {filterPreview.removed.toLocaleString("da-DK")} rækker i sorteringen
                                </p>
                                <p className="text-xs text-amber-700 dark:text-amber-400">
                                    Alle {filterPreview.totalRows.toLocaleString("da-DK")} rækker importeres — afviste kan altid gendannes ved at slå en regel fra.
                                </p>
                                {filterPreview.byRule.length > 0 && (
                                    <div className="space-y-0.5 pt-1">
                                        {filterPreview.byRule.map(r => (
                                            <div key={r.ruleName} className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
                                                <span>{r.ruleName}</span>
                                                <span className="font-mono">{r.count.toLocaleString("da-DK")}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {allRows.length > MAX_STORE_ROWS && (
                            <div className="flex items-start gap-2 rounded bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                <span>
                                    {allRows.length.toLocaleString("da-DK")} rækker er for mange til at gemme lokalt — kun de første {MAX_STORE_ROWS.toLocaleString("da-DK")} gemmes.
                                </span>
                            </div>
                        )}

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setStep("setup")}>Tilbage</Button>
                            <Button onClick={handleConfirm} disabled={colMap.titleCol === null}>
                                Importer {allRows.length.toLocaleString("da-DK")} rækker
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

// ── Main page ─────────────────────────────────────────────────

export default function AftalelicensPage() {
    const [batches, setBatches] = useState<AftalelicensBatch[]>(MOCK_BATCHES)
    const [importOpen, setImportOpen] = useState(false)

    // Load from localStorage on mount
    useEffect(() => {
        const stored = loadBatches()
        if (stored && stored.length > 0) setBatches(stored)
    }, [])

    const pending = batches.filter(b => b.status === "sorting" || b.status === "imported").length
    const ready = batches.filter(b => b.status === "weighted").length
    const lateClaimsCount = batches
        .filter(b => b.status === "completed")
        .reduce((s, b) => s + (PENDING_CLAIMS[b.id] ?? 0), 0)

    const handleImport = (batch: AftalelicensBatch) => {
        setBatches(prev => {
            const next = [batch, ...prev]
            saveBatches(next)
            return next
        })
        toast.success(`Import fuldført — ${batch.filteredRows.toLocaleString("da-DK")} rækker klar til sortering`)
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Aftalelicens"
                subtitle="Behandling og beregning af pulje-vederlag fra Copydan og TV2 Play"
                actions={
                    <Button onClick={() => setImportOpen(true)} className="gap-2">
                        <Plus className="h-4 w-4" />
                        Ny import
                    </Button>
                }
            />

            {/* Stats */}
            <div className="hidden gap-4 sm:grid sm:grid-cols-4">
                <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">Batches i alt</p>
                    <p className="text-3xl font-semibold mt-1">{batches.length}</p>
                </div>
                <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">Afventer sortering</p>
                    <p className="text-3xl font-semibold mt-1 text-amber-600 dark:text-amber-400">{pending}</p>
                </div>
                <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">Klar til beregning</p>
                    <p className="text-3xl font-semibold mt-1 text-green-600 dark:text-green-400">{ready}</p>
                </div>
                <div className={`rounded-lg border p-4 ${lateClaimsCount > 0 ? "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30" : ""}`}>
                    <p className="text-sm text-muted-foreground">Efteranmeldelser</p>
                    <p className={`text-3xl font-semibold mt-1 ${lateClaimsCount > 0 ? "text-orange-600 dark:text-orange-400" : ""}`}>
                        {lateClaimsCount}
                    </p>
                    {lateClaimsCount > 0 && (
                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">på afsluttede batches</p>
                    )}
                </div>
            </div>

            {/* Batch list */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Kilde</TableHead>
                            <TableHead className="w-[80px]">År</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Rækker total</TableHead>
                            <TableHead className="text-right">Til sortering</TableHead>
                            <TableHead>Importeret</TableHead>
                            <TableHead className="w-[110px]">Krav</TableHead>
                            <TableHead className="w-[80px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {batches.map(batch => {
                            const cfg = STATUS_CONFIG[batch.status]
                            const claimCount = PENDING_CLAIMS[batch.id] ?? 0
                            const isLate = claimCount > 0 && batch.status === "completed"
                            return (
                                <TableRow key={batch.id} className={isLate ? "bg-orange-50/50 dark:bg-orange-950/10" : ""}>
                                    <TableCell className="font-medium">{KILDE_LABELS[batch.kilde]}</TableCell>
                                    <TableCell>{batch.year}</TableCell>
                                    <TableCell>
                                        <Badge variant={cfg.variant} className="gap-1 text-xs">
                                            <cfg.icon className="h-3 w-3" />
                                            {cfg.label}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {batch.totalRows.toLocaleString("da-DK")}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                        {batch.filteredRows.toLocaleString("da-DK")}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {new Date(batch.uploadedAt).toLocaleDateString("da-DK")}
                                    </TableCell>
                                    <TableCell>
                                        {claimCount > 0 ? (
                                            <Badge
                                                variant="outline"
                                                className={`gap-1 text-xs ${isLate ? "border-orange-400 text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30" : ""}`}
                                            >
                                                {isLate && <AlertTriangle className="h-3 w-3" />}
                                                {claimCount} afventende
                                            </Badge>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Button asChild variant="ghost" size="sm" className="gap-1">
                                            <Link href={`/admin/aftalelicens/${batch.id}`}>
                                                Åbn
                                                <ChevronRight className="h-3.5 w-3.5" />
                                            </Link>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>

            <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={handleImport} />
        </div>
    )
}
