"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, Film, Tv, ChevronRight, CheckCircle2, Clock, Lock, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { NewProductionDialog } from "@/components/streaming/new-production-dialog"
import type { StreamingProduction, DistributionKeyStatus, ProductionType } from "@/lib/streaming-types"

// ── Mock data fra Excel ──────────────────────────────────────

interface MockEditor {
    name: string
    sharePercent?: number
}

interface MockProduction extends StreamingProduction {
    editors: MockEditor[]
    distributionKeyStatus?: DistributionKeyStatus
    pendingPayouts: number
    totalReceived: number
    latestPayoutYear?: number
}

const mockProductions: MockProduction[] = [
    {
        id: "001", productionNumber: "001", title: "Kærlighed for voksne",
        type: "film_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 15,
        createdAt: "2022-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [{ name: "Lars Wissing", sharePercent: 100 }],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 89993, latestPayoutYear: 2024,
    },
    {
        id: "002", productionNumber: "002", title: "Nisser",
        type: "tv_series_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2023-01-01", createdBy: "admin",
        editors: [
            { name: "Michael Bauer", sharePercent: 33.33 },
            { name: "Ida Bregninge", sharePercent: 33.33 },
            { name: "Dan Loghin", sharePercent: 33.33 },
        ],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 27865, latestPayoutYear: 2022,
    },
    {
        id: "003", productionNumber: "003", title: "Toscana",
        type: "film_licensed", premiereYear: 2022,
        licenseDurationYears: 10, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { name: "Anders Hoffmann", sharePercent: 60 },
            { name: "Niels Ostenfeld", sharePercent: 40 },
        ],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 33447, latestPayoutYear: 2023,
    },
    {
        id: "004", productionNumber: "004", title: "Kastanjemanden",
        type: "tv_series_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2023-01-01", createdBy: "admin",
        editors: [
            { name: "Cathrine Ambus", sharePercent: 33.33 },
            { name: "Anja Farsig", sharePercent: 33.33 },
            { name: "Martin Schade", sharePercent: 25 },
            { name: "Lars Therkelsen", sharePercent: 8.33 },
        ],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 55731, latestPayoutYear: 2022,
    },
    {
        id: "005", productionNumber: "005", title: "Skruk Sæson 1",
        type: "tv_series_original", premiereYear: 2022,
        licenseDurationYears: 50, licenseStartYear: 2022, adminFeePercent: 10,
        createdAt: "2022-01-01", updatedAt: "2022-01-01", createdBy: "admin",
        editors: [],
        distributionKeyStatus: "draft", pendingPayouts: 1,
        totalReceived: 0,
    },
    {
        id: "006", productionNumber: "006", title: "Ehrengard",
        type: "tv_series_original", premiereYear: 2023,
        licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 10,
        createdAt: "2023-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { name: "Janus Billeskov Jansen", sharePercent: 60 },
            { name: "Biel Andrés", sharePercent: 40 },
        ],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 47970, latestPayoutYear: 2023,
    },
    {
        id: "007", productionNumber: "007", title: "A Beautiful Life",
        type: "tv_series_original", premiereYear: 2023,
        licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 15,
        createdAt: "2023-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [{ name: "Anders Hofman", sharePercent: 100 }],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 56260, latestPayoutYear: 2024,
    },
    {
        id: "008", productionNumber: "008", title: "Sygeplejersken",
        type: "tv_series_original", premiereYear: 2023,
        licenseDurationYears: 50, licenseStartYear: 2023, adminFeePercent: 15,
        createdAt: "2023-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { name: "Elin Pröjts", sharePercent: 25 },
            { name: "Anna Heide", sharePercent: 37.5 },
            { name: "Benjamin Binderup", sharePercent: 25 },
            { name: "Tómas Gislason", sharePercent: 12.5 },
        ],
        distributionKeyStatus: "proposed", pendingPayouts: 1,
        totalReceived: 43292, latestPayoutYear: 2024,
    },
    {
        id: "009", productionNumber: "009", title: "Skruk Sæson 2",
        type: "tv_series_original", premiereYear: 2024,
        licenseDurationYears: 50, licenseStartYear: 2024, adminFeePercent: 10,
        createdAt: "2024-01-01", updatedAt: "2024-01-01", createdBy: "admin",
        editors: [
            { name: "Lars Terkelsen", sharePercent: 22.23 },
            { name: "Jakob Juul Toldam", sharePercent: 33.33 },
            { name: "Kasper Schultz Simonsen", sharePercent: 44.43 },
        ],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 28808, latestPayoutYear: 2024,
    },
    {
        id: "010", productionNumber: "010", title: "Bytte Bytte Baby 2",
        type: "film_original", premiereYear: 2024,
        licenseDurationYears: 50, licenseStartYear: 2024, adminFeePercent: 10,
        createdAt: "2024-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [
            { name: "Benjamin Binderup", sharePercent: 50 },
            { name: "Carsten Søsted", sharePercent: 50 },
        ],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 18000, latestPayoutYear: 2024,
    },
    {
        id: "011", productionNumber: "011", title: "Sult",
        type: "film_original", premiereYear: 2025,
        licenseDurationYears: 50, licenseStartYear: 2025, adminFeePercent: 15,
        createdAt: "2025-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [
            { name: "Peter Winther", sharePercent: 50 },
            { name: "Viola Frederikke Lindkvist Hjorth", sharePercent: 50 },
        ],
        distributionKeyStatus: "accepted", pendingPayouts: 1,
        totalReceived: 28946, latestPayoutYear: 2025,
    },
    {
        id: "012", productionNumber: "012", title: "Reservatet",
        type: "tv_series_original", premiereYear: 2025,
        licenseDurationYears: 50, licenseStartYear: 2025, adminFeePercent: 15,
        createdAt: "2025-01-01", updatedAt: "2025-01-01", createdBy: "admin",
        editors: [
            { name: "Anja Farsig", sharePercent: 22 },
            { name: "Kasper Leick", sharePercent: 39 },
            { name: "Frederik Strunk", sharePercent: 39 },
        ],
        distributionKeyStatus: "locked", pendingPayouts: 0,
        totalReceived: 70541, latestPayoutYear: 2025,
    },
]

