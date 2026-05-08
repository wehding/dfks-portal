"use client"

import { useState } from "react"
import { CheckCircle2, Clock, Lock, AlertCircle, ChevronDown, ChevronUp, FileUp, Film, Tv } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
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

interface MyProduction {
    id: string
    productionNumber: string
    title: string
    type: ProductionType
    premiereYear: number
    hasContract: boolean        // Om kontrakt er i arkivet
    distributionKey?: MyDistributionKey
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

export default function PortalOkonomiPage() {
    const { addContract } = useContracts()
    const [expanded, setExpanded] = useState<string | null>("008")
    const [accepted, setAccepted] = useState<Set<string>>(new Set())
    const [uploadFor, setUploadFor] = useState<MyProduction | null>(null)

    const totalPaid = myProductions.reduce((s, p) =>
        s + p.payouts.filter(pay => pay.status === "paid").reduce((a, pay) => a + pay.myAmount, 0), 0)
    const totalPending = myProductions.reduce((s, p) =>
        s + p.payouts.filter(pay => pay.status !== "paid").reduce((a, pay) => a + pay.myAmount, 0), 0)
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
                <h1 className="text-2xl font-semibold tracking-tight">Økonomi</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Dine streaming-vederlag via Create Denmark
                </p>
            </div>

            {/* Overblik */}
            <div className="grid grid-cols-3 gap-4">
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
                                                        Din kontrakt for dette værk er ikke registreret i arkivet. Upload den som dokumentation for dine bevarede rettigheder.
                                                    </p>
                                                </div>
                                                <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300" onClick={() => setUploadFor(production)}>
                                                    <FileUp className="h-3.5 w-3.5 mr-1.5" />
                                                    Upload kontrakt
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
                        creditedRole: "Klipper",
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
