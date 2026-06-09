"use client"

import { useEffect, useState, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
    ThumbsUp, ThumbsDown, AlertTriangle, AlertCircle,
    Info, CheckCircle2, TrendingUp, TrendingDown, Minus,
    FlaskConical,
} from "lucide-react"

type FeedbackRow = {
    id: string
    analyse_id: string
    fund_id: string
    fund_titel: string
    fund_svaerhedsgrad: string
    godkendt: boolean
    korrektion_beskrivelse: string | null
    created_at: string
    org_id: string | null
}

const SVAERHEDSGRAD_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
    kritisk:  { label: "Kritisk",  icon: AlertCircle,  color: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30"    },
    advarsel: { label: "Advarsel", icon: AlertTriangle, color: "text-amber-600",  bg: "bg-amber-50 dark:bg-amber-950/30" },
    positiv:  { label: "Positiv",  icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    info:     { label: "Info",     icon: Info,          color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30"   },
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="rounded-lg border p-4 space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
    )
}

function PrecisionBar({ label, correct, total, config }: {
    label: string
    correct: number
    total: number
    config: typeof SVAERHEDSGRAD_CONFIG[string]
}) {
    const pct = total === 0 ? null : Math.round((correct / total) * 100)
    const Icon = config.icon
    const trend = pct === null ? null : pct >= 80 ? "up" : pct >= 60 ? "flat" : "down"
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                    <span className="text-sm font-medium">{label}</span>
                </div>
                <div className="flex items-center gap-2">
                    {trend === "up"   && <TrendingUp   className="h-3.5 w-3.5 text-emerald-500" />}
                    {trend === "flat" && <Minus         className="h-3.5 w-3.5 text-amber-500"   />}
                    {trend === "down" && <TrendingDown  className="h-3.5 w-3.5 text-red-500"     />}
                    <span className="text-sm tabular-nums font-medium">
                        {pct === null ? "—" : `${pct}%`}
                    </span>
                    <span className="text-xs text-muted-foreground">{correct}/{total}</span>
                </div>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
                {pct !== null && (
                    <div
                        className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${pct}%` }}
                    />
                )}
            </div>
        </div>
    )
}

export default function KvalitetPage() {
    const [feedback, setFeedback] = useState<FeedbackRow[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            const supabase = createClient()
            const { data } = await supabase
                .from("analysis_feedback")
                .select("*")
                .order("created_at", { ascending: false })
            setFeedback(data ?? [])
            setLoading(false)
        }
        load()
    }, [])

    const stats = useMemo(() => {
        const total = feedback.length
        const correct = feedback.filter(f => f.godkendt).length
        const incorrect = total - correct
        const pct = total === 0 ? null : Math.round((correct / total) * 100)

        // Per sværhedsgrad
        const bySvaerhed: Record<string, { correct: number; total: number }> = {}
        for (const f of feedback) {
            const k = f.fund_svaerhedsgrad ?? "info"
            if (!bySvaerhed[k]) bySvaerhed[k] = { correct: 0, total: 0 }
            bySvaerhed[k].total++
            if (f.godkendt) bySvaerhed[k].correct++
        }

        // Hyppigst forkerte fund
        const incorrectMap: Record<string, number> = {}
        for (const f of feedback.filter(f => !f.godkendt)) {
            incorrectMap[f.fund_titel] = (incorrectMap[f.fund_titel] ?? 0) + 1
        }
        const topForkerte = Object.entries(incorrectMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)

        // Seneste 10 med korrektioner
        const medKorrektion = feedback.filter(f => !f.godkendt && f.korrektion_beskrivelse)

        return { total, correct, incorrect, pct, bySvaerhed, topForkerte, medKorrektion }
    }, [feedback])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Henter feedback...
            </div>
        )
    }

    return (
        <div className="space-y-8">
            <PageHeader
                title="AI-kvalitet"
                subtitle="Feedback fra juristers gennemgang af AI-fund — bruges til at forbedre systemet"
            />

            {/* Forklarende intro */}
            <div className="rounded-lg border bg-muted/30 px-5 py-4 space-y-2 text-sm text-muted-foreground max-w-3xl">
                <p>
                    Denne side viser hvor præcist AI-systemet vurderer kontrakter, baseret på juristers feedback fra kontraktgennemgangen.
                    Hver gang en jurist trykker <strong className="text-foreground">👍 Korrekt</strong> eller <strong className="text-foreground">👎 Forkert</strong> på et AI-fund, registreres det her.
                </p>
                <p>
                    Forkerte fund — særligt dem med en korrektion — kan gemmes som <strong className="text-foreground">sagserfaringer</strong> direkte fra gennemgangssiden.
                    De indgår herefter automatisk i AI-prompten ved fremtidige gennemgange via RAG-søgning.
                </p>
            </div>

            {stats.total === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                    <FlaskConical className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm font-medium">Ingen feedback endnu</p>
                    <p className="text-xs text-muted-foreground max-w-sm">
                        Feedback indsamles automatisk når juristen trykker tommelfinger op/ned på fund i kontraktgennemgangen.
                    </p>
                </div>
            ) : (
                <>
                    {/* Overblik */}
                    <div className="space-y-2">
                        <h2 className="text-sm font-semibold">Overblik</h2>
                        <p className="text-xs text-muted-foreground">Samlet antal vurderede fund og andelen AI'en har vurderet korrekt.</p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <Stat label="Fund vurderet" value={stats.total} />
                        <Stat
                            label="Samlet præcision"
                            value={stats.pct === null ? "—" : `${stats.pct}%`}
                            sub={`${stats.correct} korrekte`}
                        />
                        <Stat
                            label="Korrekte fund"
                            value={stats.correct}
                            sub="Godkendt af jurist"
                        />
                        <Stat
                            label="Forkerte fund"
                            value={stats.incorrect}
                            sub="Markeret som fejl"
                        />
                    </div>

                    <Separator />

                    {/* Præcision per kategori */}
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <h2 className="text-sm font-semibold">Præcision per kategori</h2>
                            <p className="text-xs text-muted-foreground">
                                Viser hvor ofte AI'en vurderer korrekt inden for hver fund-type.
                                En lav præcision på f.eks. <em>Kritisk</em> betyder at AI'en for ofte markerer noget som kritisk, der ikke er det — eller omvendt.
                                Brug dette til at skrive sagserfaringer der præciserer AI'ens vurderingskriterier.
                            </p>
                        </div>
                        <div className="space-y-4">
                            {(["kritisk", "advarsel", "positiv", "info"] as const).map(k => {
                                const cfg = SVAERHEDSGRAD_CONFIG[k]
                                const d = stats.bySvaerhed[k] ?? { correct: 0, total: 0 }
                                return (
                                    <PrecisionBar
                                        key={k}
                                        label={cfg.label}
                                        correct={d.correct}
                                        total={d.total}
                                        config={cfg}
                                    />
                                )
                            })}
                        </div>
                    </div>

                    {/* Hyppigst forkerte */}
                    {stats.topForkerte.length > 0 && (
                        <>
                            <Separator />
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <h2 className="text-sm font-semibold">Hyppigst forkerte fund</h2>
                                    <p className="text-xs text-muted-foreground">
                                        Fund-titler som juristen gentagne gange har markeret som forkerte. Jo højere antal, jo vigtigere er det at skrive en sagserfaring der korrigerer AI'ens forståelse af det pågældende emne.
                                    </p>
                                </div>
                                <div className="rounded-lg border divide-y">
                                    {stats.topForkerte.map(([titel, count]) => (
                                        <div key={titel} className="flex items-center justify-between px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <ThumbsDown className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                                <span className="text-sm">{titel}</span>
                                            </div>
                                            <Badge variant="secondary" className="tabular-nums">
                                                {count}×
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Seneste korrektioner */}
                    {stats.medKorrektion.length > 0 && (
                        <>
                            <Separator />
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <h2 className="text-sm font-semibold">Seneste korrektioner fra jurist</h2>
                                    <p className="text-xs text-muted-foreground">
                                        Når juristen markerer et fund som forkert og skriver en korrektion, vises den her.
                                        Korrektionerne kan gemmes som sagserfaringer direkte under <strong>Kontraktgennemgang</strong> (via "Gem som sagserfaring"-knappen),
                                        eller manuelt under <strong>Overenskomster → Sagserfaringer</strong>.
                                        Når de er gemt embeddes de automatisk og bruges ved næste gennemgang.
                                    </p>
                                </div>
                                <div className="space-y-3">
                                    {stats.medKorrektion.slice(0, 10).map(f => {
                                        const cfg = SVAERHEDSGRAD_CONFIG[f.fund_svaerhedsgrad] ?? SVAERHEDSGRAD_CONFIG.info
                                        const Icon = cfg.icon
                                        return (
                                            <div key={f.id} className={`rounded-lg border p-4 space-y-2 ${cfg.bg}`}>
                                                <div className="flex items-center gap-2">
                                                    <Icon className={`h-3.5 w-3.5 ${cfg.color} shrink-0`} />
                                                    <span className="text-sm font-medium">{f.fund_titel}</span>
                                                    <span className="text-xs text-muted-foreground ml-auto">
                                                        {new Date(f.created_at).toLocaleDateString("da-DK")}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-foreground/80 pl-5">{f.korrektion_beskrivelse}</p>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    )
}
