"use client"

import { useState, useEffect, useMemo } from "react"
import { Film, Download, Users, Eye, Upload, BarChart3, Clock, CheckCircle2, X, Layers, SearchCheck, Send, Info } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { createClient } from "@/lib/supabase/client"
import { PageHeader } from "@/components/page-header"
import { PdfViewer } from "@/components/pdf-viewer"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import Link from "next/link"
import type { Work } from "@/lib/types"

// ── Aftalelicens-krav (spejler data fra /portal/aftalelicens) ─

interface AftalelicensKravItem {
    id: string
    rawTitle: string
    batchLabel: string
    channel?: string
    broadcastDate?: string
    vaerkTypeLabel?: string
    note?: string
    submittedAt: string
    status: "pending" | "approved" | "rejected"
}

const MOCK_MINE_KRAV: AftalelicensKravItem[] = [
    {
        id: "krav_p1",
        rawTitle: "Broen IV",
        batchLabel: "Copydan Verdens TV 2023",
        channel: "DR1",
        broadcastDate: "2023-09-25",
        vaerkTypeLabel: "TV-serie lang",
        submittedAt: "2024-03-20T08:00:00",
        status: "approved",
    },
    {
        id: "krav_p2",
        rawTitle: "Nattens løver",
        batchLabel: "Copydan Verdens TV 2023",
        channel: "DR1",
        broadcastDate: "2023-12-07",
        vaerkTypeLabel: "TV-serie lang",
        note: "Klippet afsnit 3–6",
        submittedAt: "2024-03-22T11:30:00",
        status: "pending",
    },
]

// ── Efterlysning — værker uden klipper ────────────────────────

interface EfterlysningItem {
    id: string
    title: string
    type: string
    premiereYear: number
    productionNumber: string
}

const MOCK_EFTERLYSNINGER: EfterlysningItem[] = [
    { id: "e1", title: "Skruk Sæson 1", type: "TV-serie", premiereYear: 2022, productionNumber: "005" },
    { id: "e2", title: "Frihavn", type: "TV-serie", premiereYear: 2023, productionNumber: "013" },
    { id: "e3", title: "Den store dag", type: "Dokumentarfilm", premiereYear: 2023, productionNumber: "014" },
    { id: "e4", title: "Landet bag ved", type: "Spillefilm", premiereYear: 2024, productionNumber: "015" },
]

function mapWorkType(type: string): Work["category"] {
    const map: Record<string, Work["category"]> = {
        "feature": "feature", "spillefilm": "feature",
        "tvSeries": "tvSeries", "tv-serie": "tvSeries",
        "documentary": "documentary", "dokumentar": "documentary",
        "docSeries": "docSeries",
        "short": "short", "kortfilm": "short",
        "tvEntertainment": "tvEntertainment",
        "reality": "reality",
    }
    return map[type?.toLowerCase()] ?? "feature"
}

const KRAV_STATUS_CFG = {
    pending:  { label: "Afventer afgørelse", variant: "secondary"   as const, icon: Clock },
    approved: { label: "Godkendt",           variant: "default"     as const, icon: CheckCircle2 },
    rejected: { label: "Afvist",             variant: "destructive" as const, icon: X },
}

function RightsBadges({ rights }: { rights: Work["rights"] }) {
    return (
        <div className="flex gap-1">
            {rights.svod && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                    SVOD
                </Badge>
            )}
            {rights.copydan && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                    Copydan
                </Badge>
            )}
            {rights.royalty && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                    {rights.royaltyPercent ? `${rights.royaltyPercent}%` : "Royalty"}
                </Badge>
            )}
            {!rights.svod && !rights.copydan && !rights.royalty && (
                <span className="text-xs text-muted-foreground">—</span>
            )}
        </div>
    )
}

function DurationDisplay({ work }: { work: Work }) {
    const { t } = useI18n()

    if (work.episodes && work.episodes.length > 0) {
        return (
            <span className="tabular-nums text-sm text-muted-foreground">
                {work.episodes.length} {t("works.episodes")}
            </span>
        )
    }

    return (
        <span className="tabular-nums">
            {work.duration} {t("common.minutes")}
        </span>
    )
}

