"use client"

import { useState, useEffect } from "react"
import { Plus, Download, ChevronDown, ChevronRight, FileText } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

// ── Types ─────────────────────────────────────────────────────

type BatchType = "aftalelicens" | "rettighed" | "begge"
type BatchStatus = "genereret" | "eksporteret"

interface BulkLine {
    userId?: string         // bruges som aggregeringsnøgle
    navn: string
    cpr?: string
    beloeb: number
    vaerkstitel?: string
    episode?: string
    udsendelsesdato?: string
    kilde?: string
    betalingstype?: string
    batch?: string
}

interface BulkBatch {
    id: string
    label: string
    createdAt: string
    type: BatchType
    status: BatchStatus
    lines: BulkLine[]
    totalAmount: number
}

// ── Export column config ──────────────────────────────────────

interface ExportColumn {
    id: string
    label: string
    enabled: boolean
}

const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = [
    { id: "navn",            label: "Navn",            enabled: true },
    { id: "cpr",             label: "CPR-nummer",      enabled: true },
    { id: "beloeb",          label: "Beløb",           enabled: true },
    { id: "vaerkstitel",     label: "Værkstitel",      enabled: true },
    { id: "episode",         label: "Episode",         enabled: false },
    { id: "udsendelsesdato", label: "Udsendelsesdato", enabled: false },
    { id: "kilde",           label: "Kilde",           enabled: true },
    { id: "betalingstype",   label: "Betalingstype",   enabled: true },
    { id: "batch",           label: "Batch",           enabled: false },
]

function loadExportCols(): ExportColumn[] {
    try {
        const stored = JSON.parse(localStorage.getItem("dfks_export_columns") ?? "null")
        if (Array.isArray(stored)) return stored
    } catch {}
    return DEFAULT_EXPORT_COLUMNS
}

// ── Al data types ─────────────────────────────────────────────

type AlKlipper = { name: string; userId?: string; sharePercent: number; amount: number }
type AlEpisode = { episodeLabel: string; broadcastDate?: string; isGenudsendelse: boolean; points: number; amount: number; klippere?: AlKlipper[] }
type AlVaerk = { workId?: string; workTitle: string; vaerkType: string; totalPoints?: number; totalAmount: number; adminFeeAmount?: number; klippere?: AlKlipper[]; episodes?: AlEpisode[]; status?: string }
type AlEntry = { id: string; batchLabel: string; lockedAt: string; totalAmount: number; vaerker: AlVaerk[] }

// ── Demo rettighed data ───────────────────────────────────────

const DEMO_RETTIGHED_KEY = "dfks_rettighed_pending"

const DEMO_RETTIGHED: Omit<BulkLine, "batch">[] = [
    { userId: "u1", navn: "Anna Heide",   cpr: "010190-1234", beloeb: 42000, vaerkstitel: "Skruk",  kilde: "Create Denmark", betalingstype: "IRF" },
    { userId: "u2", navn: "Bo Lindemann", cpr: "150285-5678", beloeb: 21000, vaerkstitel: "Skruk",  kilde: "Create Denmark", betalingstype: "IRF" },
    { userId: "u1", navn: "Anna Heide",   cpr: "010190-1234", beloeb: 18500, vaerkstitel: "Nisser", kilde: "Create Denmark", betalingstype: "Succesbetaling" },
]

// ── Pull helpers ──────────────────────────────────────────────

function pullAlLines(): BulkLine[] {
    const entries: AlEntry[] = JSON.parse(localStorage.getItem("dfks_al_udbetalinger") ?? "[]")
    const lines: BulkLine[] = []

    for (const entry of entries) {
        for (const vaerk of entry.vaerker) {
            if (vaerk.status === "paid") continue

            if (vaerk.episodes) {
                for (const ep of vaerk.episodes) {
                    for (const k of ep.klippere ?? []) {
                        if (k.amount <= 0) continue
                        lines.push({
                            userId: k.userId,
                            navn: k.name,
                            beloeb: k.amount,
                            vaerkstitel: ep.episodeLabel
                                ? `${vaerk.workTitle} ${ep.episodeLabel}`
                                : vaerk.workTitle,
                            episode: ep.episodeLabel,
                            udsendelsesdato: ep.broadcastDate,
                            kilde: entry.batchLabel,
                            betalingstype: "Aftalelicens",
                        })
                    }
                }
            } else {
                for (const k of vaerk.klippere ?? []) {
                    if (k.amount <= 0) continue
                    lines.push({
                        userId: k.userId,
                        navn: k.name,
                        beloeb: k.amount,
                        vaerkstitel: vaerk.workTitle,
                        kilde: entry.batchLabel,
                        betalingstype: "Aftalelicens",
                    })
                }
            }
        }
    }
    return lines
}

function pullRettighedLines(): BulkLine[] {
    const stored = JSON.parse(localStorage.getItem(DEMO_RETTIGHED_KEY) ?? "null")
    const raw: typeof DEMO_RETTIGHED = stored ?? DEMO_RETTIGHED
    return raw.map(r => ({ ...r }))
}

