"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, FileText, Loader2, AlertCircle } from "lucide-react"
import { format } from "date-fns"
import { da } from "date-fns/locale"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

// ── Typer ────────────────────────────────────────────────────

type ReviewDetail = {
    id: string
    file_name: string | null
    producer_name: string | null
    production_type: string | null
    distribution_channels: string[] | null
    updated_at: string | null
    jurist_response: string | null
    jurist_response_at: string | null
}

// ── Hjælpefunktioner ─────────────────────────────────────────

const PRODUCTION_LABELS: Record<string, string> = {
    dokumentar: "Dokumentar", fiktion: "Fiktion / drama", reklame: "Reklame",
    streaming: "Streaming-original", shortform: "Short-form", ukendt: "Ukendt",
}

const DISTRIBUTION_LABELS: Record<string, string> = {
    biograf: "Biograf", tv_lineaer: "TV (lineær)", streaming_svod: "Streaming (SVOD)",
    streaming_avod: "Streaming (AVOD)", festival: "Festival",
    internationalt_salg: "Internationalt salg", ukendt: "Ukendt",
}

function formatDato(iso: string | null) {
    if (!iso) return "—"
    return format(new Date(iso), "d. MMMM yyyy", { locale: da })
}

// ── Side ─────────────────────────────────────────────────────

export default function PortalKontraktDetalje({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = use(params)
    const router = useRouter()
    const [review, setReview] = useState<ReviewDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)

    useEffect(() => {
        async function load() {
            setLoading(true)
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push("/"); return }

            const { data, error } = await supabase
                .from("contract_reviews")
                .select(`
                    id,
                    file_name,
                    producer_name,
                    production_type,
                    distribution_channels,
                    updated_at,
                    jurist_response,
                    jurist_response_at
                `)
                .eq("id", id)
                .eq("member_id", user.id)   // RLS + ekstra sikkerhed
                .eq("status", "afsluttet")  // kun afsluttede sager har jurist-svar
                .single()

            if (error || !data) { setNotFound(true); setLoading(false); return }
            setReview(data as ReviewDetail)
            setLoading(false)
        }
        load()
    }, [id, router])

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground py-10">
                <Loader2 className="h-4 w-4 animate-spin" />Henter…
            </div>
        )
    }

    if (notFound) {
        return (
            <div className="space-y-4">
                <Button variant="ghost" size="sm" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4 mr-1" />Tilbage
                </Button>
                <div className="flex items-center gap-3 text-muted-foreground py-10">
                    <AlertCircle className="h-5 w-5" />
                    <p>Sagen blev ikke fundet eller du har ikke adgang til den.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <Button variant="ghost" size="sm" onClick={() => router.push("/portal/kontraktgennemgang")}>
                <ArrowLeft className="h-4 w-4 mr-1" />Tilbage til oversigt
            </Button>

            <PageHeader
                title="Juristens svar"
                subtitle="Gennemgang af din indsendte kontrakt"
            />

            {/* Kontraktkort */}
            <div className="rounded-xl border bg-muted/30 px-5 py-4 space-y-2">
                <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm">{review?.file_name ?? "Ukendt fil"}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {review?.updated_at && (
                        <span>Afsluttet {formatDato(review.updated_at)}</span>
                    )}
                    {review?.producer_name && (
                        <span>Producer: {review.producer_name}</span>
                    )}
                    {review?.production_type && (
                        <span>{PRODUCTION_LABELS[review.production_type] ?? review.production_type}</span>
                    )}
                    {review?.distribution_channels && review.distribution_channels.length > 0 && (
                        <span>
                            {review.distribution_channels
                                .map(ch => DISTRIBUTION_LABELS[ch] ?? ch)
                                .join(" · ")}
                        </span>
                    )}
                </div>
            </div>

            <Separator />

            {/* Juristens svar */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Juristens svar
                </h2>
                {review?.jurist_response ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded-lg border bg-card px-5 py-4 text-sm leading-relaxed">
                        {review.jurist_response}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
                        Juristen har endnu ikke tilføjet et skriftligt svar til denne sag.
                    </div>
                )}
            </div>
        </div>
    )
}
