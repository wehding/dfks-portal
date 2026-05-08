"use client"

import { useState, useMemo, useCallback } from "react"
import {
    Upload,
    Plus,
    Trash2,
    AlertCircle,
    CheckCircle2,
    Eye,
    Clock,
    FileText,
    ChevronDown,
} from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { mockRoles, mockRegisteredWorks } from "@/lib/mock-data"
import { useContracts } from "@/lib/hooks"
import { PdfViewer } from "@/components/pdf-viewer"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
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
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { Episode, Category } from "@/lib/types"

const seriesCategories: Category[] = ["tvSeries", "docSeries"]

const statusIcon: Record<string, typeof Clock> = {
    pending: Clock,
    review: Eye,
    approved: CheckCircle2,
}

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
    pending: "outline",
    review: "secondary",
    approved: "default",
}

const statusLabels: Record<string, string> = {
    pending: "admin.contracts.pending",
    review: "admin.contracts.review",
    approved: "admin.contracts.approved",
}

export default function MineKontrakterPage() {
    const { t } = useI18n()
    const { contracts, addContract } = useContracts()

    // Member's contracts (filtered by userId in real app)
    const myContracts = contracts.filter((c) => c.userId === "u1")

    // Upload section state
    const [showUpload, setShowUpload] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [pdfUrl, setPdfUrl] = useState<string | null>(null)
    const [showPdfPreview, setShowPdfPreview] = useState(false)
    const [title, setTitle] = useState("")
    const [category, setCategory] = useState<Category | "">("")
    const [creditedRole, setCreditedRole] = useState("")
    const [duration, setDuration] = useState("")
    const [premiereDate, setPremiereDate] = useState("")
    const [episodes, setEpisodes] = useState<Episode[]>([])
    const [isDragging, setIsDragging] = useState(false)

    // Contract detail preview
    const [previewContractId, setPreviewContractId] = useState<string | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)

    // Work matching
    const [matchedWork, setMatchedWork] = useState<any>(null)

    const isSeries = seriesCategories.includes(category as Category)

    const titleMatches = useMemo(() => {
        if (!title.trim()) return []
        const lower = title.toLowerCase().trim()
        return mockRegisteredWorks.filter((w) => w.title.toLowerCase() === lower)
    }, [title])

    const handleFile = useCallback((f: File) => {
        const allowed = [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ]
        if (allowed.includes(f.type)) {
            setFile(f)
            if (f.type === "application/pdf") setPdfUrl(URL.createObjectURL(f))
        }
    }, [])

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0])
        },
        [handleFile]
    )

    const addEpisode = () =>
        setEpisodes((prev) => [
            ...prev,
            { number: prev.length + 1, title: "", duration: 0 },
        ])

    const updateEpisode = (idx: number, updates: Partial<Episode>) =>
        setEpisodes((prev) =>
            prev.map((ep, i) => (i === idx ? { ...ep, ...updates } : ep))
        )

    const removeEpisode = (idx: number) =>
        setEpisodes((prev) =>
            prev
                .filter((_, i) => i !== idx)
                .map((ep, i) => ({ ...ep, number: i + 1 }))
        )

    const activeRoles = mockRoles.filter((r) => r.active)

    const handleLocalPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) setLocalPdfUrl(URL.createObjectURL(file))
    }

    const previewContract = myContracts.find((c) => c.id === previewContractId)

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("nav.myContracts")}
                actions={
                    <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setShowUpload(!showUpload)}
                    >
                        <Upload className="h-3.5 w-3.5" />
                        {t("upload.title")}
                    </Button>
                }
            />

            {/* ── My Contracts Overview ──────────────────────────── */}
            {myContracts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="h-10 w-10 text-muted-foreground/40" />
                    <p className="mt-4 text-sm font-medium">Ingen kontrakter endnu</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Upload din første kontrakt for at komme i gang.
                    </p>
                </div>
            ) : (
                <div className="rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("works.workTitle")}</TableHead>
                                <TableHead>{t("upload.category")}</TableHead>
                                <TableHead>{t("upload.creditedRole")}</TableHead>
                                <TableHead>{t("admin.contracts.uploaded")}</TableHead>
                                <TableHead>{t("admin.contracts.status")}</TableHead>
                                <TableHead className="w-[60px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {myContracts.map((c) => {
                                const Icon = statusIcon[c.status] || Clock
                                return (
                                    <TableRow key={c.id}>
                                        <TableCell className="font-medium">{c.title}</TableCell>
                                        <TableCell className="text-sm">
                                            {t(`cat.${c.category}` as any)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {c.creditedRole}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground tabular-nums">
                                            {c.uploadedAt}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={statusVariant[c.status]}
                                                className="gap-1 font-normal"
                                            >
                                                <Icon className="h-3 w-3" />
                                                {t(statusLabels[c.status] as any)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => setPreviewContractId(c.id)}
                                            >
                                                <Eye className="h-3.5 w-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* ── Upload Section (collapsible) ──────────────────── */}
            <Collapsible open={showUpload} onOpenChange={setShowUpload}>
                <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-2 w-full rounded-lg border border-dashed p-4 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                        <Upload className="h-4 w-4" />
                        <span>{t("upload.title")}</span>
                        <ChevronDown
                            className={`ml-auto h-4 w-4 transition-transform ${showUpload ? "rotate-180" : ""
                                }`}
                        />
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="mt-4 grid gap-6 lg:grid-cols-2">
                        {/* Left: Upload + Form */}
                        <div className="space-y-6">
                            {/* Drop zone */}
                            <div
                                className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${isDragging
                                        ? "border-foreground/50 bg-muted/50"
                                        : "border-muted-foreground/20"
                                    }`}
                                onDragOver={(e) => {
                                    e.preventDefault()
                                    setIsDragging(true)
                                }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                            >
                                <Upload className="mx-auto h-8 w-8 text-muted-foreground/40" />
                                <p className="mt-3 text-sm">{t("upload.dragDrop")}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {t("upload.or")}
                                </p>
                                <label className="mt-3 inline-block cursor-pointer">
                                    <input
                                        type="file"
                                        accept=".pdf,.doc,.docx"
                                        className="hidden"
                                        onChange={(e) =>
                                            e.target.files?.[0] && handleFile(e.target.files[0])
                                        }
                                    />
                                    <span className="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors">
                                        {t("upload.browse")}
                                    </span>
                                </label>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {t("upload.maxSize")}
                                </p>
                            </div>

                            {/* File info */}
                            {file && (
                                <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
                                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                                    <span className="text-sm truncate flex-1">{file.name}</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-1.5"
                                        onClick={() => setShowPdfPreview(true)}
                                    >
                                        <Eye className="h-3.5 w-3.5" />
                                        {t("common.preview")}
                                    </Button>
                                </div>
                            )}

                            {/* Form */}
                            <div className="space-y-4">
                                {/* Title + Work Matching */}
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("upload.title_field")}</Label>
                                    <Input
                                        value={title}
                                        onChange={(e) => {
                                            setTitle(e.target.value)
                                            setMatchedWork(null)
                                        }}
                                        placeholder="Fx: Drømmen om Danmark"
                                    />
                                    {titleMatches.length > 0 && !matchedWork && (
                                        <div className="rounded-md border bg-muted/50 p-3 space-y-2">
                                            <div className="flex items-start gap-2">
                                                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                                <div className="text-xs">
                                                    {titleMatches.length > 1
                                                        ? t("upload.disambiguate")
                                                        : t("upload.matchWorkHint")}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                {titleMatches.map((w) => (
                                                    <button
                                                        key={w.id}
                                                        className="w-full text-left rounded px-2.5 py-1.5 text-sm hover:bg-background transition-colors flex items-center justify-between"
                                                        onClick={() => setMatchedWork(w)}
                                                    >
                                                        <span>
                                                            {w.title}{" "}
                                                            <span className="text-muted-foreground">
                                                                ({w.premiereYear})
                                                            </span>
                                                        </span>
                                                        {w.registeredBy.length > 0 && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-[10px] font-normal"
                                                            >
                                                                {w.registeredBy.length} registreret
                                                            </Badge>
                                                        )}
                                                    </button>
                                                ))}
                                                <button
                                                    className="w-full text-left rounded px-2.5 py-1.5 text-sm hover:bg-background transition-colors text-muted-foreground"
                                                    onClick={() => setMatchedWork(null)}
                                                >
                                                    + {t("upload.newWork")}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {matchedWork && (
                                        <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            <span>
                                                {t("upload.existingWork")}: {matchedWork.title} (
                                                {matchedWork.premiereYear})
                                                {matchedWork.registeredBy.length > 0 &&
                                                    ` — delt med ${matchedWork.registeredBy.join(", ")}`}
                                            </span>
                                            <button
                                                className="ml-auto text-muted-foreground hover:text-foreground"
                                                onClick={() => setMatchedWork(null)}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Category + Role */}
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("upload.category")}</Label>
                                        <Select
                                            value={category}
                                            onValueChange={(v) => {
                                                setCategory(v as Category)
                                                if (!seriesCategories.includes(v as Category))
                                                    setEpisodes([])
                                            }}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="—" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="feature">{t("cat.feature")}</SelectItem>
                                                <SelectItem value="short">{t("cat.short")}</SelectItem>
                                                <SelectItem value="tvSeries">{t("cat.tvSeries")}</SelectItem>
                                                <SelectItem value="documentary">{t("cat.documentary")}</SelectItem>
                                                <SelectItem value="docSeries">{t("cat.docSeries")}</SelectItem>
                                                <SelectItem value="tvEntertainment">{t("cat.tvEntertainment")}</SelectItem>
                                                <SelectItem value="reality">{t("cat.reality")}</SelectItem>
                                                <SelectItem value="sport">{t("cat.sport")}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("upload.creditedRole")}</Label>
                                        <Select value={creditedRole} onValueChange={setCreditedRole}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="—" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {activeRoles.map((r) => (
                                                    <SelectItem key={r.id} value={r.name}>
                                                        {r.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Duration or Episodes */}
                                {isSeries ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs">{t("upload.episodes")}</Label>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 gap-1 text-xs"
                                                onClick={addEpisode}
                                            >
                                                <Plus className="h-3 w-3" />
                                                {t("upload.addEpisode")}
                                            </Button>
                                        </div>
                                        {episodes.length === 0 && (
                                            <p className="text-xs text-muted-foreground py-4 text-center border rounded-md border-dashed">
                                                Tilføj afsnit med titel og varighed
                                            </p>
                                        )}
                                        <div className="space-y-2">
                                            {episodes.map((ep, idx) => (
                                                <div
                                                    key={idx}
                                                    className="grid grid-cols-[40px_1fr_80px_32px] gap-2 items-center"
                                                >
                                                    <span className="text-xs text-muted-foreground text-center tabular-nums">
                                                        #{ep.number}
                                                    </span>
                                                    <Input
                                                        placeholder={t("upload.episodeTitle")}
                                                        value={ep.title}
                                                        onChange={(e) =>
                                                            updateEpisode(idx, { title: e.target.value })
                                                        }
                                                        className="h-8 text-sm"
                                                    />
                                                    <div className="relative">
                                                        <Input
                                                            type="number"
                                                            placeholder="min"
                                                            value={ep.duration || ""}
                                                            onChange={(e) =>
                                                                updateEpisode(idx, {
                                                                    duration: parseInt(e.target.value) || 0,
                                                                })
                                                            }
                                                            className="h-8 text-sm pr-8"
                                                        />
                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                                            min
                                                        </span>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => removeEpisode(idx)}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                        {episodes.length > 0 && (
                                            <div className="text-xs text-muted-foreground">
                                                Total: {episodes.reduce((s, e) => s + e.duration, 0)}{" "}
                                                {t("common.minutes")}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">{t("upload.duration")}</Label>
                                            <div className="relative">
                                                <Input
                                                    type="number"
                                                    value={duration}
                                                    onChange={(e) => setDuration(e.target.value)}
                                                    placeholder="0"
                                                    className="pr-10"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                                    {t("common.minutes")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">
                                                {t("upload.premiereDate")}
                                            </Label>
                                            <Input
                                                type="date"
                                                value={premiereDate}
                                                onChange={(e) => setPremiereDate(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}

                                {isSeries && (
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("upload.premiereDate")}</Label>
                                        <Input
                                            type="date"
                                            value={premiereDate}
                                            onChange={(e) => setPremiereDate(e.target.value)}
                                        />
                                    </div>
                                )}

                                <Separator />

                                <Button
                                    className="w-full"
                                    disabled={!file || !title}
                                    onClick={() => {
                                        if (!file || !title) return
                                        const today = new Date()
                                        const dateStr = today.toISOString().slice(0, 10)
                                        addContract({
                                            id: `portal_${Date.now()}`,
                                            userId: "u1",
                                            userName: "Anna Heide",
                                            title: title.trim(),
                                            category: (category || "feature") as any,
                                            creditedRole: creditedRole || "Klipper",
                                            duration: isSeries
                                                ? episodes.reduce((s, e) => s + e.duration, 0)
                                                : Number(duration) || 0,
                                            episodes: isSeries ? episodes : undefined,
                                            premiereDate: premiereDate || dateStr,
                                            premiereYear: premiereDate
                                                ? new Date(premiereDate).getFullYear()
                                                : today.getFullYear(),
                                            fileUrl: "",
                                            status: "pending",
                                            uploadedAt: dateStr,
                                        })
                                        setFile(null)
                                        setPdfUrl(null)
                                        setTitle("")
                                        setCategory("")
                                        setCreditedRole("")
                                        setDuration("")
                                        setPremiereDate("")
                                        setEpisodes([])
                                        setShowUpload(false)
                                    }}
                                >
                                    <Upload className="mr-2 h-4 w-4" />
                                    {t("upload.submit")}
                                </Button>
                            </div>
                        </div>

                        {/* Right: PDF Preview */}
                        <div className="hidden lg:flex flex-col rounded-lg border min-h-[600px]">
                            {pdfUrl ? (
                                <PdfViewer url={pdfUrl} />
                            ) : (
                                <div className="flex flex-1 items-center justify-center bg-muted/30 p-8">
                                    <p className="text-sm text-muted-foreground">
                                        {t("upload.dragDrop")}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {/* Mobile PDF Preview Dialog */}
            <Dialog open={showPdfPreview} onOpenChange={setShowPdfPreview}>
                <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{t("common.preview")}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 rounded-lg border overflow-hidden">
                        {pdfUrl && <PdfViewer url={pdfUrl} />}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Contract Detail Preview Dialog */}
            <Dialog
                open={!!previewContractId}
                onOpenChange={() => {
                    setPreviewContractId(null)
                    setLocalPdfUrl(null)
                }}
            >
                <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>
                            {previewContract?.title}
                            <Badge
                                variant={statusVariant[previewContract?.status || "pending"]}
                                className="ml-3 font-normal"
                            >
                                {previewContract
                                    ? t(statusLabels[previewContract.status] as any)
                                    : ""}
                            </Badge>
                        </DialogTitle>
                    </DialogHeader>
                    {(() => {
                        const data = previewContract?.extractedData
                        const isApproved = previewContract?.status === "approved"

                        return (
                            <div
                                className={`flex-1 grid gap-4 overflow-hidden ${isApproved && data ? "lg:grid-cols-2" : ""
                                    }`}
                            >
                                {/* PDF */}
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

                                {/* Extracted Data (approved only) */}
                                {isApproved && data && (
                                    <div className="rounded-lg border overflow-auto">
                                        <div className="flex items-center gap-2 border-b px-4 py-3 sticky top-0 bg-background z-10">
                                            <span className="text-sm font-medium">
                                                {t("admin.validation.extracted")}
                                            </span>
                                            <Badge
                                                variant="default"
                                                className="ml-auto text-[10px] font-normal"
                                            >
                                                {t("admin.contracts.approved")}
                                            </Badge>
                                        </div>
                                        <div className="p-4 space-y-4 text-sm">
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1">
                                                    {t("admin.validation.salary")}
                                                </p>
                                                <p className="font-medium tabular-nums">
                                                    {data.salary?.toLocaleString("da-DK")} {t("common.kr")}{" "}
                                                    /{" "}
                                                    {t(
                                                        `admin.validation.${data.salaryUnit || "monthly"}` as any
                                                    )}
                                                </p>
                                            </div>
                                            <Separator />
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.startDate")}
                                                    </p>
                                                    <p>{data.startDate}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.endDate")}
                                                    </p>
                                                    <p>{data.endDate}</p>
                                                </div>
                                            </div>
                                            {data.pensionSupplement && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">
                                                            {t("admin.validation.pension")}
                                                        </p>
                                                        <p className="tabular-nums">
                                                            {data.pensionSupplement?.toLocaleString("da-DK")}{" "}
                                                            {t("common.kr")}
                                                        </p>
                                                    </div>
                                                </>
                                            )}
                                            <Separator />
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-2">
                                                    {t("admin.validation.rights")}
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <Badge
                                                        variant={data.svod ? "default" : "outline"}
                                                        className="font-normal"
                                                    >
                                                        SVOD {data.svod ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge
                                                        variant={data.copydan ? "default" : "outline"}
                                                        className="font-normal"
                                                    >
                                                        Copydan {data.copydan ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge
                                                        variant={data.royalty ? "default" : "outline"}
                                                        className="font-normal"
                                                    >
                                                        Royalty{" "}
                                                        {data.royalty ? `${data.royaltyPercent}%` : "✗"}
                                                    </Badge>
                                                </div>
                                            </div>
                                            {data.distribution && data.distribution.length > 0 && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">
                                                            {t("admin.validation.distribution")}
                                                        </p>
                                                        <p>{data.distribution.join(", ")}</p>
                                                    </div>
                                                </>
                                            )}
                                            {data.collectiveAgreement && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <p className="text-xs text-muted-foreground mb-1">
                                                            {t("admin.validation.agreement")}
                                                        </p>
                                                        <p>{data.collectiveAgreementName}</p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Status message for non-approved */}
                                {!isApproved && (
                                    <div className="hidden lg:flex flex-col items-center justify-center rounded-lg border bg-muted/30 p-8">
                                        <Clock className="h-8 w-8 text-muted-foreground/40" />
                                        <p className="mt-3 text-sm text-muted-foreground text-center">
                                            Kontraktdata vises når din kontrakt er godkendt af administrationen.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    )
}
