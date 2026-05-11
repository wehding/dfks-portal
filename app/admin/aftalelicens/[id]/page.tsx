"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
    ArrowLeft, Check, X, Flag, Search, ChevronDown, Download,
    Users, Calculator, Lock, Loader2, ExternalLink, Info, Save,
    ChevronsUpDown, ChevronUp, FileText, Clock, AlertTriangle,
    Link2, Link2Off, Database, Plus, Trash2, SlidersHorizontal, Ban, Eye, EyeOff,
} from "lucide-react"
import { saveFeedback, getTrainingExamples } from "@/lib/ai-feedback"
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

    return [...filmItems, ...noiseItems]
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

        if (dbMatch > 0) toast.info(`${dbMatch} titler matchet i DB — sender ${unmatched.length} til AI`)

        // ── Trin 2: AI kun på ukendte titler ────────────────────
        setAiProgress({ done: 0, total: unmatched.length })

        const batches: typeof unmatched[] = []
        for (let i = 0; i < unmatched.length; i += BATCH_SIZE) {
            batches.push(unmatched.slice(i, i + BATCH_SIZE))
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
                            vaerkType: v.vaerkType ?? null,
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
                    }
                }
            } catch (err) {
                if ((err as Error).name === "AbortError") { stopped = true; break }
                fejl += batch.length
            }
            setAiProgress({ done: Math.min((b + 1) * BATCH_SIZE, unmatched.length), total: unmatched.length })
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

// ── Rights assignment ─────────────────────────────────────────

