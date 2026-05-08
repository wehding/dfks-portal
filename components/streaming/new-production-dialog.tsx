"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMasterData } from "@/lib/hooks"

// ── Types ─────────────────────────────────────────────────────

interface NewProductionDialogProps {
    open: boolean
    onClose: () => void
    nextProductionNumber: string
    onCreate: (production: {
        productionNumber: string
        title: string
        type: string
        premiereYear: number
        licenseDurationYears: number
        licenseStartYear: number
        platform?: string
        notes?: string
    }) => void
}

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i)

// ── Component ────────────────────────────────────────────────

export function NewProductionDialog({
    open, onClose, nextProductionNumber, onCreate
}: NewProductionDialogProps) {
    const { items: platforms } = useMasterData("platforms")
    const { items: productionTypes } = useMasterData("productionTypes")
    const { items: licensePeriods } = useMasterData("licensePeriods")

    const activeTypes = productionTypes.filter(t => t.active)
    const activePeriods = licensePeriods.filter(p => p.active)

    const [productionNumber, setProductionNumber] = useState(nextProductionNumber)
    const [title, setTitle] = useState("")
    const [type, setType] = useState("")
    const [premiereYear, setPremiereYear] = useState(String(currentYear))
    const [licenseStartYear, setLicenseStartYear] = useState(String(currentYear))
    const [licenseDurationYears, setLicenseDurationYears] = useState("")
    const [platform, setPlatform] = useState("")
    const [notes, setNotes] = useState("")

    const isValid = title.trim().length > 0 && productionNumber.trim().length > 0

    function handleTypeChange(val: string) {
        setType(val)
        const selected = productionTypes.find(pt => pt.name === val)
        if (selected?.meta) setLicenseDurationYears(selected.meta)
    }

    function handleSubmit() {
        if (!isValid) return
        onCreate({
            productionNumber: productionNumber.trim(),
            title: title.trim(),
            type,
            premiereYear: parseInt(premiereYear),
            licenseDurationYears: parseInt(licenseDurationYears) || 50,
            licenseStartYear: parseInt(licenseStartYear),
            platform: platform || undefined,
            notes: notes.trim() || undefined,
        })
        reset()
        onClose()
    }

    function reset() {
        setProductionNumber(nextProductionNumber)
        setTitle("")
        setType("")
        setPremiereYear(String(currentYear))
        setLicenseStartYear(String(currentYear))
        setLicenseDurationYears("")
        setPlatform("")
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
                        <Select value={type} onValueChange={handleTypeChange}>
                            <SelectTrigger>
                                <SelectValue placeholder="Vælg type..." />
                            </SelectTrigger>
                            <SelectContent>
                                {activeTypes.map(t => (
                                    <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Platform */}
                    <div className="space-y-1.5">
                        <Label>Platform</Label>
                        <Select value={platform} onValueChange={setPlatform}>
                            <SelectTrigger>
                                <SelectValue placeholder="Vælg platform..." />
                            </SelectTrigger>
                            <SelectContent>
                                {platforms.filter(p => p.active).map(p => (
                                    <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
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
                        <Select value={licenseDurationYears} onValueChange={setLicenseDurationYears}>
                            <SelectTrigger>
                                <SelectValue placeholder="Vælg periode..." />
                            </SelectTrigger>
                            <SelectContent>
                                {activePeriods.map(p => (
                                    <SelectItem key={p.id} value={p.name}>{p.name} år</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