// Godkendte aftalelicens-krav som Work-rækker
const approvedKravAsWorks: (Work & { fromAftalelicens: true; batchLabel: string })[] =
    MOCK_MINE_KRAV
        .filter(k => k.status === "approved")
        .map(k => ({
            id: k.id,
            title: k.rawTitle,
            creditedRoles: ["Klipper"],
            sharedCredit: false,
            duration: 0,
            contractId: "",
            category: "film" as Work["category"],
            premiereYear: k.broadcastDate ? new Date(k.broadcastDate).getFullYear() : 0,
            rights: { svod: false, copydan: true, royalty: false },
            fromAftalelicens: true,
            batchLabel: k.batchLabel,
        }))

export default function MineVaerkerPage() {
    const { t } = useI18n()
    const [previewPdf, setPreviewPdf] = useState<string | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)
    const [exploitationWork, setExploitationWork] = useState<string | null>(null)
    const [meldDialog, setMeldDialog] = useState<EfterlysningItem | null>(null)
    const [meldNote, setMeldNote] = useState("")
    const [meldFileName, setMeldFileName] = useState("")
    const [meldSent, setMeldSent] = useState<Set<string>>(new Set())
    const [dbWorks, setDbWorks] = useState<Work[]>([])
    const [worksLoading, setWorksLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { setWorksLoading(false); return }

            // Find rettighedshaver
            let rhId: string | null = null
            const { data: byUid } = await supabase.from("rettighedshavere").select("id").eq("user_id", user.id).single()
            rhId = byUid?.id ?? null
            if (!rhId && user.email) {
                const { data: byEmail } = await supabase.from("rettighedshavere").select("id").eq("email", user.email).single()
                rhId = byEmail?.id ?? null
            }
            if (!rhId) { setWorksLoading(false); return }

            // Hent kontrakter med tilknyttede værker og valideringer
            const { data: contracts } = await supabase
                .from("contracts")
                .select(`
                    id, type, overenskomst, status, contract_date,
                    works(id, title, type, year),
                    contract_validations(extracted_data)
                `)
                .eq("rights_holder_id", rhId)
                .not("work_id", "is", null)

            if (!contracts?.length) { setWorksLoading(false); return }

            const works: Work[] = contracts
                .filter((c: any) => c.works)
                .map((c: any) => {
                    const ed = c.contract_validations?.[0]?.extracted_data ?? {}
                    return {
                        id: c.works.id,
                        title: c.works.title,
                        category: mapWorkType(c.works.type),
                        premiereYear: c.works.year ?? 0,
                        rights: {
                            svod: !!ed.svod,
                            copydan: !!ed.copydan,
                            royalty: !!ed.royalty,
                        },
                    } as Work
                })
                // Dedupliker (en klipper kan have flere kontrakter på samme værk)
                .filter((w, idx, arr) => arr.findIndex(x => x.id === w.id) === idx)

            setDbWorks(works)
            setWorksLoading(false)
        }
        load()
    }, [])

    const pendingOrRejectedKrav = MOCK_MINE_KRAV.filter(k => k.status !== "approved")
    const allWorks = [...dbWorks, ...approvedKravAsWorks]

    const mockExploitation: Record<string, { platforms: { name: string; views: number; revenue: number }[]; totalRevenue: number; coverage: number }> = {
        w1: {
            platforms: [
                { name: "DR TV", views: 245000, revenue: 48000 },
                { name: "Netflix DK", views: 128000, revenue: 32000 },
                { name: "Viaplay", views: 67000, revenue: 18000 },
            ],
            totalRevenue: 98000,
            coverage: 78,
        },
        w2: {
            platforms: [
                { name: "TV2 Play", views: 312000, revenue: 55000 },
                { name: "DR TV", views: 189000, revenue: 42000 },
            ],
            totalRevenue: 97000,
            coverage: 65,
        },
        w3: {
            platforms: [
                { name: "DR TV", views: 156000, revenue: 35000 },
                { name: "Netflix DK", views: 92000, revenue: 24000 },
                { name: "Blockbuster", views: 28000, revenue: 8000 },
            ],
            totalRevenue: 67000,
            coverage: 52,
        },
    }

    const currentExploitation = exploitationWork ? mockExploitation[exploitationWork] || {
        platforms: [{ name: "DR TV", views: 45000, revenue: 12000 }],
        totalRevenue: 12000,
        coverage: 25,
    } : null

    const currentWork = exploitationWork ? allWorks.find(w => w.id === exploitationWork) : null

    const handleLocalPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) setLocalPdfUrl(URL.createObjectURL(file))
    }

    return (
        <div className="space-y-6">
            <PageHeader title={t("works.title")} subtitle={t("works.subtitle")} />

            {allWorks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                    <Film className="h-10 w-10 text-muted-foreground/40" />
                    <h3 className="mt-4 text-sm font-medium">{t("works.noWorks")}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t("works.noWorksDesc")}
                    </p>
                </div>
            ) : (
                <div className="rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("works.workTitle")}</TableHead>
                                <TableHead>{t("works.credit")}</TableHead>
                                <TableHead>{t("works.sharedCredit")}</TableHead>
                                <TableHead>{t("works.rights")}</TableHead>
                                <TableHead>{t("works.duration")}</TableHead>
                                <TableHead className="w-[100px]">{t("works.contract")}</TableHead>
                                <TableHead className="w-[140px]">Udnyttelse</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {allWorks.map((work) => {
                                const isAftalelicens = "fromAftalelicens" in work
                                return (
                                <TableRow key={work.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium">{work.title}</span>
                                            <span className="text-xs text-muted-foreground">
                                                ({work.premiereYear || "—"})
                                            </span>
                                            {isAftalelicens && (
                                                <Badge variant="outline" className="text-[10px] py-0 gap-0.5 font-normal">
                                                    <Layers className="h-2.5 w-2.5" />
                                                    {(work as typeof approvedKravAsWorks[0]).batchLabel}
                                                </Badge>
                                            )}
                                        </div>
                                        {work.episodes && work.editedEpisodes && work.editedEpisodes.length > 0 && (
                                            <div className="mt-1 space-y-0.5">
                                                {work.episodes
                                                    .filter(ep => work.editedEpisodes!.includes(ep.number))
                                                    .map(ep => (
                                                        <div key={ep.number} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                            <span className="font-mono text-muted-foreground/60">↳</span>
                                                            <span className="font-mono font-medium">E{String(ep.number).padStart(2, "0")}</span>
                                                            <span>{ep.title}</span>
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>{work.creditedRoles.join(", ")}</TableCell>
                                    <TableCell>
                                        {work.sharedCredit ? (
                                            <Tooltip>
                                                <TooltipTrigger>
                                                    <Badge
                                                        variant="secondary"
                                                        className="gap-1 font-normal"
                                                    >
                                                        <Users className="h-3 w-3" />
                                                        {t("works.yes")}
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p className="text-xs">
                                                        {t("works.sharedWith")}:{" "}
                                                        {work.sharedWith?.join(", ")}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <span className="text-muted-foreground text-sm">
                                                {t("works.no")}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <RightsBadges rights={work.rights} />
                                    </TableCell>
                                    <TableCell>
                                        {work.episodes && work.episodes.length > 0 ? (
                                            <span className="text-sm tabular-nums text-muted-foreground">
                                                {work.episodes.length} {t("works.episodes")}
                                            </span>
                                        ) : (
                                            <span className="tabular-nums">{work.duration} {t("common.minutes")}</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {!isAftalelicens ? (
                                            <div className="flex gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => setPreviewPdf(work.contractId)}
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <Download className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {!isAftalelicens ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1.5 text-xs h-7"
                                                onClick={() => setExploitationWork(work.id)}
                                            >
                                                <BarChart3 className="h-3 w-3" />
                                                {t("works.seeExploitation")}
                                            </Button>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Aftalelicens-krav — kun afventende og afviste */}
            {pendingOrRejectedKrav.length > 0 && (
                <section className="rounded-lg border">
                    <div className="flex items-center justify-between px-5 py-4 border-b">
                        <div className="flex items-center gap-2">
                            <Layers className="h-4 w-4 text-muted-foreground" />
                            <h2 className="font-medium text-sm">Aftalelicens-krav</h2>
                            {pendingOrRejectedKrav.some(k => k.status === "pending") && (
                                <Badge variant="secondary" className="text-xs">
                                    {pendingOrRejectedKrav.filter(k => k.status === "pending").length} afventer afgørelse
                                </Badge>
                            )}
                        </div>
                        <Button asChild variant="ghost" size="sm" className="text-xs gap-1">
                            <Link href="/portal/aftalelicens">
                                Søg flere titler
                            </Link>
                        </Button>
                    </div>
                    <div className="divide-y">
                        {pendingOrRejectedKrav.map(krav => {
                            const cfg = KRAV_STATUS_CFG[krav.status]
                            return (
                                <div key={krav.id} className="px-5 py-4 flex items-start justify-between gap-4">
                                    <div className="space-y-0.5 min-w-0">
                                        <p className="text-sm font-medium">{krav.rawTitle}</p>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                            <span>{krav.batchLabel}</span>
                                            {krav.channel && <span>· {krav.channel}</span>}
                                            {krav.broadcastDate && (
                                                <span>· {new Date(krav.broadcastDate).toLocaleDateString("da-DK")}</span>
                                            )}
                                            {krav.vaerkTypeLabel && (
                                                <Badge variant="outline" className="text-[10px] py-0 font-normal">
                                                    {krav.vaerkTypeLabel}
                                                </Badge>
                                            )}
                                        </div>
                                        {krav.note && (
                                            <p className="text-xs text-muted-foreground italic mt-0.5">&ldquo;{krav.note}&rdquo;</p>
                                        )}
                                    </div>
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                        <Badge variant={cfg.variant} className="gap-1 text-xs whitespace-nowrap">
                                            <cfg.icon className="h-3 w-3" />
                                            {cfg.label}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground">
                                            Indsendt {new Date(krav.submittedAt).toLocaleDateString("da-DK")}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </section>
            )}

            {/* Efterlysning — værker uden klipper */}
            <section className="rounded-lg border">
                <div className="flex items-center gap-2 px-5 py-4 border-b">
                    <SearchCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h2 className="font-medium text-sm">Efterlysning — kender du disse værker?</h2>
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                        {MOCK_EFTERLYSNINGER.filter(e => !meldSent.has(e.id)).length} uden klipper
                    </Badge>
                </div>
                <p className="px-5 pt-3 pb-1 text-sm text-muted-foreground">
                    DFKS har registreret følgende værker uden tilknyttet klipper. Har du klippet et af disse, så meld dig nedenfor.
                </p>
                <div className="divide-y">
                    {MOCK_EFTERLYSNINGER.map(item => (
                        <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-sm font-medium">{item.title}</p>
                                <p className="text-xs text-muted-foreground">{item.type} · {item.premiereYear} · #{item.productionNumber}</p>
                            </div>
                            {meldSent.has(item.id) ? (
                                <Badge variant="outline" className="gap-1 text-xs text-green-700 border-green-300 bg-green-50 dark:bg-green-950 shrink-0">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Meldt til DFKS
                                </Badge>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 text-xs gap-1.5"
                                    onClick={() => { setMeldDialog(item); setMeldNote(""); setMeldFileName("") }}
                                >
                                    <Users className="h-3.5 w-3.5" />
                                    Jeg klippede dette
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* Meld-dialog */}
            <Dialog open={!!meldDialog} onOpenChange={() => { setMeldDialog(null); setMeldFileName("") }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Meld dig som klipper</DialogTitle>
                        <DialogDescription>
                            Du markerer at du har klippet dette værk. DFKS vil validere dit krav.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Werk details */}
                    <div className="rounded-lg bg-muted/50 border p-3 text-xs space-y-1">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Titel</span>
                            <span className="font-medium">{meldDialog?.title}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Type</span>
                            <span>{meldDialog?.type}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">År</span>
                            <span>{meldDialog?.premiereYear}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Prod.nr.</span>
                            <span>#{meldDialog?.productionNumber}</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {/* Contract upload */}
                        <div className="space-y-1.5">
                            <Label>Kontrakt (anbefalet)</Label>
                            <label className="cursor-pointer block">
                                <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                                    <Upload className="h-4 w-4 shrink-0" />
                                    {meldFileName
                                        ? <span className="text-foreground font-medium truncate">{meldFileName}</span>
                                        : "Vedhæft kontrakt eller klippeattest (.pdf, .docx)"}
                                </div>
                                <input
                                    type="file"
                                    accept=".pdf,.doc,.docx"
                                    className="sr-only"
                                    onChange={e => setMeldFileName(e.target.files?.[0]?.name ?? "")}
                                />
                            </label>
                            {meldFileName && (
                                <button
                                    className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                                    onClick={() => setMeldFileName("")}
                                >
                                    <X className="h-3 w-3" /> Fjern fil
                                </button>
                            )}
                        </div>

                        {/* Note */}
                        <div className="space-y-1.5">
                            <Label>Note (valgfrit)</Label>
                            <Textarea
                                value={meldNote}
                                onChange={e => setMeldNote(e.target.value)}
                                placeholder="Fx: Klippede afsnit 2–5, sæson 1. Kontrakt via Zentropa..."
                                rows={3}
                            />
                        </div>

                        {/* Info */}
                        <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300">
                            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <p>Din markering sendes til DFKS for validering. Du vil blive kontaktet når dit krav er behandlet.</p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setMeldDialog(null); setMeldFileName("") }}>Annuller</Button>
                        <Button onClick={() => {
                            if (meldDialog) {
                                setMeldSent(prev => new Set([...prev, meldDialog.id]))
                                setMeldDialog(null)
                                setMeldFileName("")
                            }
                        }}>
                            <Send className="mr-2 h-3.5 w-3.5" />
                            Send markering
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Contract Preview Dialog */}
            <Dialog open={!!previewPdf} onOpenChange={() => { setPreviewPdf(null); setLocalPdfUrl(null) }}>
                <DialogContent className="h-[90vh] flex flex-col" style={{ maxWidth: "92vw", width: "92vw" }}>
                    <DialogHeader>
                        <DialogTitle>{t("common.preview")}</DialogTitle>
                    </DialogHeader>
                    {(() => {
                        const data = null as any
                        const isApproved = false

                        return (
                            <div className={`flex-1 grid gap-4 overflow-hidden ${isApproved && data ? "lg:grid-cols-2" : ""}`}>
                                {/* PDF Side */}
                                <div className="rounded-lg border overflow-hidden flex flex-col">
                                    {localPdfUrl ? (
                                        <PdfViewer url={localPdfUrl} />
                                    ) : (
                                        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30">
                                            <p className="text-sm text-muted-foreground mb-3">
                                                Vælg en PDF for at teste preview
                                            </p>
                                            <label className="cursor-pointer">
                                                <input
                                                    type="file"
                                                    accept=".pdf"
                                                    className="hidden"
                                                    onChange={handleLocalPdf}
                                                />
                                                <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                                                    <Upload className="h-4 w-4" />
                                                    Vælg PDF
                                                </span>
                                            </label>
                                        </div>
                                    )}
                                </div>

                                {/* Extracted Data Side (only for approved) */}
                                {isApproved && data && (
                                    <div className="rounded-lg border overflow-auto">
                                        <div className="flex items-center gap-2 border-b px-4 py-3 sticky top-0 bg-background z-10">
                                            <span className="text-sm font-medium">{t("admin.validation.extracted")}</span>
                                            <Badge variant="default" className="ml-auto text-[10px] font-normal">
                                                {t("admin.contracts.approved")}
                                            </Badge>
                                        </div>
                                        <div className="p-4 space-y-4 text-sm">
                                            {/* Salary */}
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.salary")}</p>
                                                <p className="font-medium tabular-nums">
                                                    {data.salary?.toLocaleString("da-DK")} {t("common.kr")} / {t(`admin.validation.${data.salaryUnit || "monthly"}` as any)}
                                                </p>
                                            </div>

                                            <Separator />

                                            {/* Employment */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.startDate")}</p>
                                                    <p>{data.startDate}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.endDate")}</p>
                                                    <p>{data.endDate}</p>
                                                </div>
                                            </div>

                                            {data.pensionSupplement && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.pension")}</p>
                                                        <p className="tabular-nums">{data.pensionSupplement?.toLocaleString("da-DK")} {t("common.kr")}</p>
                                                    </div>
                                                </>
                                            )}

                                            <Separator />

                                            {/* Rights */}
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-2">{t("admin.validation.rights")}</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <Badge variant={data.svod ? "default" : "outline"} className="font-normal">
                                                        SVOD {data.svod ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge variant={data.copydan ? "default" : "outline"} className="font-normal">
                                                        Copydan {data.copydan ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge variant={data.royalty ? "default" : "outline"} className="font-normal">
                                                        Royalty {data.royalty ? `${data.royaltyPercent}%` : "✗"}
                                                    </Badge>
                                                </div>
                                            </div>

                                            {data.distribution && data.distribution.length > 0 && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.distribution")}</p>
                                                        <p>{data.distribution.join(", ")}</p>
                                                    </div>
                                                </>
                                            )}

                                            {data.collectiveAgreement && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">{t("admin.validation.agreement")}</p>
                                                        <p>{data.collectiveAgreementName}</p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })()}
                </DialogContent>
            </Dialog>

            {/* Exploitation Dialog */}
            <Dialog open={!!exploitationWork} onOpenChange={(o) => { if (!o) setExploitationWork(null) }}>
                <DialogContent className="sm:max-w-[540px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5" />
                            {t("works.seeExploitation")} — {currentWork?.title || ""}
                        </DialogTitle>
                    </DialogHeader>
                    {currentExploitation && (
                        <div className="space-y-5 py-2">
                            {/* Summary */}
                            <div className="grid grid-cols-2 gap-4">
                                <Card>
                                    <CardContent className="pt-4 pb-3">
                                        <p className="text-xs text-muted-foreground">Samlet omsætning</p>
                                        <p className="text-xl font-bold tabular-nums">
                                            {currentExploitation.totalRevenue.toLocaleString("da-DK")} kr.
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="pt-4 pb-3">
                                        <p className="text-xs text-muted-foreground">Udnyttelsesdækning</p>
                                        <p className="text-xl font-bold tabular-nums">
                                            {currentExploitation.coverage}%
                                        </p>
                                        <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-primary transition-all"
                                                style={{ width: `${currentExploitation.coverage}%` }}
                                            />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Platform breakdown */}
                            <div>
                                <p className="text-sm font-medium mb-3">Platforme</p>
                                <div className="space-y-3">
                                    {currentExploitation.platforms.map((p, i) => {
                                        const maxViews = Math.max(...currentExploitation.platforms.map(x => x.views))
                                        return (
                                            <div key={i} className="space-y-1.5">
                                                <div className="flex justify-between text-sm">
                                                    <span className="font-medium">{p.name}</span>
                                                    <span className="text-muted-foreground tabular-nums">
                                                        {p.views.toLocaleString("da-DK")} visninger · {p.revenue.toLocaleString("da-DK")} kr.
                                                    </span>
                                                </div>
                                                <div className="h-2 rounded-full bg-muted overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full bg-emerald-500 transition-all"
                                                        style={{ width: `${(p.views / maxViews) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