function RightsTab({ vaerker, confirmedMatches }: {
    vaerker: AftalelicensVaerk[]
    confirmedMatches: VaerkMatch[]
}) {
    const approved = vaerker.filter(v => v.sortStatus === "approved" && v.vaerkType)
    const [rights, setRights] = useState<Record<string, AftalelicensRettighed[]>>({})
    const [seeded, setSeeded] = useState(false)
    const [addDialog, setAddDialog] = useState<string | null>(null) // vaerkId
    const [newName, setNewName] = useState("")
    const [newShare, setNewShare] = useState("100")

    // Seed rights from Parring when parring is first confirmed
    useEffect(() => {
        if (seeded || confirmedMatches.length === 0) return
        const seed: Record<string, AftalelicensRettighed[]> = {}
        confirmedMatches.forEach(m => {
            if (m.rettighedshavere.length > 0) {
                seed[m.vaerkId] = m.rettighedshavere.map((r, i) => ({
                    id: `r_auto_${m.vaerkId}_${i}`,
                    vaerkId: m.vaerkId,
                    name: r.name,
                    userId: r.userId,
                    sharePercent: r.sharePercent,
                    contractVerified: !!r.userId,
                }))
            }
        })
        setRights(seed)
        setSeeded(true)
    }, [confirmedMatches, seeded])

    const handleAdd = (vaerkId: string) => {
        if (!newName.trim()) return
        const r: AftalelicensRettighed = {
            id: `r_${Date.now()}`,
            vaerkId,
            name: newName.trim(),
            sharePercent: Number(newShare),
            contractVerified: false,
        }
        setRights(prev => ({ ...prev, [vaerkId]: [...(prev[vaerkId] ?? []), r] }))
        setNewName("")
        setNewShare("100")
        setAddDialog(null)
        toast.success("Rettighedshaver tilknyttet")
    }

    const handleRemove = (vaerkId: string, retId: string) => {
        setRights(prev => ({ ...prev, [vaerkId]: (prev[vaerkId] ?? []).filter(r => r.id !== retId) }))
    }

    if (approved.length === 0) {
        return (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                Sorter og godkend værker først for at tilknytte rettighedshavere
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {seeded ? (
                <div className="flex items-start gap-2 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/20 px-3 py-2.5 text-xs text-green-800 dark:text-green-300">
                    <Database className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Rettighedshavere er automatisk hentet fra værksdatabasen via Parring. Du kan tilpasse dem nedenfor.
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Tilknyt klippere til de godkendte værker. Fuldfør Parring først for at auto-populere fra værksdatabasen.
                </p>
            )}
            <div className="rounded-lg border divide-y">
                {approved.map(v => {
                    const vaerkRights = rights[v.id] ?? []
                    return (
                        <div key={v.id} className="p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium">{v.rawTitle}</p>
                                    <p className="text-xs text-muted-foreground">{v.vaerkType ? VAERK_TYPE_LABELS[v.vaerkType] : "—"} · {v.duration} min</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0 gap-1 text-xs"
                                    onClick={() => setAddDialog(v.id)}
                                >
                                    <Users className="h-3.5 w-3.5" />
                                    Tilknyt klipper
                                </Button>
                            </div>
                            {vaerkRights.length > 0 && (
                                <div className="mt-3 space-y-1">
                                    {vaerkRights.map(r => (
                                        <div key={r.id} className="flex items-center justify-between text-xs rounded bg-muted/50 px-3 py-1.5">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{r.name}</span>
                                                {r.contractVerified && (
                                                    <Badge variant="outline" className="text-[10px] py-0 gap-0.5">
                                                        <Check className="h-2.5 w-2.5" />kontrakt
                                                    </Badge>
                                                )}
                                                {r.id.startsWith("r_auto_") && (
                                                    <Badge variant="secondary" className="text-[10px] py-0">DB</Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-muted-foreground font-mono">{r.sharePercent}%</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5 text-destructive hover:text-destructive"
                                                    onClick={() => handleRemove(v.id, r.id)}
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                    {vaerkRights.reduce((s, r) => s + r.sharePercent, 0) !== 100 && (
                                        <p className="text-[10px] text-amber-600 dark:text-amber-400 pl-1">
                                            Andele summer til {vaerkRights.reduce((s, r) => s + r.sharePercent, 0)}% — juster til 100%
                                        </p>
                                    )}
                                </div>
                            )}
                            {vaerkRights.length === 0 && (
                                <p className="mt-2 text-xs text-muted-foreground italic">Ingen klippere tilknyttet endnu</p>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Add rights dialog */}
            <Dialog open={!!addDialog} onOpenChange={() => setAddDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Tilknyt klipper</DialogTitle>
                        <DialogDescription>Søg i kontraktarkivet eller tilknyt manuelt</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Klipper</Label>
                            <Select onValueChange={v => setNewName(MOCK_KLIPPERE.find(k => k.id === v)?.name ?? "")}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Vælg fra kontraktarkiv..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {MOCK_KLIPPERE.map(k => (
                                        <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">— eller skriv manuelt —</p>
                            <Input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="Navn..."
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Andel (%)</Label>
                            <Input
                                type="number"
                                value={newShare}
                                onChange={e => setNewShare(e.target.value)}
                                min="0"
                                max="100"
                                className="w-24"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddDialog(null)}>Annuller</Button>
                        <Button onClick={() => addDialog && handleAdd(addDialog)} disabled={!newName.trim()}>
                            Tilknyt
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

    const autoCount   = matches.filter(m => m.matchScore === "auto").length
    const fuzzyCount  = matches.filter(m => m.matchScore === "fuzzy").length
    const manualCount = matches.filter(m => m.matchScore === "manual").length
    const noneCount   = matches.filter(m => m.matchScore === "none" && !m.newWorkCreated).length
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

    const linkFuzzy = (vaerkId: string, fuzzyWork: FuzzyWork) => {
        const realWork = mockWorks.find(w => w.id === fuzzyWork.id)
        const contracts = realWork ? mockContracts.filter(c => normalizeTitle(c.title) === normalizeTitle(realWork.title)) : []
        const equalShare = contracts.length > 0 ? Math.round(100 / contracts.length) : 100
        const rettigheder = contracts.map(c => ({
            userId: c.userId,
            name: c.userName ?? "Ukendt",
            roles: c.creditedRoles ?? [],
            sharePercent: equalShare,
        }))
        setMatches(prev => prev.map(m => m.vaerkId === vaerkId ? {
            ...m,
            matchedWorkId: fuzzyWork.id,
            matchedWorkTitle: fuzzyWork.title,
            matchScore: "fuzzy" as const,
            rettighedshavere: rettigheder,
            confirmed: true,
        } : m))
        toast.success(`Fuzzy-parret med "${fuzzyWork.title}"`)
    }

    const handleCreateWork = (vaerkId: string) => {
        if (!newWorkTitle.trim()) return
        const newWork: FuzzyWork = {
            id: `new_${Date.now()}`,
            title: newWorkTitle.trim(),
            category: newWorkType,
        }
        setExtraWorks(prev => [...prev, newWork])
        setMatches(prev => prev.map(m => m.vaerkId === vaerkId ? {
            ...m,
            matchedWorkId: newWork.id,
            matchedWorkTitle: newWork.title,
            matchScore: "manual" as const,
            newWorkCreated: true,
            confirmed: true,
        } : m))
        setNewWorkDialog(null)
        setNewWorkTitle("")
        toast.success(`Nyt værk oprettet: "${newWork.title}"`)
    }

    const linkWork = (vaerkId: string, work: { id: string; title: string }) => {
        const contracts = mockContracts.filter(c => normalizeTitle(c.title) === normalizeTitle(work.title))
        const equalShare = contracts.length > 0 ? Math.round(100 / contracts.length) : 100
        const rettigheder = contracts.map(c => ({
            userId: c.userId,
            name: c.userName ?? "Ukendt",
            roles: c.creditedRoles ?? [],
            sharePercent: equalShare,
        }))
        setMatches(prev => prev.map(m => m.vaerkId === vaerkId ? {
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

    const unlinkWork = (vaerkId: string) => {
        setMatches(prev => prev.map(m => m.vaerkId === vaerkId ? {
            ...m,
            matchedWorkId: undefined,
            matchedWorkTitle: undefined,
            matchScore: "none",
            rettighedshavere: [],
            confirmed: false,
        } : m))
    }

    const toggleConfirm = (vaerkId: string) => {
        setMatches(prev => prev.map(m => m.vaerkId === vaerkId ? { ...m, confirmed: !m.confirmed } : m))
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

            {/* Match table */}
            <div className="rounded-lg border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Titel (batch)</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Matchet værk</TableHead>
                            <TableHead>Rettighedshavere</TableHead>
                            <TableHead className="w-[100px]">Match</TableHead>
                            <TableHead className="w-[120px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {matches.map(m => (
                            <TableRow key={m.vaerkId} className={m.confirmed ? "" : "bg-amber-50/40 dark:bg-amber-950/10"}>
                                <TableCell>
                                    <p className="text-sm font-medium">{m.rawTitle}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {m.season != null && `S${m.season}`}
                                        {m.episode != null && `E${m.episode}`}
                                        {m.season != null || m.episode != null ? " · " : ""}
                                        {m.duration ? `${m.duration} min` : ""}
                                        {m.productionYear != null && ` · ${m.productionYear}`}
                                    </p>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {m.vaerkType ? VAERK_TYPE_LABELS[m.vaerkType] : "—"}
                                </TableCell>
                                <TableCell>
                                    {m.matchedWorkTitle ? (
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm">{m.matchedWorkTitle}</span>
                                            {m.newWorkCreated && (
                                                <Badge variant="outline" className="text-[10px] py-0 text-blue-600 border-blue-300">ny</Badge>
                                            )}
                                            <button
                                                onClick={() => unlinkWork(m.vaerkId)}
                                                className="text-muted-foreground hover:text-destructive transition-colors"
                                                title="Fjern parring"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ) : m.fuzzyMatches && m.fuzzyMatches.length > 0 ? (
                                        <div className="space-y-1">
                                            {m.fuzzyMatches.map((fm, i) => (
                                                <div key={i} className="flex items-center gap-1.5">
                                                    <button
                                                        className="text-xs text-left hover:text-primary transition-colors flex items-center gap-1"
                                                        onClick={() => linkFuzzy(m.vaerkId, fm.work)}
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
                                    {m.rettighedshavere.length > 0 ? (
                                        <div className="space-y-0.5">
                                            {m.rettighedshavere.map((r, i) => (
                                                <div key={i} className="flex items-baseline gap-1.5 text-xs">
                                                    <span className="font-medium">{r.name}</span>
                                                    {r.roles.length > 0 && (
                                                        <span className="text-muted-foreground">({r.roles.join(", ")})</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {m.hasDuplicates ? (
                                        <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-700 dark:text-amber-400">
                                            <AlertTriangle className="h-3 w-3" />
                                            Duplikat
                                        </Badge>
                                    ) : (
                                        <Badge
                                            variant={m.matchScore === "auto" ? "default" : m.matchScore === "fuzzy" ? "secondary" : m.matchScore === "manual" ? "secondary" : "outline"}
                                            className={`text-xs gap-1 ${m.matchScore === "fuzzy" ? "border-violet-300 text-violet-700 dark:text-violet-300" : ""}`}
                                        >
                                            {m.matchScore === "auto" && <Link2 className="h-3 w-3" />}
                                            {m.matchScore === "fuzzy" && <Search className="h-3 w-3" />}
                                            {m.matchScore === "manual" && <Database className="h-3 w-3" />}
                                            {m.matchScore === "none" && <Link2Off className="h-3 w-3" />}
                                            {m.matchScore === "auto" ? "Auto" : m.matchScore === "fuzzy" ? "Fuzzy" : m.matchScore === "manual" ? "Manuelt" : "Ingen match"}
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-1 flex-wrap">
                                        {!m.matchedWorkId && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs gap-1"
                                                onClick={() => { setSearchDialog(m.vaerkId); setWorkSearch("") }}
                                            >
                                                <Search className="h-3 w-3" />
                                                Søg i DB
                                            </Button>
                                        )}
                                        {!m.matchedWorkId && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
                                                onClick={() => {
                                                    setNewWorkDialog(m.vaerkId)
                                                    setNewWorkTitle(m.rawTitle)
                                                    setNewWorkType(m.vaerkType ?? "dokumentarfilm")
                                                }}
                                            >
                                                <Plus className="h-3 w-3" />
                                                Opret nyt
                                            </Button>
                                        )}
                                        {!m.matchedWorkId && !m.confirmed && !m.fuzzyMatches && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs gap-1 text-muted-foreground"
                                                onClick={() => toggleConfirm(m.vaerkId)}
                                            >
                                                <Check className="h-3 w-3" />
                                                Ingen match
                                            </Button>
                                        )}
                                        {!m.matchedWorkId && m.confirmed && (
                                            <Badge variant="outline" className="text-xs gap-1 h-7 px-2">
                                                <Check className="h-3 w-3 text-muted-foreground" />
                                                Bekræftet ingen match
                                            </Badge>
                                        )}
                                        {m.matchedWorkId && (
                                            <Button
                                                variant={m.confirmed ? "default" : "outline"}
                                                size="sm"
                                                className="h-7 text-xs gap-1"
                                                onClick={() => toggleConfirm(m.vaerkId)}
                                            >
                                                <Check className="h-3 w-3" />
                                                {m.confirmed ? "Bekræftet" : "Bekræft"}
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {allConfirmed && matches.length > 0 && !confirmed && (
                <div className="flex items-center justify-between rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                        <Check className="h-4 w-4" />
                        Alle titler er parret og bekræftet — rettighedshavere er klar til trin 3
                    </div>
                    <Button size="sm" onClick={() => { setConfirmed(true); onConfirmed(matches); toast.success("Parring låst — rettighedshavere er klar") }}>
                        <Lock className="mr-2 h-3.5 w-3.5" />
                        Lås parring
                    </Button>
                </div>
            )}

            {confirmed && (
                <div className="flex items-center gap-2 rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-4 py-3 text-sm text-green-800 dark:text-green-300">
                    <Lock className="h-4 w-4" />
                    Parring låst — fortsæt til Rettighedshavere
                </div>
            )}

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
                        <DialogTitle>Opret nyt værk</DialogTitle>
                        <DialogDescription>
                            Tilføj et nyt værk til databasen og par det med denne titel
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
                            Opret og par
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

    const [weighted, setWeighted] = useState<(AftalelicensVaegtet & { tierLabel?: string })[] | null>(null)
    const [klumpBeloeb, setKlumpBeloeb] = useState("1000000")
    const [adminPct, setAdminPct] = useState("15")
    const [hensaettelserPct, setHensaettelserPct] = useState("10")
    const [socialPct, setSocialPct] = useState("0")
    const [locked, setLocked] = useState(false)

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
        const items: (AftalelicensVaegtet & { tierLabel?: string; base?: number })[] = approved.map(v => {
            const { points, base, tierLabel } = beregnPoints(v.vaerkType!, v.duration, vaegte, extra)
            return {
                vaerkId: v.id,
                rawTitle: v.rawTitle,
                vaerkType: v.vaerkType!,
                duration: v.duration ?? 0,
                viewCount: v.viewCount,
                isGenudsendelse: v.isGenudsendelse ?? false,
                points,
                shareOfTotal: 0,
                tierLabel,
                base,
            }
        })
        const totalPoints = items.reduce((s, i) => s + i.points, 0)
        items.forEach(i => { i.shareOfTotal = totalPoints > 0 ? i.points / totalPoints : 0 })
        setWeighted(items)
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
                                {weighted.map(w => {
                                    const wExt = w as typeof w & { tierLabel?: string; base?: number }
                                    return (
                                        <TableRow key={w.vaerkId}>
                                            <TableCell className="text-sm font-medium">{w.rawTitle}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{VAERK_TYPE_LABELS[w.vaerkType]}</TableCell>
                                            <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{w.duration || "—"}</TableCell>
                                            <TableCell className="text-right font-mono text-xs font-medium">{wExt.base ?? "—"}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{wExt.tierLabel ?? "—"}</TableCell>
                                            <TableCell className="text-right font-mono text-sm font-medium tabular-nums">
                                                {w.points.toLocaleString("da-DK")}
                                            </TableCell>
                                            <TableCell className="text-right text-sm tabular-nums">{(w.shareOfTotal * 100).toFixed(2)}%</TableCell>
                                            {w.estimatedAmount !== undefined && (
                                                <TableCell className="text-right font-mono text-sm tabular-nums">
                                                    {w.estimatedAmount.toLocaleString("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 })}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    )
                                })}
                                <TableRow className="font-medium bg-muted/30">
                                    <TableCell colSpan={5}>I alt</TableCell>
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
                                        toast.success(`Beregning låst — ${Math.round(hensaettelserBeloeb).toLocaleString("da-DK")} kr. hensat`)
                                    }
                                }}
                                disabled={locked}
                            >
                                <Lock className="h-4 w-4" />
                                {locked ? "Beregning låst" : "Godkend og lås beregning"}
                            </Button>
                        </div>
                    </div>

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
    const id = params.id as string

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
        setVaerker(prev => prev.map(v => v.id === vaerkId ? { ...v, ...patch } : v))
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
                    <TabsTrigger value="rettigheder" disabled={!sortingComplete}>
                        3. Rettighedshavere
                    </TabsTrigger>
                    <TabsTrigger value="beregning" disabled={!sortingComplete}>
                        4. Vægtning og beregning
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

                <TabsContent value="rettigheder" className="mt-4">
                    <RightsTab vaerker={vaerker} confirmedMatches={confirmedMatches} />
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
