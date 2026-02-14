"use client"

import { useState } from "react"
import Image from "next/image"
import { Send, Banknote, CheckCircle2, ArrowLeft } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import type { FundType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import Link from "next/link"

const HELLIGDAG_RATE = 0.01
const BETA_RATE = 0.005
const HELLIGDAG_ACCOUNT = "3001 13371857"
const BETA_ACCOUNT = "3001 13371490"

function formatKr(amount: number): string {
    return (
        new Intl.NumberFormat("da-DK", {
            style: "decimal",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount) + " kr."
    )
}

export default function PublicIndbetalingerPage() {
    const { t } = useI18n()

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
    const [submitted, setSubmitted] = useState(false)
    const [errors, setErrors] = useState<Record<string, boolean>>({})

    // ── Computed values ──
    const rate = fundType === "helligdag" ? HELLIGDAG_RATE : BETA_RATE
    const bankAccount = fundType === "helligdag" ? HELLIGDAG_ACCOUNT : BETA_ACCOUNT
    const calculatedContribution = ferieberettigetLoen * rate
    const totalSettlement = firstPayment + secondPayment - previouslyPaid

    const validate = () => {
        const newErrors: Record<string, boolean> = {}
        if (!producerName.trim()) newErrors.producerName = true
        if (!filmTitle.trim()) newErrors.filmTitle = true
        if (!contactEmail.trim()) newErrors.contactEmail = true
        if (!ferieberettigetLoen || ferieberettigetLoen <= 0) newErrors.ferieberettigetLoen = true
        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleSubmit = () => {
        if (!validate()) return

        // In production, this would POST to an API endpoint
        // For now, we simulate a successful submission
        setSubmitted(true)
    }

    const handleReset = () => {
        setSubmitted(false)
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
        setErrors({})
    }

    if (submitted) {
        return (
            <div className="min-h-svh bg-gray-50 flex flex-col">
                {/* Header */}
                <header className="bg-white border-b py-6">
                    <div className="mx-auto max-w-2xl px-4 flex flex-col items-center">
                        <Image
                            src="/logo.png"
                            alt="Dansk Filmklipperselskab"
                            width={220}
                            height={90}
                            priority
                        />
                    </div>
                </header>

                {/* Success message */}
                <main className="flex-1 flex items-center justify-center px-4 py-12">
                    <Card className="max-w-md w-full text-center">
                        <CardContent className="pt-8 pb-8 space-y-6">
                            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-xl font-semibold">
                                    Indbetalingsskema modtaget
                                </h2>
                                <p className="text-muted-foreground text-sm leading-relaxed">
                                    Tak for din indberetning. Vi har modtaget dit indbetalingsskema for{" "}
                                    <strong>
                                        {fundType === "helligdag"
                                            ? "Helligdagsfonden (1%)"
                                            : "BETA / Barselsfonden (0,5%)"}
                                    </strong>
                                    .
                                </p>
                                <p className="text-muted-foreground text-sm">
                                    En bekræftelse vil blive sendt til{" "}
                                    <strong>{contactEmail}</strong>.
                                </p>
                            </div>

                            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-left space-y-1">
                                <div className="flex items-center gap-2">
                                    <Banknote className="h-4 w-4 text-blue-600 shrink-0" />
                                    <span className="font-medium text-blue-800">
                                        Indbetaling skal ske til:
                                    </span>
                                </div>
                                <p className="pl-6 font-mono text-blue-700">
                                    {bankAccount}
                                </p>
                                <p className="pl-6 text-blue-600">
                                    Beregnet bidrag: {formatKr(calculatedContribution)}
                                </p>
                            </div>

                            <div className="flex flex-col gap-2">
                                <Button onClick={handleReset} className="w-full">
                                    Indsend nyt skema
                                </Button>
                                <Link href="/">
                                    <Button variant="ghost" className="w-full gap-1.5">
                                        <ArrowLeft className="h-4 w-4" />
                                        Tilbage til forsiden
                                    </Button>
                                </Link>
                            </div>
                        </CardContent>
                    </Card>
                </main>

                {/* Footer */}
                <footer className="bg-white border-t py-6">
                    <div className="mx-auto max-w-2xl px-4 text-center text-xs text-muted-foreground space-y-1">
                        <p className="font-medium">Dansk Filmklipperselskab (DFKS)</p>
                        <p>Vermlandsgade 68 · 2300 København S</p>
                        <p>E-mail: info@markup.dk · Tlf: +45 33 86 28 80</p>
                    </div>
                </footer>
            </div>
        )
    }

    return (
        <div className="min-h-svh bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b py-6">
                <div className="mx-auto max-w-2xl px-4 flex flex-col items-center gap-3">
                    <Image
                        src="/logo.png"
                        alt="Dansk Filmklipperselskab"
                        width={220}
                        height={90}
                        priority
                    />
                    <div className="text-center">
                        <h1 className="text-lg font-semibold tracking-tight">
                            Indbetalingsskema for producenter
                        </h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Digital indberetning af bidrag til Helligdagsfond og BETA
                        </p>
                    </div>
                </div>
            </header>

            {/* Form */}
            <main className="flex-1 py-8 px-4">
                <div className="mx-auto max-w-2xl">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {t("admin.payments.newPayment")}
                            </CardTitle>
                            <CardDescription>
                                Udfyld formularen for at indberette bidrag til
                                Helligdagsfond eller BETA-fond. Alle felter markeret med * er
                                påkrævede.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* ── Section 1: Fund type ── */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                                    1. Vælg fondtype
                                </h3>
                                <Select
                                    value={fundType}
                                    onValueChange={(v) => setFundType(v as FundType)}
                                >
                                    <SelectTrigger className="w-full max-w-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="helligdag">
                                            {t("admin.payments.helligdag")}
                                        </SelectItem>
                                        <SelectItem value="beta">
                                            {t("admin.payments.beta")}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>

                                {/* Bank account info */}
                                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                                    <div className="flex items-center gap-2 text-sm">
                                        <Banknote className="h-4 w-4 text-blue-600 shrink-0" />
                                        <span className="font-medium text-blue-800">
                                            {t("admin.payments.bankAccount")}:
                                        </span>
                                        <span className="font-mono text-blue-700">
                                            {bankAccount}
                                        </span>
                                    </div>
                                    <p className="mt-1 ml-6 text-xs text-blue-600">
                                        {fundType === "helligdag"
                                            ? "Helligdagsfond (1% af ferieberettiget løn)"
                                            : "BETA / Barselsfond (0,5% af ferieberettiget løn)"}
                                    </p>
                                </div>
                            </div>

                            <Separator />

                            {/* ── Section 2: Producer & Film ── */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                                    2. Producent &amp; produktion
                                </h3>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.producer")} *
                                        </Label>
                                        <Input
                                            placeholder="Produktionsselskab..."
                                            value={producerName}
                                            onChange={(e) => setProducerName(e.target.value)}
                                            className={errors.producerName ? "border-red-400" : ""}
                                        />
                                        {errors.producerName && (
                                            <p className="text-xs text-red-500">Påkrævet felt</p>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.filmTitle")} *
                                        </Label>
                                        <Input
                                            placeholder="Filmens titel..."
                                            value={filmTitle}
                                            onChange={(e) => setFilmTitle(e.target.value)}
                                            className={errors.filmTitle ? "border-red-400" : ""}
                                        />
                                        {errors.filmTitle && (
                                            <p className="text-xs text-red-500">Påkrævet felt</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            {/* ── Section 3: Dates ── */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                                    3. Datoer
                                </h3>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.shootingPeriod")} —{" "}
                                            {t("admin.payments.shootingStart")}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={shootingStart}
                                            onChange={(e) => setShootingStart(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.shootingPeriod")} —{" "}
                                            {t("admin.payments.shootingEnd")}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={shootingEnd}
                                            onChange={(e) => setShootingEnd(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.accountClosed")}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={accountClosed}
                                            onChange={(e) => setAccountClosed(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            {/* ── Section 4: Calculation ── */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                                    4. Beregning
                                </h3>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.ferieberettigetLoen")} (kr.) *
                                        </Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={ferieberettigetLoen || ""}
                                            onChange={(e) =>
                                                setFerieberettigetLoen(Number(e.target.value))
                                            }
                                            className={
                                                errors.ferieberettigetLoen ? "border-red-400" : ""
                                            }
                                        />
                                        {errors.ferieberettigetLoen && (
                                            <p className="text-xs text-red-500">
                                                Angiv venligst ferieberettiget løn
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.calculatedContribution")} (
                                            {fundType === "helligdag" ? "1%" : "0,5%"})
                                        </Label>
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

                            {/* ── Section 5: Payment details ── */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                                    5. Indbetalinger
                                </h3>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.firstPayment")}
                                        </Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={firstPayment || ""}
                                            onChange={(e) =>
                                                setFirstPayment(Number(e.target.value))
                                            }
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            {t("admin.payments.firstPaymentHint")}
                                        </p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.previouslyPaid")}
                                        </Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={previouslyPaid || ""}
                                            onChange={(e) =>
                                                setPreviouslyPaid(Number(e.target.value))
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">
                                            {t("admin.payments.secondPayment")}
                                        </Label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={secondPayment || ""}
                                            onChange={(e) =>
                                                setSecondPayment(Number(e.target.value))
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="max-w-sm space-y-1.5">
                                    <Label className="text-xs">
                                        {t("admin.payments.totalSettlement")}
                                    </Label>
                                    <Input
                                        type="text"
                                        value={formatKr(totalSettlement)}
                                        disabled
                                        className="bg-muted font-medium text-lg"
                                    />
                                </div>
                            </div>

                            <Separator />

                            {/* ── Section 6: Contact ── */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                                    6. Kontaktoplysninger
                                </h3>
                                <div className="max-w-sm space-y-1.5">
                                    <Label className="text-xs">
                                        {t("admin.payments.contactEmail")} *
                                    </Label>
                                    <Input
                                        type="email"
                                        placeholder="kontakt@producent.dk"
                                        value={contactEmail}
                                        onChange={(e) => setContactEmail(e.target.value)}
                                        className={errors.contactEmail ? "border-red-400" : ""}
                                    />
                                    {errors.contactEmail && (
                                        <p className="text-xs text-red-500">Påkrævet felt</p>
                                    )}
                                </div>
                            </div>

                            <Separator />

                            {/* Submit */}
                            <div className="flex gap-3 pt-2">
                                <Button onClick={handleSubmit} className="gap-1.5">
                                    <Send className="h-4 w-4" />
                                    {t("admin.payments.submit")}
                                </Button>
                                <Link href="/">
                                    <Button variant="outline">
                                        {t("common.cancel")}
                                    </Button>
                                </Link>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>

            {/* Footer */}
            <footer className="bg-white border-t py-6 mt-8">
                <div className="mx-auto max-w-2xl px-4 text-center text-xs text-muted-foreground space-y-1">
                    <p className="font-medium">Dansk Filmklipperselskab (DFKS)</p>
                    <p>Vermlandsgade 68 · 2300 København S</p>
                    <p>E-mail: info@markup.dk · Tlf: +45 33 86 28 80</p>
                </div>
            </footer>
        </div>
    )
}
