"use client"

import React, { useState, useMemo, useEffect, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
    ArrowLeft, Check, X, Flag, Search, ChevronDown, Download,
    Users, Calculator, Lock, Loader2, ExternalLink, Info, Save,
    ChevronsUpDown, ChevronUp, FileText, Clock, AlertTriangle,
    Link2, Link2Off, Database, Plus, Trash2, SlidersHorizontal, Ban, Eye, EyeOff, Pencil,
} from "lucide-react"
import { saveFeedback, getTrainingExamples } from "@/lib/ai-feedback"
import { recordDecision, findInHistory } from "@/lib/ai-history"
import { loadAiConfig } from "@/lib/ai-providers"
import { PageHeader } from "@/components/page-header"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
    AftalelicensBatch, AftalelicensVaerk, AftalelicensRettighed,
    AftalelicensVaegtet, SortStatus, VaerkType, AftalelicensVaegtExtra, FilterRule,
} from "@/lib/streaming-types"
import { mockWorks, mockContracts } from "@/lib/mock-data"

// ── Mock data ─────────────────────────────────────────────────

const MOCK_BATCH: AftalelicensBatch = {
    id: "batch1",
    kilde: "copydan_verdenstv",
    year: 2023,
    uploadedAt: "2024-03-15T10:30:00",
    uploadedBy: "Admin",
    totalRows: 312450,
    filteredRows: 8340,
    status: "sorting",
}

const VAERK_TYPE_LABELS: Record<VaerkType, string> = {
    spillefilm:      "Spillefilm",
    tv_serie_lang:   "TV-serie lang",
    tv_serie_kort:   "TV-serie kort",
    kortfilm:        "Kortfilm",
    dokumentarfilm:  "Dokumentarfilm",
    dokumentarserie: "Dokumentarserie",
    dokuDrama:       "DokuDrama",
    kort_dokumentar: "Kort dokumentar",
    ikke_relevant:   "Ikke relevant",
}

const KILDE_LABELS: Record<string, string> = {
    copydan_verdenstv: "Copydan Verdens TV",
    copydan_arkiv: "Copydan Arkiv",
    tv2play: "TV2 Play",
}

function genMockVaerker(): AftalelicensVaerk[] {
    // Legitime filmværker — skal sorteres
    const filmTitles = [
        { raw: "Nordlys", type: "dokumentarfilm" as VaerkType, channel: "DR K", duration: 88, isGenudsendelse: false },
        { raw: "Drømmen om Danmark", type: "spillefilm" as VaerkType, channel: "DR1", duration: 118, isGenudsendelse: false },
        { raw: "Borgen", type: "tv_serie_lang" as VaerkType, channel: "DR1", duration: 55, isGenudsendelse: false, season: 3, episode: 7, productionYear: 2013 },
        { raw: "Kærlighed for voksne", type: "spillefilm" as VaerkType, channel: "DR2", duration: 88, isGenudsendelse: false },
        { raw: "Sommerdansen", type: "dokumentarfilm" as VaerkType, channel: "DR K", duration: 52, isGenudsendelse: false },
        { raw: "Bryggeren", type: "dokuDrama" as VaerkType, channel: "TV2", duration: 44, isGenudsendelse: true },
        { raw: "Ronja Røverdatter", type: "spillefilm" as VaerkType, channel: "DR1", duration: 106, isGenudsendelse: false },
        { raw: "Mørke sider S1E1", type: "dokumentarserie" as VaerkType, channel: "DR2", duration: 48, isGenudsendelse: false },
        { raw: "Mørke sider S1E2", type: "dokumentarserie" as VaerkType, channel: "DR2", duration: 48, isGenudsendelse: false },
        { raw: "Mørke sider S1E3", type: "dokumentarserie" as VaerkType, channel: "DR2", duration: 48, isGenudsendelse: false },
        { raw: "Skovgården", type: "tv_serie_kort" as VaerkType, channel: "TV2", duration: 28, isGenudsendelse: true },
        { raw: "Frihavn", type: "tv_serie_lang" as VaerkType, channel: "DR1", duration: 58, isGenudsendelse: false },
        { raw: "Havets stemme", type: "kortfilm" as VaerkType, channel: "DR K", duration: 18, isGenudsendelse: false },
        { raw: "Ulvens time", type: "dokumentarfilm" as VaerkType, channel: "TV2", duration: 75, isGenudsendelse: false },
        { raw: "Broen IV", type: "tv_serie_lang" as VaerkType, channel: "DR1", duration: 60, isGenudsendelse: false },
        { raw: "Klassekampen", type: "dokumentarserie" as VaerkType, channel: "DR2", duration: 43, isGenudsendelse: true },
        { raw: "Den hvide løgn", type: "kort_dokumentar" as VaerkType, channel: "DR K", duration: 22, isGenudsendelse: false },
        { raw: "Elverdronningen", type: "spillefilm" as VaerkType, channel: "TV2", duration: 95, isGenudsendelse: false },
        { raw: "Nattens løver", type: "tv_serie_lang" as VaerkType, channel: "DR1", duration: 52, isGenudsendelse: false },
    ]

    // Nyhedsagtige/sportsindhold der typisk filtreres — mange dubletter
    const noiseTitles: { raw: string; channel: string; duration: number }[] = [
        { raw: "TV Avisen 21.00", channel: "DR1", duration: 29 },
        { raw: "TV Avisen 21.00", channel: "DR1", duration: 29 },
        { raw: "TV Avisen 21.00", channel: "DR1", duration: 29 },
        { raw: "TV Avisen 18.30", channel: "DR1", duration: 15 },
        { raw: "TV Avisen 18.30", channel: "DR1", duration: 15 },
        { raw: "Sportsnyt", channel: "DR1", duration: 12 },
        { raw: "Sportsnyt", channel: "DR1", duration: 12 },
        { raw: "Sportsnyt", channel: "DR1", duration: 12 },
        { raw: "Sportsnyt", channel: "DR1", duration: 12 },
        { raw: "Go' morgen Danmark", channel: "TV2", duration: 180 },
        { raw: "Go' morgen Danmark", channel: "TV2", duration: 180 },
        { raw: "Go' morgen Danmark", channel: "TV2", duration: 180 },
        { raw: "Go' aften Danmark", channel: "TV2", duration: 60 },
        { raw: "Go' aften Danmark", channel: "TV2", duration: 60 },
        { raw: "Go' aften Danmark", channel: "TV2", duration: 60 },
        { raw: "Nyhederne kl. 22", channel: "TV2", duration: 25 },
        { raw: "Nyhederne kl. 22", channel: "TV2", duration: 25 },
        { raw: "Nyhederne kl. 22", channel: "TV2", duration: 25 },
        { raw: "Nyhederne kl. 22", channel: "TV2", duration: 25 },
        { raw: "Vejret på TV2", channel: "TV2", duration: 5 },
        { raw: "Vejret på TV2", channel: "TV2", duration: 5 },
        { raw: "Vejret på TV2", channel: "TV2", duration: 5 },
        { raw: "Vejret", channel: "DR1", duration: 5 },
        { raw: "Vejret", channel: "DR1", duration: 5 },
        { raw: "Sporten DR", channel: "DR1", duration: 10 },
        { raw: "Sporten DR", channel: "DR1", duration: 10 },
        { raw: "Sporten DR", channel: "DR1", duration: 10 },
        { raw: "Ultra Nyt", channel: "DR Ultra", duration: 8 },
        { raw: "Ultra Nyt", channel: "DR Ultra", duration: 8 },
        { raw: "Lorry Nyheder", channel: "TV2 Lorry", duration: 20 },
    ]

    const filmItems = filmTitles.map((t, i) => ({
        id: `vaerk_${i + 1}`,
        batchId: "batch1",
        rawTitle: t.raw,
        channel: t.channel,
        broadcastDate: `2023-0${(i % 9) + 1}-${String((i * 3 % 28) + 1).padStart(2, "0")}`,
        duration: t.duration,
        isGenudsendelse: t.isGenudsendelse,
        vaerkType: t.type,
        sortStatus: (i < 6 ? "approved" : i === 6 ? "rejected" : i === 7 ? "flagged" : "pending") as SortStatus,
        // "Drømmen om Danmark" (index 1) simulerer et DB-match
        sortedBy: (i === 1 ? "db" : undefined),
        notes: i === 7 ? "Usikker på værktype" : undefined,
        season: (t as { season?: number }).season,
        episode: (t as { episode?: number }).episode,
        productionYear: (t as { productionYear?: number }).productionYear,
    }))

    const noiseItems = noiseTitles.map((t, i) => ({
        id: `noise_${i + 1}`,
        batchId: "batch1",
        rawTitle: t.raw,
        channel: t.channel,
        broadcastDate: `2023-${String((i % 12) + 1).padStart(2, "0")}-${String((i * 5 % 28) + 1).padStart(2, "0")}`,
        duration: t.duration,
        isGenudsendelse: i % 3 !== 0,
        vaerkType: undefined,
        sortStatus: "pending" as SortStatus,
    }))

    // Ekstra udsendelser af Mørke sider S1E2 — simulerer at samme afsnit sendes flere gange
    // To i september (samme måned som original → genudsendelse), én i november (ny måned → fuld pris)
    const s1e2Extra: AftalelicensVaerk[] = [
        { id: "vaerk_s1e2_b", batchId: "batch1", rawTitle: "Mørke sider S1E2", channel: "DR2", broadcastDate: "2023-09-28", duration: 48, isGenudsendelse: false, vaerkType: "dokumentarserie", sortStatus: "approved", season: 1, episode: 2 },
        { id: "vaerk_s1e2_c", batchId: "batch1", rawTitle: "Mørke sider S1E2", channel: "DR2", broadcastDate: "2023-09-30", duration: 48, isGenudsendelse: false, vaerkType: "dokumentarserie", sortStatus: "approved", season: 1, episode: 2 },
        { id: "vaerk_s1e2_d", batchId: "batch1", rawTitle: "Mørke sider S1E2", channel: "DR2", broadcastDate: "2023-11-10", duration: 48, isGenudsendelse: false, vaerkType: "dokumentarserie", sortStatus: "approved", season: 1, episode: 2 },
    ]

    return [...filmItems, ...noiseItems, ...s1e2Extra]
}

const MOCK_KLIPPERE = [
    { id: "u1", name: "Mads Eriksen" },
    { id: "u2", name: "Sara Lund" },
    { id: "u3", name: "Peter Mollerup" },
]

// DFI mock lookup
async function dfiLookup(title: string): Promise<AftalelicensVaerk["dfiData"] | null> {
    await new Promise(r => setTimeout(r, 800))
    const data: Record<string, AftalelicensVaerk["dfiData"]> = {
        "Borgen": { title: "Borgen", duration: 55, year: 2010, category: "tv_serie_lang", directors: ["Susanne Bier"], editors: ["Mads Eriksen"] },
        "Kærlighed for voksne": { title: "Kærlighed for voksne", duration: 88, year: 2022, category: "spillefilm", directors: ["Kaspar Munk"], editors: ["Sara Lund", "Peter Mollerup"] },
    }
    return data[title] ?? null
}

// ── Status badge ──────────────────────────────────────────────

function SortStatusBadge({ status }: { status: SortStatus }) {
    const cfg = {
        pending:  { label: "Afventer",  variant: "outline"     as const },
        approved: { label: "Godkendt",  variant: "default"     as const },
        rejected: { label: "Afvist",    variant: "destructive" as const },
        flagged:  { label: "Flagget",   variant: "secondary"   as const },
    }[status]
    return <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
}

// ── Sort table ────────────────────────────────────────────────

type SortCol = "title" | "date" | "channel" | "duration" | "vaerkType" | "status"
type SortDir = "asc" | "desc"

function SortableHead({ col, label, current, onSort, className }: {
    col: SortCol
    label: string
    current: { col: SortCol; dir: SortDir }
    onSort: (col: SortCol) => void
    className?: string
}) {
    const active = current.col === col
    return (
        <TableHead className={className}>
            <button
                onClick={() => onSort(col)}
                className="flex items-center gap-1 hover:text-foreground transition-colors text-left w-full"
            >
                {label}
                {active
                    ? <ChevronUp className={`h-3 w-3 ${current.dir === "desc" ? "rotate-180" : ""} transition-transform`} />
                    : <ChevronsUpDown className="h-3 w-3 opacity-40" />
                }
            </button>
        </TableHead>
    )
}

// ── Quick-filter fra titel ────────────────────────────────────

function extractKeywordSuggestions(title: string, channel?: string): { label: string; type: FilterRule["type"]; value: string }[] {
    const suggestions: { label: string; type: FilterRule["type"]; value: string }[] = []

    // Rens titlen: fjern tider (21.00), episode-nr, kanalnavne i slutningen
    const cleaned = title
        .replace(/\s+\d{1,2}[.:]\d{2}(\s|$)/g, " ")       // "21.00"
        .replace(/\s+(kl\.|ep\.|afsnit|sæson)\s*\d+/gi, "") // episode-markering
        .replace(/\s+(dr1|dr2|dr k|dr ultra|tv2|tv 2)$/gi, "") // kanal i slutning
        .replace(/\s+\d+$/g, "")                              // løbende nummer til sidst
        .trim()
        .toLowerCase()

    // Forslag 1: kernekeyword (renset)
    if (cleaned && cleaned !== title.toLowerCase()) {
        suggestions.push({ label: `Nøgleord: "${cleaned}"`, type: "title_keyword", value: cleaned })
    }

    // Forslag 2: eksakt titel (lowercase)
    suggestions.push({ label: `Eksakt titel: "${title}"`, type: "title_keyword", value: title.toLowerCase() })

    // Forslag 3: kanal-filter
    if (channel) {
        suggestions.push({ label: `Kanal: "${channel}"`, type: "channel", value: channel.toLowerCase() })
    }

    return suggestions
}

