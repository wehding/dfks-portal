"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { useState, useEffect } from "react"
import { Plus, Upload, FileSpreadsheet, Clock, CheckCircle2, ChevronRight, AlertTriangle, Loader2 } from "lucide-react"
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
import { addScreeningClaimComment, createAftalelicensBatch, fetchAdminScreeningClaims, fetchAftalelicensBatches, importScreeningSourceRows, markScreeningClaimCommentsRead, updateScreeningClaimStatus } from "@/app/actions/screenings"
import { getAftalelicensFilterRules } from "@/app/actions/organisation-settings"
import { MessageThread } from "@/components/messages/message-thread"
import { clearAdminMessageThread, deleteAdminMessage } from "@/app/actions/admin-messages"
import { WORK_TYPES } from "@/lib/work-types"
import { readFirstWorksheetRows } from "@/lib/excel/read-workbook"
import { parseScreeningDate, parseScreeningTime } from "@/lib/screening-date-time"

// ── Constants ─────────────────────────────────────────────────

const MAX_STORE_ROWS = 20000

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

// saveBatches/loadBatches (localStorage) er fjernet — batch-historik hentes/gemmes
// nu via createAftalelicensBatch()/fetchAftalelicensBatches() (rigtig databasetabel,
// se migration 20260820180000_aftalelicens_batches.sql).

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
    // Berigende metadata — vigtig for senere værk-matching, men ikke krævet for selve importen.
    countryCols: number[]
    directorCols: number[]
    genreCol: number | null
    categoryCol: number | null
    descriptionCol: number | null
    productionCompanyCols: number[]
    imdbIdCol: number | null
    // Yderligere felter fra Simply.TV-specifikationen (TASK-epg-sendedata-arkitektur.md).
    broadcastTimeCol: number | null
    listingIdCol: number | null
    seriesIdCol: number | null
    episodeIdCol: number | null    // Primær matchingnøgle — stabilt indholds-ID, genbruges ved genudsendelser
    originalTitleCol: number | null
    episodeTitleCol: number | null
    actorsCol: number | null
    editorialLinkCol: number | null
    broadcastTitleCol: number | null
}