function aggregateByUser(lines: BulkLine[]): BulkLine[] {
    const map = new Map<string, BulkLine>()

    for (const line of lines) {
        // Nøgle: userId hvis tilgængeligt, ellers navn+cpr
        const key = line.userId ?? `${line.navn}__${line.cpr ?? ""}`
        const existing = map.get(key)

        if (!existing) {
            map.set(key, { ...line })
        } else {
            existing.beloeb += line.beloeb
            // Saml unikke værkstitler
            const titles = new Set((existing.vaerkstitel ?? "").split(", ").filter(Boolean))
            if (line.vaerkstitel) titles.add(line.vaerkstitel)
            existing.vaerkstitel = Array.from(titles).join(", ")
            // Saml unikke betalingstyper
            const types = new Set((existing.betalingstype ?? "").split(", ").filter(Boolean))
            if (line.betalingstype) types.add(line.betalingstype)
            existing.betalingstype = Array.from(types).join(", ")
            // Ryd episode/dato ved aggregering (ikke meningsfuldt på tværs)
            existing.episode = undefined
            existing.udsendelsesdato = undefined
        }
    }

    return Array.from(map.values())
}

function buildLines(type: BatchType): BulkLine[] {
    const raw: BulkLine[] = []
    if (type === "aftalelicens" || type === "begge") raw.push(...pullAlLines())
    if (type === "rettighed"    || type === "begge") raw.push(...pullRettighedLines())
    return aggregateByUser(raw)
}

// ── Format helpers ────────────────────────────────────────────

function kr(n: number) {
    return n.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })
}

function typeLabel(t: BatchType) {
    if (t === "aftalelicens") return "Aftalelicens"
    if (t === "rettighed")    return "Rettighedsbetaling"
    return "Begge typer"
}

// ── CSV download ──────────────────────────────────────────────

