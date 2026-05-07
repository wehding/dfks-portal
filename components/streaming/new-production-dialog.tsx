"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ProductionType, LicenseDuration } from "@/lib/streaming-types"

// ── Types ─────────────────────────────────────────────────────

interface NewProductionDialogProps {
    open: boolean
    onClose: () => void
    nextProductionNumber: string
    onCreate: (production: {
        productionNumber: string
        title: string
        type: ProductionType
        premiereYear: number
        licenseDurationYears: LicenseDuration
        licenseStartYear: number
        notes?: string
    }) => void
}

// ── Helpers ──────────────────────────────────────────────────

const productionTypes: { value: ProductionType; label: string; defaultLicense: LicenseDuration }[] = [
    { value: "film_original",        label: "Film — Original",           defaultLicense: 50 },
    { value: "film_licensed",        label: "Film — Licenseret",         defaultLicense: 10 },
    { value: "tv_series_original",   label: "TV Serie — Original",       defaultLicense: 50 },
    { value: "tv_series_licensed",   label: "TV Serie — Licenseret",     defaultLicense: 10 },
    { value: "short_original",       label: "Kortfilm — Original",       defaultLicense: 50 },
    { value: "documentary_original", label: "Dokumentar — Original",     defaultLicense: 50 },
]

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i)

// ── Component ────────────────────────────────────────────────

export function NewProductionDialog({
    open, onClose, nextProductionNumber, onCreate
}: NewProductionDialogProps) {
    const [productionNumber, setProductionNumber] = useState(nextProductionNumber)
    const [title, setTitle] = useState("")
    const [type, setType] = useState<ProductionType>("film_original")
    const [premiereYear, setPremiereYear] = useState(String(currentYear))
    const [licenseStartYear, setLicenseStartYear] = useState(String(currentYear))
    const [licenseDurationYears, setLicenseDurationYears] = useState<LicenseDuration>(50)
    const [notes, setNotes] = useState("")

    const selectedType = productionTypes.find(t => t.value === type)
    const isValid = title.trim().length > 0 && productionNumber.trim().length > 0

    function handleTypeChange(val: ProductionType) {
        setType(val)
        const t = productionTypes.find(pt => pt.value === val)
        if (t) setLicenseDurationYears(t.defaultLicense)
    }

    function handleSubmit() {
        if (!isValid) return
        onCreate({
            productionNumber: productionNumber.trim(),
            title: title.trim(),
            type,
            premiereYear: parseInt(premiereYear),
            licenseDurationYears,
            licenseStartYear: parseInt(licenseStartYear),
            notes: notes.trim() || undefined,
        })
        reset()
        onClose()
    }

    function reset() {
        setProductionNumber(nextProductionNumber)
        setTitle("")
        setType("film_original")
        setPremiereYear(String(currentYear))
        setLicenseStartYear(String(currentYear))
        setLicenseDurationYears(50)
        setNotes("")
    }

    function handleClose() { reset(); onClose() }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Ny produktion</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Produktionsnummer + titel */}
                    <div className="grid grid-cols-[100px_1fr] gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="productionNumber">Nr.</Label>
                            <Input
                                id="productionNumber"
                                value={productionNumber}
                                onChange={e => setProductionNumber(e.target.value)}
                                className="font-mono"
                                maxLength={10}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="title">
                                Titel <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="title"
                                placeholder="Produktionens titel"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Type */}
                    <div className="space-y-1.5">
                        <Label>Type</Label>
                        <Select value={type} onValueChange={v => handleTypeChange(v as ProductionType)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {productionTypes.map(t => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Premiere år */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Premiereår</Label>
                            <Select value={premiereYear} onValueChange={setPremiereYear}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {years.map(y => (
                                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Licens startår</Label>
                            <Select value={licenseStartYear} onValueChange={setLicenseStartYear}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {years.map(y => (
                                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Licensperiode */}
                    <div className="space-y-1.5">
                        <Label>Licensperiode</Label>
                        <Select
                            value={String(licenseDurationYears)}
                            onValueChange={v => setLicenseDurationYears(Number(v) as LicenseDuration)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="10">10 år (licenseret)</SelectItem>
                                <SelectItem value="50">50 år (original)</SelectItem>
                            </SelectContent>
                        </Select>
                        {selectedType && (
                            <p className="text-xs text-muted-foreground">
                                Standard for {selectedType.label.split("—")[0].trim()} er {selectedType.defaultLicense} år
                            </p>
                        )}
                    </div>

                    {/* Note */}
                    <div className="space-y-1.5">
                        <Label htmlFor="notes">
                            Note <span className="text-muted-foreground font-normal">(valgfri)</span>
                        </Label>
                        <Input
                            id="notes"
                            placeholder="Intern note..."
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>Annuller</Button>
                    <Button onClick={handleSubmit} disabled={!isValid}>
                        Opret produktion
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
