"use client"

import { useState, useMemo } from "react"
import {
    Search,
    Trash2,
    Eye,
    Download,
    ArrowUpDown,
    ChevronUp,
    ChevronDown,
    Filter,
} from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { useContracts } from "@/lib/hooks"
import { PdfViewer } from "@/components/pdf-viewer"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import type { Contract } from "@/lib/types"

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    pending: "outline",
    review: "secondary",
    approved: "default",
    rejected: "destructive",
}

const statusLabels: Record<string, string> = {
    pending: "admin.contracts.pending",
    review: "admin.contracts.review",
    approved: "admin.contracts.approved",
    rejected: "admin.contracts.rejected",
}

type SortField = "title" | "uploadedAt" | "category" | "premiereYear"
type SortDir = "asc" | "desc"

function formatRights(c: Contract) {
    const d = c.extractedData
    if (!d) return "—"
    const parts: string[] = []
    if (d.svod) parts.push("SVOD")
    if (d.copydan) parts.push("Copydan")
    if (d.royalty) parts.push(`Royalty ${d.royaltyPercent || 0}%`)
    if (d.aiDataMiningClause) parts.push("AI-forbehold")
    return parts.length > 0 ? parts.join(", ") : "—"
}

export default function AdminKontrakterPage() {
    const { t } = useI18n()
    const { contracts, deleteContract } = useContracts()
    const [search, setSearch] = useState("")
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [viewContract, setViewContract] = useState<Contract | null>(null)
    const [localPdfUrl, setLocalPdfUrl] = useState<string | null>(null)

    // Filters
    const [filterYear, setFilterYear] = useState<string>("all")
    const [filterCategory, setFilterCategory] = useState<string>("all")

    // Sort
    const [sortField, setSortField] = useState<SortField>("uploadedAt")
    const [sortDir, setSortDir] = useState<SortDir>("desc")

    const years = useMemo(() => {
        const set = new Set(contracts.map((c) => c.premiereYear))
        return Array.from(set).sort((a, b) => b - a)
    }, [contracts])

    const categories = useMemo(() => {
        const set = new Set(contracts.map((c) => c.category))
        return Array.from(set)
    }, [contracts])

    const filtered = useMemo(() => {
        let result = contracts.filter(
            (c) =>
                c.title.toLowerCase().includes(search.toLowerCase()) ||
                c.userName?.toLowerCase().includes(search.toLowerCase())
        )
        if (filterYear !== "all") {
            result = result.filter((c) => c.premiereYear === parseInt(filterYear))
        }
        if (filterCategory !== "all") {
            result = result.filter((c) => c.category === filterCategory)
        }
        // Sort
        result.sort((a, b) => {
            let cmp = 0
            switch (sortField) {
                case "title":
                    cmp = a.title.localeCompare(b.title, "da")
                    break
                case "uploadedAt":
                    cmp = a.uploadedAt.localeCompare(b.uploadedAt)
                    break
                case "category":
                    cmp = a.category.localeCompare(b.category)
                    break
                case "premiereYear":
                    cmp = a.premiereYear - b.premiereYear
                    break
            }
            return sortDir === "asc" ? cmp : -cmp
        })
        return result
    }, [contracts, search, filterYear, filterCategory, sortField, sortDir])

    const handleDelete = () => {
        if (deleteId) {
            const c = contracts.find(x => x.id === deleteId)
            deleteContract(deleteId)
            setDeleteId(null)
            if (c) toast.success(`"${c.title}" er slettet`)
        }
    }

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"))
        } else {
            setSortField(field)
            setSortDir("asc")
        }
    }

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />
        return sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3 ml-1" />
        ) : (
            <ChevronDown className="h-3 w-3 ml-1" />
        )
    }

    const handleBulkDownload = () => {
        // In production: zip and download. For now simulate per-file download
        filtered.forEach((c) => {
            const link = document.createElement("a")
            link.href = c.fileUrl
            link.download = `${c.title}.pdf`
            link.click()
        })
        toast.success(`${filtered.length} kontrakter downloadet`)
    }

    const handleLocalPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) setLocalPdfUrl(URL.createObjectURL(file))
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.contracts.title")}
                subtitle={t("admin.contracts.subtitle")}
                actions={
                    filtered.length > 0 ? (
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={handleBulkDownload}
                        >
                            <Download className="h-3.5 w-3.5" />
                            {t("admin.contracts.bulkDownload")} ({filtered.length})
                        </Button>
                    ) : undefined
                }
            />

            {/* Search + Filters */}
            <div className="flex flex-wrap gap-3">
                <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("common.search")}
                        className="pl-9"
                    />
                </div>
                <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder={t("admin.contracts.filterYear")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("admin.stats.all")}</SelectItem>
                        {years.map((y) => (
                            <SelectItem key={y} value={String(y)}>
                                {y}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder={t("admin.contracts.filterCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("admin.stats.all")}</SelectItem>
                        {categories.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                                {t(`cat.${cat}` as any)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>
                                <button
                                    className="flex items-center text-xs font-medium"
                                    onClick={() => toggleSort("title")}
                                >
                                    {t("works.workTitle")}
                                    <SortIcon field="title" />
                                </button>
                            </TableHead>
                            <TableHead>{t("admin.contracts.member")}</TableHead>
                            <TableHead>{t("upload.creditedRole")}</TableHead>
                            <TableHead>
                                <button
                                    className="flex items-center text-xs font-medium"
                                    onClick={() => toggleSort("category")}
                                >
                                    {t("upload.category")}
                                    <SortIcon field="category" />
                                </button>
                            </TableHead>
                            <TableHead>
                                <button
                                    className="flex items-center text-xs font-medium"
                                    onClick={() => toggleSort("premiereYear")}
                                >
                                    {t("admin.contracts.premiere")}
                                    <SortIcon field="premiereYear" />
                                </button>
                            </TableHead>
                            <TableHead>{t("admin.contracts.agreement")}</TableHead>
                            <TableHead>{t("admin.contracts.rightsReservation")}</TableHead>
                            <TableHead>
                                <button
                                    className="flex items-center text-xs font-medium"
                                    onClick={() => toggleSort("uploadedAt")}
                                >
                                    {t("admin.contracts.uploaded")}
                                    <SortIcon field="uploadedAt" />
                                </button>
                            </TableHead>
                            <TableHead>{t("admin.contracts.status")}</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={9}
                                    className="py-8 text-center text-sm text-muted-foreground"
                                >
                                    {t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell className="font-medium">{c.title}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {c.userName}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {c.creditedRoles.join(", ")}
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm">
                                            {t(`cat.${c.category}` as any)}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground tabular-nums">
                                        {c.premiereDate}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {c.extractedData?.collectiveAgreement
                                            ? c.extractedData.collectiveAgreementName || "Ja"
                                            : "—"}
                                    </TableCell>
                                    <TableCell className="text-sm max-w-[160px] truncate">
                                        {formatRights(c)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground tabular-nums">
                                        {c.uploadedAt}
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            variant={statusVariant[c.status]}
                                            className="font-normal"
                                        >
                                            {t(statusLabels[c.status] as any)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => setViewContract(c)}
                                                title={t("common.view")}
                                            >
                                                <Eye className="h-3.5 w-3.5" />
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                    >
                                                        <Filter className="h-3.5 w-3.5" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem>
                                                        <Download className="mr-2 h-3.5 w-3.5" />
                                                        {t("admin.contracts.downloadContract")}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-destructive focus:text-destructive"
                                                        onClick={() => setDeleteId(c.id)}
                                                    >
                                                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                                                        {t("common.delete")}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Contract Detail Dialog */}
            <Dialog
                open={!!viewContract}
                onOpenChange={() => {
                    setViewContract(null)
                    setLocalPdfUrl(null)
                }}
            >
                <DialogContent className="sm:max-w-7xl w-[92vw] h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {viewContract?.title}
                            <Badge
                                variant={statusVariant[viewContract?.status || "pending"]}
                                className="font-normal"
                            >
                                {viewContract
                                    ? t(statusLabels[viewContract.status] as any)
                                    : ""}
                            </Badge>
                        </DialogTitle>
                        <DialogDescription>
                            {viewContract?.userName} • {t(`cat.${viewContract?.category}` as any)} •{" "}
                            {viewContract?.premiereDate}
                            {(viewContract?.creditedRoles?.length ?? 0) > 0 && (
                                <> • <span className="font-medium text-foreground">{viewContract?.creditedRoles.join(", ")}</span></>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    {viewContract && (
                        <div className="flex-1 grid gap-4 overflow-hidden lg:grid-cols-[3fr_2fr]">
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
                                                <Eye className="h-4 w-4" />
                                                Vælg PDF
                                            </span>
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* Details */}
                            <div className="rounded-lg border overflow-auto">
                                <div className="p-4 space-y-4 text-sm">
                                    {/* Portal-submitted data */}
                                    {(viewContract.creditedRoles.length > 0 || viewContract.episodeCredits || viewContract.episodes) && (
                                        <>
                                            <div className="rounded-md bg-muted/40 border px-3 py-2.5 space-y-1.5">
                                                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Indsendt af klipper</p>
                                                {viewContract.episodeCredits && viewContract.episodeCredits.length > 0 ? (
                                                    <div className="space-y-0.5">
                                                        <span className="text-muted-foreground text-xs">Kreditering pr. afsnit:</span>
                                                        {Object.entries(
                                                            viewContract.episodeCredits.reduce<Record<string, number[]>>((acc, ec) => {
                                                                acc[ec.role] = [...(acc[ec.role] ?? []), ec.number]
                                                                return acc
                                                            }, {})
                                                        ).map(([role, nums]) => (
                                                            <div key={role} className="flex gap-2 pl-2">
                                                                <span className="text-muted-foreground shrink-0">{role}:</span>
                                                                <span className="tabular-nums">{nums.sort((a,b)=>a-b).map(n => `#${n}`).join(", ")}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : viewContract.creditedRoles.length > 0 && (
                                                    <div className="flex gap-2">
                                                        <span className="text-muted-foreground shrink-0">{t("upload.creditedRole")}:</span>
                                                        <span>{viewContract.creditedRoles.join(", ")}</span>
                                                    </div>
                                                )}
                                                {viewContract.duration > 0 && !viewContract.episodeCredits?.length && (
                                                    <div className="flex gap-2">
                                                        <span className="text-muted-foreground shrink-0">Varighed:</span>
                                                        <span className="tabular-nums">{viewContract.duration} min</span>
                                                    </div>
                                                )}
                                                {viewContract.premiereDate && (
                                                    <div className="flex gap-2">
                                                        <span className="text-muted-foreground shrink-0">Premiere:</span>
                                                        <span>{viewContract.premiereDate}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <Separator />
                                        </>
                                    )}
                                    {viewContract.extractedData ? (
                                        <>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.producer")}
                                                    </p>
                                                    <p className="font-medium">
                                                        {viewContract.extractedData.producerName || "—"}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.salary")}
                                                    </p>
                                                    <p className="font-medium tabular-nums">
                                                        {viewContract.extractedData.salary?.toLocaleString("da-DK")}{" "}
                                                        {t("common.kr")} / {t(`admin.validation.${viewContract.extractedData.salaryUnit || "monthly"}` as any)}
                                                    </p>
                                                </div>
                                            </div>
                                            <Separator />
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.startDate")}
                                                    </p>
                                                    <p>{viewContract.extractedData.startDate}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.endDate")}
                                                    </p>
                                                    <p>{viewContract.extractedData.endDate}</p>
                                                </div>
                                            </div>
                                            <Separator />
                                            <div className="grid grid-cols-3 gap-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.pensionPercent")}
                                                    </p>
                                                    <p className="tabular-nums">
                                                        {viewContract.extractedData.pensionPercent || 0}%
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.personalSupplement")}
                                                    </p>
                                                    <p className="tabular-nums">
                                                        {viewContract.extractedData.personalSupplement?.toLocaleString("da-DK") || 0}{" "}
                                                        {t("common.kr")}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.workingWeeks")}
                                                    </p>
                                                    <p className="tabular-nums">
                                                        {viewContract.extractedData.workingWeeks || "—"}
                                                    </p>
                                                </div>
                                            </div>
                                            <Separator />
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-2">
                                                    {t("admin.validation.rights")}
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <Badge variant={viewContract.extractedData.svod ? "default" : "outline"} className="font-normal">
                                                        SVOD {viewContract.extractedData.svod ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge variant={viewContract.extractedData.copydan ? "default" : "outline"} className="font-normal">
                                                        Copydan {viewContract.extractedData.copydan ? "✓" : "✗"}
                                                    </Badge>
                                                    <Badge variant={viewContract.extractedData.royalty ? "default" : "outline"} className="font-normal">
                                                        Royalty {viewContract.extractedData.royalty ? `${viewContract.extractedData.royaltyPercent}%` : "✗"}
                                                    </Badge>
                                                </div>
                                            </div>
                                            <Separator />
                                            {/* Producer contributions */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.holidayPay")}
                                                    </p>
                                                    <p className="tabular-nums">
                                                        {viewContract.extractedData.holidayPayRate || 0}%
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1">
                                                        {t("admin.validation.beta")}
                                                    </p>
                                                    <p className="tabular-nums">
                                                        {viewContract.extractedData.betaRate || 0}%
                                                    </p>
                                                </div>
                                            </div>
                                            <Separator />
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1">
                                                    {t("admin.validation.agreement")}
                                                </p>
                                                <p>
                                                    {viewContract.extractedData.collectiveAgreement
                                                        ? viewContract.extractedData.collectiveAgreementName
                                                        : "—"}
                                                </p>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-muted-foreground py-8 text-center">
                                            Ingen udtrukne data endnu
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
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
                        <Button variant="destructive" onClick={handleDelete}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("common.delete")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