function detectColumns(headers: string[]): ColMap {
    const h = headers.map(s => String(s ?? "").toLowerCase().trim())
    // Kolonner der ender på "id" (fx "Season Id", "Episode Id") er platform-identifikatorer,
    // ikke det tal, vi leder efter — udelukkes eksplicit fra sæson/afsnit-genkendelsen, så de
    // aldrig ved en fejl bliver valgt frem for den faktiske "Season Number"/"Episode Number".
    const isIdColumn = (hh: string) => /\bid\b/.test(hh) || hh.endsWith("id")
    const find = (...candidates: string[]) => {
        for (const c of candidates) {
            const i = h.findIndex(hh => hh === c || hh.includes(c))
            if (i >= 0) return i
        }
        return null
    }
    const findExcludingId = (...candidates: string[]) => {
        for (const c of candidates) {
            const i = h.findIndex(hh => !isIdColumn(hh) && (hh === c || hh.includes(c)))
            if (i >= 0) return i
        }
        return null
    }
    const findAll = (...candidates: string[]) => {
        const indices: number[] = []
        h.forEach((hh, i) => {
            if (candidates.some(c => hh === c || hh.includes(c))) indices.push(i)
        })
        return indices
    }
    return {
        // "Original Title" og "Episode Title" er egne, adskilte felter (se nedenfor) —
        // titleCol skal derfor kun finde selve "Title" (som sendt), ikke de to andre.
        titleCol:    find("titel", "title", "programtitel", "programnavn", "program", "produktionstitel", "navn"),
        // "Channel name" (læsbart navn, fx "TV2") tjekkes FØR den generiske "channel" —
        // Simply.TV har begge et numerisk "Channel"-ID og et læsbart "Channel Name" som
        // separate kolonner; uden denne rækkefølge vælges ID'et fejlagtigt.
        channelCol:  find("kanal", "channel name", "sendekanal", "station", "tv-kanal", "channel"),
        dateCol:     find("dato", "date", "sendestart", "sendedato", "broadcastdate", "dato/tid", "startdato"),
        durationCol: find("varighed", "duration", "minutter", "spilletid", "tid", "længde", "length"),
        viewsCol:    find("visninger", "views", "visningstal", "antal visninger", "antal_visninger"),
        // "Nummer"-varianter tjekkes FØRST — undgår at fx "Season Id"/"Episode Id" (platform-
        // ID'er, ikke tal) ved en fejl bliver valgt før den faktiske "Season Number"/"Episode
        // Number". findExcludingId er desuden en ekstra sikkerhed uafhængigt af rækkefølgen.
        seasonCol:   findExcludingId("sæsonnummer", "sæson nr", "season number", "serie sæson", "sæson", "season"),
        episodeCol:  findExcludingId("episodenummer", "afsnitsnummer", "afsnit nr", "episode nr", "episode number", "afsnit", "episode"),
        productionYearCol:  find("produktionsår", "produktions år", "production year", "år", "year", "årstal"),
        countryCols:            findAll("land", "country"),
        directorCols:           findAll("instruktør", "director"),
        genreCol:               find("genre"),
        categoryCol:            find("kategori", "category"),
        descriptionCol:         find("beskrivelse", "description"),
        productionCompanyCols:  findAll("produktionsselskab", "company of production", "production company"),
        imdbIdCol:              find("imdb"),
        broadcastTimeCol:       find("sendetidspunkt", "broadcast time"),
        listingIdCol:           find("listing id", "listing-id"),
        seriesIdCol:            find("serie-id", "series id"),
        // Episode Id er den PRIMÆRE matchingnøgle (stabil på tværs af genudsendelser) — søges
        // specifikt, ikke via findExcludingId (som bevidst udelukker "id"-kolonner andetsteds).
        episodeIdCol:           find("episode id", "afsnit-id"),
        originalTitleCol:       find("originaltitel", "original title"),
        episodeTitleCol:        find("afsnitstitel", "episode title"),
        actorsCol:              find("skuespillere", "actors"),
        editorialLinkCol:       find("editorial link", "redaktionelt link"),
        broadcastTitleCol:      find("broadcast title", "sendetitel"),
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
    // Berigende metadata — samme navngivning som works-tabellen, af hensyn til senere matching.
    productionCountries?: string[]
    directors?: string[]
    primaryDirector?: string    // Bro til works.director (ental) — se ARKITEKTUR-works-director-array.md
    genre?: string
    category?: string
    description?: string
    productionCompanies?: string[]
    imdbId?: string
    // Yderligere felter fra Simply.TV-specifikationen.
    broadcastTime?: string
    listingId?: string
    seriesId?: string
    episodeId?: string    // Primær matchingnøgle — stabilt indholds-ID, genbruges ved genudsendelser
    originalTitle?: string
    episodeTitle?: string
    actors?: string
    editorialLink?: string
    broadcastTitle?: string
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
    onImport: (batch: AftalelicensBatch, rows: ParsedRow[]) => Promise<boolean>
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
            const buffer = await file.arrayBuffer()
            const raw = await readFirstWorksheetRows(buffer, file.name)

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
                const broadcastDate = cm.dateCol !== null ? parseScreeningDate(row[cm.dateCol]) : undefined
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
                const productionCountries = cm.countryCols.length
                    ? cm.countryCols.map(i => String(row[i] ?? "").trim()).filter(Boolean)
                    : undefined
                const directors = cm.directorCols.length
                    ? cm.directorCols.map(i => String(row[i] ?? "").trim()).filter(Boolean)
                    : undefined
                // Bro til works.director (ental tekstfelt, ikke array) — indtil en
                // eventuel fremtidig opgradering af works.director til array besluttes
                // (se ARKITEKTUR-works-director-array.md). Bevarer den fulde liste i
                // "directors" samtidig, så ingen information går tabt ved import.
                const primaryDirector = directors?.[0]
                const genre = cm.genreCol !== null ? String(row[cm.genreCol] ?? "").trim() || undefined : undefined
                const category = cm.categoryCol !== null ? String(row[cm.categoryCol] ?? "").trim() || undefined : undefined
                const description = cm.descriptionCol !== null ? String(row[cm.descriptionCol] ?? "").trim() || undefined : undefined
                const productionCompanies = cm.productionCompanyCols.length
                    ? cm.productionCompanyCols.map(i => String(row[i] ?? "").trim()).filter(Boolean)
                    : undefined
                const imdbId = cm.imdbIdCol !== null ? String(row[cm.imdbIdCol] ?? "").trim() || undefined : undefined
                const broadcastTime = cm.broadcastTimeCol !== null ? parseScreeningTime(row[cm.broadcastTimeCol]) : undefined
                const listingId = cm.listingIdCol !== null ? String(row[cm.listingIdCol] ?? "").trim() || undefined : undefined
                const seriesId = cm.seriesIdCol !== null ? String(row[cm.seriesIdCol] ?? "").trim() || undefined : undefined
                const episodeId = cm.episodeIdCol !== null ? String(row[cm.episodeIdCol] ?? "").trim() || undefined : undefined
                const originalTitle = cm.originalTitleCol !== null ? String(row[cm.originalTitleCol] ?? "").trim() || undefined : undefined
                const episodeTitle = cm.episodeTitleCol !== null ? String(row[cm.episodeTitleCol] ?? "").trim() || undefined : undefined
                const actors = cm.actorsCol !== null ? String(row[cm.actorsCol] ?? "").trim() || undefined : undefined
                const editorialLink = cm.editorialLinkCol !== null ? String(row[cm.editorialLinkCol] ?? "").trim() || undefined : undefined
                const broadcastTitle = cm.broadcastTitleCol !== null ? String(row[cm.broadcastTitleCol] ?? "").trim() || undefined : undefined
                return {
                    rawTitle, channel, broadcastDate, duration, viewCount, season, episode, productionYear,
                    productionCountries, directors, primaryDirector, genre, category, description, productionCompanies, imdbId,
                    broadcastTime, listingId, seriesId, episodeId, originalTitle, episodeTitle, actors,
                    editorialLink, broadcastTitle,
                } satisfies ParsedRow
            }).filter(Boolean) as ParsedRow[]

            setAllRows(parsed)

            // Build preview (first 5 rows as col→value map)
            const prev = parsed.slice(0, 5).map(r => {
                const obj: Record<string, string> = { Titel: r.rawTitle }
                if (r.channel) obj["Kanal"] = r.channel
                if (r.broadcastDate) obj["Dato"] = r.broadcastDate
                if (r.broadcastTime) obj["Klokkeslæt"] = r.broadcastTime.slice(0, 5)
                if (r.duration != null) obj["Varighed"] = `${r.duration} min`
                if (r.viewCount != null) obj["Visninger"] = r.viewCount.toLocaleString("da-DK")
                return obj
            })
            setPreviewRows(prev)

            // Beregn filter-preview (kun informativt — intet fjernes ved import)
            const filterResult = await getAftalelicensFilterRules()
            const rules = filterResult.rules.filter(r => r.active)
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

    const handleConfirm = async () => {
        // The timestamp is generated only when the user confirms a new batch.
        // eslint-disable-next-line react-hooks/purity
        const batchId = `batch_${Date.now()}`
        const toStore = allRows.slice(0, MAX_STORE_ROWS).map((r, i): AftalelicensVaerk => ({
            id: `${batchId}_${i}`,
            batchId,
            rawTitle: r.rawTitle,
            channel: r.channel,
            broadcastDate: r.broadcastDate,
            broadcastTime: r.broadcastTime,
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

        if (!(await onImport(batch, allRows))) return
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
                                {colMap.genreCol !== null && (
                                    <span>Genre → &quot;{headers[colMap.genreCol]}&quot;</span>
                                )}
                                {colMap.categoryCol !== null && (
                                    <span>Kategori → &quot;{headers[colMap.categoryCol]}&quot;</span>
                                )}
                                {colMap.descriptionCol !== null && (
                                    <span>Beskrivelse → &quot;{headers[colMap.descriptionCol]}&quot;</span>
                                )}
                                {colMap.imdbIdCol !== null && (
                                    <span>IMDb-ID → &quot;{headers[colMap.imdbIdCol]}&quot;</span>
                                )}
                                {colMap.countryCols.length > 0 && (
                                    <span>Land → {colMap.countryCols.map(i => `"${headers[i]}"`).join(", ")}</span>
                                )}
                                {colMap.directorCols.length > 0 && (
                                    <span>Instruktør → {colMap.directorCols.map(i => `"${headers[i]}"`).join(", ")}</span>
                                )}
                                {colMap.productionCompanyCols.length > 0 && (
                                    <span>Produktionsselskab → {colMap.productionCompanyCols.map(i => `"${headers[i]}"`).join(", ")}</span>
                                )}
                                {colMap.episodeIdCol !== null && (
                                    <span>Episode-ID → &quot;{headers[colMap.episodeIdCol]}&quot;</span>
                                )}
                                {colMap.seriesIdCol !== null && (
                                    <span>Serie-ID → &quot;{headers[colMap.seriesIdCol]}&quot;</span>
                                )}
                                {colMap.listingIdCol !== null && (
                                    <span>Listing-ID → &quot;{headers[colMap.listingIdCol]}&quot;</span>
                                )}
                                {colMap.broadcastTimeCol !== null && (
                                    <span>Sendetidspunkt → &quot;{headers[colMap.broadcastTimeCol]}&quot;</span>
                                )}
                                {colMap.originalTitleCol !== null && (
                                    <span>Originaltitel → &quot;{headers[colMap.originalTitleCol]}&quot;</span>
                                )}
                                {colMap.episodeTitleCol !== null && (
                                    <span>Afsnitstitel → &quot;{headers[colMap.episodeTitleCol]}&quot;</span>
                                )}
                                {colMap.broadcastTitleCol !== null && (
                                    <span>Sendetitel → &quot;{headers[colMap.broadcastTitleCol]}&quot;</span>
                                )}
                                {colMap.actorsCol !== null && (
                                    <span>Skuespillere → &quot;{headers[colMap.actorsCol]}&quot;</span>
                                )}
                                {colMap.editorialLinkCol !== null && (
                                    <span>Redaktionelt link → &quot;{headers[colMap.editorialLinkCol]}&quot;</span>
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
    const [batches, setBatches] = useState<AftalelicensBatch[]>([])
    const [batchesLoading, setBatchesLoading] = useState(true)
    const [batchesError, setBatchesError] = useState<string | null>(null)
    const [importOpen, setImportOpen] = useState(false)
    const [claims, setClaims] = useState<Record<string, any>[]>([])
    const [activeClaim, setActiveClaim] = useState<Record<string, any> | null>(null)
    const [reply, setReply] = useState("")
    const [typeFilter, setTypeFilter] = useState("all")
    const filteredClaims = claims.filter(claim => typeFilter === "all" || claim.works?.type === typeFilter)

    const loadClaims = async () => {
        const result = await fetchAdminScreeningClaims()
        if (result.success) setClaims(result.claims ?? [])
    }

    const loadBatchesFromServer = async () => {
        const result = await fetchAftalelicensBatches()
        if (result.success) {
            setBatchesError(null)
            setBatches(result.batches.map(b => ({
                id: b.id, kilde: b.kilde as AftalelicensKilde, year: b.year,
                uploadedAt: b.uploaded_at, uploadedBy: b.uploaded_by ?? "Admin",
                totalRows: b.total_rows, filteredRows: b.filtered_rows,
                status: b.status as AftalelicensBatch["status"], notes: b.notes ?? undefined,
            })))
        } else {
            setBatchesError(result.error ?? "Datasættene kunne ikke hentes")
        }
        setBatchesLoading(false)
    }

    // Kører bevidst kun ved mount — loadBatchesFromServer behøver ikke være
    // en reaktiv afhængighed her, og den asynkrone setState heri er tilsigtet.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadBatchesFromServer()
        void loadClaims()
    }, [])

    const pending = batches.filter(b => b.status === "sorting" || b.status === "imported").length
    const ready = batches.filter(b => b.status === "weighted").length
    const lateClaimsCount = 0

    const handleImport = async (batch: AftalelicensBatch, rows: ParsedRow[]) => {
        const result = await importScreeningSourceRows({
            source: batch.kilde,
            batchKey: batch.id,
            rows: rows.map(row => ({
                title: row.rawTitle, channel: row.channel, screeningDate: row.broadcastDate,
                season: row.season, episode: row.episode, productionYear: row.productionYear,
                duration: row.duration, viewCount: row.viewCount,
                productionCountries: row.productionCountries, directors: row.directors,
                primaryDirector: row.primaryDirector,
                genre: row.genre, category: row.category, description: row.description,
                productionCompanies: row.productionCompanies, imdbId: row.imdbId,
                broadcastTime: row.broadcastTime, listingId: row.listingId, seriesId: row.seriesId,
                episodeId: row.episodeId, originalTitle: row.originalTitle, episodeTitle: row.episodeTitle,
                actors: row.actors, editorialLink: row.editorialLink, broadcastTitle: row.broadcastTitle,
            })),
        })
        if (!result.success) {
            toast.error(result.error ?? "Kunne ikke gemme visningskilden")
            return false
        }
        const batchResult = await createAftalelicensBatch({
            id: batch.id, kilde: batch.kilde, year: batch.year,
            totalRows: batch.totalRows, filteredRows: batch.filteredRows,
            status: batch.status, notes: batch.notes,
        })
        if (!batchResult.success) {
            // Selve dataen (screening_source_rows) er allerede gemt på dette tidspunkt —
            // kun historik-kortet fejlede. Advarsel, ikke en blokerende fejl.
            toast.warning(`Data er importeret, men historik-kortet kunne ikke gemmes: ${batchResult.error ?? "ukendt fejl"}`)
        }
        setBatches(prev => [batch, ...prev])
        toast.success(`Import fuldført — ${batch.filteredRows.toLocaleString("da-DK")} rækker klar til sortering`)
        return true
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Visningsadmin"
                subtitle="Behandling og beregning af pulje-vederlag fra Copydan og TV2 Play"
                actions={
                    <Button onClick={() => setImportOpen(true)} className="gap-2">
                        <Plus className="h-4 w-4" />
                        Ny import
                    </Button>
                }
            />

            <div className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Manuelle indberetninger</h2><p className="text-xs text-muted-foreground">Visninger indberettet af medlemmer</p></div><div className="flex items-center gap-2"><select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm"><option value="all">Type</option>{WORK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><Badge variant="secondary">{filteredClaims.filter(claim => claim.status === "pending").length} afventer</Badge></div></div>
                {filteredClaims.length === 0 ? <p className="text-sm text-muted-foreground">Ingen manuelle indberetninger.</p> : <div className="space-y-2">{filteredClaims.slice(0, 20).map(claim => <button key={claim.id} type="button" onClick={async () => { setActiveClaim(claim); await markScreeningClaimCommentsRead(claim.id, "admin") }} className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted"><span><span className="font-medium">{claim.title}</span><span className="ml-2 text-xs text-muted-foreground">{claim.channel} · {new Date(claim.screening_date).toLocaleDateString("da-DK")}</span></span><span className="flex items-center gap-2"><Badge variant={claim.source_match_status === "found" ? "default" : "outline"}>{claim.source_match_status === "found" ? "Fundet i visningsliste" : "Ikke fundet i visningsliste"}</Badge><Badge variant={claim.status === "rejected" ? "destructive" : claim.status === "approved" ? "default" : "secondary"}>{claim.status === "pending" ? "Afventer" : claim.status}</Badge></span></button>)}</div>}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
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
                        {batchesLoading && (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                                    Indlæser datasæt …
                                </TableCell>
                            </TableRow>
                        )}
                        {!batchesLoading && batchesError && (
                            <TableRow>
                                <TableCell colSpan={8} className="py-8 text-center text-sm text-destructive">
                                    {batchesError}
                                </TableCell>
                            </TableRow>
                        )}
                        {!batchesLoading && !batchesError && batches.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                                    Ingen datasæt importeret endnu.
                                </TableCell>
                            </TableRow>
                        )}
                        {!batchesLoading && batches.map(batch => {
                            const cfg = STATUS_CONFIG[batch.status]
                            const claimCount = 0
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
            <Dialog open={!!activeClaim} onOpenChange={open => { if (!open) setActiveClaim(null) }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{activeClaim?.title}</DialogTitle></DialogHeader>{activeClaim && <MessageThread title="Beskeder med medlem" messages={(activeClaim.screening_claim_comments ?? []).map((comment: Record<string, any>) => ({ id: comment.id, authorRole: comment.author_role, message: comment.message, createdAt: comment.created_at, memberReadAt: comment.member_read_at, adminReadAt: comment.admin_read_at }))} viewerRole="admin" memberLabel="Medlem" adminLabel="DFKS" composerValue={reply} onComposerChange={setReply} onSend={async () => { if (!reply.trim()) return; await addScreeningClaimComment({ claimId: activeClaim.id, message: reply, authorRole: "admin" }); setReply(""); await loadClaims() }} onDeleteMessage={async messageId => { await deleteAdminMessage({ kind: "screening", threadId: activeClaim.id, messageId }); await loadClaims() }} onClearThread={async () => { await clearAdminMessageThread({ kind: "screening", threadId: activeClaim.id }); await loadClaims() }} footer={activeClaim.status === "pending" ? <div className="flex justify-end gap-2"><Button variant="outline" onClick={async () => { await updateScreeningClaimStatus(activeClaim.id, "rejected"); setActiveClaim(null); await loadClaims() }}>Afvis</Button><Button onClick={async () => { await updateScreeningClaimStatus(activeClaim.id, "approved"); setActiveClaim(null); await loadClaims() }}>Godkend</Button></div> : null} />}</DialogContent></Dialog>
        </div>
    )
}
