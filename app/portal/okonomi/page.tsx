
"use client"

import { useState, useEffect } from "react"
import { CheckCircle2, Clock, Lock, AlertCircle, ChevronDown, ChevronUp, FileUp, Film, Tv, Database, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { UploadContractDialog } from "@/components/streaming/upload-contract-dialog"
import { useContracts } from "@/lib/hooks"
import type { DistributionKeyStatus, PayoutStatus, ProductionType } from "@/lib/streaming-types"

// ── Mock data — klipper: Anna Heide ──────────────────────────

interface MyShare {
    editorId: string
    sharePercent: number
    acceptedAt?: string
    myAcceptStatus: "accepted" | "pending"
}

interface MyDistributionKey {
    id: string
    status: DistributionKeyStatus
    proposedBy: string
    proposedAt: string
    myShare: MyShare
    allShares: { name: string; sharePercent: number; acceptedAt?: string }[]
}

interface MyPayout {
    id: string
    payoutYear: number
    type: "irf" | "succesbetaling" | "royalties" | "copydan"
    myAmount: number
    status: PayoutStatus
    paidAt?: string
}

interface EpisodeEditor {
    name: string
    userId: string
    isMe: boolean
    sharePercent?: number   // known/locked share
}

interface MyEpisode {
    episodeLabel: string
    editors: EpisodeEditor[]
}

interface MyProduction {
    id: string
    productionNumber: string
    title: string
    type: ProductionType
    premiereYear: number
    hasContract: boolean        // Om kontrakt er i arkivet
    distributionKey?: MyDistributionKey
    episodes?: MyEpisode[]
    payouts: MyPayout[]
    totalReceived: number
}

const myProductions: MyProduction[] = [
    {
        id: "008",
        productionNumber: "008",
        title: "Sygeplejersken",
        type: "tv_series_original",
        premiereYear: 2023,
        hasContract: true,
        distributionKey: {
            id: "dk2",
            status: "proposed",
            proposedBy: "Anna Heide",
            proposedAt: "2025-03-10",
            myShare: { editorId: "e2", sharePercent: 37.5, acceptedAt: "2025-03-10", myAcceptStatus: "accepted" },
            allShares: [
                { name: "Elin Pröjts", sharePercent: 25, acceptedAt: "2025-03-11" },
                { name: "Anna Heide", sharePercent: 37.5, acceptedAt: "2025-03-10" },
                { name: "Benjamin Binderup", sharePercent: 25 },
                { name: "Tómas Gislason", sharePercent: 12.5 },
            ],
        },
        episodes: [
            { episodeLabel: "S1E1", editors: [{ name: "Anna Heide", userId: "u1", isMe: true, sharePercent: 100 }] },
            { episodeLabel: "S1E2", editors: [{ name: "Anna Heide", userId: "u1", isMe: true }, { name: "Benjamin Binderup", userId: "u3", isMe: false }] },
            { episodeLabel: "S1E3", editors: [{ name: "Benjamin Binderup", userId: "u3", isMe: false, sharePercent: 100 }] },
            { episodeLabel: "S1E4", editors: [{ name: "Anna Heide", userId: "u1", isMe: true, sharePercent: 100 }] },
            { episodeLabel: "S1E5", editors: [{ name: "Anna Heide", userId: "u1", isMe: true }, { name: "Tómas Gislason", userId: "u4", isMe: false }] },
            { episodeLabel: "S1E6", editors: [{ name: "Elin Pröjts", userId: "u2", isMe: false, sharePercent: 100 }] },
        ],
        payouts: [
            { id: "p1", payoutYear: 2023, type: "succesbetaling", myAmount: 5201.38, status: "paid", paidAt: "2024-03-01" },
            { id: "p2", payoutYear: 2024, type: "succesbetaling", myAmount: 8886.92, status: "pending" },
        ],
        totalReceived: 5201.38,
    },
    {
        id: "011",
        productionNumber: "011",
        title: "Sult",
        type: "film_original",
        premiereYear: 2025,
        hasContract: false,     // Kontrakt mangler — skal uploades
        distributionKey: {
            id: "dk11",
            status: "proposed",
            proposedBy: "Peter Winther",
            proposedAt: "2025-02-01",
            myShare: { editorId: "e2", sharePercent: 50, myAcceptStatus: "pending" },
            allShares: [
                { name: "Peter Winther", sharePercent: 50, acceptedAt: "2025-02-05" },
                { name: "Anna Heide", sharePercent: 50 },
            ],
        },
        payouts: [
            { id: "p1", payoutYear: 2025, type: "irf", myAmount: 12302.16, status: "pending" },
        ],
        totalReceived: 0,
    },
]

// ── Helpers ──────────────────────────────────────────────────

function fmt2(n: number) {
    return new Intl.NumberFormat("da-DK", {
        style: "currency", currency: "DKK",
        minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(n)
}

function typeLabel(type: ProductionType): string {
    const map: Record<ProductionType, string> = {
        film_original: "Film · Original", film_licensed: "Film · Licenseret",
        tv_series_original: "TV Serie · Original", tv_series_licensed: "TV Serie · Licenseret",
        short_original: "Kortfilm · Original", documentary_original: "Dokumentar · Original",
    }
    return map[type] ?? type
}

function TypeIcon({ type }: { type: ProductionType }) {
    return type.startsWith("tv") ? <Tv className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />
}

function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
    if (status === "pending") return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950">Afventer</Badge>
    if (status === "exported") return <Badge variant="outline" className="text-purple-600 border-purple-300 bg-purple-50 dark:bg-purple-950">Under behandling</Badge>
    if (status === "paid") return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950">Udbetalt</Badge>
    return null
}

// ── Distribution Key Card ─────────────────────────────────────

function DistributionKeyCard({ production, onAccept }: {
    production: MyProduction
    onAccept: (productionId: string) => void
}) {
    const dk = production.distributionKey
    if (!dk) return null

    const myStatus = dk.myShare.myAcceptStatus
    const acceptedCount = dk.allShares.filter(s => s.acceptedAt).length
    const totalCount = dk.allShares.length

    return (
        <div className="rounded-lg border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-sm font-medium">Fordelingsnøgle</h3>
                {dk.status === "locked" && (
                    <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50 dark:bg-green-950">
                        <Lock className="h-3 w-3" />Låst
                    </Badge>
                )}
                {dk.status === "proposed" && (
                    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950">
                        <Clock className="h-3 w-3" />{acceptedCount}/{totalCount} har accepteret
                    </Badge>
                )}
            </div>

            {/* Fordeling */}
            <div className="divide-y">
                {dk.allShares.map((share, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="flex-1 text-sm">{share.name}</span>
                        <span className="tabular-nums text-sm font-medium w-12 text-right">{share.sharePercent}%</span>
                        <div className="w-24 flex justify-end">
                            {share.acceptedAt ? (
                                <span className="flex items-center gap-1 text-xs text-green-600">
                                    <CheckCircle2 className="h-3 w-3" />Accepteret
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-xs text-amber-600">
                                    <Clock className="h-3 w-3" />Afventer
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Min accept */}
            {myStatus === "pending" && dk.status !== "locked" && (
                <div className="px-4 py-3 border-t bg-muted/30 space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Du skal acceptere fordelingsnøglen for at DFKS kan udbetale dit vederlag.
                    </p>
                    <div className="flex gap-2">
                        <Button size="sm" onClick={() => onAccept(production.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Acceptér fordeling
                        </Button>
                        <Button variant="outline" size="sm">
                            Foreslå anden fordeling
                        </Button>
                    </div>
                </div>
            )}

            {myStatus === "accepted" && dk.status !== "locked" && (
                <div className="px-4 py-3 border-t bg-green-50 dark:bg-green-950">
                    <p className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Du har accepteret — afventer de øvrige klippere
                    </p>
                </div>
            )}
        </div>
    )
}

// ── Page ─────────────────────────────────────────────────────

// ── Aftalelicens types ────────────────────────────────────────
interface AlKlipper { name: string; userId?: string; sharePercent: number; amount: number }
interface AlEpisode { episodeLabel: string; broadcastDate?: string; isGenudsendelse: boolean; amount: number; klippere?: AlKlipper[] }
interface AlVaerk { workId?: string; workTitle: string; vaerkType: string; totalAmount: number; klippere?: AlKlipper[]; episodes?: AlEpisode[]; status?: "pending" | "paid" }
interface AlEntry { id: string; batchLabel: string; lockedAt: string; vaerker: AlVaerk[] }

// Logged-in klipper (mock)
const MY_USER_ID = "u1"
const MY_NAME = "Anna Heide"

export default function PortalOkonomiPage() {
    const { addContract } = useContracts()
    const [expanded, setExpanded] = useState<string | null>("008")
    const [accepted, setAccepted] = useState<Set<string>>(new Set())
    const [uploadFor, setUploadFor] = useState<MyProduction | null>(null)
    const [alData, setAlData] = useState<{ entry: AlEntry; vaerk: AlVaerk; myAmount: number }[]>([])
    const [expandedAl, setExpandedAl] = useState<string | null>(null)
    // Episode distribution: key = `${productionId}_${episodeLabel}`, value = { percent: string, weeks: string }
    const [episodeInputs, setEpisodeInputs] = useState<Record<string, { percent: string; weeks: string }>>({})
    // Input mode per production: "percent" | "weeks"
    const [epInputMode, setEpInputMode] = useState<Record<string, "percent" | "weeks">>({})

    function setEpInput(productionId: string, episodeLabel: string, field: "percent" | "weeks", value: string) {
        const key = `${productionId}_${episodeLabel}`
        setEpisodeInputs(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
    }

    function getEpInput(productionId: string, episodeLabel: string) {
        return episodeInputs[`${productionId}_${episodeLabel}`] ?? { percent: "", weeks: "" }
    }

    useEffect(() => {
        const stored: AlEntry[] = JSON.parse(localStorage.getItem("dfks_al_udbetalinger") ?? "[]")
        // Seed demo entry for Anna Heide if none exists
        if (!stored.some(e => e.vaerker.some(v =>
            v.klippere?.some(k => k.userId === MY_USER_ID) ||
            v.episodes?.some(ep => ep.klippere?.some(k => k.userId === MY_USER_ID))
        ))) {
            const demo: AlEntry = {
                id: "al_demo_anna",
                batchLabel: "Copydan Verdens TV 2023",
                lockedAt: new Date().toISOString(),
                vaerker: [{
                    workId: "008",
                    workTitle: "Sygeplejersken",
                    vaerkType: "tv_serie_lang",
                    totalAmount: 112000,
                    episodes: [
                        { episodeLabel: "S1E3", broadcastDate: "2023-10-05", isGenudsendelse: false, amount: 38000, klippere: [{ name: MY_NAME, userId: MY_USER_ID, sharePercent: 100, amount: 38000 }] },
                        { episodeLabel: "S1E5", broadcastDate: "2023-10-19", isGenudsendelse: false, amount: 38000, klippere: [{ name: MY_NAME, userId: MY_USER_ID, sharePercent: 100, amount: 38000 }] },
                        { episodeLabel: "S1E5", broadcastDate: "2023-11-02", isGenudsendelse: true, amount: 19000, klippere: [{ name: MY_NAME, userId: MY_USER_ID, sharePercent: 100, amount: 19000 }] },
                    ],
                }],
            }
            stored.push(demo)
            localStorage.setItem("dfks_al_udbetalinger", JSON.stringify(stored))
        }
        // Filter for this klipper
        const result: { entry: AlEntry; vaerk: AlVaerk; myAmount: number }[] = []
        for (const entry of stored) {
            for (const vaerk of entry.vaerker) {
                const myEpisodes = vaerk.episodes?.filter(ep => ep.klippere?.some(k => k.userId === MY_USER_ID || k.name === MY_NAME))
                const myFilmKlipper = vaerk.klippere?.find(k => k.userId === MY_USER_ID || k.name === MY_NAME)
                if (myEpisodes?.length || myFilmKlipper) {
                    const myAmount = myEpisodes
                        ? myEpisodes.reduce((s, ep) => s + (ep.klippere?.find(k => k.userId === MY_USER_ID || k.name === MY_NAME)?.amount ?? 0), 0)
                        : (myFilmKlipper?.amount ?? 0)
                    result.push({ entry, vaerk: { ...vaerk, episodes: myEpisodes ?? vaerk.episodes }, myAmount })
                }
            }
        }
        setAlData(result)
    }, [])

    const totalPaid = myProductions.reduce((s, p) =>
        s + p.payouts.filter(pay => pay.status === "paid").reduce((a, pay) => a + pay.myAmount, 0), 0)
        + alData.filter(d => d.vaerk.status === "paid").reduce((s, d) => s + d.myAmount, 0)
    const totalPending = myProductions.reduce((s, p) =>
        s + p.payouts.filter(pay => pay.status !== "paid").reduce((a, pay) => a + pay.myAmount, 0), 0)
        + alData.filter(d => d.vaerk.status !== "paid").reduce((s, d) => s + d.myAmount, 0)
    const needsAction = myProductions.filter(p =>
        p.distributionKey?.myShare.myAcceptStatus === "pending" && !accepted.has(p.id)
    ).length

    function handleAccept(productionId: string) {
        setAccepted(prev => new Set([...prev, productionId]))
    }

    return (
        <>
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="hidden text-2xl font-semibold tracking-tight sm:block">Økonomi</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Dine streaming-vederlag via Create Denmark
                </p>
            </div>

            {/* Overblik */}
            <div className="hidden grid-cols-3 gap-4 sm:grid">
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Udbetalt i alt</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{fmt2(totalPaid)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Afventer udbetaling</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{fmt2(totalPending)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Kræver handling</p>
                    <p className={`mt-1 text-xl font-semibold ${needsAction > 0 ? "text-amber-600" : ""}`}>
                        {needsAction > 0 ? `${needsAction} ${needsAction > 1 ? "værker" : "værk"}` : "—"}
                    </p>
                </div>
            </div>

            {/* Produktioner */}
            <div className="space-y-3">
                {myProductions.map(production => {
                    const isExpanded = expanded === production.id
                    const needsAccept = production.distributionKey?.myShare.myAcceptStatus === "pending" && !accepted.has(production.id)
                    const missingContract = !production.hasContract

                    return (
                        <div key={production.id} className="rounded-lg border overflow-hidden">
                            {/* Header */}
                            <button
                                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors text-left"
                                onClick={() => setExpanded(isExpanded ? null : production.id)}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium truncate">{production.title}</p>
                                        {needsAccept && (
                                            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 shrink-0">
                                                <AlertCircle className="h-3 w-3" />Handling krævet
                                            </Badge>
                                        )}
                                        {missingContract && (
                                            <Badge variant="outline" className="gap-1 text-red-600 border-red-300 bg-red-50 dark:bg-red-950 shrink-0">
                                                <FileUp className="h-3 w-3" />Kontrakt mangler
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <TypeIcon type={production.type} />
                                        {typeLabel(production.type)}
                                        <span className="text-muted-foreground/40">·</span>
                                        {production.premiereYear}
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-sm font-medium tabular-nums">{fmt2(totalPaid > 0 ? production.totalReceived : 0)}</p>
                                    <p className="text-xs text-muted-foreground">modtaget</p>
                                </div>
                                {isExpanded
                                    ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                                    : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                }
                            </button>

                            {/* Expanded */}
                            {isExpanded && (
                                <div className="border-t bg-muted/10 p-4 space-y-4">
                                    {/* Manglende kontrakt */}
                                    {missingContract && (
                                        <div className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3">
                                            <FileUp className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                                            <div className="flex-1 space-y-2">
                                                <div>
                                                    <p className="text-sm font-medium text-red-700 dark:text-red-300">Kontrakt mangler</p>
                                                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                                                        Din kontrakt for dette værk er ikke registreret i arkivet. Send den til DFKS som dokumentation for dine bevarede rettigheder.
                                                    </p>
                                                </div>
                                                <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300" onClick={() => setUploadFor(production)}>
                                                    <FileUp className="h-3.5 w-3.5 mr-1.5" />
                                                    Send kontrakt
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Fordelingsnøgle */}
                                    {production.distributionKey && (
                                        <DistributionKeyCard
                                            production={accepted.has(production.id)
                                                ? { ...production, distributionKey: { ...production.distributionKey, myShare: { ...production.distributionKey.myShare, myAcceptStatus: "accepted" } } }
                                                : production
                                            }
                                            onAccept={handleAccept}
                                        />
                                    )}

                                    {/* Afsnit */}
                                    {production.episodes && production.episodes.length > 0 && (() => {
                                        const mode = epInputMode[production.id] ?? "percent"
                                        const sharedEpisodes = production.episodes.filter(ep => ep.editors.length > 1 && ep.editors.some(e => e.isMe))
                                        return (
                                            <div className="rounded-lg border">
                                                <div className="flex items-center justify-between px-4 py-3 border-b">
                                                    <h3 className="text-sm font-medium">Afsnit</h3>
                                                    {sharedEpisodes.length > 0 && (
                                                        <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs">
                                                            <button
                                                                onClick={() => setEpInputMode(prev => ({ ...prev, [production.id]: "percent" }))}
                                                                className={`px-2 py-0.5 rounded transition-colors ${mode === "percent" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                                            >%</button>
                                                            <button
                                                                onClick={() => setEpInputMode(prev => ({ ...prev, [production.id]: "weeks" }))}
                                                                className={`px-2 py-0.5 rounded transition-colors ${mode === "weeks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                                            >uger</button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="divide-y">
                                                    {production.episodes.map((ep, i) => {
                                                        const isShared = ep.editors.length > 1
                                                        const isMeInvolved = ep.editors.some(e => e.isMe)
                                                        const myEditor = ep.editors.find(e => e.isMe)
                                                        const inputs = getEpInput(production.id, ep.episodeLabel)

                                                        // Calculate derived percent from weeks if mode=weeks
                                                        const allWeeks = isShared && isMeInvolved
                                                            ? ep.editors.map(e => {
                                                                if (e.isMe) return parseFloat(inputs.weeks) || 0
                                                                // other editors' weeks unknown until they enter — for now just show pending
                                                                return null
                                                            })
                                                            : []
                                                        const allWeeksEntered = allWeeks.every(w => w !== null && w > 0)

                                                        let derivedPercent: number | null = null
                                                        if (mode === "weeks" && isMeInvolved && isShared) {
                                                            const myWeeks = parseFloat(inputs.weeks) || 0
                                                            // Only show derived % if we know all weeks — simplification: single-side entry
                                                            if (myWeeks > 0) {
                                                                // We can't calculate without other editors' weeks in this mock
                                                                // Show pending note instead
                                                            }
                                                        }
                                                        if (mode === "percent" && isMeInvolved && isShared) {
                                                            derivedPercent = parseFloat(inputs.percent) || null
                                                        }

                                                        return (
                                                            <div key={i} className={`px-4 py-3 ${isShared && isMeInvolved ? "bg-muted/20" : ""}`}>
                                                                <div className="flex items-start gap-3">
                                                                    <span className="font-mono text-sm font-medium w-12 shrink-0">{ep.episodeLabel}</span>
                                                                    <div className="flex-1 space-y-2">
                                                                        <div className="flex flex-wrap gap-1.5">
                                                                            {ep.editors.map((ed, j) => (
                                                                                <span key={j} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md border ${ed.isMe ? "bg-primary/10 border-primary/30 font-medium" : "bg-muted border-border text-muted-foreground"}`}>
                                                                                    {ed.sharePercent !== undefined && !isShared ? null : <Users className="h-3 w-3" />}
                                                                                    {ed.name}
                                                                                    {ed.sharePercent !== undefined && isShared && <span className="text-muted-foreground">{ed.sharePercent}%</span>}
                                                                                </span>
                                                                            ))}
                                                                        </div>

                                                                        {/* Distribution input for shared episodes where I'm involved and no locked share */}
                                                                        {isShared && isMeInvolved && myEditor?.sharePercent === undefined && (
                                                                            <div className="flex items-center gap-2 mt-1">
                                                                                <span className="text-xs text-muted-foreground w-20 shrink-0">Min andel:</span>
                                                                                {mode === "percent" ? (
                                                                                    <div className="flex items-center gap-1">
                                                                                        <Input
                                                                                            type="number"
                                                                                            min={0} max={100} step={0.5}
                                                                                            placeholder="0"
                                                                                            value={inputs.percent}
                                                                                            onChange={e => setEpInput(production.id, ep.episodeLabel, "percent", e.target.value)}
                                                                                            className="h-7 w-20 text-sm text-right"
                                                                                        />
                                                                                        <span className="text-sm text-muted-foreground">%</span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="flex items-center gap-2">
                                                                                        <div className="flex items-center gap-1">
                                                                                            <Input
                                                                                                type="number"
                                                                                                min={0} step={0.5}
                                                                                                placeholder="0"
                                                                                                value={inputs.weeks}
                                                                                                onChange={e => setEpInput(production.id, ep.episodeLabel, "weeks", e.target.value)}
                                                                                                className="h-7 w-20 text-sm text-right"
                                                                                            />
                                                                                            <span className="text-sm text-muted-foreground">uger</span>
                                                                                        </div>
                                                                                        <span className="text-xs text-muted-foreground italic">Procent beregnes når alle har indtastet</span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                                {sharedEpisodes.some(ep => {
                                                    const inp = getEpInput(production.id, ep.episodeLabel)
                                                    return mode === "percent" ? !!inp.percent : !!inp.weeks
                                                }) && (
                                                    <div className="px-4 py-3 border-t bg-muted/30 flex justify-end">
                                                        <Button size="sm" className="gap-1.5">
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                            Send forslag til DFKS
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })()}

                                    {/* Udbetalinger */}
                                    <div className="rounded-lg border">
                                        <div className="px-4 py-3 border-b">
                                            <h3 className="text-sm font-medium">Udbetalinger</h3>
                                        </div>
                                        <div className="divide-y">
                                            {production.payouts.map(payout => (
                                                <div key={payout.id} className="flex items-center gap-3 px-4 py-3">
                                                    <div className="flex-1">
                                                        <p className="text-sm">
                                                            {payout.payoutYear} — {{ irf: "IRF", succesbetaling: "Succesbetaling", royalties: "Royalties", copydan: "Copydan" }[payout.type]}
                                                        </p>
                                                        {payout.paidAt && (
                                                            <p className="text-xs text-muted-foreground">Udbetalt {payout.paidAt}</p>
                                                        )}
                                                    </div>
                                                    <p className="text-sm font-medium tabular-nums">{fmt2(payout.myAmount)}</p>
                                                    <PayoutStatusBadge status={payout.status} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Aftalelicens */}
            {alData.length > 0 && (
                <div className="space-y-3">
                    <div>
                        <h2 className="text-lg font-semibold">Aftalelicens</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">Dine vederlag fra Copydan og TV2 Play</p>
                    </div>
                    <div className="space-y-3">
                        {alData.map(({ entry, vaerk, myAmount }, i) => {
                            const key = `${entry.id}_${i}`
                            const isExpanded = expandedAl === key
                            const status = vaerk.status ?? "pending"
                            return (
                                <div key={key} className="rounded-lg border overflow-hidden">
                                    <button
                                        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors text-left"
                                        onClick={() => setExpandedAl(isExpanded ? null : key)}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-medium truncate">{vaerk.workTitle}</p>
                                                {status === "paid"
                                                    ? <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950 shrink-0">Udbetalt</Badge>
                                                    : <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 shrink-0">Afventer</Badge>
                                                }
                                            </div>
                                            <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1.5">
                                                <Database className="h-3 w-3" />
                                                {entry.batchLabel}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-sm font-medium tabular-nums">{fmt2(myAmount)}</p>
                                            <p className="text-xs text-muted-foreground">mit beløb</p>
                                        </div>
                                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                                    </button>
                                    {isExpanded && (
                                        <div className="border-t bg-muted/10 p-4 space-y-3">
                                            <p className="text-xs text-muted-foreground">Låst {new Date(entry.lockedAt).toLocaleDateString("da-DK")}</p>
                                            {vaerk.episodes && vaerk.episodes.length > 0 && (
                                                <div className="rounded-md border divide-y text-xs bg-card">
                                                    {vaerk.episodes.map((ep, j) => {
                                                        const myKlipper = ep.klippere?.find(k => k.userId === MY_USER_ID || k.name === MY_NAME)
                                                        return (
                                                            <div key={j} className="flex items-center gap-2 px-3 py-2.5">
                                                                <span className="font-mono text-muted-foreground">↳</span>
                                                                <span className="font-mono font-medium">{ep.episodeLabel}</span>
                                                                {ep.broadcastDate && (
                                                                    <span className="text-muted-foreground">
                                                                        {new Date(ep.broadcastDate).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                                                                    </span>
                                                                )}
                                                                {ep.isGenudsendelse && (
                                                                    <span className="inline-flex items-center rounded px-1 py-0 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">½</span>
                                                                )}
                                                                {myKlipper && myKlipper.sharePercent < 100 && (
                                                                    <span className="text-muted-foreground">{myKlipper.sharePercent}%</span>
                                                                )}
                                                                <span className="ml-auto tabular-nums font-medium">
                                                                    {fmt2(myKlipper?.amount ?? 0)}
                                                                </span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                            {vaerk.klippere && !vaerk.episodes && (() => {
                                                const myKlipper = vaerk.klippere.find(k => k.userId === MY_USER_ID || k.name === MY_NAME)
                                                return myKlipper ? (
                                                    <div className="rounded-md border text-xs bg-card px-3 py-2.5 flex justify-between">
                                                        <span className="text-muted-foreground">{myKlipper.sharePercent}% andel</span>
                                                        <span className="tabular-nums font-medium">{fmt2(myKlipper.amount)}</span>
                                                    </div>
                                                ) : null
                                            })()}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>

        <UploadContractDialog
            open={!!uploadFor}
            onClose={() => setUploadFor(null)}
            productionTitle={uploadFor?.title ?? ""}
            productionId={uploadFor?.id ?? ""}
            onUploaded={(_, file) => {
                if (uploadFor) {
                    const today = new Date().toISOString().slice(0, 10)
                    addContract({
                        id: `portal_${Date.now()}`,
                        userId: "u1",
                        userName: "Anna Heide",
                        title: uploadFor.title,
                        category: "feature",
                        creditedRoles: ["Klipper"],
                        duration: 0,
                        premiereDate: today,
                        premiereYear: new Date().getFullYear(),
                        fileUrl: "",
                        status: "pending",
                        uploadedAt: today,
                    })
                }
                setUploadFor(null)
            }}
        />
        </>
    )
}
