"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import {
    Search, Film, Tv, ChevronUp, ChevronDown, ArrowUpDown,
    Users, CheckCircle2, Clock, AlertCircle, Lock, Filter,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import type { StreamingProduction, DistributionKeyStatus, ProductionType } from "@/lib/streaming-types"

// ── Mock data ─────────────────────────────────────────────────

interface WorkEntry extends StreamingProduction {
    editors: { name: string; sharePercent?: number }[]
    distributionKeyStatus?: DistributionKeyStatus
    contractStatus?: "ok" | "missing" | "pending"
}

const mockWorks: WorkEntry[] = [
    { id: "001", productionNumber: "001", title: "Kærlighed for voksne", type: "film_original", premiereYear: 2022, licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 15, createdAt: "2022-01-01", updatedAt: "2024-01-01", createdBy: "admin", editors: [{ name: "Lars Wissing", sharePercent: 100 }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "002", productionNumber: "002", title: "Nisser", type: "tv_series_original", premiereYear: 2022, licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10, createdAt: "2022-01-01", updatedAt: "2023-01-01", createdBy: "admin", editors: [{ name: "Michael Bauer" }, { name: "Ida Bregninge" }, { name: "Dan Loghin" }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "003", productionNumber: "003", title: "Toscana", type: "film_licensed", premiereYear: 2022, licenseDurationYears: 10, licenseStartYear: 2022, adminFeePercent: 10, createdAt: "2022-01-01", updatedAt: "2024-01-01", createdBy: "admin", editors: [{ name: "Anders Hoffmann" }, { name: "Niels Ostenfeld" }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "004", productionNumber: "004", title: "Kastanjemanden", type: "tv_series_original", premiereYear: 2022, licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10, createdAt: "2022-01-01", updatedAt: "2023-01-01", createdBy: "admin", editors: [{ name: "Cathrine Ambus" }, { name: "Anja Farsig" }, { name: "Martin Schade" }, { name: "Lars Therkelsen" }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "005", productionNumber: "005", title: "Skruk Sæson 1", type: "tv_series_original", premiereYear: 2022, licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10, createdAt: "2022-01-01", updatedAt: "2022-01-01", createdBy: "admin", editors: [], distributionKeyStatus: "draft", contractStatus: "missing" },
    { id: "006", productionNumber: "006", title: "Ehrengard", type: "tv_series_original", premiereYear: 2023, licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 10, createdAt: "2023-01-01", updatedAt: "2024-01-01", createdBy: "admin", editors: [{ name: "Janus Billeskov Jansen" }, { name: "Biel Andrés" }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "007", productionNumber: "007", title: "A Beautiful Life", type: "tv_series_original", premiereYear: 2023, licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 15, createdAt: "2023-01-01", updatedAt: "2025-01-01", createdBy: "admin", editors: [{ name: "Anders Hofman", sharePercent: 100 }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "008", productionNumber: "008", title: "Sygeplejersken", type: "tv_series_original", premiereYear: 2023, licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 15, createdAt: "2023-01-01", updatedAt: "2024-01-01", createdBy: "admin", editors: [{ name: "Elin Pröjts" }, { name: "Anna Heide" }, { name: "Benjamin Binderup" }, { name: "Tómas Gislason" }], distributionKeyStatus: "proposed", contractStatus: "pending" },
    { id: "009", productionNumber: "009", title: "Skruk Sæson 2", type: "tv_series_original", premiereYear: 2024, licenseDurationYears: 50, licenseStartYear: 2024, adminFeePercent: 10, createdAt: "2024-01-01", updatedAt: "2024-01-01", createdBy: "admin", editors: [{ name: "Lars Terkelsen" }, { name: "Jakob Juul Toldam" }, { name: "Kasper Schultz Simonsen" }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "010", productionNumber: "010", title: "Bytte Bytte Baby 2", type: "film_original", premiereYear: 2024, licenseDurationYears: 50, licenseStartYear: 2024, adminFeePercent: 10, createdAt: "2024-01-01", updatedAt: "2025-01-01", createdBy: "admin", editors: [{ name: "Benjamin Binderup" }, { name: "Carsten Søsted" }], distributionKeyStatus: "locked", contractStatus: "ok" },
    { id: "011", productionNumber: "011", title: "Sult", type: "film_original", premiereYear: 2025, licenseDurationYears: 50, licenseStartYear: 2025, adminFeePercent: 15, createdAt: "2025-01-01", updatedAt: "2025-01-01", createdBy: "admin", editors: [{ name: "Peter Winther" }, { name: "Viola Frederikke Lindkvist Hjorth" }], distributionKeyStatus: "accepted", contractStatus: "pending" },
    { id: "012", productionNumber: "012", title: "Reservatet", type: "tv_series_original", premiereYear: 2025, licenseDurationYears: 50, licenseStartYear: 2025, adminFeePercent: 15, createdAt: "2025-01-01", updatedAt: "2025-01-01", createdBy: "admin", editors: [{ name: "Anja Farsig" }, { name: "Kasper Leick" }, { name: "Frederik Strunk" }], distributionKeyStatus: "locked", contractStatus: "ok" },
]

// ── Helpers ───────────────────────────────────────────────────

const TYPE_LABELS: Record<ProductionType, string> = {
    film_original: "Film · Original",
    film_licensed: "Film · Licenseret",
    tv_series_original: "TV-serie · Original",
    tv_series_licensed: "TV-serie · Licenseret",
    short_original: "Kortfilm · Original",
    documentary_original: "Dokumentar · Original",
}

const TYPE_GROUPS: Record<string, ProductionType[]> = {
    "Film": ["film_original", "film_licensed"],
    "TV-serie": ["tv_series_original", "tv_series_licensed"],
    "Kortfilm / Dokumentar": ["short_original", "documentary_original"],
}

function TypeIcon({ type }: { type: ProductionType }) {
    if (type.startsWith("tv_")) return <Tv className="h-3.5 w-3.5 text-muted-foreground" />
    return <Film className="h-3.5 w-3.5 text-muted-foreground" />
}

function KeyBadge({ status }: { status?: DistributionKeyStatus }) {
    if (!status || status === "draft")
        return <Badge variant="outline" className="gap-1 text-xs text-muted-foreground font-normal"><AlertCircle className="h-3 w-3" />Ingen</Badge>
    if (status === "proposed" || status === "negotiating" || status === "accepted")
        return <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 font-normal"><Clock className="h-3 w-3" />Afventer</Badge>
    return <Badge variant="outline" className="gap-1 text-xs text-green-700 border-green-300 bg-green-50 dark:bg-green-950 font-normal"><Lock className="h-3 w-3" />Låst</Badge>
}

function ContractBadge({ status }: { status?: string }) {
    if (status === "ok")
        return <Badge variant="outline" className="gap-1 text-xs text-green-700 border-green-300 bg-green-50 dark:bg-green-950 font-normal"><CheckCircle2 className="h-3 w-3" />OK</Badge>
    if (status === "pending")
        return <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 font-normal"><Clock className="h-3 w-3" />Afventer</Badge>
    return <Badge variant="outline" className="gap-1 text-xs text-red-600 border-red-300 bg-red-50 dark:bg-red-950 font-normal"><AlertCircle className="h-3 w-3" />Mangler</Badge>
}

type SortField = "number" | "title" | "type" | "year" | "editors" | "key" | "contract"
type SortDir = "asc" | "desc"

export default function VaerkerPage() {
    const [search, setSearch] = useState("")
    const [filterType, setFilterType] = useState("all")
    const [filterYear, setFilterYear] = useState("all")
    const [filterKey, setFilterKey] = useState("all")
    const [filterContract, setFilterContract] = useState("all")
    const [sortField, setSortField] = useState<SortField>("number")
    const [sortDir, setSortDir] = useState<SortDir>("asc")

    const years = useMemo(() =>
        [...new Set(mockWorks.map(w => w.premiereYear))].sort((a, b) => b - a), [])

    const filtered = useMemo(() => {
        const q = search.toLowerCase()
        let result = mockWorks.filter(w => {
            const matchSearch = !q ||
                w.title.toLowerCase().includes(q) ||
                w.productionNumber.includes(q) ||
                w.editors.some(e => e.name.toLowerCase().includes(q))
            const matchType = filterType === "all" || TYPE_GROUPS[filterType]?.includes(w.type)
            const matchYear = filterYear === "all" || w.premiereYear === parseInt(filterYear)
            const matchKey = filterKey === "all" ||
                (filterKey === "locked" && w.distributionKeyStatus === "locked") ||
                (filterKey === "pending" && ["proposed", "negotiating", "accepted"].includes(w.distributionKeyStatus ?? "")) ||
                (filterKey === "missing" && (!w.distributionKeyStatus || w.distributionKeyStatus === "draft"))
            const matchContract = filterContract === "all" || w.contractStatus === filterContract
            return matchSearch && matchType && matchYear && matchKey && matchContract
        })

        result.sort((a, b) => {
            let cmp = 0
            switch (sortField) {
                case "number": cmp = a.productionNumber.localeCompare(b.productionNumber, undefined, { numeric: true }); break
                case "title": cmp = a.title.localeCompare(b.title, "da"); break
                case "type": cmp = a.type.localeCompare(b.type); break
                case "year": cmp = a.premiereYear - b.premiereYear; break
                case "editors": cmp = a.editors.length - b.editors.length; break
                case "key": cmp = (a.distributionKeyStatus ?? "").localeCompare(b.distributionKeyStatus ?? ""); break
                case "contract": cmp = (a.contractStatus ?? "").localeCompare(b.contractStatus ?? ""); break
            }
            return sortDir === "asc" ? cmp : -cmp
        })
        return result
    }, [search, filterType, filterYear, filterKey, filterContract, sortField, sortDir])

    const toggleSort = (field: SortField) => {
        if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc")
        else { setSortField(field); setSortDir("asc") }
    }

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />
        return sortDir === "asc" ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />
    }

    const SortBtn = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
        <button className="flex items-center text-xs font-medium" onClick={() => toggleSort(field)}>
            {children}<SortIcon field={field} />
        </button>
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title="Værker"
                subtitle={`${filtered.length} af ${mockWorks.length} værker`}
            />

            {/* Søgning + filtre */}
            <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Søg på titel, nummer eller klipper..."
                        className="pl-9"
                    />
                </div>
                <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-[170px]">
                        <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
                        <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle typer</SelectItem>
                        {Object.keys(TYPE_GROUPS).map(g => (
                            <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger className="w-[110px]">
                        <SelectValue placeholder="År" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle år</SelectItem>
                        {years.map(y => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filterKey} onValueChange={setFilterKey}>
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Fordelingsnøgle" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle nøgler</SelectItem>
                        <SelectItem value="locked">Låst</SelectItem>
                        <SelectItem value="pending">Afventer</SelectItem>
                        <SelectItem value="missing">Ingen nøgle</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={filterContract} onValueChange={setFilterContract}>
                    <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Kontrakt" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Alle kontrakter</SelectItem>
                        <SelectItem value="ok">OK</SelectItem>
                        <SelectItem value="pending">Afventer</SelectItem>
                        <SelectItem value="missing">Mangler</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Tabel */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-16"><SortBtn field="number">#</SortBtn></TableHead>
                            <TableHead><SortBtn field="title">Titel</SortBtn></TableHead>
                            <TableHead><SortBtn field="type">Type</SortBtn></TableHead>
                            <TableHead className="w-20"><SortBtn field="year">År</SortBtn></TableHead>
                            <TableHead><SortBtn field="editors">Klippere</SortBtn></TableHead>
                            <TableHead><SortBtn field="key">Fordelingsnøgle</SortBtn></TableHead>
                            <TableHead><SortBtn field="contract">Kontrakt</SortBtn></TableHead>
                            <TableHead className="w-24" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                                    Ingen værker matcher søgningen
                                </TableCell>
                            </TableRow>
                        ) : filtered.map(w => (
                            <TableRow key={w.id}>
                                <TableCell className="tabular-nums text-muted-foreground text-sm">{w.productionNumber}</TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <TypeIcon type={w.type} />
                                        <span className="font-medium">{w.title}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{TYPE_LABELS[w.type]}</TableCell>
                                <TableCell className="tabular-nums text-sm text-muted-foreground">{w.premiereYear}</TableCell>
                                <TableCell>
                                    {w.editors.length === 0 ? (
                                        <span className="text-xs text-muted-foreground">—</span>
                                    ) : (
                                        <div className="flex items-center gap-1.5">
                                            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span className="text-sm">
                                                {w.editors.length === 1
                                                    ? w.editors[0].name
                                                    : `${w.editors[0].name} +${w.editors.length - 1}`}
                                            </span>
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell><KeyBadge status={w.distributionKeyStatus} /></TableCell>
                                <TableCell><ContractBadge status={w.contractStatus} /></TableCell>
                                <TableCell>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                                        <Link href={`/admin/streaming/${w.id}`}>Se værk</Link>
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
