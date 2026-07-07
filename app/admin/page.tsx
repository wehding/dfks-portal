"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    FileText, CheckCircle, AlertCircle, Users2,
    ArrowRight, Clock, Scale, UserCheck, Cpu,
} from "lucide-react"

type EmbeddingHealth = {
    google: { ok: boolean; ms: number }
    syv: { ok: boolean; ms: number }
    aktiv: string
}

function EmbeddingStatus() {
    const [health, setHealth] = useState<EmbeddingHealth | null>(null)

    useEffect(() => {
        fetch("/api/health/embeddings")
            .then(r => r.json())
            .then(setHealth)
            .catch(() => {})
    }, [])

    if (!health) return null

    return (
        <div className="rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">Embedding</span>
            </div>
            <div className="flex flex-wrap gap-2">
                <span className="flex items-center gap-1.5">
                    <Badge variant={health.google.ok ? "default" : "destructive"} className="font-normal text-[11px] px-1.5 py-0">
                        Google {health.google.ok ? `✓ ${health.google.ms}ms` : "✗"}
                    </Badge>
                </span>
                <span className="flex items-center gap-1.5">
                    <Badge variant={health.syv.ok ? "default" : "outline"} className="font-normal text-[11px] px-1.5 py-0">
                        syv.ai {health.syv.ok ? `✓ ${health.syv.ms}ms` : "✗ nede"}
                    </Badge>
                </span>
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
                Aktiv: <span className="font-medium text-foreground">{health.aktiv}</span>
            </span>
        </div>
    )
}

type Stats = {
    pending: number       // kontrakter afventer validering
    validated: number     // validerede kontrakter
    total: number         // alle kontrakter
    members: number       // aktive medlemmer
}

function StatCard({ icon: Icon, label, value, href, highlight }: {
    icon: React.ElementType
    label: string
    value: number
    href: string
    highlight?: boolean
}) {
    return (
        <Link href={href}>
            <div className={`rounded-lg border p-5 space-y-3 hover:bg-muted/40 transition-colors cursor-pointer ${highlight && value > 0 ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                <div className="flex items-center justify-between">
                    <Icon className={`h-5 w-5 ${highlight && value > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
                    {highlight && value > 0 && (
                        <span className="text-xs font-medium text-amber-600 bg-amber-100 dark:bg-amber-900/40 rounded-full px-2 py-0.5">
                            Handling påkrævet
                        </span>
                    )}
                </div>
                <div>
                    <p className={`text-3xl font-bold tabular-nums ${highlight && value > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                        {value}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
                </div>
            </div>
        </Link>
    )
}

export default function AdminDashboardPage() {
    const [stats, setStats] = useState<Stats | null>(null)
    const [loading, setLoading] = useState(true)
    const [orgId] = useState("3dfcad23-03ce-4de0-82f2-6566dfcd88a5")

    useEffect(() => {
        const load = async () => {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            const resolvedOrgId = user?.user_metadata?.org_id ?? orgId

            const [pendingRes, validatedRes, membersRes] = await Promise.all([
                supabase.from("contracts").select("id", { count: "exact", head: true })
                    .eq("org_id", resolvedOrgId).eq("status", "kladde"),
                supabase.from("contracts").select("id", { count: "exact", head: true })
                    .eq("org_id", resolvedOrgId).eq("status", "valideret"),
                supabase.from("org_affiliations").select("id", { count: "exact", head: true })
                    .eq("org_id", resolvedOrgId).eq("is_member", true),
            ])

            setStats({
                pending:   pendingRes.count  ?? 0,
                validated: validatedRes.count ?? 0,
                total:     (pendingRes.count ?? 0) + (validatedRes.count ?? 0),
                members:   membersRes.count  ?? 0,
            })
            setLoading(false)
        }
        load()
    }, [])

    const greeting = () => {
        const h = new Date().getHours()
        if (h < 10) return "Godmorgen"
        if (h < 13) return "God formiddag"
        if (h < 17) return "God eftermiddag"
        return "God aften"
    }

    return (
        <div className="space-y-8 max-w-3xl">
            <PageHeader
                title={`${greeting()} 👋`}
                subtitle="Her er et overblik over hvad der venter i dag"
            />

            <EmbeddingStatus />

            {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="rounded-lg border p-5 h-28 animate-pulse bg-muted/30" />
                    ))}
                </div>
            ) : stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatCard
                        icon={Clock}
                        label="Afventer validering"
                        value={stats.pending}
                        href="/admin/kontrakter"
                        highlight
                    />
                    <StatCard
                        icon={CheckCircle}
                        label="Validerede kontrakter"
                        value={stats.validated}
                        href="/admin/kontrakter"
                    />
                    <StatCard
                        icon={FileText}
                        label="Kontrakter i alt"
                        value={stats.total}
                        href="/admin/kontrakter"
                    />
                    <StatCard
                        icon={UserCheck}
                        label="Aktive medlemmer"
                        value={stats.members}
                        href="/admin/rettighedshavere"
                    />
                </div>
            )}

            {/* Genveje */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Genveje</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                        { href: "/admin/kontrakter",       icon: CheckCircle, label: "Validér kontrakter",       desc: "Gennemgå og godkend indsendte kontrakter" },
                        { href: "/admin/kontraktgennemgang", icon: Scale,      label: "Kontraktgennemgang",       desc: "AI-assisteret juridisk gennemgang" },
                        { href: "/admin/kontrakter",        icon: FileText,    label: "Kontrakter",               desc: "Se og administrér alle kontrakter" },
                        { href: "/admin/rettighedshavere",  icon: Users2,      label: "Rettighedshavere",         desc: "Medlemmer og portal-adgang" },
                    ].map(item => (
                        <Link key={item.href} href={item.href}>
                            <div className="flex items-center gap-3 rounded-lg border px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer">
                                <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">{item.label}</p>
                                    <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
                                </div>
                                <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                            </div>
                        </Link>
                    ))}
                </div>
            </div>

            {stats && stats.pending > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-5 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                                {stats.pending} kontrakt{stats.pending !== 1 ? "er" : ""} afventer validering
                            </p>
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                Gå til kontraktadministration for at gennemgå dem
                            </p>
                        </div>
                    </div>
                    <Button size="sm" asChild className="shrink-0 bg-amber-600 hover:bg-amber-700">
                        <Link href="/admin/kontrakter">Validér nu</Link>
                    </Button>
                </div>
            )}
        </div>
    )
}
