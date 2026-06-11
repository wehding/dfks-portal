export const dynamic = "force-dynamic";

"use client"

import { useState, useMemo } from "react"
import { Search, Flag, Upload, CheckCircle2, Clock, X, Info, FileText, ChevronDown, ChevronUp } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

// ── Mock titles from approved aftalelicens batches ────────────

interface PublicTitle {
    id: string
    batchId: string
    batchLabel: string   // "Copydan Verdens TV 2023"
    rawTitle: string
    channel?: string
    broadcastDate?: string
    duration?: number
    vaerkTypeLabel?: string
}

const MOCK_TITLES: PublicTitle[] = [
    { id: "vaerk_1",  batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Borgen",              channel: "DR1",  broadcastDate: "2023-01-01", duration: 55,  vaerkTypeLabel: "TV-serie lang" },
    { id: "vaerk_2",  batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Kærlighed for voksne", channel: "DR2",  broadcastDate: "2023-02-04", duration: 88,  vaerkTypeLabel: "Spillefilm" },
    { id: "vaerk_3",  batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Sommerdansen",        channel: "DR K", broadcastDate: "2023-03-07", duration: 52,  vaerkTypeLabel: "Dokumentarfilm" },
    { id: "vaerk_4",  batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Bryggeren",           channel: "TV2",  broadcastDate: "2023-04-10", duration: 44,  vaerkTypeLabel: "DokuDrama" },
    { id: "vaerk_5",  batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Ronja Røverdatter",   channel: "DR1",  broadcastDate: "2023-05-13", duration: 106, vaerkTypeLabel: "Spillefilm" },
    { id: "vaerk_6",  batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Mørke sider",         channel: "DR2",  broadcastDate: "2023-06-16", duration: 48,  vaerkTypeLabel: "Dokumentarserie" },
    { id: "vaerk_9",  batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Havets stemme",       channel: "DR K", broadcastDate: "2023-07-19", duration: 18,  vaerkTypeLabel: "Kortfilm" },
    { id: "vaerk_10", batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Ulvens time",         channel: "TV2",  broadcastDate: "2023-08-22", duration: 75,  vaerkTypeLabel: "Dokumentarfilm" },
    { id: "vaerk_11", batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Broen IV",            channel: "DR1",  broadcastDate: "2023-09-25", duration: 60,  vaerkTypeLabel: "TV-serie lang" },
    { id: "vaerk_13", batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Den hvide løgn",      channel: "DR K", broadcastDate: "2023-10-01", duration: 22,  vaerkTypeLabel: "Kort dokumentar" },
    { id: "vaerk_14", batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Elverdronningen",     channel: "TV2",  broadcastDate: "2023-11-04", duration: 95,  vaerkTypeLabel: "Spillefilm" },
    { id: "vaerk_15", batchId: "batch1", batchLabel: "Copydan Verdens TV 2023", rawTitle: "Nattens løver",       channel: "DR1",  broadcastDate: "2023-12-07", duration: 52,  vaerkTypeLabel: "TV-serie lang" },
    { id: "vaerk_t1", batchId: "batch2", batchLabel: "TV2 Play 2023",           rawTitle: "Badehotellet",        channel: "TV2",  broadcastDate: "2023-03-01", duration: 58,  vaerkTypeLabel: "TV-serie lang" },
    { id: "vaerk_t2", batchId: "batch2", batchLabel: "TV2 Play 2023",           rawTitle: "Anna Pihl",           channel: "TV2",  broadcastDate: "2023-05-15", duration: 52,  vaerkTypeLabel: "TV-serie lang" },
    { id: "vaerk_t3", batchId: "batch2", batchLabel: "TV2 Play 2023",           rawTitle: "Bedrag",              channel: "TV2",  broadcastDate: "2023-08-20", duration: 60,  vaerkTypeLabel: "TV-serie lang" },
]

// ── Claim state ───────────────────────────────────────────────

type ClaimStatus = "pending" | "approved" | "rejected"

interface Claim {
    id: string
    titleId: string
    title: PublicTitle
    note: string
    fileName?: string
    submittedAt: string
    status: ClaimStatus
}

// ── Claim dialog ──────────────────────────────────────────────

function ClaimDialog({ title, onClose, onSubmit }: {
    title: PublicTitle
    onClose: () => void
    onSubmit: (note: string, fileName?: string) => void
}) {
    const [note, setNote] = useState("")
    const [fileName, setFileName] = useState("")

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Markér som dit værk</DialogTitle>
                    <DialogDescription>
                        Du markerer at du har klippet <strong>{title.rawTitle}</strong>. DFKS vil validere dit krav.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-lg bg-muted/50 border p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Titel</span>
                        <span className="font-medium">{title.rawTitle}</span>
                    </div>
                    {title.channel && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Kanal</span>
                            <span>{title.channel}</span>
                        </div>
                    )}
                    {title.broadcastDate && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Dato</span>
                            <span>{new Date(title.broadcastDate).toLocaleDateString("da-DK")}</span>
                        </div>
                    )}
                    {title.vaerkTypeLabel && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Værktype</span>
                            <span>{title.vaerkTypeLabel}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Kilde</span>
                        <span>{title.batchLabel}</span>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label>Kontrakt (anbefalet)</Label>
                        <label className="cursor-pointer block">
                            <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                                <Upload className="h-4 w-4 shrink-0" />
                                {fileName
                                    ? <span className="text-foreground font-medium truncate">{fileName}</span>
                                    : "Vedhæft kontrakt eller klippeattest (.pdf, .docx)"}
                            </div>
                            <input
                                type="file"
                                accept=".pdf,.doc,.docx"
                                className="sr-only"
                                onChange={e => setFileName(e.target.files?.[0]?.name ?? "")}
                            />
                        </label>
                        {fileName && (
                            <button
                                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                                onClick={() => setFileName("")}
                            >
                                <X className="h-3 w-3" /> Fjern fil
                            </button>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label>Note (valgfrit)</Label>
                        <Textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder="F.eks. afsnit nr., sæson, periode du arbejdede på produktionen..."
                            rows={3}
                        />
                    </div>

                    <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <p>Din markering sendes til DFKS for validering. Du vil blive kontaktet når dit krav er behandlet.</p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuller</Button>
                    <Button onClick={() => onSubmit(note, fileName || undefined)}>
                        <Flag className="mr-2 h-4 w-4" />
                        Send markering
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// Titler klipperen allerede er officielt tilknyttet via admin (fra DB i real app)
const ALREADY_ATTACHED_IDS = new Set(["vaerk_11", "vaerk_1"]) // Broen IV, Borgen

// ── Main page ─────────────────────────────────────────────────

export default function PortalAftalelicensPage() {
    const [search, setSearch] = useState("")
    const [claims, setClaims] = useState<Claim[]>([])
    const [claimTarget, setClaimTarget] = useState<PublicTitle | null>(null)
    const [showClaims, setShowClaims] = useState(true)

    const claimedIds = useMemo(() => new Set(claims.map(c => c.titleId)), [claims])
    const claimByTitleId = useMemo(() => {
        const map = new Map<string, Claim>()
        claims.forEach(c => map.set(c.titleId, c))
        return map
    }, [claims])

    const results = useMemo(() => {
        if (!search.trim()) return []
        const q = search.toLowerCase()
        return MOCK_TITLES.filter(t =>
            t.rawTitle.toLowerCase().includes(q) ||
            (t.channel ?? "").toLowerCase().includes(q)
        )
    }, [search])

    const handleSubmit = (note: string, fileName?: string) => {
        if (!claimTarget) return
        const claim: Claim = {
            id: `claim_${Date.now()}`,
            titleId: claimTarget.id,
            title: claimTarget,
            note,
            fileName,
            submittedAt: new Date().toISOString(),
            status: "pending",
        }
        setClaims(prev => [claim, ...prev])
        setClaimTarget(null)
        toast.success("Din markering er sendt til DFKS")
    }

    const STATUS_CFG = {
        pending:  { label: "Afventer",  variant: "secondary"   as const, icon: Clock },
        approved: { label: "Godkendt",  variant: "default"     as const, icon: CheckCircle2 },
        rejected: { label: "Afvist",    variant: "destructive" as const, icon: X },
    }

    return (
        <div className="space-y-8 max-w-3xl">
            <PageHeader
                title="Aftalelicens — mine titler"
                subtitle="Søg i de offentliggjorte titler og markér dem du har kreditering på"
            />

            {/* Info box */}
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p className="font-medium">Hvad er dette?</p>
                    <p className="text-xs leading-relaxed">
                        DFKS modtager data fra Copydan og TV2 Play om udsendelser af dansk film og serier. Hvis du har klippet en af de viste titler, kan du markere den her — også selvom du ikke allerede er registreret på den. DFKS validerer herefter dit krav og tilknytter dig til beregningen.
                    </p>
                </div>
            </div>

            {/* Search */}
            <section className="rounded-lg border">
                <div className="px-5 py-4 border-b">
                    <h2 className="font-medium text-sm">Søg i titler</h2>
                </div>
                <div className="p-5 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Søg på titel eller kanal..."
                            className="pl-9"
                        />
                    </div>

                    {search.trim() && results.length === 0 && (
                        <div className="rounded-lg border border-dashed p-6 text-center space-y-2">
                            <p className="text-sm text-muted-foreground">Ingen titler matcher din søgning.</p>
                            <p className="text-xs text-muted-foreground">
                                Kun godkendte titler fra afsluttede sorteringsrunder vises. Kontakt DFKS hvis du mener din titel mangler.
                            </p>
                        </div>
                    )}

                    {results.length > 0 && (
                        <div className="rounded-lg border overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Titel</TableHead>
                                        <TableHead className="w-[90px]">Dato</TableHead>
                                        <TableHead>Kanal</TableHead>
                                        <TableHead className="w-[80px]">Min.</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead className="w-[110px]" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {results.map(title => {
                                        const attached = ALREADY_ATTACHED_IDS.has(title.id)
                                        const existingClaim = claimByTitleId.get(title.id)
                                        return (
                                            <TableRow key={title.id} className={attached ? "bg-muted/30" : ""}>
                                                <TableCell className="font-medium text-sm">{title.rawTitle}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground tabular-nums">
                                                    {title.broadcastDate
                                                        ? new Date(title.broadcastDate).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "2-digit" })
                                                        : "—"}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">{title.channel ?? "—"}</TableCell>
                                                <TableCell className="text-sm">{title.duration ?? "—"}</TableCell>
                                                <TableCell>
                                                    {title.vaerkTypeLabel && (
                                                        <Badge variant="outline" className="text-xs font-normal">
                                                            {title.vaerkTypeLabel}
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {attached ? (
                                                        <Badge variant="default" className="gap-1 text-xs">
                                                            <CheckCircle2 className="h-3 w-3" />
                                                            Tilknyttet
                                                        </Badge>
                                                    ) : existingClaim ? (
                                                        <Badge
                                                            variant={existingClaim.status === "rejected" ? "destructive" : "secondary"}
                                                            className="gap-1 text-xs"
                                                        >
                                                            {existingClaim.status === "approved"
                                                                ? <CheckCircle2 className="h-3 w-3" />
                                                                : existingClaim.status === "rejected"
                                                                    ? <X className="h-3 w-3" />
                                                                    : <Clock className="h-3 w-3" />
                                                            }
                                                            {existingClaim.status === "approved" ? "Godkendt"
                                                                : existingClaim.status === "rejected" ? "Afvist"
                                                                : "Afventer"}
                                                        </Badge>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="gap-1 text-xs h-7"
                                                            onClick={() => setClaimTarget(title)}
                                                        >
                                                            <Flag className="h-3 w-3" />
                                                            Det er mig
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            </section>

            {/* My claims */}
            {claims.length > 0 && (
                <section className="rounded-lg border">
                    <button
                        className="flex items-center justify-between w-full px-5 py-4 border-b text-left"
                        onClick={() => setShowClaims(v => !v)}
                    >
                        <div className="flex items-center gap-2">
                            <h2 className="font-medium text-sm">Mine markeringer</h2>
                            <Badge variant="secondary" className="text-xs">{claims.length}</Badge>
                        </div>
                        {showClaims
                            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        }
                    </button>

                    {showClaims && (
                        <div className="divide-y">
                            {claims.map(claim => {
                                const cfg = STATUS_CFG[claim.status]
                                return (
                                    <div key={claim.id} className="px-5 py-4 flex items-start justify-between gap-4">
                                        <div className="space-y-0.5 min-w-0">
                                            <p className="text-sm font-medium truncate">{claim.title.rawTitle}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {claim.title.batchLabel}
                                                {claim.title.broadcastDate && ` · ${new Date(claim.title.broadcastDate).toLocaleDateString("da-DK")}`}
                                            </p>
                                            {claim.note && (
                                                <p className="text-xs text-muted-foreground italic mt-1">&ldquo;{claim.note}&rdquo;</p>
                                            )}
                                            {claim.fileName && (
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                                    <FileText className="h-3 w-3" />
                                                    {claim.fileName}
                                                </div>
                                            )}
                                        </div>
                                        <div className="shrink-0 flex flex-col items-end gap-1">
                                            <Badge variant={cfg.variant} className="gap-1 text-xs">
                                                <cfg.icon className="h-3 w-3" />
                                                {cfg.label}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground">
                                                {new Date(claim.submittedAt).toLocaleDateString("da-DK")}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </section>
            )}

            {claimTarget && (
                <ClaimDialog
                    title={claimTarget}
                    onClose={() => setClaimTarget(null)}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    )
}