function downloadCsv(batch: BulkBatch) {
    const cols = loadExportCols().filter(c => c.enabled)
    const rows = batch.lines.map(l =>
        cols.map(c => {
            const v = l[c.id as keyof BulkLine] ?? ""
            return typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '""')}"`
        }).join(";")
    )
    const csv = "\uFEFF" + [cols.map(c => c.label).join(";"), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `udbetaling_${batch.label.replace(/\s+/g, "_")}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

// ── Page ──────────────────────────────────────────────────────

export default function AdminUdbetalingerPage() {
    const [batches, setBatches] = useState<BulkBatch[]>([])
    const [expanded, setExpanded] = useState<string | null>(null)
    const [showCreate, setShowCreate] = useState(false)
    const [batchType, setBatchType] = useState<BatchType>("begge")
    const [batchName, setBatchName] = useState("")
    const [previewLines, setPreviewLines] = useState<BulkLine[]>([])
    const [exportCols, setExportCols] = useState<ExportColumn[]>(DEFAULT_EXPORT_COLUMNS)

    useEffect(() => {
        const stored = JSON.parse(localStorage.getItem(DEMO_RETTIGHED_KEY) ?? "null")
        // Re-seed if missing or if entries don't have userId (stale data)
        if (!stored || !stored[0]?.userId) {
            localStorage.setItem(DEMO_RETTIGHED_KEY, JSON.stringify(DEMO_RETTIGHED))
        }
        setBatches(JSON.parse(localStorage.getItem("dfks_bulk_batches") ?? "[]"))
        setExportCols(loadExportCols())
    }, [])

    function openCreate() {
        const lines = buildLines("begge")
        setBatchType("begge")
        setBatchName("Udbetaling " + new Date().toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }))
        setPreviewLines(lines)
        setShowCreate(true)
    }

    function handleTypeChange(type: BatchType) {
        setBatchType(type)
        setPreviewLines(buildLines(type))
    }

    function handleCreate() {
        const label = batchName.trim() || "Udbetaling " + new Date().toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })
        const lines = previewLines.map(l => ({ ...l, batch: label }))
        const batch: BulkBatch = {
            id: "batch_" + Date.now(),
            label,
            createdAt: new Date().toISOString(),
            type: batchType,
            status: "genereret",
            lines,
            totalAmount: lines.reduce((s, l) => s + l.beloeb, 0),
        }
        const updated = [batch, ...batches]
        setBatches(updated)
        localStorage.setItem("dfks_bulk_batches", JSON.stringify(updated))
        setShowCreate(false)
        setExpanded(batch.id)
    }

    function markExported(batchId: string) {
        const updated = batches.map(b =>
            b.id === batchId ? { ...b, status: "eksporteret" as BatchStatus } : b
        )
        setBatches(updated)
        localStorage.setItem("dfks_bulk_batches", JSON.stringify(updated))
    }

    function markAllPaidInDb(batch: BulkBatch) {
        // Sæt alle AL-udbetalinger til "paid" i dfks_al_udbetalinger
        type AlVaerkRaw = { status?: string; [key: string]: unknown }
        type AlEntryRaw = { vaerker: AlVaerkRaw[]; [key: string]: unknown }
        const entries: AlEntryRaw[] = JSON.parse(localStorage.getItem("dfks_al_udbetalinger") ?? "[]")
        const updated = entries.map(e => ({
            ...e,
            vaerker: e.vaerker.map(v => ({ ...v, status: "paid" })),
        }))
        localStorage.setItem("dfks_al_udbetalinger", JSON.stringify(updated))

        // Markér også batchen som eksporteret
        markExported(batch.id)
    }

    const activeCols = exportCols.filter(c => c.enabled)
    const previewTotal = previewLines.reduce((s, l) => s + l.beloeb, 0)

    return (
        <div className="space-y-6">
            <PageHeader
                title="Bulk betaling"
                subtitle="Generér og eksportér udbetalingsbatches til lønsystemet"
                actions={
                    <Button size="sm" className="gap-1.5" onClick={openCreate}>
                        <Plus className="h-4 w-4" />
                        Ny udbetaling
                    </Button>
                }
            />

            {batches.length === 0 ? (
                <div className="rounded-lg border border-dashed p-12 text-center">
                    <p className="text-sm text-muted-foreground">Ingen udbetalingsbatches endnu</p>
                    <p className="text-xs text-muted-foreground mt-1">Opret en ny udbetaling for at komme i gang</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {batches.map(batch => {
                        const isExpanded = expanded === batch.id
                        return (
                            <Card key={batch.id}>
                                <CardHeader
                                    className="pb-3 cursor-pointer select-none"
                                    onClick={() => setExpanded(isExpanded ? null : batch.id)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {isExpanded
                                                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                            }
                                            <div>
                                                <CardTitle className="text-base font-medium">{batch.label}</CardTitle>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {fmtDate(batch.createdAt)} · {batch.lines.length} linjer · {typeLabel(batch.type)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono font-semibold text-sm">{kr(batch.totalAmount)}</span>
                                            <Badge
                                                variant={batch.status === "eksporteret" ? "secondary" : "outline"}
                                                className="text-xs"
                                            >
                                                {batch.status === "eksporteret" ? "Eksporteret" : "Genereret"}
                                            </Badge>
                                        </div>
                                    </div>
                                </CardHeader>

                                {isExpanded && (
                                    <CardContent className="pt-0">
                                        <div className="flex gap-2 mb-3">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="gap-1.5"
                                                onClick={() => downloadCsv(batch)}
                                            >
                                                <FileText className="h-3.5 w-3.5" />
                                                Download CSV
                                            </Button>
                                            {batch.status !== "eksporteret" && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="gap-1.5"
                                                    onClick={() => markAllPaidInDb(batch)}
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    Markér alle som udbetalt i værksdatabasen
                                                </Button>
                                            )}
                                        </div>

                                        <div className="rounded-md border overflow-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        {activeCols.map(c => (
                                                            <TableHead
                                                                key={c.id}
                                                                className={c.id === "beloeb" ? "text-right" : ""}
                                                            >
                                                                {c.label}
                                                            </TableHead>
                                                        ))}
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {batch.lines.map((line, i) => (
                                                        <TableRow key={i}>
                                                            {activeCols.map(c => (
                                                                <TableCell
                                                                    key={c.id}
                                                                    className={c.id === "beloeb"
                                                                        ? "text-right font-mono text-sm font-medium"
                                                                        : "text-sm"
                                                                    }
                                                                >
                                                                    {c.id === "beloeb"
                                                                        ? kr(line.beloeb)
                                                                        : (line[c.id as keyof BulkLine] as string | undefined) ?? "—"
                                                                    }
                                                                </TableCell>
                                                            ))}
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create dialog */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Ny udbetaling</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 flex-1 overflow-auto min-h-0">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Navn</Label>
                            <Input
                                value={batchName}
                                onChange={e => setBatchName(e.target.value)}
                                placeholder="F.eks. Aftalelicens Q1 2025"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Type</Label>
                            <Select value={batchType} onValueChange={v => handleTypeChange(v as BatchType)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="aftalelicens">Aftalelicens</SelectItem>
                                    <SelectItem value="rettighed">Rettighedsbetaling</SelectItem>
                                    <SelectItem value="begge">Begge</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {previewLines.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4">
                                Ingen afventende betalinger fundet for den valgte type.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">
                                        Forhåndsvisning — {previewLines.length} linjer trukket fra &quot;Afventer&quot;
                                    </Label>
                                    <span className="text-xs font-mono font-semibold">
                                        I alt: {kr(previewTotal)}
                                    </span>
                                </div>
                                <div className="rounded-md border overflow-auto max-h-80">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Navn</TableHead>
                                                <TableHead>Værk</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Beløb</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {previewLines.map((l, i) => (
                                                <TableRow key={i}>
                                                    <TableCell className="text-sm">{l.navn}</TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">
                                                        {l.vaerkstitel ?? "—"}
                                                        {l.episode ? ` · ${l.episode}` : ""}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">{l.betalingstype}</TableCell>
                                                    <TableCell className="text-right font-mono text-sm font-medium">{kr(l.beloeb)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setShowCreate(false)}>Annuller</Button>
                        <Button onClick={handleCreate} disabled={previewLines.length === 0}>
                            Generér batch ({previewLines.length} linjer)
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
