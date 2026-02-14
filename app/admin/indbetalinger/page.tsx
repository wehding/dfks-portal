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
} from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { mockProducerPaymentForms } from "@/lib/mock-data"
import type { ProducerPaymentForm, FundType, PaymentFormStatus } from "@/lib/types"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"

const HELLIGDAG_RATE = 0.01
const BETA_RATE = 0.005
const HELLIGDAG_ACCOUNT = "3001 13371857"
const BETA_ACCOUNT = "3001 13371490"

function formatKr(amount: number): string {
    return new Intl.NumberFormat("da-DK", {
        style: "decimal",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount) + " kr."
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("da-DK")
}

function StatusBadge({ status }: { status: PaymentFormStatus }) {
    const { t } = useI18n()
    const config: Record<PaymentFormStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
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
            className: "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30",
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
        <Badge variant="secondary" className="text-xs font-normal bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
            BETA 0,5%
        </Badge>
    )
}

export default function AdminIndbetalingerPage() {
    const { t } = useI18n()
    const [forms, setForms] = useState<ProducerPaymentForm[]>(mockProducerPaymentForms)
    const [activeTab, setActiveTab] = useState("overview")

    // ── Form state ──
    const [fundType, setFundType] = useState<FundType>("helligdag")
    const [producerName, setProducerName] = useState("")
    const [filmTitle, setFilmTitle] = useState("")
    const [shootingStart, setShootingStart] = useState("")
    const [shootingEnd, setShootingEnd] = useState("")
    const [accountClosed, setAccountClosed] = useState("")
    const [ferieberettigetLoen, setFerieberettigetLoen] = useState<number>(0)
    const [firstPayment, setFirstPayment] = useState<number>(0)
    const [previouslyPaid, setPreviouslyPaid] = useState<number>(0)
    const [secondPayment, setSecondPayment] = useState<number>(0)
    const [contactEmail, setContactEmail] = useState("")

    // ── Filters ──
    const [search, setSearch] = useState("")
    const [filterYear, setFilterYear] = useState<string>("all")
    const [filterStatus, setFilterStatus] = useState<string>("all")
    const [filterFund, setFilterFund] = useState<string>("all")

    // ── Computed values ──
    const rate = fundType === "helligdag" ? HELLIGDAG_RATE : BETA_RATE
    const bankAccount = fundType === "helligdag" ? HELLIGDAG_ACCOUNT : BETA_ACCOUNT
    const calculatedContribution = ferieberettigetLoen * rate
    const totalSettlement = firstPayment + secondPayment - previouslyPaid

    // ── Filter logic ──
    const years = useMemo(
        () => [...new Set(forms.map((f) => f.year))].sort((a, b) => b - a),
        [forms]
    )
    const producers = useMemo(
        () => [...new Set(forms.map((f) => f.producerName))].sort(),
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
        if (filterYear !== "all") result = result.filter((f) => f.year === Number(filterYear))
        if (filterStatus !== "all") result = result.filter((f) => f.status === filterStatus)
        if (filterFund !== "all") result = result.filter((f) => f.fundType === filterFund)
        return result
    }, [forms, search, filterYear, filterStatus, filterFund])

    // ── Summary stats ──
    const totalSubmitted = forms.length
    const totalHelligdag = forms.filter((f) => f.fundType === "helligdag").reduce((s, f) => s + f.calculatedContribution, 0)
    const totalBeta = forms.filter((f) => f.fundType === "beta").reduce((s, f) => s + f.calculatedContribution, 0)

    const handleSubmit = () => {
        if (!producerName || !filmTitle || !contactEmail || !ferieberettigetLoen) {
            toast.error("Udfyld venligst alle påkrævede felter")
            return
        }
        const newForm: ProducerPaymentForm = {
            id: `ppf${Date.now()}`,
            fundType,
            producerName,
            filmTitle,
            shootingPeriodStart: shootingStart,
            shootingPeriodEnd: shootingEnd,
            accountClosedDate: accountClosed,
            ferieberettigetLoen,
            calculatedContribution,
            firstPayment,
            previouslyPaid,
            secondPayment,
            totalSettlement: calculatedContribution,
            contactEmail,
            status: "submitted",
            submittedAt: new Date().toISOString().split("T")[0],
            year: new Date().getFullYear(),
        }
        setForms((prev) => [newForm, ...prev])
        toast.success(t("admin.payments.formSubmitted"))
        // Reset form
        setProducerName("")
        setFilmTitle("")
        setShootingStart("")
        setShootingEnd("")
        setAccountClosed("")
        setFerieberettigetLoen(0)
        setFirstPayment(0)
        setPreviouslyPaid(0)
        setSecondPayment(0)
        setContactEmail("")
        setActiveTab("overview")
    }

    const handleDownloadPdf = (form: ProducerPaymentForm) => {
        // In production, this would generate a real PDF
        toast.success(`PDF genereret for ${form.filmTitle} (${form.fundType === "helligdag" ? "Helligdag" : "BETA"})`)
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t("admin.payments.title")}
                subtitle={t("admin.payments.subtitle")}
            />

            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Indberetninger i alt</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{totalSubmitted}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Helligdagsfond (1%)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{formatKr(totalHelligdag)}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>BETA-fond (0,5%)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{formatKr(totalBeta)}</div>
                    </CardContent>
                </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="overview">{t("admin.payments.overview")}</TabsTrigger>
                    <TabsTrigger value="new">{t("admin.payments.newPayment")}</TabsTrigger>
                </TabsList>

                {/* ── Overview Tab ── */}
                <TabsContent value="overview" className="space-y-4 mt-4">
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
                                <SelectItem value="all">{t("admin.payments.allYears")}</SelectItem>
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
                                <SelectItem value="all">{t("admin.payments.allFunds")}</SelectItem>
                                <SelectItem value="helligdag">Helligdag (1%)</SelectItem>
                                <SelectItem value="beta">BETA (0,5%)</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={filterStatus} onValueChange={setFilterStatus}>
                            <SelectTrigger className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("admin.payments.allStatuses")}</SelectItem>
                                <SelectItem value="draft">{t("admin.payments.draft")}</SelectItem>
                                <SelectItem value="submitted">{t("admin.payments.submitted")}</SelectItem>
                                <SelectItem value="verified">{t("admin.payments.verified")}</SelectItem>
                                <SelectItem value="paid">{t("admin.payments.paid")}</SelectItem>
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
                                    <TableHead className="text-right">{t("admin.payments.ferieberettigetLoen")}</TableHead>
                                    <TableHead className="text-right">{t("admin.payments.calculatedContribution")}</TableHead>
                                    <TableHead>{t("admin.payments.status")}</TableHead>
                                    <TableHead>{t("admin.payments.submittedAt")}</TableHead>
                                    <TableHead className="w-[80px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                            {t("common.noResults")}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filtered.map((form) => (
                                        <TableRow key={form.id}>
                                            <TableCell>
                                                <FundBadge fundType={form.fundType} />
                                            </TableCell>
                                            <TableCell className="font-medium">{form.producerName}</TableCell>
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
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="gap-1 text-xs"
                                                    onClick={() => handleDownloadPdf(form)}
                                                >
                                                    <FileDown className="h-3 w-3" />
                                                    PDF
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* ── New Payment Tab ── */}
                <TabsContent value="new" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("admin.payments.newPayment")}</CardTitle>
                            <CardDescription>
                                Udfyld formularen for at indberette bidrag til Helligdagsfond eller BETA-fond
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Fund type selection */}
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">{t("admin.payments.fundType")}</Label>
                                <Select value={fundType} onValueChange={(v) => setFundType(v as FundType)}>
                                    <SelectTrigger className="w-full max-w-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="helligdag">{t("admin.payments.helligdag")}</SelectItem>
                                        <SelectItem value="beta">{t("admin.payments.beta")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Bank account info */}
                            <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20 p-4">
                                <div className="flex items-center gap-2 text-sm">
                                    <Banknote className="h-4 w-4 text-blue-600" />
                                    <span className="font-medium text-blue-800 dark:text-blue-200">
                                        {t("admin.payments.bankAccount")}:
                                    </span>
                                    <span className="font-mono text-blue-700 dark:text-blue-300">
                                        {bankAccount}
                                    </span>
                                    <span className="text-blue-600 dark:text-blue-400">
                                        — {fundType === "helligdag" ? "Helligdagsfond (1%)" : "BETA / Barselsfond (0,5%)"}
                                    </span>
                                </div>
                            </div>

                            <Separator />

                            {/* Producer & Film info */}
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.payments.producer")} *</Label>
                                    <Input
                                        placeholder="Produktionsselskab..."
                                        value={producerName}
                                        onChange={(e) => setProducerName(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.payments.filmTitle")} *</Label>
                                    <Input
                                        placeholder="Filmens titel..."
                                        value={filmTitle}
                                        onChange={(e) => setFilmTitle(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Dates */}
                            <div className="grid gap-4 sm:grid-cols-3">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.payments.shootingPeriod")} — {t("admin.payments.shootingStart")}</Label>
                                    <Input
                                        type="date"
                                        value={shootingStart}
                                        onChange={(e) => setShootingStart(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.payments.shootingPeriod")} — {t("admin.payments.shootingEnd")}</Label>
                                    <Input
                                        type="date"
                                        value={shootingEnd}
                                        onChange={(e) => setShootingEnd(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">{t("admin.payments.accountClosed")}</Label>
                                    <Input
                                        type="date"
                                        value={accountClosed}
                                        onChange={(e) => setAccountClosed(e.target.value)}
                                    />
                                </div>
                            </div>

                            <Separator />

                            {/* Financial section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-medium">Beregning</h3>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.payments.ferieberettigetLoen")} (kr.) *</Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={ferieberettigetLoen || ""}
                                            onChange={(e) => setFerieberettigetLoen(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.payments.calculatedContribution")} ({fundType === "helligdag" ? "1%" : "0,5%"})</Label>
                                        <Input
                                            type="text"
                                            value={formatKr(calculatedContribution)}
                                            disabled
                                            className="bg-muted font-medium"
                                        />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            {/* Payment details */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-medium">Indbetalinger</h3>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.payments.firstPayment")}</Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={firstPayment || ""}
                                            onChange={(e) => setFirstPayment(Number(e.target.value))}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            {t("admin.payments.firstPaymentHint")}
                                        </p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.payments.previouslyPaid")}</Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={previouslyPaid || ""}
                                            onChange={(e) => setPreviouslyPaid(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">{t("admin.payments.secondPayment")}</Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={secondPayment || ""}
                                            onChange={(e) => setSecondPayment(Number(e.target.value))}
                                        />
                                    </div>
                                </div>
                                <div className="max-w-sm space-y-1.5">
                                    <Label className="text-xs">{t("admin.payments.totalSettlement")}</Label>
                                    <Input
                                        type="text"
                                        value={formatKr(totalSettlement)}
                                        disabled
                                        className="bg-muted font-medium text-lg"
                                    />
                                </div>
                            </div>

                            <Separator />

                            {/* Contact */}
                            <div className="max-w-sm space-y-1.5">
                                <Label className="text-xs">{t("admin.payments.contactEmail")} *</Label>
                                <Input
                                    type="email"
                                    placeholder="kontakt@producent.dk"
                                    value={contactEmail}
                                    onChange={(e) => setContactEmail(e.target.value)}
                                />
                            </div>

                            {/* Submit */}
                            <div className="flex gap-3 pt-2">
                                <Button onClick={handleSubmit} className="gap-1.5">
                                    <Send className="h-4 w-4" />
                                    {t("admin.payments.submit")}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setActiveTab("overview")}
                                >
                                    {t("common.cancel")}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
