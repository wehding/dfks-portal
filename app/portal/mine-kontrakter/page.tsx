"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
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
    Sparkles,
    Loader2,
    X,
} from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { mockRoles, mockRegisteredWorks } from "@/lib/mock-data"
import { useContracts } from "@/lib/hooks"
import type { PortalScreeningResult } from "@/lib/ai"
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
    const [creditedRoles, setCreditedRoles] = useState<string[]>([""])
    const [duration, setDuration] = useState("")
    const [premiereDate, setPremiereDate] = useState("")
    const [episodes, setEpisodes] = useState<Episode[]>([])
    const [episodeCredits, setEpisodeCredits] = useState<{ number: number; role: string }[]>([{ number: 1, role: "" }])
    const [isDragging, setIsDragging] = useState(false)
    const [screening, setScreening] = useState(false)
    const [aiFields, setAiFields] = useState<Set<string>>(new Set())

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
        setEpisodes((prev) => prev.filter((_, i) => i !== idx))

    const activeRoles = mockRoles.filter((r) => r.active)

    // Auto-screen contract when file is selected
    useEffect(() => {
        if (!file) return
        let cancelled = false
        setScreening(true)
        setAiFields(new Set())
        const roleNames = activeRoles.map(r => r.name)
        ;(async () => {
            try {
                const { extractTextFromFile, screenPortalContract } = await import("@/lib/ai")
                const text = await extractTextFromFile(file)
                if (cancelled) return
                const result: PortalScreeningResult = await screenPortalContract(text, roleNames)
                if (cancelled) return
                const filled = new Set<string>()
                if (result.title) { setTitle(result.title); filled.add("title") }
                if (result.category && ["feature","short","tvSeries","documentary","docSeries","tvEntertainment","reality","sport"].includes(result.category)) {
                    setCategory(result.category as Category); filled.add("category")
                }
                if (result.creditedRole) {
                    // Find exact match first, then case-insensitive fallback
                    const exact = roleNames.find(r => r === result.creditedRole)
                    const ci = exact ?? roleNames.find(r => r.toLowerCase() === result.creditedRole!.toLowerCase())
                    if (ci) { setCreditedRoles([ci]); filled.add("creditedRole") }
                }
                if (result.premiereDate) { setPremiereDate(result.premiereDate); filled.add("premiereDate") }
                if (result.episodes && result.episodes.length > 0) {
                    setEpisodes(result.episodes.map((e, i) => ({ number: i + 1, title: e.title ?? "", duration: e.duration ?? 0 })))
                    filled.add("episodes")
                } else if (result.duration && result.duration > 0) {
                    setDuration(String(result.duration)); filled.add("duration")
                }
                setAiFields(filled)
                if (filled.size > 0) {
                    toast.success(`${filled.size} felt${filled.size > 1 ? "er" : ""} udfyldt automatisk — kontrollér og ret`)
                }
            } catch (e: any) {
                if (!cancelled) toast.error(`Screening fejlede: ${e.message}`)
            } finally {
                if (!cancelled) setScreening(false)
            }
        })()
        return () => { cancelled = true }
    }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

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
                                            {c.creditedRoles.join(", ")}
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
                                    {screening ? (
                                        <Loader2 className="h-4 w-4 text-purple-500 shrink-0 animate-spin" />
                                    ) : (
                                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <span className="text-sm truncate block">{file.name}</span>
                                        {screening && (
                                            <span className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1 mt-0.5">
                                                <Sparkles className="h-3 w-3" />
                                                Screener kontrakt...
                                            </span>
                                        )}
                                    </div>
                                    {!screening && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="gap-1.5"
                                            onClick={() => setShowPdfPreview(true)}
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                            {t("common.preview")}
                                        </Button>
                                    )}
                                </div>
                            )}

                            {/* Form */}
                            <div className="space-y-4">
                                {/* Title + Work Matching */}
                                <div className="space-y-1.5">
                                    <Label className="text-xs flex items-center gap-1">
                                        {t("upload.title_field")}
                                        {aiFields.has("title") && <Sparkles className="h-3 w-3 text-purple-500" />}
                                    </Label>
                                    <Input
                                        value={title}
                                        onChange={(e) => {
                                            setTitle(e.target.value)
                                            setMatchedWork(null)
                                        }}
                                        placeholder="Fx: Drømmen om Danmark"
                                        disabled={screening}
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
                                        <Label className="text-xs flex items-center gap-1">
                                            {t("upload.category")}
                                            {aiFields.has("category") && <Sparkles className="h-3 w-3 text-purple-500" />}
                                        </Label>
                                        <Select
                                            value={category}
                                            disabled={screening}
                                            onValueChange={(v) => {
                                                setCategory(v as Category)
                                                if (!seriesCategories.includes(v as Category)) {
                                                    setEpisodes([])
                                                    setEpisodeCredits([{ number: 1, role: "" }])
                                                }
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
                                    {/* Credited roles — only for non-series */}
                                    {!isSeries && (
                                        <div className="space-y-1.5">
                                            <Label className="text-xs flex items-center gap-1">
                                                {t("upload.creditedRole")}
                                                {aiFields.has("creditedRole") && <Sparkles className="h-3 w-3 text-purple-500" />}
                                            </Label>
                                            <div className="space-y-2">
                                                {creditedRoles.map((role, idx) => (
                                                    <div key={idx} className="flex gap-2">
                                                        <Select
                                                            value={role}
                                                            disabled={screening}
                                                            onValueChange={(v) =>
                                                                setCreditedRoles(prev => prev.map((r, i) => i === idx ? v : r))
                                                            }
                                                        >
                                                            <SelectTrigger className="flex-1">
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
                                                        {creditedRoles.length > 1 && (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-9 w-9 shrink-0 text-muted-foreground"
                                                                onClick={() =>
                                                                    setCreditedRoles(prev => prev.filter((_, i) => i !== idx))
                                                                }
                                                            >
                                                                <X className="h-3.5 w-3.5" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                ))}
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 gap-1 text-xs text-muted-foreground px-0 hover:bg-transparent hover:text-foreground"
                                                    disabled={screening}
                                                    onClick={() => setCreditedRoles(prev => [...prev, ""])}
                                                >
                                                    <Plus className="h-3 w-3" />
                                                    Tilføj kreditering
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Episode credits (series) or duration (non-series) */}
                                {isSeries ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs">Afsnit &amp; kreditering</Label>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 gap-1 text-xs"
                                                onClick={() => setEpisodeCredits(prev => [...prev, { number: (prev[prev.length - 1]?.number ?? 0) + 1, role: prev[prev.length - 1]?.role ?? "" }])}
                                            >
                                                <Plus className="h-3 w-3" />
                                                Tilføj afsnit
                                            </Button>
                                        </div>
                                        {episodeCredits.length === 0 && (
                                            <p className="text-xs text-muted-foreground py-4 text-center border rounded-md border-dashed">
                                                Tilføj de afsnit du har kreditering på
                                            </p>
                                        )}
                                        <div className="space-y-2">
                                            {episodeCredits.map((ec, idx) => (
                                                <div key={idx} className="grid grid-cols-[52px_1fr_32px] gap-2 items-center">
                                                    <div className="relative">
                                                        <Input
                                                            type="number"
                                                            value={ec.number}
                                                            onChange={(e) =>
                                                                setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, number: parseInt(e.target.value) || 1 } : x))
                                                            }
                                                            className="h-8 text-sm pl-4 pr-1 tabular-nums"
                                                            min={1}
                                                        />
                                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">#</span>
                                                    </div>
                                                    <Select
                                                        value={ec.role}
                                                        onValueChange={(v) =>
                                                            setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, role: v } : x))
                                                        }
                                                    >
                                                        <SelectTrigger className="h-8 text-sm">
                                                            <SelectValue placeholder="Kreditering..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {activeRoles.map((r) => (
                                                                <SelectItem key={r.id} value={r.name}>
                                                                    {r.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground"
                                                        onClick={() => setEpisodeCredits(prev => prev.filter((_, i) => i !== idx))}
                                                        disabled={episodeCredits.length === 1}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs flex items-center gap-1">
                                                {t("upload.duration")}
                                                {aiFields.has("duration") && <Sparkles className="h-3 w-3 text-purple-500" />}
                                            </Label>
                                            <div className="relative">
                                                <Input
                                                    type="number"
                                                    value={duration}
                                                    onChange={(e) => setDuration(e.target.value)}
                                                    placeholder="0"
                                                    className="pr-10"
                                                    disabled={screening}
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                                    {t("common.minutes")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs flex items-center gap-1">
                                                {t("upload.premiereDate")}
                                                {aiFields.has("premiereDate") && <Sparkles className="h-3 w-3 text-purple-500" />}
                                            </Label>
                                            <Input
                                                type="date"
                                                value={premiereDate}
                                                onChange={(e) => setPremiereDate(e.target.value)}
                                                disabled={screening}
                                            />
                                        </div>
                                    </div>
                                )}

                                {isSeries && (
                                    <div className="space-y-1.5">
                                        <Label className="text-xs flex items-center gap-1">
                                            {t("upload.premiereDate")}
                                            {aiFields.has("premiereDate") && <Sparkles className="h-3 w-3 text-purple-500" />}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={premiereDate}
                                            onChange={(e) => setPremiereDate(e.target.value)}
                                            disabled={screening}
                                        />
                                    </div>
                                )}

                                <Separator />

                                <Button
                                    className="w-full"
                                    disabled={!file || !title || screening || (isSeries ? episodeCredits.every(e => !e.role) : creditedRoles.every(r => !r))}
                                    onClick={() => {
                                        if (!file || !title) return
                                        const today = new Date()
                                        const dateStr = today.toISOString().slice(0, 10)
                                        const filledEpisodeCredits = episodeCredits.filter(e => e.role)
                                        addContract({
                                            id: `portal_${Date.now()}`,
                                            userId: "u1",
                                            userName: "Anna Heide",
                                            title: title.trim(),
                                            category: (category || "feature") as any,
                                            creditedRoles: isSeries
                                                ? [...new Set(filledEpisodeCredits.map(e => e.role))]
                                                : creditedRoles.filter(Boolean).length > 0 ? creditedRoles.filter(Boolean) : ["Klipper"],
                                            duration: Number(duration) || 0,
                                            episodes: isSeries
                                                ? filledEpisodeCredits.map(e => ({ number: e.number, title: "", duration: 0 }))
                                                : undefined,
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
                                        setCreditedRoles([""])
                                        setDuration("")
                                        setPremiereDate("")
                                        setEpisodes([])
                                        setEpisodeCredits([{ number: 1, role: "" }])
                                        setAiFields(new Set())
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
                <DialogContent className="sm:max-w-7xl w-[92vw] h-[90vh] flex flex-col">
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
                                className={`flex-1 grid gap-4 overflow-hidden ${isApproved && data ? "lg:grid-cols-[3fr_2fr]" : ""
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