// ── Helpers ──────────────────────────────────────────────────

function typeLabel(type: ProductionType): string {
    const map: Record<ProductionType, string> = {
        film_original: "Film · Original",
        film_licensed: "Film · Licenseret",
        tv_series_original: "TV Serie · Original",
        tv_series_licensed: "TV Serie · Licenseret",
        short_original: "Kortfilm · Original",
        documentary_original: "Dokumentar · Original",
    }
    return map[type] ?? type
}

function TypeIcon({ type }: { type: ProductionType }) {
    if (type.startsWith("film") || type.startsWith("short") || type.startsWith("documentary")) {
        return <Film className="h-3.5 w-3.5" />
    }
    return <Tv className="h-3.5 w-3.5" />
}

function KeyStatusBadge({ status }: { status?: DistributionKeyStatus }) {
    if (!status || status === "draft") {
        return <Badge variant="outline" className="gap-1 text-muted-foreground"><AlertCircle className="h-3 w-3" />Ingen nøgle</Badge>
    }
    if (status === "proposed" || status === "negotiating") {
        return <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950"><Clock className="h-3 w-3" />Afventer accept</Badge>
    }
    if (status === "accepted") {
        return <Badge variant="outline" className="gap-1 text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950"><CheckCircle2 className="h-3 w-3" />Accepteret</Badge>
    }
    if (status === "locked") {
        return <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50 dark:bg-green-950"><Lock className="h-3 w-3" />Låst</Badge>
    }
    return null
}

function fmt(n: number) {
    return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(n)
}

// ── Page ─────────────────────────────────────────────────────

