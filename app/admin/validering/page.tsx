"use client"

import { useState } from "react"
import {
    Check,
    X,
    FileText,
    Upload,
    ArrowLeft,
    Trash2,
    Clock,
    CheckCircle2,
    Eye,
    Sparkles,
    AlertTriangle,
    Info,
    ChevronDown,
    ChevronUp,
} from "lucide-react"
import { toast } from "sonner"
import { PdfViewer } from "@/components/pdf-viewer"
import { useI18n } from "@/lib/i18n"
import { useContracts } from "@/lib/hooks"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import type { Contract } from "@/lib/types"
import {
    screenContract,
    extractTextFromFile,
    getReferences,
    getMemberList,
    type ScreeningResult,
    type ContractFlag,
} from "@/lib/ai"

const statusLabels: Record<string, string> = {
    pending: "admin.contracts.pending",
    review: "admin.contracts.review",
    approved: "admin.contracts.approved",
    rejected: "admin.contracts.rejected",
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    pending: "outline",
    review: "secondary",
    approved: "default",
    rejected: "destructive",
}

export default function AdminValideringPage() {
    const { t } = useI18n()
    const { contracts, deleteContract, updateContract } = useContracts()
    const [reviewingId, setReviewingId] = useState<string | null>(null)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)
    const [screeningResult, setScreeningResult] = useState<ScreeningResult | null>(null)
    const [screening, setScreening] = useState(false)
    const [screeningError, setScreeningError] = useState<string | null>(null)
    const [showFlags, setShowFlags] = useState(true)

    const unreviewedContracts = contracts.filter(
        (c) => c.status === "pending" || c.status === "review"
    )
    const reviewedContracts = contracts.filter(
        (c) => c.status === "approved" || c.status === "rejected"
    )
    const reviewingContract = contracts.find((c) => c.id === reviewingId)

    const handleApprove = (id: string) => {
        const c = contracts.find(x => x.id === id)
        // Merge AI-extracted data if available
        if (screeningResult) {
            updateContract(id, {
                status: "approved",
                extractedData: screeningResult.extractedData,
            })
        } else {
            updateContract(id, { status: "approved" })
        }
        setReviewingId(null)
        setLocalPdfUrl(null)
        setScreeningResult(null)
        setScreeningError(null)
        if (c) toast.success(`"${c.title}" er godkendt`)
    }

    const handleScreenContract = async () => {
        if (!localPdfUrl) {
            toast.error("Upload en PDF for at køre AI-screening")
            return
        }
        setScreening(true)
        setScreeningError(null)
        setScreeningResult(null)
        try {
            // Fetch the blob URL as a File
            const resp = await fetch(localPdfUrl)
            const blob = await resp.blob()
            const file = new File([blob], "kontrakt.pdf", { type: "application/pdf" })
            const text = await extractTextFromFile(file)
            if (!text.trim()) throw new Error("Ingen tekst fundet i PDF — er det en scannet fil?")
            const result = await screenContract(text)
            setScreeningResult(result)
            toast.success("AI-screening fuldført")
        } catch (e: any) {
            setScreeningError(e.message)
            toast.error(`Screening fejlede: ${e.message}`)
        }
        setScreening(false)
    }

    const handleDelete = (id: string) => {
        const c = contracts.find(x => x.id === id)
        deleteContract(id)
        setDeleteId(null)
        if (reviewingId === id) {
            setReviewingId(null)
            setLocalPdfUrl(null)
        }
        if (c) toast.success(`"${c.title}" er slettet`)
    }

    const handleLocalPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) setLocalPdfUrl(URL.createObjectURL(file))
    }

    // ── Review View ──────────────────────────────────────────

    if (reviewingContract) {
        const data = reviewingContract.extractedData
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => { setReviewingId(null); setLocalPdfUrl(null); setScreeningResult(null); setScreeningError(null) }}
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t("admin.validation.backToList")}
                    </Button>
                    <Separator orientation="vertical" className="h-5" />
                    <span className="text-sm font-medium">
                        {reviewingContract.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        — {reviewingContract.userName}
                    </span>
                </div>

                {/* Split view: PDF left, data right */}
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* PDF Panel */}
                    <div className="flex flex-col rounded-lg border min-h-[700px]">
                        <div className="flex items-center gap-2 border-b px-4 py-3">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{t("admin.validation.pdf")}</span>
                            <span className="ml-auto flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                    {reviewingContract.title}
                                </span>
                                <label className="cursor-pointer">
                                    <input
                                        type="file"
                                        accept=".pdf"
                                        className="hidden"
                                        onChange={handleLocalPdf}
                                    />
                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                        <Upload className="h-3 w-3" />
                                        Test PDF
                                    </span>
                                </label>
                            </span>
                        </div>
                        {localPdfUrl ? (
                            <PdfViewer url={localPdfUrl} />
                        ) : (
                            <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8">
                                <FileText className="h-12 w-12 opacity-20 text-muted-foreground" />
                                <p className="mt-3 text-sm text-muted-foreground">Vælg en PDF for at teste vieweren</p>
                                <label className="mt-3 cursor-pointer">
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

                    {/* Extracted Data Panel */}
                    <div className="rounded-lg border">
                        <div className="flex items-center gap-2 border-b px-4 py-3">
                            <span className="text-sm font-medium">
                                {t("admin.validation.extracted")}
                            </span>
                            <div className="ml-auto flex items-center gap-2">
                                {screeningResult && (
                                    <Badge
                                        variant={
                                            screeningResult.overallVerdict === "approved"
                                                ? "default"
                                                : screeningResult.overallVerdict === "critical"
                                                ? "destructive"
                                                : "secondary"
                                        }
                                        className="font-normal text-xs"
                                    >
                                        {screeningResult.overallVerdict === "approved"
                                            ? "✓ Godkendt af AI"
                                            : screeningResult.overallVerdict === "critical"
                                            ? "✗ Kritisk"
                                            : "! Med forbehold"}
                                    </Badge>
                                )}
                                {screeningResult?.profMember !== undefined && (
                                    <Badge
                                        variant={screeningResult.profMember ? "default" : "outline"}
                                        className="font-normal text-xs"
                                    >
                                        {screeningResult.profMember === true
                                            ? "ProF-medlem"
                                            : screeningResult.profMember === false
                                            ? "Ikke ProF-medlem"
                                            : "Medlemsskab ukendt"}
                                    </Badge>
                                )}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 text-xs"
                                    onClick={handleScreenContract}
                                    disabled={screening || !localPdfUrl}
                                    title={!localPdfUrl ? "Upload en PDF for at aktivere AI-screening" : ""}
                                >
                                    <Sparkles className={`h-3.5 w-3.5 ${screening ? "animate-pulse" : ""}`} />
                                    {screening ? "Screener..." : "AI-screen"}
                                </Button>
                            </div>
                        </div>

                        {/* AI Flags panel */}
                        {screeningError && (
                            <div className="flex items-start gap-2 mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                {screeningError}
                            </div>
                        )}

                        {screeningResult && screeningResult.flags.length > 0 && (
                            <div className="mx-4 mt-4 rounded-lg border">
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
                                    onClick={() => setShowFlags(!showFlags)}
                                >
                                    <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>
                                        AI-markører ({screeningResult.flags.length})
                                        {" — "}
                                        {screeningResult.flags.filter(f => f.severity === "critical").length > 0 && (
                                            <span className="text-destructive">
                                                {screeningResult.flags.filter(f => f.severity === "critical").length} kritiske
                                            </span>
                                        )}
                                    </span>
                                    {showFlags ? (
                                        <ChevronUp className="ml-auto h-3.5 w-3.5" />
                                    ) : (
                                        <ChevronDown className="ml-auto h-3.5 w-3.5" />
                                    )}
                                </button>
                                {showFlags && (
                                    <div className="divide-y border-t">
                                        {screeningResult.flags.map((flag: ContractFlag, i: number) => (
                                            <div key={i} className="px-3 py-2.5 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    {flag.severity === "critical" ? (
                                                        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                                                    ) : flag.severity === "warning" ? (
                                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                                    ) : (
                                                        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                    )}
                                                    <span className="text-xs font-medium">{flag.title}</span>
                                                    <Badge
                                                        variant={
                                                            flag.severity === "critical"
                                                                ? "destructive"
                                                                : flag.severity === "warning"
                                                                ? "secondary"
                                                                : "outline"
                                                        }
                                                        className="ml-auto text-[10px] font-normal"
                                                    >
                                                        {flag.category}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground pl-5">
                                                    {flag.description}
                                                </p>
                                                {flag.quote && (
                                                    <p className="text-[10px] text-muted-foreground pl-5 italic border-l ml-5 border-muted">
                                                        "{flag.quote}"
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {screeningResult.recommendations.length > 0 && (
                                    <div className="border-t px-3 py-2 space-y-1">
                                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                            Anbefalinger
                                        </p>
                                        {screeningResult.recommendations.map((r: string, i: number) => (
                                            <p key={i} className="text-xs text-muted-foreground">
                                                → {r}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-5 p-4">
                            {/* Producer */}
                            <div className="space-y-1.5">
                                <Label className="text-xs">{t("admin.validation.producer")}</Label>
                                <Input
                                    defaultValue={data?.producerName}
                                    placeholder="Producentens navn..."
                                />
                            </div>

                            <Separator />

                            {/* Salary */}
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.salary")}</Label>
                                    <Input
                                        type="number"
                                        defaultValue={data?.salary}
                                        placeholder="0"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.salaryUnit")}</Label>
                                    <Select defaultValue={data?.salaryUnit || "monthly"}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="monthly">{t("admin.validation.monthly")}</SelectItem>
                                            <SelectItem value="weekly">{t("admin.validation.weekly")}</SelectItem>
                                            <SelectItem value="daily">{t("admin.validation.daily")}</SelectItem>
                                            <SelectItem value="total">{t("admin.validation.total")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <Separator />

                            {/* Employment */}
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.startDate")}</Label>
                                    <Input type="date" defaultValue={data?.startDate} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.endDate")}</Label>
                                    <Input type="date" defaultValue={data?.endDate} />
                                </div>
                            </div>

                            <Separator />

                            {/* Pension & Supplements */}
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.pensionPercent")}</Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="number"
                                            defaultValue={data?.pensionPercent}
                                            placeholder="0"
                                            step="0.1"
                                        />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.pension")} ({t("common.kr")})</Label>
                                    <Input
                                        type="number"
                                        defaultValue={data?.pensionSupplement}
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.personalSupplement")}</Label>
                                    <Input
                                        type="number"
                                        defaultValue={data?.personalSupplement}
                                        placeholder="0"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.other")}</Label>
                                    <Input
                                        defaultValue={data?.otherSupplements}
                                        placeholder="—"
                                    />
                                </div>
                            </div>

                            <Separator />

                            {/* Working weeks */}
                            <div className="space-y-1.5">
                                <Label className="text-xs">{t("admin.validation.workingWeeks")}</Label>
                                <Input
                                    type="number"
                                    defaultValue={data?.workingWeeks}
                                    placeholder="0"
                                    className="max-w-[120px]"
                                />
                            </div>

                            <Separator />

                            {/* Producer contributions: Helligdagsbetaling & BETA */}
                            <div>
                                <Label className="text-xs mb-3 block">{t("admin.validation.producerContributions")}</Label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.validation.holidayPay")}</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                defaultValue={data?.holidayPayRate}
                                                placeholder="12.5"
                                                step="0.1"
                                            />
                                            <span className="text-sm text-muted-foreground">%</span>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.validation.beta")}</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                defaultValue={data?.betaRate}
                                                placeholder="0.6"
                                                step="0.01"
                                            />
                                            <span className="text-sm text-muted-foreground">%</span>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-2">
                                    Satser for producent/arbejdsgivers indbetaling
                                </p>
                            </div>

                            <Separator />

                            {/* Rights */}
                            <div>
                                <Label className="text-xs mb-3 block">{t("admin.validation.rights")}</Label>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm">SVOD</span>
                                        <Switch defaultChecked={data?.svod} />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm">Copydan</span>
                                        <Switch defaultChecked={data?.copydan} />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm flex-1">Royalty</span>
                                        <Input
                                            type="number"
                                            defaultValue={data?.royaltyPercent}
                                            placeholder="%"
                                            className="w-20"
                                            step="0.1"
                                        />
                                        <Switch defaultChecked={data?.royalty} />
                                    </div>
                                    <Separator className="my-1" />
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm">{t("admin.validation.aiClause")}</span>
                                            <p className="text-[10px] text-muted-foreground">
                                                {t("admin.validation.aiClauseDesc")}
                                            </p>
                                        </div>
                                        <Switch defaultChecked={data?.aiDataMiningClause} />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            {/* Distribution & Agreement */}
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.distribution")}</Label>
                                    <Input
                                        defaultValue={data?.distribution?.join(", ")}
                                        placeholder="Netflix, DR, TV2..."
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.agreement")}</Label>
                                    <Input
                                        defaultValue={
                                            data?.collectiveAgreement
                                                ? data.collectiveAgreementName
                                                : ""
                                        }
                                        placeholder="—"
                                    />
                                </div>
                            </div>

                            {/* Gender & Special */}
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.validation.gender")}</Label>
                                    <Select defaultValue={data?.gender}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="—" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="male">{t("admin.stats.male")}</SelectItem>
                                            <SelectItem value="female">{t("admin.stats.female")}</SelectItem>
                                            <SelectItem value="other">Andet</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs">{t("admin.validation.specialNotes")}</Label>
                                <Textarea
                                    defaultValue={data?.specialNotes}
                                    placeholder="Fritekst..."
                                    rows={3}
                                />
                            </div>

                            <Separator />

                            {/* Actions */}
                            <div className="flex items-center gap-2 pt-1">
                                <Button
                                    className="gap-1.5"
                                    onClick={() => handleApprove(reviewingContract.id)}
                                >
                                    <Check className="h-4 w-4" />
                                    {t("admin.validation.approve")}
                                </Button>
                                <Button variant="outline" className="ml-auto">
                                    {t("admin.validation.save")}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // ── Overview ─────────────────────────────────────────────

    function ContractTable({
        items,
        showDelete,
    }: {
        items: Contract[]
        showDelete?: boolean
    }) {
        if (items.length === 0) {
            return (
                <div className="py-12 text-center text-sm text-muted-foreground">
                    {t("common.noResults")}
                </div>
            )
        }

        return (
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t("works.workTitle")}</TableHead>
                        <TableHead>{t("admin.contracts.member")}</TableHead>
                        <TableHead>{t("upload.category")}</TableHead>
                        <TableHead>{t("admin.contracts.uploaded")}</TableHead>
                        <TableHead>{t("admin.contracts.status")}</TableHead>
                        <TableHead className="w-[100px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((c) => (
                        <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.title}</TableCell>
                            <TableCell className="text-muted-foreground">{c.userName}</TableCell>
                            <TableCell>
                                <span className="text-sm">{t(`cat.${c.category}` as any)}</span>
                            </TableCell>
                            <TableCell className="text-muted-foreground tabular-nums">
                                {c.uploadedAt}
                            </TableCell>
                            <TableCell>
                                <Badge variant={statusVariant[c.status]} className="font-normal">
                                    {t(statusLabels[c.status] as any)}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                <div className="flex gap-1">
                                    {(c.status === "pending" || c.status === "review") && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 gap-1 text-xs"
                                            onClick={() => setReviewingId(c.id)}
                                        >
                                            <Eye className="h-3 w-3" />
                                            {t("admin.validation.review")}
                                        </Button>
                                    )}
                                    {c.status === "approved" && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 gap-1 text-xs"
                                            onClick={() => setReviewingId(c.id)}
                                        >
                                            <Eye className="h-3 w-3" />
                                            {t("common.view")}
                                        </Button>
                                    )}
                                    {showDelete && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={() => setDeleteId(c.id)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.validation.title")}
                subtitle={t("admin.validation.subtitle")}
            />

            <Tabs defaultValue="unreviewed">
                <TabsList>
                    <TabsTrigger value="unreviewed" className="gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {t("admin.validation.unreviewed")}
                        {unreviewedContracts.length > 0 && (
                            <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 text-[10px] justify-center">
                                {unreviewedContracts.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="reviewed" className="gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("admin.validation.reviewed")}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="unreviewed" className="mt-4">
                    <div className="rounded-lg border">
                        <ContractTable items={unreviewedContracts} showDelete />
                    </div>
                </TabsContent>

                <TabsContent value="reviewed" className="mt-4">
                    <div className="rounded-lg border">
                        <ContractTable items={reviewedContracts} />
                    </div>
                </TabsContent>
            </Tabs>

            {/* Delete confirmation dialog */}
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("common.delete")}</DialogTitle>
                        <DialogDescription>{t("common.deleteConfirm")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteId && handleDelete(deleteId)}
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("common.delete")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
