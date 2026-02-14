"use client"

import { useState, useMemo } from "react"
import {
    Search,
    Filter,
    FileDown,
    CheckCircle2,
    Clock,
    Send,
    AlertCircle,
    Banknote,
    Eye,
    MoreHorizontal,
} from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { mockProducerPaymentForms } from "@/lib/mock-data"
import type { ProducerPaymentForm, FundType, PaymentFormStatus } from "@/lib/types"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"

function formatKr(amount: number): string {
    return (
        new Intl.NumberFormat("da-DK", {
            style: "decimal",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount) + " kr."
    )
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("da-DK")
}

function StatusBadge({ status }: { status: PaymentFormStatus }) {
    const { t } = useI18n()
    const config: Record<
        PaymentFormStatus,
        { icon: typeof CheckCircle2; className: string; label: string }
    > = {
        draft: {
            icon: AlertCircle,
            className: "text-slate-600 border-slate-200 bg-slate-50 dark:bg-slate-950/30",
            label: t("admin.payments.draft"),
        },
        submitted: {
            icon: Send,
            className: "text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-950/30",
            label: t("admin.payments.submitted"),
        },
        verified: {
            icon: CheckCircle2,
            className:
                "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30",
            label: t("admin.payments.verified"),
        },
        paid: {
            icon: Banknote,
            className: "text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30",
            label: t("admin.payments.paid"),
        },
    }
    const c = config[status]
    const Icon = c.icon
    return (
        <Badge variant="outline" className={`gap-1 ${c.className}`}>
            <Icon className="h-3 w-3" />
            {c.label}
        </Badge>
    )
}

function FundBadge({ fundType }: { fundType: FundType }) {
    if (fundType === "helligdag") {
        return (
            <Badge variant="secondary" className="text-xs font-normal">
                Helligdag 1%
            </Badge>
        )
    }
    return (
        <Badge
            variant="secondary"
            className="text-xs font-normal bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400"
        >
            BETA 0,5%
        </Badge>
    )
}

function DetailDialog({
    form,
    open,
    onOpenChange,
}: {
    form: ProducerPaymentForm | null
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    if (!form) return null
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FundBadge fundType={form.fundType} />
                        {form.filmTitle}
                    </DialogTitle>
                    <DialogDescription>
                        Indsendt af {form.producerName} · {formatDate(form.submittedAt)}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs text-muted-foreground">Producent</p>
                            <p className="font-medium">{form.producerName}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Kontakt</p>
                            <p className="font-medium">{form.contactEmail}</p>
                        </div>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <p className="text-xs text-muted-foreground">Optagelsesstart</p>
                            <p>{form.shootingPeriodStart ? formatDate(form.shootingPeriodStart) : "—"}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Optagelsesslut</p>
                            <p>{form.shootingPeriodEnd ? formatDate(form.shootingPeriodEnd) : "—"}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Regnskab afsluttet</p>
                            <p>{form.accountClosedDate ? formatDate(form.accountClosedDate) : "—"}</p>
                        </div>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs text-muted-foreground">Ferieberettiget løn</p>
                            <p className="font-medium tabular-nums">{formatKr(form.ferieberettigetLoen)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Beregnet bidrag</p>
                            <p className="font-medium tabular-nums">{formatKr(form.calculatedContribution)}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <p className="text-xs text-muted-foreground">1. indbetaling</p>
                            <p className="tabular-nums">{formatKr(form.firstPayment)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Tidligere indbetalt</p>
                            <p className="tabular-nums">{formatKr(form.previouslyPaid)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">2. indbetaling</p>
                            <p className="tabular-nums">{formatKr(form.secondPayment)}</p>
                        </div>
                    </div>
                    <div className="rounded-lg border p-3 bg-muted/50">
                        <p className="text-xs text-muted-foreground">Total afregning</p>
                        <p className="text-lg font-semibold tabular-nums">
                            {formatKr(form.totalSettlement)}
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default function AdminIndbetalingerPage() {
    const { t } = useI18n()
    const [forms, setForms] = useState<ProducerPaymentForm[]>(mockProducerPaymentForms)

    // ── Filters ──
    const [search, setSearch] = useState("")
    const [filterYear, setFilterYear] = useState<string>("all")
    const [filterStatus, setFilterStatus] = useState<string>("all")
    const [filterFund, setFilterFund] = useState<string>("all")

    // ── Detail dialog ──
    const [selectedForm, setSelectedForm] = useState<ProducerPaymentForm | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)

    // ── Filter logic ──
    const years = useMemo(
        () => [...new Set(forms.map((f) => f.year))].sort((a, b) => b - a),
        [forms]
    )

    const filtered = useMemo(() => {
        let result = forms
        if (search.trim()) {
            const q = search.toLowerCase()
            result = result.filter(
                (f) =>
                    f.filmTitle.toLowerCase().includes(q) ||
                    f.producerName.toLowerCase().includes(q) ||
                    f.contactEmail.toLowerCase().includes(q)
            )
        }
        if (filterYear !== "all")
            result = result.filter((f) => f.year === Number(filterYear))
        if (filterStatus !== "all")
            result = result.filter((f) => f.status === filterStatus)
        if (filterFund !== "all")
            result = result.filter((f) => f.fundType === filterFund)
        return result
    }, [forms, search, filterYear, filterStatus, filterFund])

    // ── Summary stats ──
    const totalSubmitted = forms.length
    const totalHelligdag = forms
        .filter((f) => f.fundType === "helligdag")
        .reduce((s, f) => s + f.calculatedContribution, 0)
    const totalBeta = forms
        .filter((f) => f.fundType === "beta")
        .reduce((s, f) => s + f.calculatedContribution, 0)
    const pendingCount = forms.filter(
        (f) => f.status === "submitted" || f.status === "draft"
    ).length

    // ── Status management ──
    const updateStatus = (formId: string, newStatus: PaymentFormStatus) => {
        setForms((prev) =>
            prev.map((f) => (f.id === formId ? { ...f, status: newStatus } : f))
        )
        const statusLabels: Record<PaymentFormStatus, string> = {
            draft: "Kladde",
            submitted: "Indsendt",
            verified: "Verificeret",
            paid: "Betalt",
        }
        toast.success(`Status opdateret til: ${statusLabels[newStatus]}`)
    }

    const handleDownloadPdf = (form: ProducerPaymentForm) => {
        toast.success(
            `PDF genereret for ${form.filmTitle} (${form.fundType === "helligdag" ? "Helligdag" : "BETA"})`
        )
    }

    const handleViewDetail = (form: ProducerPaymentForm) => {
        setSelectedForm(form)
        setDetailOpen(true)
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.payments.title")}
                subtitle="Oversigt over modtagne indbetalingsskemaer fra producenter"
            />

            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Indberetninger i alt</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">
                            {totalSubmitted}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Afventer behandling</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums text-amber-600">
                            {pendingCount}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Helligdagsfond (1%)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">
                            {formatKr(totalHelligdag)}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>BETA-fond (0,5%)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">
                            {formatKr(totalBeta)}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Info banner */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20 p-4">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                    💡 Producenter indsender indbetalingsskemaer via den offentlige side:{" "}
                    <a
                        href="/indbetalinger"
                        className="font-medium underline underline-offset-4"
                        target="_blank"
                    >
                        /indbetalinger
                    </a>
                    . Nye indberetninger vises automatisk her.
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder={t("common.search")}
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger className="w-[140px]">
                        <Filter className="mr-2 h-3.5 w-3.5" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">
                            {t("admin.payments.allYears")}
                        </SelectItem>
                        {years.map((y) => (
                            <SelectItem key={y} value={String(y)}>
                                {y}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filterFund} onValueChange={setFilterFund}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">
                            {t("admin.payments.allFunds")}
                        </SelectItem>
                        <SelectItem value="helligdag">Helligdag (1%)</SelectItem>
                        <SelectItem value="beta">BETA (0,5%)</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[160px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">
                            {t("admin.payments.allStatuses")}
                        </SelectItem>
                        <SelectItem value="draft">
                            {t("admin.payments.draft")}
                        </SelectItem>
                        <SelectItem value="submitted">
                            {t("admin.payments.submitted")}
                        </SelectItem>
                        <SelectItem value="verified">
                            {t("admin.payments.verified")}
                        </SelectItem>
                        <SelectItem value="paid">
                            {t("admin.payments.paid")}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("admin.payments.fundType")}</TableHead>
                            <TableHead>{t("admin.payments.producer")}</TableHead>
                            <TableHead>{t("admin.payments.filmTitle")}</TableHead>
                            <TableHead className="text-right">
                                {t("admin.payments.ferieberettigetLoen")}
                            </TableHead>
                            <TableHead className="text-right">
                                {t("admin.payments.calculatedContribution")}
                            </TableHead>
                            <TableHead>{t("admin.payments.status")}</TableHead>
                            <TableHead>{t("admin.payments.submittedAt")}</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={8}
                                    className="h-24 text-center text-muted-foreground"
                                >
                                    {t("common.noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((form) => (
                                <TableRow key={form.id}>
                                    <TableCell>
                                        <FundBadge fundType={form.fundType} />
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {form.producerName}
                                    </TableCell>
                                    <TableCell>{form.filmTitle}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {formatKr(form.ferieberettigetLoen)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums font-medium">
                                        {formatKr(form.calculatedContribution)}
                                    </TableCell>
                                    <TableCell>
                                        <StatusBadge status={form.status} />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {formatDate(form.submittedAt)}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 w-8 p-0"
                                                >
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem
                                                    onClick={() => handleViewDetail(form)}
                                                >
                                                    <Eye className="mr-2 h-3.5 w-3.5" />
                                                    Vis detaljer
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => handleDownloadPdf(form)}
                                                >
                                                    <FileDown className="mr-2 h-3.5 w-3.5" />
                                                    Download PDF
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                {form.status !== "verified" && (
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            updateStatus(form.id, "verified")
                                                        }
                                                    >
                                                        <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-600" />
                                                        Markér som verificeret
                                                    </DropdownMenuItem>
                                                )}
                                                {form.status !== "paid" && (
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            updateStatus(form.id, "paid")
                                                        }
                                                    >
                                                        <Banknote className="mr-2 h-3.5 w-3.5 text-green-700" />
                                                        Markér som betalt
                                                    </DropdownMenuItem>
                                                )}
                                                {form.status !== "submitted" && (
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            updateStatus(form.id, "submitted")
                                                        }
                                                    >
                                                        <Send className="mr-2 h-3.5 w-3.5 text-blue-600" />
                                                        Nulstil til indsendt
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Detail dialog */}
            <DetailDialog
                form={selectedForm}
                open={detailOpen}
                onOpenChange={setDetailOpen}
            />
        </div>
    )
}