export default function StreamingPage() {
    const [search, setSearch] = useState("")
    const [showNew, setShowNew] = useState(false)

    const q = search.toLowerCase()
    const filtered = mockProductions.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.productionNumber.includes(q) ||
        p.editors.some(e => e.name.toLowerCase().includes(q))
    )

    const totalReceived = mockProductions.reduce((s, p) => s + p.totalReceived, 0)
    const pendingCount = mockProductions.filter(p => p.pendingPayouts > 0).length
    const noKeyCount = mockProductions.filter(p => !p.distributionKeyStatus || p.distributionKeyStatus === "draft").length

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Værker</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Rettighedsudbetalinger via Create Denmark
                    </p>
                </div>
                <Button onClick={() => setShowNew(true)}>
                    <Plus className="h-4 w-4" />
                    Nyt værk
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Værker</p>
                    <p className="mt-1 text-2xl font-semibold">{mockProductions.length}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Afventer udbetaling</p>
                    <p className="mt-1 text-2xl font-semibold">{pendingCount}</p>
                    {pendingCount > 0 && (
                        <p className="mt-0.5 text-xs text-amber-600">{noKeyCount > 0 ? `${noKeyCount} mangler fordelingsnøgle` : "Klar til eksport"}</p>
                    )}
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Total modtaget</p>
                    <p className="mt-1 text-2xl font-semibold">{fmt(totalReceived)}</p>
                </div>
            </div>

            {/* Search */}
            <Input
                placeholder="Søg på titel, nummer eller klipper..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="max-w-sm"
            />

            {/* List */}
            <div className="rounded-lg border divide-y">
                {filtered.map(p => (
                    <Link
                        key={p.id}
                        href={`/admin/streaming/${p.id}`}
                        className="flex items-center gap-4 px-4 py-3.5 hover:bg-muted/40 transition-colors group"
                    >
                        {/* Number */}
                        <span className="w-8 text-sm font-mono text-muted-foreground shrink-0">
                            {p.productionNumber}
                        </span>

                        {/* Title + type */}
                        <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{p.title}</p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <TypeIcon type={p.type} />
                                {typeLabel(p.type)}
                                {p.season && <><span className="text-muted-foreground/40">·</span>Sæson {p.season}</>}
                                <span className="text-muted-foreground/40">·</span>
                                {p.premiereYear}
                                <span className="text-muted-foreground/40">·</span>
                                {p.licenseDurationYears} år licens
                            </p>
                        </div>

                        {/* Editors */}
                        <div className="hidden md:block w-48 shrink-0">
                            {p.editors.length === 0 ? (
                                <span className="text-xs text-muted-foreground italic">Ingen klippere tilknyttet</span>
                            ) : (
                                <p className="text-xs text-muted-foreground truncate">
                                    {p.editors.map(e => e.name).join(", ")}
                                </p>
                            )}
                        </div>

                        {/* Distribution key status */}
                        <div className="hidden lg:flex w-36 shrink-0 justify-start">
                            <KeyStatusBadge status={p.distributionKeyStatus} />
                        </div>

                        {/* Amount */}
                        <div className="w-28 shrink-0 text-right">
                            {p.totalReceived > 0 ? (
                                <div>
                                    <p className="text-sm font-medium tabular-nums">{fmt(p.totalReceived)}</p>
                                    {p.latestPayoutYear && (
                                        <p className="text-xs text-muted-foreground">senest {p.latestPayoutYear}</p>
                                    )}
                                </div>
                            ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                            )}
                        </div>

                        {/* Chevron */}
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                ))}

                {filtered.length === 0 && (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                        Ingen værker matcher din søgning
                    </div>
                )}
            </div>

            <NewProductionDialog
                open={showNew}
                onClose={() => setShowNew(false)}
                nextProductionNumber={String(mockProductions.length + 1).padStart(3, "0")}
                onCreate={(production) => {
                    // TODO: gem i database
                    console.log("Oprettet:", production)
                    setShowNew(false)
                }}
            />
        </div>
    )
}