function QuickFilterButton({ vaerk, onAddRule }: {
    vaerk: AftalelicensVaerk
    onAddRule: (rule: Omit<FilterRule, "id" | "createdAt">) => void
}) {
    const [open, setOpen] = useState(false)
    const suggestions = extractKeywordSuggestions(vaerk.rawTitle, vaerk.channel)

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Tilføj til frasorteringsregler"
                    onClick={e => e.stopPropagation()}
                >
                    <Ban className="h-3 w-3" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
                <p className="text-xs font-medium text-muted-foreground px-1 pb-1.5">Tilføj frasorteringsregel</p>
                <div className="space-y-0.5">
                    {suggestions.map((s, i) => (
                        <button
                            key={i}
                            className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center gap-2"
                            onClick={() => {
                                onAddRule({ name: s.value, type: s.type, value: s.value, active: true })
                                setOpen(false)
                            }}
                        >
                            <Ban className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="font-mono text-xs">{s.label}</span>
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}

// ── Filter rules (shared with stamdata) ──────────────────────

const DEFAULT_FILTER_RULES: FilterRule[] = [
    { id: "fr1", name: "Sport", type: "title_keyword", value: "sport", active: true, createdAt: "2024-01-01" },
    { id: "fr2", name: "Nyheder", type: "title_keyword", value: "nyhed", active: true, createdAt: "2024-01-01" },
    { id: "fr3", name: "TV Avisen", type: "title_keyword", value: "tv avisen", active: true, createdAt: "2024-01-01" },
    { id: "fr4", name: "Sporten", type: "title_keyword", value: "sporten", active: true, createdAt: "2024-01-01" },
    { id: "fr5", name: "Vejret", type: "title_keyword", value: "vejret", active: true, createdAt: "2024-01-01" },
]

const FILTER_RULE_TYPE_LABELS: Record<FilterRule["type"], string> = {
    title_keyword: "Nøgleord i titel",
    title_regex: "Regex-mønster",
    channel: "Kanalnavn",
}

function loadFilterRulesLocal(): FilterRule[] {
    if (typeof window === "undefined") return DEFAULT_FILTER_RULES
    try {
        const stored = localStorage.getItem("dfks_filter_rules")
        return stored ? JSON.parse(stored) : DEFAULT_FILTER_RULES
    } catch { return DEFAULT_FILTER_RULES }
}

function matchesAnyRule(title: string, channel: string | undefined, rules: FilterRule[]): boolean {
    const t = title.toLowerCase()
    const ch = (channel ?? "").toLowerCase()
    return rules.filter(r => r.active).some(r => {
        if (r.type === "title_keyword") return t.includes(r.value.toLowerCase())
        if (r.type === "title_regex") { try { return new RegExp(r.value, "i").test(title) } catch { return false } }
        if (r.type === "channel") return ch === r.value.toLowerCase()
        return false
    })
}

function FilterRulesPanel({ onRulesChange, onAddRuleRef }: { onRulesChange: (rules: FilterRule[]) => void; onAddRuleRef?: React.MutableRefObject<((rule: Omit<FilterRule, "id" | "createdAt">) => void) | null> }) {
    const [open, setOpen] = useState(false)
    const [rules, setRules] = useState<FilterRule[]>(DEFAULT_FILTER_RULES)
    const [ruleSearch, setRuleSearch] = useState("")
    const [newName, setNewName] = useState("")
    const [newType, setNewType] = useState<FilterRule["type"]>("title_keyword")
    const [newValue, setNewValue] = useState("")
    const [adding, setAdding] = useState(false)

    const applyRules = (next: FilterRule[]) => {
        localStorage.setItem("dfks_filter_rules", JSON.stringify(next))
        onRulesChange(next)
    }

    // Hydrate from localStorage after mount to avoid SSR/client mismatch
    useEffect(() => {
        const stored = loadFilterRulesLocal()
        setRules(stored)
        onRulesChange(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (onAddRuleRef) {
            onAddRuleRef.current = (rule: Omit<FilterRule, "id" | "createdAt">) => {
                setRules(prev => {
                    const next = [...prev, { ...rule, id: `fr_${Date.now()}`, createdAt: new Date().toISOString() }]
                    applyRules(next)
                    return next
                })
                toast.success(`Filterregel tilføjet: "${rule.value}"`)
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onAddRuleRef])

    const toggleActive = (id: string) => {
        setRules(prev => {
            const next = prev.map(r => r.id === id ? { ...r, active: !r.active } : r)
            applyRules(next)
            return next
        })
    }

    const handleDelete = (id: string) => {
        setRules(prev => {
            const next = prev.filter(r => r.id !== id)
            applyRules(next)
            return next
        })
        toast.success("Regel slettet")
    }

    const handleAdd = () => {
        if (!newName.trim() || !newValue.trim()) return
        setRules(prev => {
            const next = [...prev, {
                id: `fr_${Date.now()}`,
                name: newName.trim(),
                type: newType,
                value: newValue.trim(),
                active: true,
                createdAt: new Date().toISOString(),
            }]
            applyRules(next)
            return next
        })
        setNewName("")
        setNewValue("")
        setNewType("title_keyword")
        setAdding(false)
        toast.success("Filterregel tilføjet")
    }

    const activeCount = rules.filter(r => r.active).length

    const visibleRules = ruleSearch.trim()
        ? rules.filter(r =>
            r.name.toLowerCase().includes(ruleSearch.toLowerCase()) ||
            r.value.toLowerCase().includes(ruleSearch.toLowerCase())
        )
        : rules

    return (
        <div className="rounded-lg border">
            <button
                className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/40 transition-colors"
                onClick={() => setOpen(o => !o)}
            >
                <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">Filtrering</span>
                    <Badge variant="secondary" className="text-xs">{activeCount} aktive</Badge>
                    <span className="text-xs text-muted-foreground">({rules.length} regler)</span>
                </div>
                <ChevronDown className={"h-4 w-4 text-muted-foreground transition-transform " + (open ? "rotate-180" : "")} />
            </button>
            {open && (
                <div className="border-t px-4 pb-4 pt-3 space-y-3">
                    <div className="flex items-center gap-3">
                        <p className="text-xs text-muted-foreground flex-1">Titler der matcher aktive regler fjernes automatisk. Ændringer gælder globalt (deles med stamdata).</p>
                        <div className="relative w-52 shrink-0">
                            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Søg i regler…"
                                value={ruleSearch}
                                onChange={e => setRuleSearch(e.target.value)}
                                className="h-8 pl-8 text-xs"
                            />
                            {ruleSearch && (
                                <button
                                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                                    onClick={() => setRuleSearch("")}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Navn</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Værdi</TableHead>
                                <TableHead className="w-[80px]">Aktiv</TableHead>
                                <TableHead className="w-[48px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleRules.map(rule => (
                                <TableRow key={rule.id}>
                                    <TableCell className={"text-sm " + (!rule.active ? "text-muted-foreground" : "")}>{rule.name}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-xs font-normal">{FILTER_RULE_TYPE_LABELS[rule.type]}</Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">{rule.value}</TableCell>
                                    <TableCell>
                                        <Switch checked={rule.active} onCheckedChange={() => toggleActive(rule.id)} />
                                    </TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(rule.id)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {visibleRules.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                                        {ruleSearch ? `Ingen regler matcher "${ruleSearch}"` : "Ingen filtre defineret"}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                    {adding ? (
                        <div className="flex items-end gap-2 pt-1">
                            <div className="space-y-1 flex-1">
                                <Label className="text-xs">Navn</Label>
                                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="f.eks. Reklamer" className="h-8 text-sm" />
                            </div>
                            <div className="space-y-1 w-40">
                                <Label className="text-xs">Type</Label>
                                <Select value={newType} onValueChange={v => setNewType(v as FilterRule["type"])}>
                                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(Object.entries(FILTER_RULE_TYPE_LABELS) as [FilterRule["type"], string][]).map(([k, v]) => (
                                            <SelectItem key={k} value={k}>{v}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1 flex-1">
                                <Label className="text-xs">Værdi</Label>
                                <Input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="f.eks. reklame" className="h-8 text-sm" />
                            </div>
                            <Button size="sm" onClick={handleAdd} className="h-8">Tilføj</Button>
                            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAdding(false); setNewName(""); setNewValue("") }}>Annuller</Button>
                        </div>
                    ) : (
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
                            <Plus className="h-3.5 w-3.5" />
                            Tilføj regel
                        </Button>
                    )}

                </div>
            )}
        </div>
    )
}

function SortTable({ vaerker, onUpdate }: {
    vaerker: AftalelicensVaerk[]
    onUpdate: (id: string, patch: Partial<AftalelicensVaerk>) => void
}) {
    const addRuleRef = useRef<((rule: Omit<FilterRule, "id" | "createdAt">) => void) | null>(null)
    const autoRejectedRef = useRef<Set<string>>(new Set())
    const currentRulesRef = useRef<FilterRule[]>(loadFilterRulesLocal())

    const handleRulesChange = (rules: FilterRule[]) => {
        currentRulesRef.current = rules
        const auto = autoRejectedRef.current
        const toRestore: string[] = []
        const toReject: string[] = []

        vaerker.forEach(v => {
            const matches = matchesAnyRule(v.rawTitle, v.channel, rules)
            if (auto.has(v.id) && !matches) {
                toRestore.push(v.id)
                auto.delete(v.id)
            } else if (!auto.has(v.id) && v.sortStatus === "pending" && matches) {
                toReject.push(v.id)
                auto.add(v.id)
            }
        })

        toRestore.forEach(id => onUpdate(id, { sortStatus: "pending", sortedAt: undefined, sortedBy: undefined }))
        toReject.forEach(id => onUpdate(id, { sortStatus: "rejected", sortedAt: new Date().toISOString(), sortedBy: "filter" }))

        if (toRestore.length > 0 && toReject.length === 0)
            toast.info(`${toRestore.length} titel${toRestore.length !== 1 ? "r" : ""} genaktiveret`)
        else if (toReject.length > 0)
            toast.success(`${toReject.length} titel${toReject.length !== 1 ? "r" : ""} afvist automatisk`)
    }

    // Re-anvend filtreringsregler når vaerker-data udskiftes (real data erstatter mock)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (vaerker.length > 0 && currentRulesRef.current.some(r => r.active)) {
            autoRejectedRef.current = new Set()
            handleRulesChange(currentRulesRef.current)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vaerker.length])

    const PAGE_SIZE = 200
    const [page, setPage] = useState(0)
    const [filter, setFilter] = useState<"all" | SortStatus>("all")
    const [hideRejected, setHideRejected] = useState(false)
    const [search, setSearch] = useState("")
    const [dupFilter, setDupFilter] = useState("")
    const [sortCol, setSortCol] = useState<SortCol>("date")
    const [sortDir, setSortDir] = useState<SortDir>("asc")
    const [dfiLoading, setDfiLoading] = useState<string | null>(null)
    const [noteEdit, setNoteEdit] = useState<{
        id: string
        value: string
        rawTitle: string
        channel?: string
        productionYear?: number
        broadcastDate?: string
        duration?: number
    } | null>(null)
    const [aiSearch, setAiSearch] = useState<{
        loading: boolean
        result: {
            kenderProgrammet?: boolean
            hvadErDette: string
            relevant: "ja" | "nej" | "usikker"
            vaerkType: string | null
            begrundelse: string
            confidence: "høj" | "mellem" | "lav"
        } | null
        error: string | null
    }>({ loading: false, result: null, error: null })
    const [aiRunning, setAiRunning] = useState(false)
    const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null)
    const [aiSuggestions, setAiSuggestions] = useState<Map<string, { status: string; type?: string; reason: string }>>(new Map())
    const aiAbortRef = useRef<AbortController | null>(null)
    const [bulkPopup, setBulkPopup] = useState<{ x: number; y: number; label: string; onConfirm: () => void } | null>(null)
    const lastClickPos = useRef({ x: 0, y: 0 })

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            lastClickPos.current = { x: e.clientX, y: e.clientY }
        }
        window.addEventListener("mousedown", handler)
        return () => window.removeEventListener("mousedown", handler)
    }, [])

    // Åbn bulk-popup ved musen, men hold den inden for skærmen
    const openBulkPopup = (label: string, onConfirm: () => void) => {
        const POPUP_W = 252   // min-w-[220px] + border + padding
        const POPUP_H = 90    // ca. højde
        const rawX = lastClickPos.current.x + 12
        const rawY = lastClickPos.current.y - 10
        setBulkPopup({
            x: Math.min(rawX, window.innerWidth - POPUP_W),
            y: Math.min(Math.max(rawY, 8), window.innerHeight - POPUP_H),
            label,
            onConfirm,
        })
    }

    // Luk bulk-popup ved klik udenfor
    useEffect(() => {
        if (!bulkPopup) return
        const handler = (e: MouseEvent) => {
            const target = e.target as Element
            if (!target.closest("[data-bulk-popup]")) setBulkPopup(null)
        }
        // Lyt i næste tick så popup ikke lukker med det samme
        const t = setTimeout(() => window.addEventListener("mousedown", handler), 0)
        return () => { clearTimeout(t); window.removeEventListener("mousedown", handler) }
    }, [bulkPopup])

    const BATCH_SIZE = 50

    // Mapning fra mockWorks.category → VaerkType
    const CATEGORY_TO_VAERKTYPE: Record<string, VaerkType> = {
        feature: "spillefilm",
        tvSeries: "tv_serie_lang",
        documentary: "dokumentarfilm",
        short: "kortfilm",
        animation: "spillefilm",
    }

    const runAiGrovsortering = async () => {
        const pending = vaerker.filter(v => v.sortStatus === "pending")
        if (pending.length === 0) { toast.info("Ingen afventende titler at sortere"); return }

        const abort = new AbortController()
        aiAbortRef.current = abort
        setAiRunning(true)
        const allSuggestions = new Map<string, { status: string; type?: string; reason: string }>()
        let dbMatch = 0, godkendt = 0, afvist = 0, usikker = 0, fejl = 0

        // ── Trin 1: DB-match ─────────────────────────────────────
        // Titler der matcher vores værksdatabase godkendes direkte — ingen AI nødvendig
        const workIdx = buildWorkIndex()
        const unmatched: typeof pending = []

        for (const v of pending) {
            const key = normalizeTitle(v.rawTitle)
            const works = workIdx.get(key) ?? []
            // Duplikate titler i DB — overlades til manuel parring, ikke auto-godkendt
            if (works.length > 1) { unmatched.push(v); continue }
            const work = works[0]
            if (work) {
                const vaerkType = CATEGORY_TO_VAERKTYPE[work.category] ?? undefined
                onUpdate(v.id, {
                    sortStatus: "approved",
                    vaerkType,
                    sortedAt: new Date().toISOString(),
                    sortedBy: "db",
                })
                allSuggestions.set(v.id, {
                    status: "godkend",
                    type: vaerkType,
                    reason: "Match i værksdatabase",
                })
                dbMatch++
                godkendt++
            } else {
                unmatched.push(v)
            }
        }

        if (dbMatch > 0) toast.info(`${dbMatch} titler matchet i DB`)

        // ── Trin 1.5: Historik-filter — kendte titler fra tidligere batches ──
        let histMatch = 0
        const afterHistory: typeof unmatched = []
        for (const v of unmatched) {
            const hist = findInHistory(v.rawTitle, v.channel)
            if (hist) {
                onUpdate(v.id, {
                    sortStatus: hist.decision,
                    vaerkType: hist.vaerkType as VaerkType | undefined,
                    sortedAt: new Date().toISOString(),
                    sortedBy: "historik",
                })
                allSuggestions.set(v.id, {
                    status: hist.decision === "approved" ? "godkend" : "afvis",
                    type: hist.vaerkType,
                    reason: `Fra historik (set ${hist.count}×)`,
                })
                if (hist.decision === "approved") godkendt++
                else afvist++
                histMatch++
            } else {
                afterHistory.push(v)
            }
        }

        if (histMatch > 0) toast.info(`${histMatch} titler matchet i historik — sender ${afterHistory.length} til AI`)

        // ── Trin 2: AI kun på ukendte titler ────────────────────
        setAiProgress({ done: 0, total: afterHistory.length })

        const batches: typeof afterHistory[] = []
        for (let i = 0; i < afterHistory.length; i += BATCH_SIZE) {
            batches.push(afterHistory.slice(i, i + BATCH_SIZE))
        }

        let stopped = false
        for (let b = 0; b < batches.length; b++) {
            if (abort.signal.aborted) { stopped = true; break }
            const batch = batches[b]
            try {
                const res = await fetch("/api/aftalelicens/grovsorter", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: abort.signal,
                    body: JSON.stringify({
                        items: batch.map(v => ({
                            id: v.id,
                            rawTitle: v.rawTitle,
                            channel: v.channel,
                            duration: v.duration,
                            productionYear: v.productionYear,
                        })),
                        examples: getTrainingExamples(20),
                        ...loadAiConfig("grovsorter"),
                    }),
                })
                const data = await res.json()
                if (!res.ok || data.error) { fejl += batch.length; continue }

                for (const r of (data.results as { id: string; status: string; type?: string; reason: string }[])) {
                    allSuggestions.set(r.id, { status: r.status, type: r.type ?? undefined, reason: r.reason })
                    if (r.status === "godkend") godkendt++
                    else if (r.status === "afvis") afvist++
                    else usikker++

                    if (r.status === "godkend") {
                        onUpdate(r.id, {
                            sortStatus: "approved",
                            vaerkType: (r.type as VaerkType) ?? undefined,
                            sortedAt: new Date().toISOString(),
                            sortedBy: "ai",
                        })
                    } else if (r.status === "afvis") {
                        onUpdate(r.id, {
                            sortStatus: "rejected",
                            sortedAt: new Date().toISOString(),
                            sortedBy: "ai",
                        })
                    } else {
                        // "usikker" → sæt flag og gem AI's begrundelse som note
                        onUpdate(r.id, {
                            sortStatus: "flagged",
                            notes: r.reason ?? "AI usikker på klassifikation",
                            sortedAt: new Date().toISOString(),
                            sortedBy: "ai",
                        })
                    }
                }
            } catch (err) {
                if ((err as Error).name === "AbortError") { stopped = true; break }
                fejl += batch.length
            }
            setAiProgress({ done: Math.min((b + 1) * BATCH_SIZE, afterHistory.length), total: afterHistory.length })
        }

        setAiSuggestions(allSuggestions)
        setAiRunning(false)
        setAiProgress(null)
        aiAbortRef.current = null

        const parts = []
        if (dbMatch > 0) parts.push(`${dbMatch} DB-match`)
        if (godkendt - dbMatch > 0) parts.push(`${godkendt - dbMatch} AI-godkendt`)
        if (afvist > 0) parts.push(`${afvist} afvist`)
        if (usikker > 0) parts.push(`${usikker} usikker`)
        if (fejl > 0) parts.push(`${fejl} fejl`)

        if (stopped) {
            toast.info(`AI stoppet — ${parts.length > 0 ? parts.join(", ") : "ingen behandlet"}`)
        } else {
            toast.success(`Grovsortering færdig — ${parts.join(", ")}`)
        }
    }

    const handleSort = (col: SortCol) => {
        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
        else { setSortCol(col); setSortDir("asc") }
    }

    // Fjern kun afsnit/sæson-markører — behold årstal som del af matchet
    const stripEpisodeId = (title: string) =>
        title
            .replace(/\s*[Ss]\d+\s*[Ee]\d+/g, "")   // S1E1 / S01E01
            .replace(/\s*[Ss]æson\s*\d+/gi, "")      // Sæson 3
            .replace(/\s*[Aa]fsnit\s*\d+/gi, "")     // Afsnit 7
            .replace(/\s*[-–]\s*\d+\s*$/g, "")       // - 4 til sidst
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()

    const STATUS_ORDER: Record<SortStatus, number> = { pending: 0, flagged: 1, approved: 2, rejected: 3 }

    const filtered = useMemo(() => {
        setPage(0)
        let list = vaerker
        if (filter !== "all") list = list.filter(v => v.sortStatus === filter)
        if (hideRejected && filter === "all") list = list.filter(v => v.sortStatus !== "rejected")

        // Dublet-filter: tæl forekomster inden for status-filtreret liste
        const minDup = dupFilter !== "" ? Number(dupFilter) : null
        if (minDup !== null && minDup >= 1) {
            const counts = new Map<string, number>()
            for (const v of list) {
                const base = stripEpisodeId(v.rawTitle)
                counts.set(base, (counts.get(base) ?? 0) + 1)
            }
            list = list.filter(v => (counts.get(stripEpisodeId(v.rawTitle)) ?? 1) >= minDup)
        }

        if (search) list = list.filter(v => v.rawTitle.toLowerCase().includes(search.toLowerCase()))

        list = [...list].sort((a, b) => {
            let cmp = 0
            switch (sortCol) {
                case "title":    cmp = a.rawTitle.localeCompare(b.rawTitle, "da"); break
                case "date":     cmp = (a.broadcastDate ?? "").localeCompare(b.broadcastDate ?? ""); break
                case "channel":  cmp = (a.channel ?? "").localeCompare(b.channel ?? "", "da"); break
                case "duration": cmp = (a.duration ?? 0) - (b.duration ?? 0); break
                case "vaerkType":cmp = (a.vaerkType ?? "").localeCompare(b.vaerkType ?? "", "da"); break
                case "status":   cmp = STATUS_ORDER[a.sortStatus] - STATUS_ORDER[b.sortStatus]; break
            }
            return sortDir === "asc" ? cmp : -cmp
        })
        return list
    }, [vaerker, filter, hideRejected, search, dupFilter, sortCol, sortDir])

    const handleDfi = async (vaerk: AftalelicensVaerk) => {
        setDfiLoading(vaerk.id)
        const data = await dfiLookup(vaerk.rawTitle)
        setDfiLoading(null)
        if (data) {
            onUpdate(vaerk.id, { dfiData: data, dfiMatched: true })
            toast.success(`DFI-match: ${data.title}`)
        } else {
            onUpdate(vaerk.id, { dfiMatched: false })
            toast.info("Ikke fundet i Filmdatabasen")
        }
    }

    const setStatus = (id: string, status: SortStatus) => {
        onUpdate(id, {
            sortStatus: status,
            sortedAt: new Date().toISOString(),
            sortedBy: "admin",
            ...(status === "rejected" ? { vaerkType: "ikke_relevant" as VaerkType } : {}),
        })
    }

    const flagWithMatches = (id: string, note: string) => {
        const vaerk = vaerker.find(v => v.id === id)
        if (!vaerk) return

        const now = new Date().toISOString()
        onUpdate(id, { sortStatus: "flagged", notes: note, sortedAt: now, sortedBy: "admin" })

        const baseTitle = stripEpisodeId(vaerk.rawTitle)
        const siblings = vaerker.filter(v => {
            if (v.id === id || v.sortStatus === "flagged") return false
            if (stripEpisodeId(v.rawTitle) !== baseTitle) return false
            if (vaerk.productionYear && v.productionYear && vaerk.productionYear !== v.productionYear) return false
            return true
        })

        if (siblings.length === 0) return

        const yearSuffix = vaerk.productionYear ? ` (${vaerk.productionYear})` : ""
        openBulkPopup(`Flag alle ${siblings.length + 1} med samme serienavn${yearSuffix}?`, () => {
            siblings.forEach(s => onUpdate(s.id, { sortStatus: "flagged", notes: note, sortedAt: now, sortedBy: "admin" }))
            setBulkPopup(null)
        })
    }

    const approveWithMatches = (id: string, vaerkType?: VaerkType) => {
        const vaerk = vaerker.find(v => v.id === id)
        if (!vaerk) return

        const now = new Date().toISOString()
        onUpdate(id, { sortStatus: "approved", vaerkType: vaerkType ?? vaerk.vaerkType, sortedAt: now, sortedBy: "admin" })

        const baseTitle = stripEpisodeId(vaerk.rawTitle)
        const siblings = vaerker.filter(v => {
            if (v.id === id || v.sortStatus === "approved") return false
            if (stripEpisodeId(v.rawTitle) !== baseTitle) return false
            if (vaerk.productionYear && v.productionYear && vaerk.productionYear !== v.productionYear) return false
            return true
        })

        if (siblings.length === 0) return

        const yearSuffix = vaerk.productionYear ? ` (${vaerk.productionYear})` : ""
        openBulkPopup(`Godkend alle ${siblings.length + 1} med samme serienavn${yearSuffix}?`, () => {
            siblings.forEach(s => onUpdate(s.id, { sortStatus: "approved", vaerkType: vaerkType ?? s.vaerkType, sortedAt: now, sortedBy: "admin" }))
            setBulkPopup(null)
        })
    }

    const rejectWithMatches = (id: string) => {
        const vaerk = vaerker.find(v => v.id === id)
        if (!vaerk) return

        // Afvis den valgte titel
        setStatus(id, "rejected")

        // Find andre titler med samme serienavn + årstal (ekskl. allerede afviste)
        const baseTitle = stripEpisodeId(vaerk.rawTitle)
        const siblings = vaerker.filter(v => {
            if (v.id === id || v.sortStatus === "rejected") return false
            if (stripEpisodeId(v.rawTitle) !== baseTitle) return false
            // Hvis årstal er tilgængeligt på begge, kræv at de matcher
            if (vaerk.productionYear && v.productionYear && vaerk.productionYear !== v.productionYear) return false
            return true
        })

        if (siblings.length === 0) return

        const yearSuffix = vaerk.productionYear ? ` (${vaerk.productionYear})` : ""
        openBulkPopup(`Afvis alle ${siblings.length + 1} med samme serienavn${yearSuffix}?`, () => {
            const now = new Date().toISOString()
            siblings.forEach(s => onUpdate(s.id, { sortStatus: "rejected", vaerkType: "ikke_relevant" as VaerkType, sortedAt: now, sortedBy: "admin" }))
            setBulkPopup(null)
        })
    }

    const pending = vaerker.filter(v => v.sortStatus === "pending").length
    const approvedCount = vaerker.filter(v => v.sortStatus === "approved").length
    const rejectedCount = vaerker.filter(v => v.sortStatus === "rejected").length
    const filterRejectedCount = vaerker.filter(v => v.sortStatus === "rejected" && v.sortedBy === "filter").length
    const flaggedCount = vaerker.filter(v => v.sortStatus === "flagged").length
    const total = vaerker.length
    const progress = total > 0 ? Math.round(((total - pending) / total) * 100) : 100

    return (
        <div className="space-y-4">
            {/* Filter rules panel */}
            <FilterRulesPanel onRulesChange={handleRulesChange} onAddRuleRef={addRuleRef} />

            {/* Progress */}
            <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="space-y-1 flex-1 mr-4">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{total - pending} af {total} sorteret</span>
                            <span className="text-muted-foreground">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                        {/* Opdeling af sorterede titler */}
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground pt-1">
                            {approvedCount > 0 && (
                                <span className="text-green-600 dark:text-green-400">
                                    ✓ {approvedCount} godkendt
                                </span>
                            )}
                            {rejectedCount > 0 && (
                                <span className="text-destructive">
                                    ✗ {rejectedCount} afvist
                                    {filterRejectedCount > 0 && (
                                        <span className="opacity-70"> ({filterRejectedCount} af filtreringsregler)</span>
                                    )}
                                </span>
                            )}
                            {flaggedCount > 0 && (
                                <span className="text-amber-600 dark:text-amber-400">
                                    ⚑ {flaggedCount} flagget
                                </span>
                            )}
                            {pending > 0 && (
                                <span>
                                    ⋯ {pending} afventende
                                </span>
                            )}
                        </div>
                        {aiProgress && (
                            <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
                                <span className="flex items-center gap-1.5">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    AI behandler batch {Math.ceil(aiProgress.done / BATCH_SIZE)} af {Math.ceil(aiProgress.total / BATCH_SIZE)}…
                                </span>
                                <span>{aiProgress.done} / {aiProgress.total}</span>
                            </div>
                        )}
                    </div>
                    {aiRunning ? (
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={() => aiAbortRef.current?.abort()}
                        >
                            <X className="h-3.5 w-3.5" />
                            Stop AI
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 shrink-0 border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950"
                            onClick={runAiGrovsortering}
                            disabled={pending === 0}
                        >
                            <span className="text-xs font-bold">AI</span>
                            Kør AI-grovsortering
                        </Button>
                    )}
                </div>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Søg på titel..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-8 h-9 text-sm"
                    />
                </div>
                {(["all", "pending", "approved", "rejected", "flagged"] as const).map(f => (
                    <Button
                        key={f}
                        variant={filter === f ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilter(f)}
                        className="text-xs"
                    >
                        {f === "all" ? "Alle" : f === "pending" ? "Afventende" : f === "approved" ? "Godkendt" : f === "rejected" ? "Afvist" : "Flagget"}
                        <span className="ml-1 opacity-70">
                            {f === "all" ? vaerker.length : vaerker.filter(v => v.sortStatus === f).length}
                        </span>
                    </Button>
                ))}
                {/* Skjul afviste */}
                <Button
                    variant={hideRejected ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setHideRejected(h => !h)}
                    className="text-xs gap-1.5"
                >
                    {hideRejected ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {hideRejected ? "Afviste skjult" : "Skjul afviste"}
                </Button>

                {/* Dublet-filter */}
                <div className="flex items-center gap-1.5 border rounded-md px-2 h-9 bg-background">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Dubletter ≥</span>
                    <Input
                        type="number"
                        value={dupFilter}
                        onChange={e => setDupFilter(e.target.value)}
                        placeholder="—"
                        className="h-6 w-14 border-0 p-0 text-xs text-center focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        min="1"
                    />
                    {dupFilter !== "" && (
                        <button
                            type="button"
                            onClick={() => setDupFilter("")}
                            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 ml-auto text-xs"
                    onClick={() => {
                        filtered.forEach(v => { if (v.sortStatus === "pending") setStatus(v.id, "approved") })
                        toast.success("Alle synlige godkendt")
                    }}
                >
                    <Check className="h-3 w-3" />
                    Godkend alle synlige
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                        filtered.forEach(v => { if (v.sortStatus === "pending") setStatus(v.id, "rejected") })
                        toast.success("Alle synlige afvist")
                    }}
                >
                    <X className="h-3 w-3" />
                    Afvis alle synlige
                </Button>
            </div>

            {/* Table */}
            <div className="rounded-lg border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <SortableHead col="title"    label="Titel"    current={{ col: sortCol, dir: sortDir }} onSort={handleSort} />
                            <SortableHead col="date"     label="Dato"     current={{ col: sortCol, dir: sortDir }} onSort={handleSort} className="w-[100px]" />
                            <SortableHead col="channel"  label="Kanal"    current={{ col: sortCol, dir: sortDir }} onSort={handleSort} />
                            <SortableHead col="duration" label="Min."     current={{ col: sortCol, dir: sortDir }} onSort={handleSort} className="w-[80px]" />
                            <SortableHead col="vaerkType" label="Værktype" current={{ col: sortCol, dir: sortDir }} onSort={handleSort} className="w-[160px]" />
                            <TableHead className="w-[100px]">Genuds.</TableHead>
                            <TableHead className="w-[80px]">DFI</TableHead>
                            <SortableHead col="status"   label="Status"   current={{ col: sortCol, dir: sortDir }} onSort={handleSort} className="w-[100px]" />
                            <TableHead className="w-[120px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(v => (
                            <TableRow key={v.id} className={v.sortStatus === "rejected" ? "opacity-50" : ""}>
                                <TableCell>
                                    <div>
                                        <span className="text-sm font-medium">{v.rawTitle}</span>
                                        {(v.season != null || v.episode != null || v.productionYear != null) && (
                                            <span className="ml-1.5 text-xs text-muted-foreground">
                                                {v.season != null && `S${v.season}`}
                                                {v.episode != null && `E${v.episode}`}
                                                {v.productionYear != null && ` (${v.productionYear})`}
                                            </span>
                                        )}
                                        <QuickFilterButton
                                            vaerk={v}
                                            onAddRule={rule => addRuleRef.current?.(rule)}
                                        />
                                        {aiSuggestions.has(v.id) && (
                                            <span
                                                title={aiSuggestions.get(v.id)?.reason}
                                                className="ml-1.5 inline-flex items-center rounded px-1 py-0 text-[9px] font-bold tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300 cursor-help"
                                            >
                                                AI
                                            </span>
                                        )}
                                        {v.notes && v.sortStatus === "flagged" && (
                                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{v.notes}</p>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground tabular-nums">
                                    {v.broadcastDate
                                        ? new Date(v.broadcastDate).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "2-digit" })
                                        : "—"}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{v.channel ?? "—"}</TableCell>
                                <TableCell className="text-sm">{v.duration ?? "—"}</TableCell>
                                <TableCell>
                                    <Select
                                        value={v.vaerkType ?? ""}
                                        onValueChange={val => {
                                            const type = val as VaerkType
                                            onUpdate(v.id, { vaerkType: type })

                                            // Tilbyd bulk-ændring for samme serie
                                            const baseTitle = stripEpisodeId(v.rawTitle)
                                            const siblings = vaerker.filter(s =>
                                                s.id !== v.id &&
                                                stripEpisodeId(s.rawTitle) === baseTitle &&
                                                !(v.productionYear && s.productionYear && v.productionYear !== s.productionYear)
                                            )
                                            if (siblings.length === 0) return
                                            openBulkPopup(`Sæt alle ${siblings.length + 1} til "${VAERK_TYPE_LABELS[type]}"?`, () => {
                                                siblings.forEach(s => onUpdate(s.id, { vaerkType: type }))
                                                setBulkPopup(null)
                                            })
                                        }}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue placeholder="Vælg type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(Object.keys(VAERK_TYPE_LABELS) as VaerkType[]).map(t => (
                                                <SelectItem key={t} value={t} className="text-xs">
                                                    {VAERK_TYPE_LABELS[t]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TableCell>
                                <TableCell>
                                    <Switch
                                        checked={v.isGenudsendelse ?? false}
                                        onCheckedChange={val => onUpdate(v.id, { isGenudsendelse: val })}
                                    />
                                </TableCell>
                                <TableCell>
                                    {dfiLoading === v.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                    ) : v.dfiMatched === true ? (
                                        <span
                                            title={v.dfiData ? `${v.dfiData.title} (${v.dfiData.year}) — ${v.dfiData.category}` : "Fundet i Filmdatabasen"}
                                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 cursor-default"
                                        >
                                            DFI ✓
                                        </span>
                                    ) : v.dfiMatched === false ? (
                                        <span className="text-xs text-muted-foreground/40">—</span>
                                    ) : (
                                        <button
                                            onClick={() => handleDfi(v)}
                                            className="text-muted-foreground/50 hover:text-blue-600 transition-colors"
                                            title="Søg i Filmdatabasen"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1.5">
                                        <SortStatusBadge status={v.sortStatus} />
                                        {v.sortStatus === "approved" && v.sortedBy === "db" && (
                                            <span
                                                title="Automatisk godkendt — fundet i værksdatabasen"
                                                className="inline-flex items-center rounded px-1 py-0 text-[9px] font-medium tracking-wide bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400 cursor-help border border-green-200 dark:border-green-800"
                                            >
                                                db
                                            </span>
                                        )}
                                        {v.sortStatus === "rejected" && (() => {
                                            let label = ""
                                            let title = ""
                                            if (v.sortedBy === "filter") {
                                                const rule = currentRulesRef.current.find(r =>
                                                    matchesAnyRule(v.rawTitle, v.channel, [r])
                                                )
                                                label = "regel"
                                                title = rule ? `Filterregel: "${rule.name}" (${rule.value})` : "Filterregel"
                                            } else if (v.sortedBy === "ai") {
                                                const sug = aiSuggestions.get(v.id)
                                                label = "ai"
                                                title = sug?.reason ? `AI: ${sug.reason}` : "AI-vurdering"
                                            } else {
                                                return null
                                            }
                                            return (
                                                <span
                                                    title={title}
                                                    className="inline-flex items-center rounded px-1 py-0 text-[9px] font-medium tracking-wide bg-muted text-muted-foreground cursor-help border"
                                                >
                                                    {label}
                                                </span>
                                            )
                                        })()}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-green-600 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                                            onClick={() => approveWithMatches(v.id)}
                                            title="Godkend"
                                        >
                                            <Check className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={() => rejectWithMatches(v.id)}
                                            title="Afvis"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-amber-600 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                                            onClick={() => {
                                                setNoteEdit({
                                                    id: v.id,
                                                    value: v.notes ?? "",
                                                    rawTitle: v.rawTitle,
                                                    channel: v.channel,
                                                    productionYear: v.productionYear,
                                                    broadcastDate: v.broadcastDate,
                                                    duration: v.duration,
                                                })
                                                setAiSearch({ loading: false, result: null, error: null })
                                            }}
                                            title="Flag"
                                        >
                                            <Flag className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {filtered.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                                    Ingen resultater
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {filtered.length > PAGE_SIZE && (
                <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
                    <span>
                        Viser {(page * PAGE_SIZE + 1).toLocaleString("da-DK")}–{Math.min((page + 1) * PAGE_SIZE, filtered.length).toLocaleString("da-DK")} af {filtered.length.toLocaleString("da-DK")} rækker
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                        >
                            Forrige
                        </Button>
                        <span className="px-2 text-xs">Side {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1))}
                            disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                        >
                            Næste
                        </Button>
                    </div>
                </div>
            )}

            {/* Bulk-popup — vises ved musen */}
            {bulkPopup && (
                <div
                    data-bulk-popup
                    className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 flex flex-col gap-2 min-w-[220px]"
                    style={{ left: bulkPopup.x, top: bulkPopup.y }}
                >
                    <p className="text-sm font-medium leading-snug">{bulkPopup.label}</p>
                    <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setBulkPopup(null)}>
                            Nej
                        </Button>
                        <Button size="sm" className="h-7 text-xs" onClick={bulkPopup.onConfirm}>
                            Ja, sæt alle
                        </Button>
                    </div>
                </div>
            )}

            {/* Note/flag dialog */}
            <Dialog open={!!noteEdit} onOpenChange={() => setNoteEdit(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Flag værk</DialogTitle>
                        <DialogDescription className="truncate">{noteEdit?.rawTitle}</DialogDescription>
                    </DialogHeader>

                    {/* AI-søgning */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">AI-vurdering</span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1.5"
                                disabled={aiSearch.loading}
                                onClick={async () => {
                                    if (!noteEdit) return
                                    setAiSearch({ loading: true, result: null, error: null })
                                    try {
                                        const res = await fetch("/api/aftalelicens/ai-soeg", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                rawTitle: noteEdit.rawTitle,
                                                channel: noteEdit.channel,
                                                productionYear: noteEdit.productionYear,
                                                broadcastDate: noteEdit.broadcastDate,
                                                duration: noteEdit.duration,
                                                examples: getTrainingExamples(20),
                                                ...loadAiConfig("soeg"),
                                            }),
                                        })
                                        const json = await res.json()
                                        if (!res.ok) throw new Error(json.error ?? "Ukendt fejl")
                                        setAiSearch({ loading: false, result: json, error: null })
                                    } catch (e) {
                                        setAiSearch({ loading: false, result: null, error: (e as Error).message })
                                    }
                                }}
                            >
                                {aiSearch.loading
                                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Søger...</>
                                    : <><Search className="h-3 w-3" /> Søg med AI</>
                                }
                            </Button>
                        </div>

                        {aiSearch.error && (
                            <p className="text-xs text-destructive rounded bg-destructive/10 px-2 py-1.5">{aiSearch.error}</p>
                        )}

                        {aiSearch.result && (() => {
                            const r = aiSearch.result
                            const relevantColor = r.relevant === "ja"
                                ? "text-green-700 bg-green-50 border-green-200"
                                : r.relevant === "nej"
                                    ? "text-red-700 bg-red-50 border-red-200"
                                    : "text-amber-700 bg-amber-50 border-amber-200"
                            const relevantLabel = r.relevant === "ja" ? "Relevant" : r.relevant === "nej" ? "Ikke relevant" : "Usikker"
                            return (
                                <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
                                    <p className="text-sm leading-snug">{r.hvadErDette}</p>
                                    <div className="flex flex-wrap gap-1.5 items-center">
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${relevantColor}`}>
                                            {relevantLabel}
                                        </span>
                                        {r.vaerkType && r.vaerkType !== "ikke_relevant" && (
                                            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                                                {VAERK_TYPE_LABELS[r.vaerkType as VaerkType] ?? r.vaerkType}
                                            </span>
                                        )}
                                        <span className="text-xs text-muted-foreground ml-auto">Sikkerhed: {r.confidence}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{r.begrundelse}</p>
                                    <p className="text-xs italic text-muted-foreground/60">
                                        {r.kenderProgrammet
                                            ? "Baseret på specifik programviden — verificér navne og datoer ved tvivl."
                                            : "AI kender ikke dette specifikke program — vurdering baseret på metadata."}
                                    </p>
                                    <div className="flex gap-2 pt-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs flex-1 text-destructive border-destructive/40 hover:bg-destructive/10"
                                            onClick={() => {
                                                if (!noteEdit) return
                                                saveFeedback({
                                                    rawTitle: noteEdit.rawTitle,
                                                    channel: noteEdit.channel,
                                                    productionYear: noteEdit.productionYear,
                                                    duration: noteEdit.duration,
                                                    aiRelevant: r.relevant,
                                                    aiVaerkType: r.vaerkType,
                                                    userDecision: "rejected",
                                                    timestamp: new Date().toISOString(),
                                                })
                                                const id = noteEdit.id
                                                setNoteEdit(null)
                                                rejectWithMatches(id)
                                            }}
                                        >
                                            <X className="h-3 w-3 mr-1" /> Afvis
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="h-7 text-xs flex-1 bg-green-600 hover:bg-green-700 text-white"
                                            onClick={() => {
                                                if (!noteEdit) return
                                                saveFeedback({
                                                    rawTitle: noteEdit.rawTitle,
                                                    channel: noteEdit.channel,
                                                    productionYear: noteEdit.productionYear,
                                                    duration: noteEdit.duration,
                                                    aiRelevant: r.relevant,
                                                    aiVaerkType: r.vaerkType,
                                                    userDecision: "approved",
                                                    timestamp: new Date().toISOString(),
                                                })
                                                const id = noteEdit.id
                                                const vt = r.vaerkType as VaerkType | null ?? undefined
                                                setNoteEdit(null)
                                                approveWithMatches(id, vt)
                                            }}
                                        >
                                            <Check className="h-3 w-3 mr-1" /> Godkend
                                        </Button>
                                    </div>
                                </div>
                            )
                        })()}
                    </div>

                    <Separator />

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Note</Label>
                        <Input
                            value={noteEdit?.value ?? ""}
                            onChange={e => setNoteEdit(prev => prev ? { ...prev, value: e.target.value } : null)}
                            placeholder="Tilføj note om hvorfor dette er flagget..."
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNoteEdit(null)}>Annuller</Button>
                        <Button onClick={() => {
                            if (noteEdit) {
                                const id = noteEdit.id
                                const note = noteEdit.value
                                setNoteEdit(null)
                                flagWithMatches(id, note)
                                toast.success("Flagget")
                            }
                        }}>
                            <Flag className="mr-2 h-3.5 w-3.5" />
                            Flag
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Parring med værksdatabase ─────────────────────────────────

interface VaerkMatch {
    vaerkId: string          // AftalelicensVaerk.id
    rawTitle: string
    vaerkType?: VaerkType
    duration?: number
    season?: number
    episode?: number
    productionYear?: number
    matchedWorkId?: string   // Work.id fra DB
    matchedWorkTitle?: string
    matchScore: "auto" | "fuzzy" | "manual" | "none"
    fuzzyMatches?: FuzzyMatch[]   // Top-3 fuzzy forslag (kun ved matchScore === "none" eller "fuzzy")
    rettighedshavere: { userId?: string; name: string; roles: string[]; sharePercent: number }[]
    confirmed: boolean
    hasDuplicates?: boolean  // Flere værker med samme titel — kræver manuel valg
    newWorkCreated?: boolean // Oprettet som nyt værk i denne session
}

// Normalisér titel til sammenligning
function normalizeTitle(t: string) {
    return t.toLowerCase().replace(/[^a-zæøå0-9]/gi, " ").replace(/\s+/g, " ").trim()
}

// Byg et opslag: normaliseret titel → kontrakter der indeholder titlen
function buildContractIndex() {
    const idx = new Map<string, typeof mockContracts>()
    mockContracts.forEach(c => {
        const key = normalizeTitle(c.title)
        if (!idx.has(key)) idx.set(key, [])
        idx.get(key)!.push(c)
    })
    return idx
}

// Byg et opslag: normaliseret titel → Work[] (kan være flere ved duplikate titler)
function buildWorkIndex() {
    const idx = new Map<string, (typeof mockWorks[0])[]>()
    mockWorks.forEach(w => {
        const key = normalizeTitle(w.title)
        if (!idx.has(key)) idx.set(key, [])
        idx.get(key)!.push(w)
    })
    return idx
}

// Fuzzy word-overlap score: 0–1
function fuzzyScore(a: string, b: string): number {
    const wa = normalizeTitle(a).split(/\s+/).filter(w => w.length > 1)
    const wb = new Set(normalizeTitle(b).split(/\s+/).filter(w => w.length > 1))
    if (wa.length === 0 || wb.size === 0) return 0
    const overlap = wa.filter(w => wb.has(w)).length
    return overlap / Math.max(wa.length, wb.size)
}

// Find top-3 fuzzy matches for a title (threshold: 0.35)
function findFuzzyMatches(title: string, extraWorks: FuzzyWork[] = []): FuzzyMatch[] {
    const allWorks: FuzzyWork[] = [
        ...mockWorks.map(w => ({ id: w.id, title: w.title, category: w.category, productionYear: w.premiereYear })),
        ...extraWorks,
    ]
    return allWorks
        .map(w => ({ work: w, score: fuzzyScore(title, w.title) }))
        .filter(x => x.score >= 0.35)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
}

interface FuzzyWork { id: string; title: string; category?: string; productionYear?: number }
interface FuzzyMatch { work: FuzzyWork; score: number }

function autoMatch(vaerker: AftalelicensVaerk[]): VaerkMatch[] {
    const contractIdx = buildContractIndex()
    const workIdx = buildWorkIndex()

    return vaerker
        .filter(v => v.sortStatus === "approved")
        .map(v => {
            const key = normalizeTitle(v.rawTitle)
            const contracts = contractIdx.get(key) ?? []
            const works = workIdx.get(key) ?? []

            const equalShare = contracts.length > 0 ? Math.round(100 / contracts.length) : 100
            const rettighedshavere = contracts.map(c => ({
                userId: c.userId,
                name: c.userName ?? "Ukendt",
                roles: c.creditedRoles ?? [],
                sharePercent: equalShare,
            }))

            const identifiers = { season: v.season, episode: v.episode, productionYear: v.productionYear }

            // Duplikate titler — kræver manuel valg af det rigtige værk
            if (works.length > 1) {
                return {
                    vaerkId: v.id,
                    rawTitle: v.rawTitle,
                    vaerkType: v.vaerkType,
                    duration: v.duration,
                    ...identifiers,
                    matchedWorkId: undefined,
                    matchedWorkTitle: undefined,
                    matchScore: "none" as const,
                    hasDuplicates: true,
                    fuzzyMatches: works.map(w => ({ work: { id: w.id, title: w.title, category: w.category, productionYear: w.premiereYear }, score: 1 })),
                    rettighedshavere,
                    confirmed: false,
                }
            }

            // Eksakt match (unik)
            const work = works[0]
            if (contracts.length > 0 || work) {
                return {
                    vaerkId: v.id,
                    rawTitle: v.rawTitle,
                    vaerkType: v.vaerkType,
                    duration: v.duration,
                    ...identifiers,
                    matchedWorkId: work?.id,
                    matchedWorkTitle: work?.title,
                    matchScore: "auto" as const,
                    rettighedshavere,
                    // DB-matchede fra skridt 1 er allerede verificerede
                    confirmed: contracts.length > 0 || v.sortedBy === "db",
                }
            }

            // Ingen eksakt match — kør fuzzy
            const fuzzyMatches = findFuzzyMatches(v.rawTitle)
            return {
                vaerkId: v.id,
                rawTitle: v.rawTitle,
                vaerkType: v.vaerkType,
                duration: v.duration,
                season: v.season,
                episode: v.episode,
                productionYear: v.productionYear,
                matchedWorkId: undefined,
                matchedWorkTitle: undefined,
                matchScore: "none" as const,
                fuzzyMatches: fuzzyMatches.length > 0 ? fuzzyMatches : undefined,
                rettighedshavere: [],
                confirmed: false,
            }
        })
}

// ── Series/season grouping helpers ────────────────────────────

function stripSeriesId(title: string) {
    return title
        .replace(/\s*[Ss]\d+\s*[Ee]\d+/g, "")
        .replace(/\s*[Ss]æson\s*\d+/gi, "")
        .replace(/\s*[Aa]fsnit\s*\d+/gi, "")
        .replace(/\s*[-–]\s*\d+\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim()
}

function getSeasonFromTitle(title: string): number | null {
    const m = title.match(/\b[Ss](\d+)[Ee]\d+/) ?? title.match(/[Ss]æson\s*(\d+)/i)
    return m ? parseInt(m[1]) : null
}

interface MatchGroup {
    key: string
    baseTitle: string
    season?: number
    episodes: VaerkMatch[]
    matchedWorkId?: string
    matchedWorkTitle?: string
    matchScore: "auto" | "fuzzy" | "manual" | "none"
    fuzzyMatches?: FuzzyMatch[]
    rettighedshavere: VaerkMatch["rettighedshavere"]
    confirmed: boolean
    isGrouped: boolean
    vaerkType?: VaerkType
    newWorkCreated?: boolean
    hasDuplicates?: boolean
}

function buildGroups(matches: VaerkMatch[]): MatchGroup[] {
    const buckets = new Map<string, VaerkMatch[]>()
    for (const m of matches) {
        const season = m.season ?? getSeasonFromTitle(m.rawTitle)
        const key = season != null
            ? `${normalizeTitle(stripSeriesId(m.rawTitle))}:s${season}`
            : m.vaerkId
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key)!.push(m)
    }

    return Array.from(buckets.entries()).map(([key, episodes]) => {
        const first = episodes[0]
        const season = first.season ?? getSeasonFromTitle(first.rawTitle) ?? undefined
        const isGrouped = episodes.length > 1 || season != null
        const baseTitle = season != null ? (stripSeriesId(first.rawTitle) || first.rawTitle) : first.rawTitle

        const allWorkId = first.matchedWorkId
        const allSameWork = episodes.every(e => e.matchedWorkId === allWorkId)
        const matchedWorkId = allSameWork ? allWorkId : undefined
        const matchedWorkTitle = allSameWork ? first.matchedWorkTitle : undefined
        const matchScore: MatchGroup["matchScore"] = matchedWorkId ? first.matchScore : "none"
        const confirmed = episodes.every(e => e.confirmed)

        return {
            key,
            baseTitle,
            season,
            episodes,
            matchedWorkId,
            matchedWorkTitle,
            matchScore,
            fuzzyMatches: first.fuzzyMatches,
            rettighedshavere: first.rettighedshavere,
            confirmed,
            isGrouped,
            vaerkType: first.vaerkType,
            newWorkCreated: episodes.some(e => e.newWorkCreated),
            hasDuplicates: first.hasDuplicates,
        }
    })
}

function ParringTab({ vaerker, onConfirmed }: {
    vaerker: AftalelicensVaerk[]
    onConfirmed: (matches: VaerkMatch[]) => void
}) {
    const [extraWorks, setExtraWorks] = useState<FuzzyWork[]>([])
    const [matches, setMatches] = useState<VaerkMatch[]>(() => autoMatch(vaerker))
    const [searchDialog, setSearchDialog] = useState<string | null>(null)
    const [workSearch, setWorkSearch] = useState("")
    const [confirmed, setConfirmed] = useState(false)
    const [newWorkDialog, setNewWorkDialog] = useState<string | null>(null) // vaerkId
    const [newWorkTitle, setNewWorkTitle] = useState("")
    const [newWorkType, setNewWorkType] = useState<VaerkType>("dokumentarfilm")
    const [newWorkYear, setNewWorkYear] = useState(String(new Date().getFullYear()))
    const [bulkCreateDialog, setBulkCreateDialog] = useState(false)
    const [bulkEditItems, setBulkEditItems] = useState<{ vaerkId: string; title: string; vaerkType: VaerkType }[]>([])
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
    const [matchFilter, setMatchFilter] = useState<"alle" | "uden_match" | "dublikat" | "med_match">("alle")
    const [sortCol, setSortCol] = useState<"titel" | "type" | "match" | null>(null)
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

    const groups = useMemo(() => buildGroups(matches), [matches])

    const filteredGroups = useMemo(() => {
        let result = groups
        if (matchFilter === "uden_match") result = result.filter(g => g.matchScore === "none" && !g.newWorkCreated)
        else if (matchFilter === "dublikat") result = result.filter(g => !!g.hasDuplicates)
        else if (matchFilter === "med_match") result = result.filter(g => !!g.matchedWorkId || !!g.newWorkCreated)
        if (!sortCol) return result
        return [...result].sort((a, b) => {
            let cmp = 0
            if (sortCol === "titel") cmp = a.baseTitle.localeCompare(b.baseTitle, "da")
            if (sortCol === "type") cmp = (a.vaerkType ?? "").localeCompare(b.vaerkType ?? "")
            if (sortCol === "match") {
                const order: Record<string, number> = { auto: 0, fuzzy: 1, manual: 1, none: 2 }
                cmp = (order[a.matchScore] ?? 3) - (order[b.matchScore] ?? 3)
            }
            return sortDir === "asc" ? cmp : -cmp
        })
    }, [groups, matchFilter, sortCol, sortDir])

    const autoCount   = matches.filter(m => m.matchScore === "auto").length
    const fuzzyCount  = matches.filter(m => m.matchScore === "fuzzy").length
    const manualCount = matches.filter(m => m.matchScore === "manual").length
    const noneGroups  = groups.filter(g => g.matchScore === "none" && !g.newWorkCreated)
    const noneCount   = noneGroups.length
    const newCount    = matches.filter(m => m.newWorkCreated).length
    const allConfirmed = matches.every(m => m.confirmed)

    const workSearchResults = useMemo(() => {
        const all = [
            ...mockWorks,
            ...extraWorks.map(w => ({ id: w.id, title: w.title, category: w.category ?? "", editors: [], directors: [] })),
        ]
        if (!workSearch.trim()) return all
        const q = workSearch.toLowerCase()
        return all.filter(w => w.title.toLowerCase().includes(q))
    }, [workSearch, extraWorks])

    const linkFuzzy = (groupKey: string, fuzzyWork: FuzzyWork) => {
        const realWork = mockWorks.find(w => w.id === fuzzyWork.id)
        const contracts = realWork ? mockContracts.filter(c => normalizeTitle(c.title) === normalizeTitle(realWork.title)) : []
        const equalShare = contracts.length > 0 ? Math.round(100 / contracts.length) : 100
        const rettigheder = contracts.map(c => ({
            userId: c.userId,
            name: c.userName ?? "Ukendt",
            roles: c.creditedRoles ?? [],
            sharePercent: equalShare,
        }))
        const group = groups.find(g => g.key === groupKey)
        const vaerkIds = group?.episodes.map(e => e.vaerkId) ?? [groupKey]
        setMatches(prev => prev.map(m => vaerkIds.includes(m.vaerkId) ? {
            ...m,
            matchedWorkId: fuzzyWork.id,
            matchedWorkTitle: fuzzyWork.title,
            matchScore: "fuzzy" as const,
            rettighedshavere: rettigheder,
            confirmed: true,
        } : m))
        toast.success(`Fuzzy-parret med "${fuzzyWork.title}"`)
    }

    const handleBulkCreateWorks = () => {
        if (bulkEditItems.length === 0) return
        // bulkEditItems.vaerkId holds the group key
        const newWorks: (FuzzyWork & { groupKey: string })[] = bulkEditItems.map(item => ({
            id: `new_${item.vaerkId.replace(/[^a-z0-9]/gi, "_")}`,
            title: item.title.trim(),
            category: item.vaerkType,
            groupKey: item.vaerkId,
        }))
        setExtraWorks(prev => [...prev, ...newWorks])
        setMatches(prev => prev.map(m => {
            // Find which group this match belongs to
            const season = m.season ?? getSeasonFromTitle(m.rawTitle)
            const groupKey = season != null
                ? `${normalizeTitle(stripSeriesId(m.rawTitle))}:s${season}`
                : m.vaerkId
            const nw = newWorks.find(w => w.groupKey === groupKey)
            if (!nw) return m
            return { ...m, matchedWorkId: nw.id, matchedWorkTitle: nw.title, matchScore: "manual" as const, newWorkCreated: true, confirmed: true }
        }))
        setBulkCreateDialog(false)
        window.open("/admin/vaerker", "_blank")
        toast.success(`${bulkEditItems.length} nye værker klar — tilknyt klippere i Værksdatabasen`)
    }

    const getGroupVaerkIds = (groupKey: string) =>
        groups.find(g => g.key === groupKey)?.episodes.map(e => e.vaerkId) ?? [groupKey]

    const handleCreateWork = (groupKey: string) => {
        if (!newWorkTitle.trim()) return
        const newWork: FuzzyWork = {
            id: `new_${Date.now()}`,
            title: newWorkTitle.trim(),
            category: newWorkType,
        }
        setExtraWorks(prev => [...prev, newWork])
        const vaerkIds = getGroupVaerkIds(groupKey)
        setMatches(prev => prev.map(m => vaerkIds.includes(m.vaerkId) ? {
            ...m,
            matchedWorkId: newWork.id,
            matchedWorkTitle: newWork.title,
            matchScore: "manual" as const,
            newWorkCreated: true,
            confirmed: true,
        } : m))
        setNewWorkDialog(null)
        setNewWorkTitle("")
        window.open("/admin/vaerker", "_blank")
        toast.success(`"${newWorkTitle.trim()}" klar — tilknyt klippere i Værksdatabasen`)
    }

    const linkWork = (groupKey: string, work: { id: string; title: string }) => {
        const contracts = mockContracts.filter(c => normalizeTitle(c.title) === normalizeTitle(work.title))
        const equalShare = contracts.length > 0 ? Math.round(100 / contracts.length) : 100
        const rettigheder = contracts.map(c => ({
            userId: c.userId,
            name: c.userName ?? "Ukendt",
            roles: c.creditedRoles ?? [],
            sharePercent: equalShare,
        }))
        const vaerkIds = getGroupVaerkIds(groupKey)
        setMatches(prev => prev.map(m => vaerkIds.includes(m.vaerkId) ? {
            ...m,
            matchedWorkId: work.id,
            matchedWorkTitle: work.title,
            matchScore: "manual",
            rettighedshavere: rettigheder,
            confirmed: true,
        } : m))
        setSearchDialog(null)
        setWorkSearch("")
        toast.success(`Parret med "${work.title}"`)
    }

    const unlinkWork = (groupKey: string) => {
        const vaerkIds = getGroupVaerkIds(groupKey)
        setMatches(prev => prev.map(m => vaerkIds.includes(m.vaerkId) ? {
            ...m,
            matchedWorkId: undefined,
            matchedWorkTitle: undefined,
            matchScore: "none",
            rettighedshavere: [],
            confirmed: false,
        } : m))
    }

    const toggleConfirm = (groupKey: string) => {
        const vaerkIds = getGroupVaerkIds(groupKey)
        const group = groups.find(g => g.key === groupKey)
        const allConfirmedNow = group?.confirmed ?? false
        setMatches(prev => prev.map(m => vaerkIds.includes(m.vaerkId) ? { ...m, confirmed: !allConfirmedNow } : m))
    }


    if (vaerker.filter(v => v.sortStatus === "approved").length === 0) {
        return (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                Ingen godkendte titler at parre endnu
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border p-3 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-950/50 flex items-center justify-center shrink-0">
                        <Link2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                        <p className="text-xl font-semibold">{autoCount}</p>
                        <p className="text-xs text-muted-foreground">Eksakt match</p>
                    </div>
                </div>
                <div className="rounded-lg border p-3 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center shrink-0">
                        <Search className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                        <p className="text-xl font-semibold">{fuzzyCount + manualCount}</p>
                        <p className="text-xs text-muted-foreground">Fuzzy / manuelt parret</p>
                    </div>
                </div>
                <div className="rounded-lg border p-3 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center shrink-0">
                        <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <p className="text-xl font-semibold">{newCount}</p>
                        <p className="text-xs text-muted-foreground">Ny oprettet i DB</p>
                    </div>
                </div>
                <div className="rounded-lg border p-3 flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${noneCount > 0 ? "bg-amber-100 dark:bg-amber-950/50" : "bg-muted"}`}>
                        <Link2Off className={`h-4 w-4 ${noneCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                        <p className="text-xl font-semibold">{noneCount}</p>
                        <p className="text-xs text-muted-foreground">Afventer parring</p>
                    </div>
                </div>
            </div>

            {/* Filter toolbar */}
            {(() => {
                const filters: { key: typeof matchFilter; label: string; count: number }[] = [
                    { key: "alle",       label: "Alle",         count: groups.length },
                    { key: "med_match",  label: "Med match",    count: groups.filter(g => !!g.matchedWorkId || !!g.newWorkCreated).length },
                    { key: "uden_match", label: "Uden match",   count: groups.filter(g => g.matchScore === "none" && !g.newWorkCreated).length },
                    { key: "dublikat",   label: "Dublikat",     count: groups.filter(g => !!g.hasDuplicates).length },
                ]
                return (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {filters.map(f => (
                            <button
                                key={f.key}
                                onClick={() => setMatchFilter(f.key)}
                                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border ${
                                    matchFilter === f.key
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-background hover:bg-muted border-input"
                                }`}
                            >
                                {f.label}
                                <span className={`rounded-full px-1.5 py-0 text-[10px] font-semibold ${matchFilter === f.key ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"}`}>
                                    {f.count}
                                </span>
                            </button>
                        ))}
                    </div>
                )
            })()}

            {/* Match table */}
            <div className="rounded-lg border overflow-x-auto">
                <Table>
                    <TableHeader>
                        {(() => {
                            const toggleSort = (col: typeof sortCol) => {
                                if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
                                else { setSortCol(col); setSortDir("asc") }
                            }
                            const SortIcon = ({ col }: { col: typeof sortCol }) =>
                                sortCol === col
                                    ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />)
                                    : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
                            return (
                                <TableRow>
                                    <TableHead>
                                        <button onClick={() => toggleSort("titel")} className="flex items-center gap-1 hover:text-foreground">
                                            Titel (batch) <SortIcon col="titel" />
                                        </button>
                                    </TableHead>
                                    <TableHead>
                                        <button onClick={() => toggleSort("type")} className="flex items-center gap-1 hover:text-foreground">
                                            Type <SortIcon col="type" />
                                        </button>
                                    </TableHead>
                                    <TableHead>Matchet værk</TableHead>
                                    <TableHead>Rettighedshavere</TableHead>
                                    <TableHead className="w-[100px]">
                                        <button onClick={() => toggleSort("match")} className="flex items-center gap-1 hover:text-foreground">
                                            Match <SortIcon col="match" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="w-[120px]" />
                                </TableRow>
                            )
                        })()}
                    </TableHeader>
                    <TableBody>
                        {filteredGroups.map(g => {
                            const isExpanded = expandedGroups.has(g.key)
                            const toggleExpand = () => setExpandedGroups(prev => {
                                const next = new Set(prev)
                                if (next.has(g.key)) next.delete(g.key); else next.add(g.key)
                                return next
                            })
                            return (
                                <React.Fragment key={g.key}>
                                <TableRow className={g.confirmed ? "" : "bg-amber-50/40 dark:bg-amber-950/10"}>
                                    <TableCell>
                                        {g.isGrouped ? (
                                            <div className="flex items-start gap-1.5">
                                                <button
                                                    onClick={toggleExpand}
                                                    className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                                    title={isExpanded ? "Skjul afsnit" : "Vis afsnit"}
                                                >
                                                    <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                                                </button>
                                                <div>
                                                    <p className="text-sm font-medium">{g.baseTitle}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {g.season != null && `Sæson ${g.season} · `}
                                                        {g.episodes.length} afsnit
                                                        {g.episodes[0]?.productionYear != null && ` · ${g.episodes[0].productionYear}`}
                                                    </p>
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-sm font-medium">{g.baseTitle}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {g.episodes[0]?.duration ? `${g.episodes[0].duration} min` : ""}
                                                    {g.episodes[0]?.productionYear != null && ` · ${g.episodes[0].productionYear}`}
                                                </p>
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {g.vaerkType ? VAERK_TYPE_LABELS[g.vaerkType] : "—"}
                                    </TableCell>
                                    <TableCell>
                                        {g.matchedWorkTitle ? (
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-sm">{g.matchedWorkTitle}</span>
                                                {g.newWorkCreated && (
                                                    <Badge variant="outline" className="text-[10px] py-0 text-blue-600 border-blue-300">ny</Badge>
                                                )}
                                                <button
                                                    onClick={() => unlinkWork(g.key)}
                                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                                    title="Fjern parring"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ) : g.fuzzyMatches && g.fuzzyMatches.length > 0 ? (
                                            <div className="space-y-1">
                                                {g.fuzzyMatches.map((fm, i) => (
                                                    <div key={i} className="flex items-center gap-1.5">
                                                        <button
                                                            className="text-xs text-left hover:text-primary transition-colors flex items-center gap-1"
                                                            onClick={() => linkFuzzy(g.key, fm.work)}
                                                            title="Klik for at parre med dette værk"
                                                        >
                                                            <span className={i === 0 ? "font-medium" : "text-muted-foreground"}>{fm.work.title}</span>
                                                            {fm.work.productionYear != null && (
                                                                <span className="text-[10px] text-muted-foreground">({fm.work.productionYear})</span>
                                                            )}
                                                            {fm.score < 1 && (
                                                                <span className="text-[10px] font-mono rounded px-1 bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                                                                    {Math.round(fm.score * 100)}%
                                                                </span>
                                                            )}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground italic">Ikke matchet</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {g.rettighedshavere.length > 0 ? (
                                            <div className="space-y-0.5">
                                                {g.rettighedshavere.map((r, i) => (
                                                    <div key={i} className="flex items-baseline gap-1.5 text-xs">
                                                        <span className="font-medium">{r.name}</span>
                                                        {r.roles.length > 0 && (
                                                            <span className="text-muted-foreground">({r.roles.join(", ")})</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : g.matchedWorkId ? (
                                            <span className="text-xs text-amber-600 dark:text-amber-400 italic">Ingen klippere i DB</span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {g.hasDuplicates ? (
                                            <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-700 dark:text-amber-400">
                                                <AlertTriangle className="h-3 w-3" />
                                                Duplikat
                                            </Badge>
                                        ) : (
                                            <Badge
                                                variant={g.matchScore === "auto" ? "default" : g.matchScore === "fuzzy" ? "secondary" : g.matchScore === "manual" ? "secondary" : "outline"}
                                                className={`text-xs gap-1 ${g.matchScore === "fuzzy" ? "border-violet-300 text-violet-700 dark:text-violet-300" : ""}`}
                                            >
                                                {g.matchScore === "auto" && <Link2 className="h-3 w-3" />}
                                                {g.matchScore === "fuzzy" && <Search className="h-3 w-3" />}
                                                {g.matchScore === "manual" && <Database className="h-3 w-3" />}
                                                {g.matchScore === "none" && <Link2Off className="h-3 w-3" />}
                                                {g.matchScore === "auto" ? "Auto" : g.matchScore === "fuzzy" ? "Fuzzy" : g.matchScore === "manual" ? "Manuelt" : "Ingen match"}
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1 flex-wrap">
                                            {!g.matchedWorkId && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-xs gap-1"
                                                    onClick={() => { setSearchDialog(g.key); setWorkSearch("") }}
                                                >
                                                    <Search className="h-3 w-3" />
                                                    Søg i DB
                                                </Button>
                                            )}
                                            {!g.matchedWorkId && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
                                                    onClick={() => {
                                                        setNewWorkDialog(g.key)
                                                        setNewWorkTitle(g.baseTitle + (g.season != null ? ` Sæson ${g.season}` : ""))
                                                        setNewWorkType(g.vaerkType ?? "dokumentarfilm")
                                                    }}
                                                >
                                                    <Plus className="h-3 w-3" />
                                                    Opret nyt
                                                </Button>
                                            )}
                                            {!g.matchedWorkId && !g.confirmed && !g.fuzzyMatches && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 text-xs gap-1 text-muted-foreground"
                                                    onClick={() => toggleConfirm(g.key)}
                                                >
                                                    <Check className="h-3 w-3" />
                                                    Ingen match
                                                </Button>
                                            )}
                                            {!g.matchedWorkId && g.confirmed && (
                                                <Badge variant="outline" className="text-xs gap-1 h-7 px-2">
                                                    <Check className="h-3 w-3 text-muted-foreground" />
                                                    Bekræftet ingen match
                                                </Badge>
                                            )}
                                            {g.matchedWorkId && (
                                                <Button
                                                    variant={g.confirmed ? "default" : "outline"}
                                                    size="sm"
                                                    className="h-7 text-xs gap-1"
                                                    onClick={() => toggleConfirm(g.key)}
                                                >
                                                    <Check className="h-3 w-3" />
                                                    {g.confirmed ? "Bekræftet" : "Bekræft"}
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                                {/* Episode sub-rows for series groups */}
                                {g.isGrouped && isExpanded && g.episodes.map(ep => {
                                    const epLabel = ep.rawTitle.match(/[Ss]\d+[Ee]\d+/)?.[0]
                                        ?? (ep.episode != null ? `E${ep.episode}` : ep.rawTitle)
                                    return (
                                        <TableRow key={ep.vaerkId} className="bg-muted/20 dark:bg-muted/10">
                                            <TableCell className="pl-9 py-2">
                                                <p className="text-xs text-muted-foreground">
                                                    ↳ <span className="font-mono">{epLabel}</span>
                                                    {ep.duration ? ` · ${ep.duration} min` : ""}
                                                </p>
                                            </TableCell>
                                            <TableCell colSpan={5} />
                                        </TableRow>
                                    )
                                })}
                                </React.Fragment>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>

            {noneCount > 0 && !confirmed && (
                <div className="flex items-center justify-between rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
                        <Link2Off className="h-4 w-4 shrink-0" />
                        <span><span className="font-semibold">{noneCount}</span> {noneCount === 1 ? "titel mangler" : "titler mangler"} match i databasen</span>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 gap-1.5"
                        onClick={() => {
                            setBulkEditItems(noneGroups.map(g => ({
                                vaerkId: g.key,
                                title: g.baseTitle + (g.season != null ? ` Sæson ${g.season}` : ""),
                                vaerkType: g.vaerkType ?? "dokumentarfilm",
                            })))
                            setBulkCreateDialog(true)
                        }}
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Opret alle {noneCount} i DB
                    </Button>
                </div>
            )}

            {allConfirmed && matches.length > 0 && !confirmed && (
                <div className="flex items-center justify-between rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                        <Check className="h-4 w-4" />
                        Alle titler er parret og bekræftet — klar til beregning
                    </div>
                    <Button size="sm" onClick={() => { setConfirmed(true); onConfirmed(matches); toast.success("Parring låst") }}>
                        <Lock className="mr-2 h-3.5 w-3.5" />
                        Lås parring
                    </Button>
                </div>
            )}

            {confirmed && (
                <div className="flex items-center justify-between rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                        <Lock className="h-4 w-4" />
                        Parring låst — fortsæt til Vægtning og beregning
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 gap-1"
                        onClick={() => setConfirmed(false)}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                        Ret parring
                    </Button>
                </div>
            )}

            {/* Bulk opret i DB dialog */}
            <Dialog open={bulkCreateDialog} onOpenChange={setBulkCreateDialog}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Opret {bulkEditItems.length} nye værker i databasen</DialogTitle>
                        <DialogDescription>
                            Ret titel og værktype inden oprettelse. Klippere og fordelingsnøgler tilknyttes i Værksdatabasen efterfølgende.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-lg border divide-y max-h-96 overflow-y-auto">
                        <div className="grid grid-cols-[1fr_180px] gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/40">
                            <span>Titel</span>
                            <span>Værktype</span>
                        </div>
                        {bulkEditItems.map((item, idx) => (
                            <div key={item.vaerkId} className="grid grid-cols-[1fr_180px] gap-2 px-3 py-2 items-center">
                                <Input
                                    value={item.title}
                                    onChange={e => setBulkEditItems(prev => prev.map((it, i) => i === idx ? { ...it, title: e.target.value } : it))}
                                    className="h-7 text-sm"
                                />
                                <Select
                                    value={item.vaerkType}
                                    onValueChange={v => setBulkEditItems(prev => prev.map((it, i) => i === idx ? { ...it, vaerkType: v as VaerkType } : it))}
                                >
                                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(VAERK_TYPE_LABELS) as VaerkType[]).map(t => (
                                            <SelectItem key={t} value={t} className="text-xs">{VAERK_TYPE_LABELS[t]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkCreateDialog(false)}>Annuller</Button>
                        <Button onClick={handleBulkCreateWorks} disabled={bulkEditItems.some(it => !it.title.trim())}>
                            <Plus className="mr-2 h-3.5 w-3.5" />
                            Opret {bulkEditItems.length} værker i DB
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Manual search dialog */}
            <Dialog open={!!searchDialog} onOpenChange={() => { setSearchDialog(null); setWorkSearch("") }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Par med værk i databasen</DialogTitle>
                        <DialogDescription>
                            Søg på titel for at finde det tilsvarende værk
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={workSearch}
                                onChange={e => setWorkSearch(e.target.value)}
                                placeholder="Søg på titel..."
                                className="pl-9"
                                autoFocus
                            />
                        </div>
                        <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
                            {workSearchResults.length === 0 ? (
                                <div className="px-4 py-6 text-center text-sm text-muted-foreground">Ingen resultater</div>
                            ) : workSearchResults.map(work => {
                                const contracts = mockContracts.filter(c => normalizeTitle(c.title) === normalizeTitle(work.title))
                                return (
                                    <button
                                        key={work.id}
                                        className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                                        onClick={() => searchDialog && linkWork(searchDialog, work)}
                                    >
                                        <p className="text-sm font-medium">{work.title}</p>
                                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                            {"premiereYear" in work && <span>{(work as { premiereYear?: number }).premiereYear}</span>}
                                            {contracts.length > 0 && (
                                                <span>· {contracts.map(c => c.userName).join(", ")}</span>
                                            )}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setSearchDialog(null); setWorkSearch("") }}>Luk</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Opret nyt værk dialog */}
            <Dialog open={!!newWorkDialog} onOpenChange={() => setNewWorkDialog(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Opret nyt værk i databasen</DialogTitle>
                        <DialogDescription>
                            Opretter værket i Værksdatabasen. Klippere og fordelingsnøgle tilknyttes dér efterfølgende.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Titel</Label>
                            <Input
                                value={newWorkTitle}
                                onChange={e => setNewWorkTitle(e.target.value)}
                                placeholder="Titel på værket..."
                                autoFocus
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Værktype</Label>
                                <Select value={newWorkType} onValueChange={v => setNewWorkType(v as VaerkType)}>
                                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(VAERK_TYPE_LABELS) as VaerkType[]).map(t => (
                                            <SelectItem key={t} value={t} className="text-xs">{VAERK_TYPE_LABELS[t]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Produktionsår</Label>
                                <Input
                                    type="number"
                                    value={newWorkYear}
                                    onChange={e => setNewWorkYear(e.target.value)}
                                    min="1900"
                                    max={new Date().getFullYear()}
                                />
                            </div>
                        </div>
                        <div className="rounded bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                            Værket oprettes lokalt i denne session. I produktion vil det blive gemt i DFKS-værksdatabasen via API.
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNewWorkDialog(null)}>Annuller</Button>
                        <Button onClick={() => newWorkDialog && handleCreateWork(newWorkDialog)} disabled={!newWorkTitle.trim()}>
                            <Plus className="mr-2 h-3.5 w-3.5" />
                            Opret i DB og par
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Klipperkrav ───────────────────────────────────────────────

interface KlipperKrav {
    id: string
    klipperName: string
    klipperUserId?: string
    titleId: string
    rawTitle: string
    channel?: string
    broadcastDate?: string
    note?: string
    fileName?: string
    submittedAt: string
    status: "pending" | "approved" | "rejected"
}

const MOCK_KRAV: KlipperKrav[] = [
    {
        id: "krav1",
        klipperName: "Thomas Bergmann",
        titleId: "vaerk_1",
        rawTitle: "Borgen",
        channel: "DR1",
        broadcastDate: "2023-01-01",
        note: "Klippet afsnit 3 og 4, sæson 4",
        fileName: "kontrakt-borgen-bergmann.pdf",
        submittedAt: "2024-03-18T09:14:00",
        status: "pending",
    },
    {
        id: "krav2",
        klipperName: "Lise Nørgaard",
        titleId: "vaerk_2",
        rawTitle: "Kærlighed for voksne",
        channel: "DR2",
        broadcastDate: "2023-02-04",
        note: "Ansvarlig klipper på hele filmen",
        fileName: "kontrakt-kaerlighed-norgaard.pdf",
        submittedAt: "2024-03-19T11:30:00",
        status: "pending",
    },
    {
        id: "krav3",
        klipperName: "Mads Eriksen",
        klipperUserId: "u1",
        titleId: "vaerk_11",
        rawTitle: "Broen IV",
        channel: "DR1",
        broadcastDate: "2023-09-25",
        submittedAt: "2024-03-20T08:00:00",
        status: "approved",
    },
]

function ClaimsTab({ batchId, batchStatus }: { batchId: string; batchStatus: string }) {
    const [krav, setKrav] = useState<KlipperKrav[]>(MOCK_KRAV)
    const [rejectDialog, setRejectDialog] = useState<string | null>(null)
    const [rejectNote, setRejectNote] = useState("")

    const pending = krav.filter(k => k.status === "pending")
    const handled = krav.filter(k => k.status !== "pending")

    const approve = (id: string) => {
        setKrav(prev => prev.map(k => k.id === id ? { ...k, status: "approved" } : k))
        toast.success("Krav godkendt — klipper tilknyttet")
    }

    const reject = (id: string) => {
        setKrav(prev => prev.map(k => k.id === id ? { ...k, status: "rejected" } : k))
        setRejectDialog(null)
        setRejectNote("")
        toast.success("Krav afvist")
    }

    const KravRow = ({ k }: { k: KlipperKrav }) => (
        <div className="p-4 flex items-start gap-4">
            <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{k.klipperName}</span>
                    {k.klipperUserId && (
                        <Badge variant="outline" className="text-[10px] py-0">Portal-bruger</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                        → <strong>{k.rawTitle}</strong>
                        {k.channel && ` · ${k.channel}`}
                        {k.broadcastDate && ` · ${new Date(k.broadcastDate).toLocaleDateString("da-DK")}`}
                    </span>
                </div>
                {k.note && (
                    <p className="text-xs text-muted-foreground italic">&ldquo;{k.note}&rdquo;</p>
                )}
                {k.fileName && (
                    <div className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                        <FileText className="h-3 w-3" />
                        {k.fileName}
                    </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                    Indsendt {new Date(k.submittedAt).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })}
                </p>
            </div>
            <div className="shrink-0">
                {k.status === "pending" ? (
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            className="gap-1 h-8"
                            onClick={() => approve(k.id)}
                        >
                            <Check className="h-3.5 w-3.5" />
                            Godkend
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-8 text-destructive hover:text-destructive"
                            onClick={() => { setRejectDialog(k.id); setRejectNote("") }}
                        >
                            <X className="h-3.5 w-3.5" />
                            Afvis
                        </Button>
                    </div>
                ) : (
                    <Badge
                        variant={k.status === "approved" ? "default" : "destructive"}
                        className="gap-1 text-xs"
                    >
                        {k.status === "approved" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {k.status === "approved" ? "Godkendt" : "Afvist"}
                    </Badge>
                )}
            </div>
        </div>
    )

    const isCompleted = batchStatus === "completed"

    return (
        <div className="space-y-4">
            {isCompleted && pending.length > 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 px-4 py-3 text-sm text-orange-800 dark:text-orange-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                        <p className="font-medium">Efteranmeldelse — beregning allerede kørt</p>
                        <p className="text-xs leading-relaxed">
                            Der er indkommet {pending.length} krav efter at beregningen er låst og udbetalt. Godkendte krav vil kræve en korrektionsudbetaling.
                        </p>
                    </div>
                </div>
            )}
            <p className="text-sm text-muted-foreground">
                Klippere kan markere titler de mener at have kreditering på. Validér kravene herunder og godkend for at tilknytte klipperen til den pågældende titel.
            </p>

            {pending.length === 0 && handled.length === 0 && (
                <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                    Ingen krav modtaget endnu
                </div>
            )}

            {pending.length > 0 && (
                <div className="rounded-lg border">
                    <div className="flex items-center gap-2 px-4 py-3 border-b bg-amber-50 dark:bg-amber-950/20">
                        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                            Afventer behandling ({pending.length})
                        </span>
                    </div>
                    <div className="divide-y">
                        {pending.map(k => <KravRow key={k.id} k={k} />)}
                    </div>
                </div>
            )}

            {handled.length > 0 && (
                <div className="rounded-lg border">
                    <div className="px-4 py-3 border-b">
                        <span className="text-sm font-medium text-muted-foreground">Behandlede ({handled.length})</span>
                    </div>
                    <div className="divide-y">
                        {handled.map(k => <KravRow key={k.id} k={k} />)}
                    </div>
                </div>
            )}

            {/* Reject dialog */}
            <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Afvis krav</DialogTitle>
                        <DialogDescription>Tilføj en begrundelse der sendes til klipperen (valgfrit).</DialogDescription>
                    </DialogHeader>
                    <Textarea
                        value={rejectNote}
                        onChange={e => setRejectNote(e.target.value)}
                        placeholder="Begrundelse..."
                        rows={3}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRejectDialog(null)}>Annuller</Button>
                        <Button variant="destructive" onClick={() => rejectDialog && reject(rejectDialog)}>
                            Afvis krav
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Weighting & proof calculation ─────────────────────────────

type WeightedItem = AftalelicensVaegtet & { tierLabel?: string; base?: number; broadcastDate?: string }

interface WeightGroup {
    key: string
    baseTitle: string
    season?: number
    items: WeightedItem[]
    isGrouped: boolean
    vaerkType: VaerkType
    totalDuration: number
    totalPoints: number
    totalShare: number
    totalEstimated?: number
    base?: number
    tierLabel?: string
}

function buildWeightGroups(weighted: WeightedItem[]): WeightGroup[] {
    const buckets = new Map<string, WeightedItem[]>()
    for (const w of weighted) {
        const season = getSeasonFromTitle(w.rawTitle)
        const key = season != null
            ? `${normalizeTitle(stripSeriesId(w.rawTitle))}:s${season}`
            : w.vaerkId
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key)!.push(w)
    }

    return Array.from(buckets.entries()).map(([key, items]) => {
        const first = items[0]
        const season = getSeasonFromTitle(first.rawTitle) ?? undefined
        const isGrouped = items.length > 1 || season != null
        const baseTitle = season != null ? (stripSeriesId(first.rawTitle) || first.rawTitle) : first.rawTitle
        const hasEstimated = first.estimatedAmount !== undefined

        return {
            key,
            baseTitle,
            season,
            items,
            isGrouped,
            vaerkType: first.vaerkType,
            totalDuration: items.reduce((s, i) => s + i.duration, 0),
            totalPoints: items.reduce((s, i) => s + i.points, 0),
            totalShare: items.reduce((s, i) => s + i.shareOfTotal, 0),
            totalEstimated: hasEstimated ? items.reduce((s, i) => s + (i.estimatedAmount ?? 0), 0) : undefined,
            base: first.base,
            tierLabel: first.tierLabel,
        }
    })
}

const DEFAULT_VAEGTE: Record<VaerkType, number> = {
    spillefilm:      200,
    tv_serie_lang:   100,
    tv_serie_kort:   50,
    kortfilm:        150,
    dokumentarfilm:  200,  // overridden by dok-tier logic
    dokumentarserie: 100,
    dokuDrama:       200,
    kort_dokumentar: 100,
    ikke_relevant:   0,
}

const DEFAULT_VAEGT_EXTRA: AftalelicensVaegtExtra = {
    dokLangPoints:   200,
    dokMellemPoints: 150,
    dokKortPoints:   100,
    dokLangMin:      61,
    dokMellemMin:    21,
    dokSerieLangMin: 38,
    dokSerieKortPoints: 50,
    supplerendeKlipFaktor: 0.3,
    genudsendelseFaktor: 0.5,
    genudsendelseMaaneder: 1,
}

function loadVaegte(): Record<VaerkType, number> {
    if (typeof window === "undefined") return DEFAULT_VAEGTE
    try {
        const stored = localStorage.getItem("dfks_vaerkvaegte")
        if (!stored) return DEFAULT_VAEGTE
        const arr: { type: VaerkType; weight: number }[] = JSON.parse(stored)
        const map = { ...DEFAULT_VAEGTE }
        arr.forEach(v => { map[v.type] = v.weight })
        return map
    } catch { return DEFAULT_VAEGTE }
}

function loadVaegtExtra(): AftalelicensVaegtExtra {
    if (typeof window === "undefined") return DEFAULT_VAEGT_EXTRA
    try {
        const stored = localStorage.getItem("dfks_vaegt_extra")
        return stored ? { ...DEFAULT_VAEGT_EXTRA, ...JSON.parse(stored) } : DEFAULT_VAEGT_EXTRA
    } catch { return DEFAULT_VAEGT_EXTRA }
}

// Beregn point for et enkelt værk: base_point × minutter
// For dokumentarfilm afgør varighed base-point-niveauet (tier), minutter multipliceres herefter
function beregnPoints(vaerkType: VaerkType, duration: number | undefined, vaegte: Record<VaerkType, number>, extra: AftalelicensVaegtExtra): { points: number; base: number; tierLabel?: string } {
    const min = duration ?? 0
    if (vaerkType === "dokumentarfilm") {
        let base: number
        let tierLabel: string
        if (min >= extra.dokLangMin)        { base = extra.dokLangPoints;   tierLabel = `≥${extra.dokLangMin} min` }
        else if (min >= extra.dokMellemMin) { base = extra.dokMellemPoints; tierLabel = `${extra.dokMellemMin}–${extra.dokLangMin} min` }
        else                               { base = extra.dokKortPoints;   tierLabel = `<${extra.dokMellemMin} min` }
        return { points: base * min, base, tierLabel }
    }
    if (vaerkType === "dokumentarserie") {
        const base = min >= extra.dokSerieLangMin ? vaegte["dokumentarserie"] : extra.dokSerieKortPoints
        const tierLabel = min >= extra.dokSerieLangMin
            ? `≥${extra.dokSerieLangMin} min`
            : `<${extra.dokSerieLangMin} min`
        return { points: base * min, base, tierLabel }
    }
    const base = vaegte[vaerkType]
    return { points: base * min, base }
}

function WeightingTab({ vaerker, confirmedMatches, batchLabel }: {
    vaerker: AftalelicensVaerk[]
    confirmedMatches: VaerkMatch[]
    batchLabel: string
}) {
    const approved = vaerker.filter(v => v.sortStatus === "approved" && v.vaerkType)
    const vaegte = loadVaegte()
    const extra = loadVaegtExtra()

    const [weighted, setWeighted] = useState<WeightedItem[] | null>(null)
    const [expandedWeightGroups, setExpandedWeightGroups] = useState<Set<string>>(new Set())
    const weightGroups = useMemo(() => weighted ? buildWeightGroups(weighted) : [], [weighted])
    const [klumpBeloeb, setKlumpBeloeb] = useState("1000000")
    const [adminPct, setAdminPct] = useState("15")
    const [hensaettelserPct, setHensaettelserPct] = useState("10")
    const [socialPct, setSocialPct] = useState("0")
    const [locked, setLocked] = useState(false)
    const [dbTransfer, setDbTransfer] = useState<{ workId?: string; workTitle: string; vaerkType: VaerkType; totalPoints?: number; totalAmount: number; adminFeeAmount?: number; klippere?: { name: string; userId?: string; sharePercent: number; amount: number }[]; episodes?: { episodeLabel: string; broadcastDate?: string; isGenudsendelse: boolean; points: number; amount: number; klippere?: { name: string; userId?: string; sharePercent: number; amount: number }[] }[] }[] | null>(null)

    // Load stamdata defaults from localStorage
    useEffect(() => {
        try {
            const h = localStorage.getItem("dfks_hensaettelser_pct")
            if (h !== null) setHensaettelserPct(h)
            const s = localStorage.getItem("dfks_sociale_pct")
            if (s !== null) setSocialPct(s)
        } catch { /* ignore */ }
    }, [])
    const [hensaettelsesKonto, setHensaettelsesKonto] = useState<{ id: string; batchLabel: string; amount: number; lockedAt: string; brugt: number }[]>(() => {
        if (typeof window === "undefined") return []
        try { return JSON.parse(localStorage.getItem("dfks_hensaettelser") ?? "[]") } catch { return [] }
    })

    const handleBeregn = () => {
        const items: WeightedItem[] = approved.map(v => {
            const { points, base, tierLabel } = beregnPoints(v.vaerkType!, v.duration, vaegte, extra)
            return {
                vaerkId: v.id,
                rawTitle: v.rawTitle,
                vaerkType: v.vaerkType!,
                duration: v.duration ?? 0,
                viewCount: v.viewCount,
                isGenudsendelse: false, // beregnes nedenfor
                points,
                shareOfTotal: 0,
                tierLabel,
                base,
                broadcastDate: v.broadcastDate,
            }
        })

        // Detektér genudsendelser ud fra stamdata-indstillinger:
        // samme titel genudsendt inden for genudsendelseMaaneder måneder af seneste premiere = genudsendelse
        const monthDiff = (a: string, b: string) => {
            const da = new Date(a), db = new Date(b)
            return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth())
        }
        const byTitle = new Map<string, WeightedItem[]>()
        for (const item of items) {
            const key = normalizeTitle(item.rawTitle)
            if (!byTitle.has(key)) byTitle.set(key, [])
            byTitle.get(key)!.push(item)
        }
        for (const group of byTitle.values()) {
            if (group.length <= 1) continue
            group.sort((a, b) => (a.broadcastDate ?? "").localeCompare(b.broadcastDate ?? ""))
            let refDate = group[0].broadcastDate ?? ""
            group.forEach((item, idx) => {
                if (idx === 0) return
                const diff = refDate ? monthDiff(refDate, item.broadcastDate ?? refDate) : 0
                if (diff < extra.genudsendelseMaaneder) {
                    item.isGenudsendelse = true
                    item.points = Math.round(item.points * extra.genudsendelseFaktor)
                } else {
                    refDate = item.broadcastDate ?? refDate
                }
            })
        }

        const totalPoints = items.reduce((s, i) => s + i.points, 0)
        items.forEach(i => { i.shareOfTotal = totalPoints > 0 ? i.points / totalPoints : 0 })
        setWeighted(items)
        // Fold alle seriegrupperne ud som standard
        const groups = buildWeightGroups(items)
        setExpandedWeightGroups(new Set(groups.filter(g => g.isGrouped).map(g => g.key)))
        toast.success("Vægte beregnet")
    }

    const { netEfterAdmin, hensaettelserBeloeb, socialtBeloeb, tilFordeling } = useMemo(() => {
        const gross = Number(klumpBeloeb)
        const fee = gross * Number(adminPct) / 100
        const netEfterAdmin = gross - fee
        const hensaettelserBeloeb = netEfterAdmin * Number(hensaettelserPct) / 100
        const socialtBeloeb = netEfterAdmin * Number(socialPct) / 100
        return { netEfterAdmin, hensaettelserBeloeb, socialtBeloeb, tilFordeling: netEfterAdmin - hensaettelserBeloeb - socialtBeloeb }
    }, [klumpBeloeb, adminPct, hensaettelserPct, socialPct])

    const totalPoints = useMemo(() => weighted?.reduce((s, i) => s + i.points, 0) ?? 0, [weighted])

    if (approved.length === 0) {
        return (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                Sorter og godkend værker med en værktype for at beregne point
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Weighting */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium">Beregn point</p>
                    <p className="text-xs text-muted-foreground">
                        Formel: <span className="font-mono">base-point(type) × minutter</span> — dokumentarfilm: tier bestemmer base-point ud fra varighed
                    </p>
                </div>
                <Button onClick={handleBeregn} className="gap-2">
                    <Calculator className="h-4 w-4" />
                    Beregn point
                </Button>
            </div>

            {weighted && (
                <>
                    <div className="rounded-lg border overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[90px]">Dato</TableHead>
                                    <TableHead>Titel</TableHead>
                                    <TableHead>Værktype</TableHead>
                                    <TableHead className="text-right w-[70px]">Min.</TableHead>
                                    <TableHead className="text-right w-[70px]">Vægt</TableHead>
                                    <TableHead className="text-muted-foreground font-normal text-xs w-[160px]">Tier</TableHead>
                                    <TableHead className="text-right w-[110px]">Point</TableHead>
                                    <TableHead className="text-right w-[80px]">Andel</TableHead>
                                    {weighted[0]?.estimatedAmount !== undefined && (
                                        <TableHead className="text-right w-[120px]">Est. beløb</TableHead>
                                    )}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {weightGroups.map(g => {
                                    const isExpanded = expandedWeightGroups.has(g.key)
                                    const toggleExpand = () => setExpandedWeightGroups(prev => {
                                        const next = new Set(prev)
                                        if (next.has(g.key)) next.delete(g.key); else next.add(g.key)
                                        return next
                                    })
                                    const hasEstimated = g.totalEstimated !== undefined
                                    return (
                                        <React.Fragment key={g.key}>
                                        {/* Gruppeoverskrift for serier — samlet sum når foldet, kun overskrift når udfoldet */}
                                        {g.isGrouped ? (
                                            <TableRow className="bg-muted/10">
                                                <TableCell />
                                                <TableCell className="text-sm font-medium">
                                                    <div className="flex items-center gap-1.5">
                                                        <button onClick={toggleExpand} className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title={isExpanded ? "Skjul afsnit" : "Vis afsnit"}>
                                                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                                                        </button>
                                                        <div>
                                                            <span>{g.baseTitle}</span>
                                                            <span className="ml-1 text-xs text-muted-foreground font-normal">
                                                                {g.season != null && `Sæson ${g.season} · `}{g.items.length} udsendelser
                                                            </span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{VAERK_TYPE_LABELS[g.vaerkType]}</TableCell>
                                                {isExpanded ? (
                                                    <TableCell colSpan={hasEstimated ? 7 : 6} />
                                                ) : (
                                                    <>
                                                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{g.totalDuration || "—"}</TableCell>
                                                        <TableCell />
                                                        <TableCell />
                                                        <TableCell className="text-right font-mono text-sm font-medium tabular-nums">{g.totalPoints.toLocaleString("da-DK")}</TableCell>
                                                        <TableCell className="text-right text-sm tabular-nums">{(g.totalShare * 100).toFixed(2)}%</TableCell>
                                                        {hasEstimated && (
                                                            <TableCell className="text-right font-mono text-sm tabular-nums">
                                                                {g.totalEstimated!.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                            </TableCell>
                                                        )}
                                                    </>
                                                )}
                                            </TableRow>
                                        ) : (
                                            /* Enkelt værk — fuld række */
                                            <TableRow>
                                                <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                                                    {g.items[0]?.broadcastDate
                                                        ? new Date(g.items[0].broadcastDate).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "2-digit" })
                                                        : "—"}
                                                </TableCell>
                                                <TableCell className="text-sm font-medium">{g.baseTitle}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{VAERK_TYPE_LABELS[g.vaerkType]}</TableCell>
                                                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{g.totalDuration || "—"}</TableCell>
                                                <TableCell className="text-right font-mono text-xs font-medium">{g.base ?? "—"}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{g.tierLabel ?? "—"}</TableCell>
                                                <TableCell className="text-right font-mono text-sm font-medium tabular-nums">{g.totalPoints.toLocaleString("da-DK")}</TableCell>
                                                <TableCell className="text-right text-sm tabular-nums">{(g.totalShare * 100).toFixed(2)}%</TableCell>
                                                {hasEstimated && (
                                                    <TableCell className="text-right font-mono text-sm tabular-nums">
                                                        {g.totalEstimated!.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        )}
                                        {/* Afsnitsrækker — individuelle tal pr. afsnit */}
                                        {g.isGrouped && isExpanded && g.items.map(ep => {
                                            const epLabel = ep.rawTitle.match(/[Ss]\d+[Ee]\d+/)?.[0] ?? ep.rawTitle
                                            return (
                                                <TableRow key={ep.vaerkId} className="bg-muted/20 dark:bg-muted/10">
                                                    <TableCell className="py-2 text-xs text-muted-foreground font-mono tabular-nums">
                                                        {ep.broadcastDate
                                                            ? new Date(ep.broadcastDate).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "2-digit" })
                                                            : "—"}
                                                    </TableCell>
                                                    <TableCell className="pl-9 py-2 text-xs text-muted-foreground">
                                                        ↳ <span className="font-mono">{epLabel}</span>
                                                        {ep.isGenudsendelse && (
                                                            <span className="ml-1.5 inline-flex items-center rounded px-1 py-0 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">½</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="py-2" />
                                                    <TableCell className="text-right text-xs tabular-nums py-2">{ep.duration || "—"}</TableCell>
                                                    <TableCell className="text-right font-mono text-xs py-2">{ep.base ?? "—"}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground py-2">{ep.tierLabel ?? "—"}</TableCell>
                                                    <TableCell className="text-right font-mono text-xs font-medium tabular-nums py-2">{ep.points.toLocaleString("da-DK")}</TableCell>
                                                    <TableCell className="text-right text-xs tabular-nums py-2">{(ep.shareOfTotal * 100).toFixed(2)}%</TableCell>
                                                    {ep.estimatedAmount !== undefined && (
                                                        <TableCell className="text-right font-mono text-xs tabular-nums py-2">
                                                            {ep.estimatedAmount.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            )
                                        })}
                                        </React.Fragment>
                                    )
                                })}
                                <TableRow className="font-medium bg-muted/30">
                                    <TableCell colSpan={6}>I alt</TableCell>
                                    <TableCell className="text-right font-mono tabular-nums">{totalPoints.toLocaleString("da-DK")}</TableCell>
                                    <TableCell className="text-right">100%</TableCell>
                                    {weighted[0]?.estimatedAmount !== undefined && (
                                        <TableCell className="text-right font-mono tabular-nums">
                                            {tilFordeling.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                        </TableCell>
                                    )}
                                </TableRow>
                            </TableBody>
                        </Table>
                    </div>

                    <Separator />

                    {/* Proof calculation */}
                    <div className="space-y-4">
                        <p className="text-sm font-medium">Prøveberegning</p>
                        <div className="grid gap-4 sm:grid-cols-5 max-w-3xl">
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label className="text-xs">Klump-beløb (DKK)</Label>
                                <Input
                                    type="number"
                                    value={klumpBeloeb}
                                    onChange={e => setKlumpBeloeb(e.target.value)}
                                    disabled={locked}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Administrationsprocent</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={adminPct}
                                        onChange={e => setAdminPct(e.target.value)}
                                        className="w-20"
                                        min="0"
                                        max="100"
                                        disabled={locked}
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Hensættelser</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={hensaettelserPct}
                                        onChange={e => setHensaettelserPct(e.target.value)}
                                        className="w-20"
                                        min="0"
                                        max="100"
                                        disabled={locked}
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Til sociale formål</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={socialPct}
                                        onChange={e => setSocialPct(e.target.value)}
                                        className="w-20"
                                        min="0"
                                        max="100"
                                        disabled={locked}
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg bg-muted/50 border p-4 grid gap-3 sm:grid-cols-5 text-sm max-w-3xl">
                            <div>
                                <p className="text-xs text-muted-foreground">Brutto</p>
                                <p className="font-semibold tabular-nums">
                                    {Number(klumpBeloeb).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Admin ({adminPct}%)</p>
                                <p className="font-semibold text-destructive tabular-nums">
                                    −{(Number(klumpBeloeb) * Number(adminPct) / 100).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Hensættelser ({hensaettelserPct}%)</p>
                                <p className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                                    −{hensaettelserBeloeb.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Sociale formål ({socialPct}%)</p>
                                <p className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                                    −{socialtBeloeb.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Til fordeling</p>
                                <p className="font-semibold text-green-600 dark:text-green-400 tabular-nums">
                                    {tilFordeling.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="gap-2"
                                onClick={() => {
                                    setWeighted(prev => prev ? prev.map(w => ({
                                        ...w,
                                        estimatedAmount: w.shareOfTotal * tilFordeling,
                                    })) : null)
                                    toast.success("Prøveberegning opdateret")
                                }}
                                disabled={locked}
                            >
                                <Calculator className="h-4 w-4" />
                                Beregn per titel
                            </Button>
                            <Button
                                variant="outline"
                                className="gap-2"
                                onClick={() => toast.success("Prøveberegning eksporteret til Excel")}
                            >
                                <Download className="h-4 w-4" />
                                Eksporter Excel
                            </Button>
                            <Button
                                className="gap-2 ml-auto"
                                variant={locked ? "secondary" : "default"}
                                onClick={() => {
                                    if (!locked) {
                                        setLocked(true)

                                        // Registrer hensættelse på kontoen
                                        const entry = {
                                            id: `h_${Date.now()}`,
                                            batchLabel: batchLabel,
                                            amount: Math.round(hensaettelserBeloeb),
                                            lockedAt: new Date().toISOString(),
                                            brugt: 0,
                                        }
                                        const updated = [...hensaettelsesKonto, entry]
                                        setHensaettelsesKonto(updated)
                                        localStorage.setItem("dfks_hensaettelser", JSON.stringify(updated))

                                        // Overfør betalinger til værksdatabasen (localStorage)
                                        const gross = Number(klumpBeloeb)
                                        const batchAdminFee = gross * Number(adminPct) / 100
                                        const vaerkRecords = weightGroups
                                            .filter(g => g.totalEstimated !== undefined && g.totalEstimated > 0)
                                            .map(g => {
                                                const match = confirmedMatches.find(m => m.vaerkId === g.items[0].vaerkId)
                                                const workId = match?.matchedWorkId
                                                const workTitle = match?.matchedWorkTitle ?? g.baseTitle
                                                const workShare = tilFordeling > 0 ? g.totalEstimated! / tilFordeling : 0
                                                return {
                                                    workId,
                                                    workTitle,
                                                    vaerkType: g.vaerkType,
                                                    totalPoints: g.totalPoints,
                                                    totalAmount: Math.round(g.totalEstimated!),
                                                    adminFeeAmount: Math.round(workShare * batchAdminFee),
                                                    klippere: !g.isGrouped ? (() => {
                                                        // Brug fordelingsnøgle fra værksdatabasen for enkeltstående værker
                                                        const distKeys: Record<string, { shares: { name: string; userId?: string; sharePercent: number }[] }> =
                                                            JSON.parse(localStorage.getItem("dfks_distribution_keys") ?? "{}")
                                                        const distKey = workId ? distKeys[workId] : undefined
                                                        const shares = distKey?.shares ?? (match?.rettighedshavere ?? []).map(r => ({
                                                            name: r.name, userId: r.userId, sharePercent: r.sharePercent,
                                                        }))
                                                        return shares.map(s => ({
                                                            name: s.name,
                                                            userId: s.userId,
                                                            sharePercent: s.sharePercent,
                                                            amount: Math.round(g.totalEstimated! * s.sharePercent / 100),
                                                        }))
                                                    })() : undefined,
                                                    episodes: g.isGrouped ? g.items.map(ep => {
                                                        const epMatch = confirmedMatches.find(m => m.vaerkId === ep.vaerkId)
                                                        const epAmount = Math.round(ep.estimatedAmount ?? 0)
                                                        // Ligeligt fordelt mellem krediterede klippere på afsnittet
                                                        const credited = epMatch?.rettighedshavere ?? []
                                                        const n = credited.length || 1
                                                        const equalShare = Math.round(100 / n)
                                                        return {
                                                            episodeLabel: ep.rawTitle.match(/[Ss]\d+[Ee]\d+/)?.[0] ?? ep.rawTitle,
                                                            broadcastDate: ep.broadcastDate,
                                                            isGenudsendelse: ep.isGenudsendelse,
                                                            points: ep.points,
                                                            amount: epAmount,
                                                            klippere: credited.map((r, i) => ({
                                                                name: r.name,
                                                                userId: r.userId,
                                                                sharePercent: i === credited.length - 1 ? 100 - equalShare * (n - 1) : equalShare,
                                                                amount: Math.round(epAmount / n),
                                                            })),
                                                        }
                                                    }) : undefined,
                                                }
                                            })

                                        const dbEntry = {
                                            id: `al_${Date.now()}`,
                                            batchLabel,
                                            lockedAt: new Date().toISOString(),
                                            totalAmount: Math.round(tilFordeling),
                                            vaerker: vaerkRecords,
                                        }
                                        const existingDb: typeof dbEntry[] = JSON.parse(localStorage.getItem("dfks_al_udbetalinger") ?? "[]")
                                        localStorage.setItem("dfks_al_udbetalinger", JSON.stringify([...existingDb, dbEntry]))
                                        setDbTransfer(vaerkRecords)

                                        toast.success(`Beregning låst — betalinger overført til ${vaerkRecords.length} værker`)
                                    }
                                }}
                                disabled={locked}
                            >
                                <Lock className="h-4 w-4" />
                                {locked ? "Beregning låst" : "Godkend og lås beregning"}
                            </Button>
                        </div>
                    </div>

                    {/* Overført til værksdatabasen */}
                    {dbTransfer && dbTransfer.length > 0 && (
                        <>
                            <Separator />
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Database className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    <p className="text-sm font-medium">Overført til værksdatabasen</p>
                                    <span className="text-xs text-muted-foreground">— {dbTransfer.length} værker opdateret</span>
                                </div>
                                <div className="rounded-lg border overflow-hidden">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Værk</TableHead>
                                                <TableHead>Værktype</TableHead>
                                                <TableHead className="text-right">Point</TableHead>
                                                <TableHead className="text-right">Beløb</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {dbTransfer.map((w, i) => (
                                                <React.Fragment key={i}>
                                                    <TableRow>
                                                        <TableCell className="text-sm font-medium">
                                                            {w.workTitle}
                                                            {!w.workId && <span className="ml-1.5 text-[10px] text-amber-600 font-normal">(ikke matchet)</span>}
                                                        </TableCell>
                                                        <TableCell className="text-xs text-muted-foreground">{VAERK_TYPE_LABELS[w.vaerkType]}</TableCell>
                                                        {w.episodes ? (
                                                            <>
                                                                <TableCell />
                                                                <TableCell />
                                                            </>
                                                        ) : (
                                                            <>
                                                                <TableCell className="text-right font-mono text-xs">{w.totalPoints?.toLocaleString("da-DK")}</TableCell>
                                                                <TableCell className="text-right font-mono text-sm font-medium">
                                                                    {w.totalAmount.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                                </TableCell>
                                                            </>
                                                        )}
                                                    </TableRow>
                                                    {w.episodes?.map((ep, j) => (
                                                        <TableRow key={j} className="bg-muted/20">
                                                            <TableCell className="pl-8 py-1.5 text-xs text-muted-foreground">
                                                                ↳ <span className="font-mono">{ep.episodeLabel}</span>
                                                                {ep.broadcastDate && <span className="ml-1.5">{new Date(ep.broadcastDate).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>}
                                                                {ep.isGenudsendelse && <span className="ml-1.5 inline-flex items-center rounded px-1 py-0 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">½</span>}
                                                            </TableCell>
                                                            <TableCell className="py-1.5" />
                                                            <TableCell className="text-right font-mono text-xs py-1.5">{ep.points.toLocaleString("da-DK")}</TableCell>
                                                            <TableCell className="text-right font-mono text-xs py-1.5">
                                                                {ep.amount.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </React.Fragment>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Hensættelseskonto */}
                    {hensaettelsesKonto.length > 0 && (
                        <>
                            <Separator />
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium">Hensættelseskonto</p>
                                        <p className="text-xs text-muted-foreground">Akkumulerede hensættelser til udefrakommende krav</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-muted-foreground">Disponibel saldo</p>
                                        <p className="text-lg font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                                            {hensaettelsesKonto.reduce((s, e) => s + e.amount - e.brugt, 0).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                        </p>
                                    </div>
                                </div>
                                <div className="rounded-lg border overflow-hidden">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Batch</TableHead>
                                                <TableHead>Dato</TableHead>
                                                <TableHead className="text-right">Hensat</TableHead>
                                                <TableHead className="text-right">Brugt</TableHead>
                                                <TableHead className="text-right">Rest</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {hensaettelsesKonto.map(e => (
                                                <TableRow key={e.id}>
                                                    <TableCell className="text-sm">{e.batchLabel}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{new Date(e.lockedAt).toLocaleDateString("da-DK")}</TableCell>
                                                    <TableCell className="text-right font-mono text-sm tabular-nums">
                                                        {e.amount.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-sm tabular-nums text-destructive">
                                                        {e.brugt > 0 ? `−${e.brugt.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}` : "—"}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-sm font-medium tabular-nums">
                                                        {(e.amount - e.brugt).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            <TableRow className="bg-muted/30 font-medium">
                                                <TableCell colSpan={2}>I alt</TableCell>
                                                <TableCell className="text-right font-mono tabular-nums">
                                                    {hensaettelsesKonto.reduce((s, e) => s + e.amount, 0).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                </TableCell>
                                                <TableCell className="text-right font-mono tabular-nums text-destructive">
                                                    {hensaettelsesKonto.reduce((s, e) => s + e.brugt, 0) > 0
                                                        ? `−${hensaettelsesKonto.reduce((s, e) => s + e.brugt, 0).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}`
                                                        : "—"}
                                                </TableCell>
                                                <TableCell className="text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                                                    {hensaettelsesKonto.reduce((s, e) => s + e.amount - e.brugt, 0).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                </TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Per-klipper distribution (fordelingsnøgle) */}
                    {weighted[0]?.estimatedAmount !== undefined && confirmedMatches.length > 0 && (() => {
                        // Build per-klipper totals from confirmed matches + per-work amounts
                        const byKlipper = new Map<string, { name: string; amount: number; works: string[] }>()
                        confirmedMatches.forEach(m => {
                            const w = weighted.find(w => w.vaerkId === m.vaerkId)
                            if (!w?.estimatedAmount || m.rettighedshavere.length === 0) return
                            m.rettighedshavere.forEach(r => {
                                const key = r.userId ?? r.name
                                const share = r.sharePercent / 100
                                const amount = w.estimatedAmount! * share
                                if (!byKlipper.has(key)) byKlipper.set(key, { name: r.name, amount: 0, works: [] })
                                const entry = byKlipper.get(key)!
                                entry.amount += amount
                                if (!entry.works.includes(m.rawTitle)) entry.works.push(m.rawTitle)
                            })
                        })
                        const rows = [...byKlipper.values()].sort((a, b) => b.amount - a.amount)
                        if (rows.length === 0) return null
                        return (
                            <>
                                <Separator />
                                <div className="space-y-3">
                                    <div>
                                        <p className="text-sm font-medium">Fordelingsnøgle — per klipper</p>
                                        <p className="text-xs text-muted-foreground">Baseret på andele fra parring med værksdatabasen</p>
                                    </div>
                                    <div className="rounded-lg border overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Klipper</TableHead>
                                                    <TableHead>Tilknyttede værker</TableHead>
                                                    <TableHead className="text-right w-[140px]">Estimeret beløb</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {rows.map(r => (
                                                    <TableRow key={r.name}>
                                                        <TableCell className="text-sm font-medium">{r.name}</TableCell>
                                                        <TableCell className="text-xs text-muted-foreground">{r.works.join(", ")}</TableCell>
                                                        <TableCell className="text-right font-mono text-sm">
                                                            {r.amount.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                                <TableRow className="font-medium bg-muted/30">
                                                    <TableCell colSpan={2}>I alt</TableCell>
                                                    <TableCell className="text-right font-mono">
                                                        {rows.reduce((s, r) => s + r.amount, 0).toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                    </TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            </>
                        )
                    })()}
                </>
            )}
        </div>
    )
}

// ── Main page ─────────────────────────────────────────────────

const KILDE_LABELS_PAGE: Record<string, string> = {
    copydan_verdenstv: "Copydan Verdens TV",
    copydan_arkiv: "Copydan Arkiv",
    tv2play: "TV2 Play",
}

const STATUS_LABELS: Record<string, string> = {
    imported:  "Importeret",
    sorting:   "Sorteres",
    weighted:  "Klar til beregning",
    completed: "Afsluttet",
}

export default function AftalelicensDetailPage() {
    const params = useParams()
    const id = params?.id as string

    const [vaerker, setVaerker] = useState<AftalelicensVaerk[]>(genMockVaerker)

    // Hydrate from localStorage after mount (avoids SSR/client mismatch)
    useEffect(() => {
        try {
            const stored = localStorage.getItem(`dfks_batch_vaerker_${id}`)
            if (stored) {
                const parsed = JSON.parse(stored) as AftalelicensVaerk[]
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setVaerker(parsed)
                    return
                }
            }
        } catch { /* ignore */ }
    }, [id])
    const [confirmedMatches, setConfirmedMatches] = useState<VaerkMatch[]>([])
    const batch = MOCK_BATCH // In real app: lookup by id

    const updateVaerk = (vaerkId: string, patch: Partial<AftalelicensVaerk>) => {
        setVaerker(prev => {
            const current = prev.find(v => v.id === vaerkId)
            if (current && patch.sortStatus && patch.sortStatus !== current.sortStatus) {
                // Gem AI-korrektioner som feedback (til few-shot eksempler)
                if (
                    current.sortedBy === "ai" &&
                    (patch.sortStatus === "approved" || patch.sortStatus === "rejected")
                ) {
                    saveFeedback({
                        rawTitle: current.rawTitle,
                        channel: current.channel,
                        productionYear: current.productionYear,
                        duration: current.duration,
                        aiRelevant: current.sortStatus === "approved" ? "ja" : "nej",
                        aiVaerkType: current.vaerkType ?? null,
                        userDecision: patch.sortStatus,
                        timestamp: new Date().toISOString(),
                    })
                }
                // Gem ALLE godkend/afvis-beslutninger i historik (bruges som pre-filter fremover)
                if (patch.sortStatus === "approved" || patch.sortStatus === "rejected") {
                    recordDecision(
                        current.rawTitle,
                        patch.sortStatus,
                        current.channel,
                        (patch.vaerkType ?? current.vaerkType) as string | undefined,
                    )
                }
            }
            return prev.map(v => v.id === vaerkId ? { ...v, ...patch } : v)
        })
    }

    const sortingComplete = vaerker.every(v => v.sortStatus !== "pending")
    const pendingClaimsCount = MOCK_KRAV.filter(k => k.status === "pending").length

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href="/admin/aftalelicens">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-lg font-semibold">{KILDE_LABELS_PAGE[batch.kilde]} — {batch.year}</h1>
                    <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs">{STATUS_LABELS[batch.status]}</Badge>
                        <span className="text-xs text-muted-foreground">
                            {batch.filteredRows.toLocaleString("da-DK")} rækker · importeret {new Date(batch.uploadedAt).toLocaleDateString("da-DK")}
                        </span>
                    </div>
                </div>
            </div>

            {!sortingComplete && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Sorter alle titler for at låse op for rettighedstilknytning og beregning.</span>
                </div>
            )}

            <Tabs defaultValue="sortering">
                <TabsList>
                    <TabsTrigger value="sortering">
                        1. Sortering
                        {!sortingComplete && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />}
                    </TabsTrigger>
                    <TabsTrigger value="parring" disabled={!sortingComplete}>
                        2. Parring
                    </TabsTrigger>
                    <TabsTrigger value="beregning" disabled={!sortingComplete}>
                        3. Vægtning og beregning
                    </TabsTrigger>
                    <TabsTrigger value="krav" className="relative">
                        Klipperkrav
                        {pendingClaimsCount > 0 && (
                            <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-semibold text-white">
                                {pendingClaimsCount}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="sortering" className="mt-4">
                    <SortTable vaerker={vaerker} onUpdate={updateVaerk} />
                </TabsContent>

                <TabsContent value="parring" className="mt-4">
                    <ParringTab vaerker={vaerker} onConfirmed={setConfirmedMatches} />
                </TabsContent>

                <TabsContent value="beregning" className="mt-4">
                    <WeightingTab vaerker={vaerker} confirmedMatches={confirmedMatches} batchLabel={`${KILDE_LABELS_PAGE[batch.kilde]} ${batch.year}`} />
                </TabsContent>

                <TabsContent value="krav" className="mt-4">
                    <ClaimsTab batchId={batch.id} batchStatus={batch.status} />
                </TabsContent>
            </Tabs>
        </div>
    )
}
